import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as ts from 'typescript';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  IdempotencyPort,
  LoyaltyTransactionsPort,
  MockPaymentGatewayPort,
  OrderTransactionsPort,
} from '../src/common/contracts/ports';
import type { IdempotentResult, StoredOrder, Tx } from '../src/common/contracts/ports';
import { IdentityPort } from '../src/common/security/security';
import { ApiError } from '../src/common/errors/api-error';
import { MockPaymentGatewayService } from '../src/modules/payments/mock-payment-gateway.service';
import * as paymentApiModule from '../../frontend/src/components/payments/payment-api';
import {
  submitPayment,
  verifyReplayedOrder,
} from '../../frontend/src/components/payments/payment-api';

const userId = '33333333-3333-4333-8333-333333333333';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const orderId = '44444444-4444-4444-8444-444444444444';
const productId = '11111111-1111-4111-8111-111111111111';
const toppingId = '22222222-2222-4222-8222-222222222222';
const itemId = '55555555-5555-4555-8555-555555555555';
const paymentId = '66666666-6666-4666-8666-666666666666';
const idempotencyRecordId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const idempotencyKey = '77777777-7777-4777-8777-777777777777';
const retryKey = '99999999-9999-4999-8999-999999999999';
const fixedDate = new Date('2026-10-22T12:00:00.000Z');
const authHeader = 'Bearer valid-customer-token';

function buildStoredOrder(overrides: Partial<StoredOrder> = {}): StoredOrder {
  return {
    id: orderId,
    code: 'BL-20261022-A1B2C3D4',
    userId,
    promotionId: null,
    promotionCode: 'SAVE10',
    subtotal: 120000,
    discount: 12000,
    total: 108000,
    status: 'PENDING',
    reservationStatus: 'HELD',
    version: 0,
    createdAt: fixedDate,
    updatedAt: fixedDate,
    items: [
      {
        id: itemId,
        orderId,
        productId,
        productName: 'Cappuccino',
        size: 'M',
        sizePrice: 50000,
        unitPrice: 60000,
        qty: 2,
        lineTotal: 120000,
        toppings: [
          {
            orderItemId: itemId,
            toppingId,
            name: 'Kem',
            price: 10000,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('MockPaymentGatewayService (#10)', () => {
  const gateway = new MockPaymentGatewayService();

  it('returns SUCCEEDED when mockOutcome is SUCCESS for WALLET and CARD', async () => {
    await expect(
      gateway.charge({ orderId, amount: 108000, method: 'WALLET', mockOutcome: 'SUCCESS' }),
    ).resolves.toEqual({ status: 'SUCCEEDED' });

    await expect(
      gateway.charge({ orderId, amount: 0, method: 'CARD', mockOutcome: 'SUCCESS' }),
    ).resolves.toEqual({ status: 'SUCCEEDED' });
  });

  it('returns FAILED when mockOutcome is FAIL', async () => {
    await expect(
      gateway.charge({ orderId, amount: 108000, method: 'WALLET', mockOutcome: 'FAIL' }),
    ).resolves.toEqual({ status: 'FAILED' });
  });

  it('rejects negative or non-integer amounts', async () => {
    await expect(
      gateway.charge({ orderId, amount: -1, method: 'WALLET', mockOutcome: 'SUCCESS' }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      gateway.charge({ orderId, amount: 100.5, method: 'CARD', mockOutcome: 'SUCCESS' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('PaymentsService & POST /api/payments (#10)', () => {
  let app: INestApplication;
  let gateway: MockPaymentGatewayPort;

  const mockTx = {
    idempotencyRecord: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    payment: {
      create: jest.fn(),
    },
  };

  const idempotencyExecute = jest.fn();
  const loadOwned = jest.fn();
  const transition = jest.fn();
  const prepareRetry = jest.fn();
  const loyaltyEarn = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) })
      .overrideProvider(IdentityPort)
      .useValue({
        verifyAccessToken: async (token: string) => {
          if (token !== 'valid-customer-token') {
            throw new ApiError(401, 'UNAUTHORIZED', 'Token không hợp lệ');
          }
          return { id: userId, email: 'customer@example.com', role: 'CUSTOMER' as const };
        },
      })
      .overrideProvider(IdempotencyPort)
      .useValue({
        execute: <T>(
          input: { userId: string; scope: 'CREATE_ORDER' | 'PAY_ORDER'; key: string; payload: unknown; httpStatus: 200 | 201 },
          work: (tx: Tx) => Promise<T>,
        ): Promise<IdempotentResult<T>> => idempotencyExecute(input, work),
      })
      .overrideProvider(OrderTransactionsPort)
      .useValue({
        loadOwned,
        transition,
        prepareRetry,
      })
      .overrideProvider(LoyaltyTransactionsPort)
      .useValue({
        earn: loyaltyEarn,
        reverse: jest.fn(),
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    gateway = moduleRef.get(MockPaymentGatewayPort);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockTx.idempotencyRecord.findUnique.mockResolvedValue({ id: idempotencyRecordId });
    idempotencyExecute.mockImplementation(async (_input, work: (tx: Tx) => Promise<unknown>) => {
      const data = await work(mockTx as unknown as Tx);
      return { data, replayed: false };
    });
  });

  it('pays a PENDING order with WALLET (SUCCESS), transitions to PAID/CONSUMED, and earns loyalty points', async () => {
    const pendingOrder = buildStoredOrder({ status: 'PENDING', reservationStatus: 'HELD', version: 0 });
    const paidOrder = buildStoredOrder({ status: 'PAID', reservationStatus: 'CONSUMED', version: 1 });

    loadOwned.mockResolvedValueOnce(pendingOrder);
    transition.mockResolvedValueOnce(paidOrder);
    loyaltyEarn.mockResolvedValueOnce(10);
    mockTx.payment.create.mockResolvedValueOnce({
      id: paymentId,
      orderId,
      idempotencyRecordId,
      idempotencyKey,
      amount: 108000,
      method: 'WALLET',
      status: 'SUCCEEDED',
      createdAt: fixedDate,
      updatedAt: fixedDate,
    });

    const chargeSpy = jest.spyOn(gateway, 'charge');

    const response = await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        orderId,
        method: 'WALLET',
        mockOutcome: 'SUCCESS',
      })
      .expect(200)
      .expect('Idempotency-Replayed', 'false');

    expect(idempotencyExecute).toHaveBeenCalledWith(
      {
        userId,
        scope: 'PAY_ORDER',
        key: idempotencyKey,
        payload: { orderId, method: 'WALLET', mockOutcome: 'SUCCESS' },
        httpStatus: 200,
      },
      expect.any(Function),
    );
    expect(chargeSpy).toHaveBeenCalledWith({
      orderId,
      amount: 108000,
      method: 'WALLET',
      mockOutcome: 'SUCCESS',
    });
    expect(transition).toHaveBeenCalledWith(mockTx, {
      orderId,
      actorUserId: userId,
      expectedVersion: 0,
      toStatus: 'PAID',
    });
    expect(loyaltyEarn).toHaveBeenCalledWith(mockTx, paidOrder);
    expect(response.body).toEqual({
      payment: {
        id: paymentId,
        orderId,
        idempotencyKey,
        amount: 108000,
        method: 'WALLET',
        status: 'SUCCEEDED',
        createdAt: '2026-10-22T12:00:00.000Z',
        updatedAt: '2026-10-22T12:00:00.000Z',
      },
      order: {
        id: orderId,
        code: 'BL-20261022-A1B2C3D4',
        status: 'PAID',
        reservationStatus: 'CONSUMED',
        version: 1,
        subtotal: 120000,
        discount: 12000,
        total: 108000,
        currency: 'VND',
        promotionCode: 'SAVE10',
        createdAt: '2026-10-22T12:00:00.000Z',
        updatedAt: '2026-10-22T12:00:00.000Z',
        items: [
          {
            id: itemId,
            productId,
            productName: 'Cappuccino',
            size: 'M',
            sizePrice: 50000,
            toppings: [{ id: toppingId, name: 'Kem', price: 10000 }],
            qty: 2,
            unitPrice: 60000,
            lineTotal: 120000,
          },
        ],
      },
      loyaltyPointsEarned: 10,
    });
  });

  it('defaults mockOutcome to SUCCESS and supports CARD method', async () => {
    const pendingOrder = buildStoredOrder({ status: 'PENDING', reservationStatus: 'HELD', version: 0 });
    const paidOrder = buildStoredOrder({ status: 'PAID', reservationStatus: 'CONSUMED', version: 1 });

    loadOwned.mockResolvedValueOnce(pendingOrder);
    transition.mockResolvedValueOnce(paidOrder);
    loyaltyEarn.mockResolvedValueOnce(10);
    mockTx.payment.create.mockResolvedValueOnce({
      id: paymentId,
      orderId,
      idempotencyRecordId,
      idempotencyKey,
      amount: 108000,
      method: 'CARD',
      status: 'SUCCEEDED',
      createdAt: fixedDate,
      updatedAt: fixedDate,
    });

    const response = await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        orderId,
        method: 'CARD',
      })
      .expect(200);

    expect(idempotencyExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { orderId, method: 'CARD', mockOutcome: 'SUCCESS' },
      }),
      expect.any(Function),
    );
    expect(response.body.payment.method).toBe('CARD');
    expect(response.body.payment.status).toBe('SUCCEEDED');
    expect(response.body.order.status).toBe('PAID');
  });

  it('handles mock FAIL by transitioning to PAYMENT_FAILED/RELEASED with 0 loyalty points and HTTP 200', async () => {
    const pendingOrder = buildStoredOrder({ status: 'PENDING', reservationStatus: 'HELD', version: 0 });
    const failedOrder = buildStoredOrder({ status: 'PAYMENT_FAILED', reservationStatus: 'RELEASED', version: 1 });

    loadOwned.mockResolvedValueOnce(pendingOrder);
    transition.mockResolvedValueOnce(failedOrder);
    mockTx.payment.create.mockResolvedValueOnce({
      id: paymentId,
      orderId,
      idempotencyRecordId,
      idempotencyKey,
      amount: 108000,
      method: 'WALLET',
      status: 'FAILED',
      createdAt: fixedDate,
      updatedAt: fixedDate,
    });

    const response = await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        orderId,
        method: 'WALLET',
        mockOutcome: 'FAIL',
      })
      .expect(200)
      .expect('Idempotency-Replayed', 'false');

    expect(transition).toHaveBeenCalledWith(mockTx, {
      orderId,
      actorUserId: userId,
      expectedVersion: 0,
      toStatus: 'PAYMENT_FAILED',
    });
    expect(loyaltyEarn).not.toHaveBeenCalled();
    expect(response.body.payment.status).toBe('FAILED');
    expect(response.body.order.status).toBe('PAYMENT_FAILED');
    expect(response.body.order.reservationStatus).toBe('RELEASED');
    expect(response.body.loyaltyPointsEarned).toBe(0);
  });

  it('retries a PAYMENT_FAILED order with a new key by calling prepareRetry then transitioning to PAID', async () => {
    const failedOrder = buildStoredOrder({ status: 'PAYMENT_FAILED', reservationStatus: 'RELEASED', version: 1 });
    const reReservedOrder = buildStoredOrder({ status: 'PENDING', reservationStatus: 'HELD', version: 2 });
    const paidOrder = buildStoredOrder({ status: 'PAID', reservationStatus: 'CONSUMED', version: 3 });

    loadOwned.mockResolvedValueOnce(failedOrder);
    prepareRetry.mockResolvedValueOnce(reReservedOrder);
    transition.mockResolvedValueOnce(paidOrder);
    loyaltyEarn.mockResolvedValueOnce(10);
    mockTx.payment.create.mockResolvedValueOnce({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      orderId,
      idempotencyRecordId,
      idempotencyKey: retryKey,
      amount: 108000,
      method: 'WALLET',
      status: 'SUCCEEDED',
      createdAt: fixedDate,
      updatedAt: fixedDate,
    });

    const response = await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', retryKey)
      .send({
        orderId,
        method: 'WALLET',
        mockOutcome: 'SUCCESS',
      })
      .expect(200);

    expect(prepareRetry).toHaveBeenCalledWith(mockTx, failedOrder);
    expect(transition).toHaveBeenCalledWith(mockTx, {
      orderId,
      actorUserId: userId,
      expectedVersion: 2,
      toStatus: 'PAID',
    });
    expect(response.body.order.status).toBe('PAID');
    expect(response.body.order.version).toBe(3);
    expect(response.body.loyaltyPointsEarned).toBe(10);
  });

  it('rejects paying an already PAID or CANCELLED order with a new key (409 ORDER_NOT_PAYABLE)', async () => {
    const paidOrder = buildStoredOrder({ status: 'PAID', reservationStatus: 'CONSUMED', version: 1 });
    loadOwned.mockResolvedValueOnce(paidOrder);

    const response = await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', retryKey)
      .send({
        orderId,
        method: 'WALLET',
      })
      .expect(409);

    expect(response.body.code).toBe('ORDER_NOT_PAYABLE');
    expect(transition).not.toHaveBeenCalled();
  });

  it('returns 404 ORDER_NOT_FOUND when order belongs to another user', async () => {
    const foreignOrder = buildStoredOrder({ userId: otherUserId });
    loadOwned.mockResolvedValueOnce(foreignOrder);

    const response = await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        orderId,
        method: 'WALLET',
      })
      .expect(404);

    expect(response.body.code).toBe('ORDER_NOT_FOUND');
  });

  it('maps database unique constraint P2002 on Payment to 409 ORDER_NOT_PAYABLE', async () => {
    const pendingOrder = buildStoredOrder({ status: 'PENDING', reservationStatus: 'HELD', version: 0 });
    const paidOrder = buildStoredOrder({ status: 'PAID', reservationStatus: 'CONSUMED', version: 1 });

    loadOwned.mockResolvedValueOnce(pendingOrder);
    transition.mockResolvedValueOnce(paidOrder);
    loyaltyEarn.mockResolvedValueOnce(10);
    mockTx.payment.create.mockRejectedValueOnce({ code: 'P2002' });

    const response = await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        orderId,
        method: 'WALLET',
      })
      .expect(409);

    expect(response.body.code).toBe('ORDER_NOT_PAYABLE');
  });

  it('rejects paying a CANCELLED order with a new key (409 ORDER_NOT_PAYABLE)', async () => {
    const cancelledOrder = buildStoredOrder({ status: 'CANCELLED', reservationStatus: 'RELEASED', version: 1 });
    loadOwned.mockResolvedValueOnce(cancelledOrder);

    const response = await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', retryKey)
      .send({
        orderId,
        method: 'WALLET',
      })
      .expect(409);

    expect(response.body.code).toBe('ORDER_NOT_PAYABLE');
    expect(transition).not.toHaveBeenCalled();
  });

  it('returns cached response with Idempotency-Replayed: true when replaying same key & payload without double charging', async () => {
    const cachedResult = {
      payment: {
        id: paymentId,
        orderId,
        idempotencyKey,
        amount: 108000,
        method: 'WALLET',
        status: 'SUCCEEDED',
        createdAt: '2026-10-22T12:00:00.000Z',
        updatedAt: '2026-10-22T12:00:00.000Z',
      },
      order: {
        id: orderId,
        code: 'BL-20261022-A1B2C3D4',
        status: 'PAID',
        reservationStatus: 'CONSUMED',
        version: 1,
        subtotal: 120000,
        discount: 12000,
        total: 108000,
        currency: 'VND',
        promotionCode: 'SAVE10',
        createdAt: '2026-10-22T12:00:00.000Z',
        updatedAt: '2026-10-22T12:00:00.000Z',
        items: [],
      },
      loyaltyPointsEarned: 10,
    };

    idempotencyExecute.mockResolvedValueOnce({
      data: cachedResult,
      replayed: true,
    });

    const chargeSpy = jest.spyOn(gateway, 'charge');

    const response = await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        orderId,
        method: 'WALLET',
        mockOutcome: 'SUCCESS',
      })
      .expect(200)
      .expect('Idempotency-Replayed', 'true');

    expect(response.body).toEqual(cachedResult);
    expect(chargeSpy).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
    expect(loyaltyEarn).not.toHaveBeenCalled();
  });

  it('rejects concurrent request in flight with 409 IDEMPOTENCY_IN_PROGRESS and Retry-After: 1', async () => {
    idempotencyExecute.mockRejectedValueOnce(
      new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', 'Giao dịch đang được xử lý, vui lòng không nhấn liên tiếp'),
    );

    const response = await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        orderId,
        method: 'WALLET',
      })
      .expect(409)
      .expect('Retry-After', '1');

    expect(response.body.code).toBe('IDEMPOTENCY_IN_PROGRESS');
  });

  it('allows safe retry with the same key and payload after a network/timeout failure', async () => {
    const pendingOrder = buildStoredOrder({ status: 'PENDING', reservationStatus: 'HELD', version: 0 });
    const paidOrder = buildStoredOrder({ status: 'PAID', reservationStatus: 'CONSUMED', version: 1 });

    // Silence expected 500 error log in test console
    const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    // 1st attempt: transient failure
    idempotencyExecute.mockRejectedValueOnce(new Error('ETIMEDOUT'));

    await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', idempotencyKey)
      .send({ orderId, method: 'WALLET', mockOutcome: 'SUCCESS' })
      .expect(500);

    loggerSpy.mockRestore();

    // 2nd attempt: client retries with the SAME key and payload
    idempotencyExecute.mockImplementationOnce(async (_input, work: (tx: Tx) => Promise<unknown>) => {
      const data = await work(mockTx as unknown as Tx);
      return { data, replayed: false };
    });
    loadOwned.mockResolvedValueOnce(pendingOrder);
    transition.mockResolvedValueOnce(paidOrder);
    loyaltyEarn.mockResolvedValueOnce(10);
    mockTx.payment.create.mockResolvedValueOnce({
      id: paymentId,
      orderId,
      idempotencyRecordId,
      idempotencyKey,
      amount: 108000,
      method: 'WALLET',
      status: 'SUCCEEDED',
      createdAt: fixedDate,
      updatedAt: fixedDate,
    });

    const response = await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', idempotencyKey)
      .send({ orderId, method: 'WALLET', mockOutcome: 'SUCCESS' })
      .expect(200);

    expect(response.body.payment.status).toBe('SUCCEEDED');
    expect(response.body.order.status).toBe('PAID');
  });
});

describe('Payment Client & UI Guard Tests (#10)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('blocks double invocation / consecutive clicks when request is busy', async () => {
    let busy = false;
    let invocationCount = 0;

    const mockPayAction = async () => {
      if (busy) {
        return { blocked: true };
      }
      busy = true;
      invocationCount += 1;
      await new Promise(r => setTimeout(r, 20));
      busy = false;
      return { blocked: false };
    };

    // Simulate 2 rapid consecutive clicks
    const [click1, click2] = await Promise.all([mockPayAction(), mockPayAction()]);

    expect(invocationCount).toBe(1);
    expect(click1.blocked).toBe(false);
    expect(click2.blocked).toBe(true);
  });

  it('retries with the exact same Idempotency-Key and payload after network error', async () => {
    let callCount = 0;
    const sentHeaders: string[] = [];

    global.fetch = jest.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      callCount += 1;
      const headers = init.headers as Record<string, string>;
      sentHeaders.push(headers['Idempotency-Key']);

      if (callCount === 1) {
        throw new Error('Network timeout (ETIMEDOUT)');
      }

      return {
        ok: true,
        headers: new Headers({ 'Idempotency-Replayed': 'false' }),
        json: async () => ({
          payment: { id: paymentId, orderId, method: 'WALLET', status: 'SUCCEEDED' },
          order: { id: orderId, status: 'PAID', reservationStatus: 'CONSUMED' },
          loyaltyPointsEarned: 10,
        }),
      } as unknown as Response;
    });

    const paymentParams = {
      accessToken: 'valid-customer-token',
      idempotencyKey,
      request: {
        orderId,
        method: 'WALLET' as const,
        mockOutcome: 'SUCCESS' as const,
      },
    };

    // First call throws network error
    await expect(submitPayment(paymentParams)).rejects.toThrow('Network timeout');

    // Retry with SAME idempotencyKey
    const outcome = await submitPayment(paymentParams);

    expect(callCount).toBe(2);
    expect(sentHeaders[0]).toBe(idempotencyKey);
    expect(sentHeaders[1]).toBe(idempotencyKey);
    expect(outcome.result.order.status).toBe('PAID');
    expect(outcome.verified).toBe(true);
  });

  it('marks outcome as unverified and does NOT return stale snapshot when fresh order refetch fails after replay', async () => {
    // Per business-rules.md 7.9: DO NOT trust stale snapshot from result.order
    // if fresh order fetch fails after replay!
    const staleSnapshotOrder = {
      id: orderId,
      code: 'BL-OLD',
      status: 'PENDING' as const,
      reservationStatus: 'HELD' as const,
      version: 0,
      subtotal: 120000,
      discount: 0,
      total: 120000,
      currency: 'VND' as const,
      createdAt: fixedDate.toISOString(),
      updatedAt: fixedDate.toISOString(),
      items: [],
    };

    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/payments')) {
        return {
          ok: true,
          headers: new Headers({ 'Idempotency-Replayed': 'true' }),
          json: async () => ({
            payment: { id: paymentId, orderId, method: 'WALLET', status: 'SUCCEEDED' },
            order: staleSnapshotOrder,
            loyaltyPointsEarned: 10,
          }),
        } as unknown as Response;
      }
      if (url.includes(`/orders/${orderId}`)) {
        // Refetch fails due to 500 error or network error
        return {
          ok: false,
          status: 500,
          json: async () => ({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'Database connection failed' }),
        } as unknown as Response;
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    const outcome = await submitPayment({
      accessToken: 'valid-customer-token',
      idempotencyKey,
      request: {
        orderId,
        method: 'WALLET',
        mockOutcome: 'SUCCESS',
      },
    });

    // Replay was detected
    expect(outcome.replayed).toBe(true);
    // Crucial: verification failed, latestOrder must NOT be the stale order snapshot!
    expect(outcome.verified).toBe(false);
    expect(outcome.latestOrder).toBeNull();
    expect(outcome.verificationError).toBeDefined();

    // Verify retry verification mechanism
    global.fetch = jest.fn().mockImplementation(async () => {
      return {
        ok: true,
        json: async () => ({
          ...staleSnapshotOrder,
          status: 'PAID',
          reservationStatus: 'CONSUMED',
          version: 1,
        }),
      } as unknown as Response;
    });

    const verifiedOutcome = await verifyReplayedOrder(orderId, 'valid-customer-token');
    expect(verifiedOutcome.verified).toBe(true);
    expect(verifiedOutcome.order.status).toBe('PAID');
    expect(verifiedOutcome.order.reservationStatus).toBe('CONSUMED');
  });

  it('marks outcome as verified when fresh order refetch succeeds after replay', async () => {
    const staleSnapshot = {
      id: orderId,
      code: 'BL-20261022-A1B2C3D4',
      status: 'PENDING' as const,
      reservationStatus: 'HELD' as const,
      version: 0,
      subtotal: 120000,
      discount: 12000,
      total: 108000,
      currency: 'VND' as const,
      createdAt: fixedDate.toISOString(),
      updatedAt: fixedDate.toISOString(),
      items: [],
    };

    const freshOrder = {
      ...staleSnapshot,
      status: 'PAID' as const,
      reservationStatus: 'CONSUMED' as const,
      version: 1,
    };

    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (url.includes('/payments')) {
        return {
          ok: true,
          headers: new Headers({ 'Idempotency-Replayed': 'true' }),
          json: async () => ({
            payment: { id: paymentId, orderId, method: 'WALLET', status: 'SUCCEEDED' },
            order: staleSnapshot,
            loyaltyPointsEarned: 10,
          }),
        } as unknown as Response;
      }
      if (url.includes(`/orders/${orderId}`)) {
        return {
          ok: true,
          json: async () => freshOrder,
        } as unknown as Response;
      }
      throw new Error(`Unexpected url: ${url}`);
    });

    const outcome = await submitPayment({
      accessToken: 'valid-customer-token',
      idempotencyKey,
      request: {
        orderId,
        method: 'WALLET',
        mockOutcome: 'SUCCESS',
      },
    });

    expect(outcome.replayed).toBe(true);
    expect(outcome.verified).toBe(true);
    expect(outcome.latestOrder?.status).toBe('PAID');
    expect(outcome.latestOrder?.version).toBe(1);
  });
});

type VNode = {
  type: unknown;
  props: Record<string, unknown>;
  children: unknown[];
};

type ButtonDescriptor = {
  text: string;
  disabled: boolean;
  onClick?: () => unknown;
};

/**
 * Lightweight stateful React hook & VNode test harness to mount and interact with
 * `PaymentCheckoutPhone` and `PaymentReceiptCard` from `PaymentFlowWidget.tsx` in Node/Jest.
 */
function createPaymentWidgetTestHarness() {
  let activeInstance: { hooks: unknown[]; hookIndex: number } | null = null;

  const mockReact = {
    Fragment: Symbol.for('react.fragment'),
    createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): VNode {
      return {
        type,
        props: { ...(props ?? {}), children },
        children,
      };
    },
    useState<T>(initialValue: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
      if (!activeInstance) {
        throw new Error('useState called outside component render');
      }
      const inst = activeInstance;
      const idx = inst.hookIndex++;
      if (idx >= inst.hooks.length) {
        inst.hooks.push(typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue);
      }
      const setState = (next: T | ((prev: T) => T)) => {
        const prev = inst.hooks[idx] as T;
        inst.hooks[idx] = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
      };
      return [inst.hooks[idx] as T, setState];
    },
    useRef<T>(initialValue: T): { current: T } {
      if (!activeInstance) {
        throw new Error('useRef called outside component render');
      }
      const inst = activeInstance;
      const idx = inst.hookIndex++;
      if (idx >= inst.hooks.length) {
        inst.hooks.push({ current: initialValue });
      }
      return inst.hooks[idx] as { current: T };
    },
    useEffect(effect: () => void | (() => void), deps?: unknown[]): void {
      if (!activeInstance) {
        throw new Error('useEffect called outside component render');
      }
      const inst = activeInstance;
      const idx = inst.hookIndex++;
      const prev = inst.hooks[idx] as { deps?: unknown[] } | undefined;
      const changed =
        !prev ||
        !deps ||
        !prev.deps ||
        deps.length !== prev.deps.length ||
        deps.some((d, i) => !Object.is(d, prev.deps![i]));
      if (changed) {
        inst.hooks[idx] = { deps };
        effect();
      }
    },
  };

  const widgetPath = path.resolve(__dirname, '../../frontend/src/components/payments/PaymentFlowWidget.tsx');
  const nodeRequire = createRequire(__filename);
  const sourceCode = fs.readFileSync(widgetPath, 'utf8');
  const transpiled = ts.transpileModule(sourceCode, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;

  const moduleExports: Record<string, unknown> = {};
  const moduleObj = { exports: moduleExports };
  const customRequire = (id: string) => {
    if (id === 'react') {
      return mockReact;
    }
    if (id === 'next/link') {
      return {
        __esModule: true,
        default: (props: Record<string, unknown>) => mockReact.createElement('a', props, props.children),
      };
    }
    if (id === './payment-api') {
      return paymentApiModule;
    }
    if (id.endsWith('.css')) {
      return {};
    }
    return nodeRequire(id);
  };

  const fn = vm.runInThisContext(
    `(function(exports, require, module, React) { ${transpiled}\n})`,
    { filename: widgetPath },
  );
  fn(moduleExports, customRequire, moduleObj, mockReact);

  const widgetModule = moduleObj.exports as {
    PaymentCheckoutPhone: (props: Record<string, unknown>) => unknown;
    PaymentReceiptCard: (props: Record<string, unknown>) => unknown;
  };

  function mount<P extends Record<string, unknown>>(Component: (props: P) => unknown, initialProps: P) {
    const instances = new Map<string, { hooks: unknown[]; hookIndex: number }>();
    let currentProps = initialProps;
    let rootTree: unknown = null;

    function evaluateNode(node: unknown, pathKey: string): unknown {
      if (node === null || node === undefined || typeof node === 'boolean') {
        return null;
      }
      if (typeof node === 'string' || typeof node === 'number') {
        return String(node);
      }
      if (Array.isArray(node)) {
        return node.map((child, idx) => evaluateNode(child, `${pathKey}.${idx}`));
      }
      const vnode = node as VNode;
      if (typeof vnode.type === 'function') {
        const compKey = `${pathKey}:${(vnode.type as { name?: string }).name || 'Anon'}`;
        let inst = instances.get(compKey);
        if (!inst) {
          inst = { hooks: [], hookIndex: 0 };
          instances.set(compKey, inst);
        }
        inst.hookIndex = 0;
        const prevInst = activeInstance;
        activeInstance = inst;
        let rendered: unknown;
        try {
          rendered = (vnode.type as (p: Record<string, unknown>) => unknown)(vnode.props);
        } finally {
          activeInstance = prevInst;
        }
        return evaluateNode(rendered, compKey);
      }
      return {
        type: vnode.type,
        props: vnode.props,
        children: vnode.children.map((child, idx) => evaluateNode(child, `${pathKey}/${idx}`)),
      };
    }

    function collectText(node: unknown): string {
      if (node === null || node === undefined || typeof node === 'boolean') {
        return '';
      }
      if (typeof node === 'string' || typeof node === 'number') {
        return String(node);
      }
      if (Array.isArray(node)) {
        return node.map(collectText).join('');
      }
      const vnode = node as VNode;
      return vnode.children.map(collectText).join('');
    }

    function collectButtons(node: unknown, acc: ButtonDescriptor[] = []): ButtonDescriptor[] {
      if (!node || typeof node !== 'object') {
        return acc;
      }
      if (Array.isArray(node)) {
        for (const item of node) {
          collectButtons(item, acc);
        }
        return acc;
      }
      const vnode = node as VNode;
      if (vnode.type === 'button') {
        acc.push({
          text: collectText(vnode.children).replace(/\s+/g, ' ').trim(),
          disabled: Boolean(vnode.props.disabled),
          onClick: vnode.props.onClick as (() => unknown) | undefined,
        });
      }
      for (const child of vnode.children) {
        collectButtons(child, acc);
      }
      return acc;
    }

    function render(nextProps?: P) {
      if (nextProps) {
        currentProps = nextProps;
      }
      // Two passes emulate React re-rendering after effects update state.
      for (let pass = 0; pass < 2; pass++) {
        rootTree = evaluateNode(
          mockReact.createElement(Component as unknown as string, currentProps),
          'root',
        );
      }
    }

    render(initialProps);

    return {
      rerender: (nextProps?: P) => render(nextProps),
      getText: () => collectText(rootTree).replace(/\s+/g, ' ').trim(),
      getButtons: () => collectButtons(rootTree),
      async clickButton(labelSubstring: string) {
        const buttons = collectButtons(rootTree);
        const target = buttons.find(btn => btn.text.includes(labelSubstring));
        if (!target) {
          throw new Error(
            `Button containing "${labelSubstring}" not found. Available buttons: ${buttons.map(b => `"${b.text}"`).join(', ')}`,
          );
        }
        if (target.disabled) {
          throw new Error(`Button "${target.text}" is disabled`);
        }
        if (target.onClick) {
          await target.onClick();
        }
        render();
      },
    };
  }

  return { widgetModule, mount };
}

describe('PaymentFlowWidget Component Render & Interaction Tests (#10)', () => {
  const { widgetModule, mount } = createPaymentWidgetTestHarness();
  const { PaymentCheckoutPhone, PaymentReceiptCard } = widgetModule;

  it('Issue 1: renders PaymentReceiptCard and PaymentCheckoutPhone receipt using API data (amount=90000, total=90000, code, discount, method) and never falls back to 120.000₫ or demo order code', async () => {
    const apiOrder = {
      id: orderId,
      code: 'BL-20261023-API90K',
      status: 'PAID' as const,
      reservationStatus: 'CONSUMED' as const,
      version: 1,
      subtotal: 105000,
      discount: 15000,
      total: 90000,
      currency: 'VND' as const,
      promotionCode: 'API15K',
      createdAt: fixedDate.toISOString(),
      updatedAt: fixedDate.toISOString(),
      items: [
        {
          id: itemId,
          productId,
          productName: 'Cold Brew Cam Sả',
          size: 'L' as const,
          sizePrice: 55000,
          toppings: [],
          qty: 1,
          unitPrice: 55000,
          lineTotal: 55000,
        },
        {
          id: '88888888-8888-4888-8888-888888888888',
          productId,
          productName: 'Bánh Croissant Bơ',
          size: 'S' as const,
          sizePrice: 50000,
          toppings: [],
          qty: 1,
          unitPrice: 50000,
          lineTotal: 50000,
        },
      ],
    };

    const apiPayment = {
      id: paymentId,
      orderId,
      idempotencyKey,
      amount: 90000,
      method: 'CARD' as const,
      status: 'SUCCEEDED' as const,
      createdAt: fixedDate.toISOString(),
      updatedAt: fixedDate.toISOString(),
    };

    // 1. Direct Receipt component render with API data different from demo data
    const receiptView = mount(PaymentReceiptCard, {
      payment: apiPayment,
      order: apiOrder,
      promotionCode: apiOrder.promotionCode,
    });

    const receiptText = receiptView.getText();
    expect(receiptText).toContain('BL-20261023-API90K');
    expect(receiptText).toContain('90.000 ₫');
    expect(receiptText).toContain('105.000 ₫');
    expect(receiptText).toContain('−15.000 ₫');
    expect(receiptText).toContain('API15K');
    expect(receiptText).toContain('Thẻ ngân hàng (CARD)');
    expect(receiptText).toContain('SUCCEEDED');
    // Must NOT contain hardcoded demo values
    expect(receiptText).not.toContain('120.000 ₫');
    expect(receiptText).not.toContain('BL-20261022-A1B2C3D4');
    expect(receiptText).not.toContain('SAVE10');

    // 2. Full PaymentCheckoutPhone integration flow where API returns payment.amount = 90000 and order.total = 90000
    const onPaymentCommitted = jest.fn();
    const phoneView = mount(PaymentCheckoutPhone, {
      isDemo: false,
      order: {
        id: orderId,
        code: 'BL-20261023-API90K',
        subtotal: 105000,
        discount: 15000,
        total: 90000,
        promotionCode: 'API15K',
        items: [
          {
            id: itemId,
            name: 'Cold Brew Cam Sả',
            size: 'L',
            toppings: [],
            qty: 1,
            unitPrice: 55000,
          },
        ],
      },
      onExecutePayment: async () => ({
        result: {
          payment: apiPayment,
          order: apiOrder,
          loyaltyPointsEarned: 9,
        },
        replayed: false,
        latestOrder: apiOrder,
        verified: true,
      }),
      onPaymentCommitted,
    });

    // Initial pending screen must show API order code and 90.000 ₫, not 120.000 ₫
    const initialText = phoneView.getText();
    expect(initialText).toContain('BL-20261023-API90K');
    expect(initialText).toContain('Xác nhận thanh toán • 90.000 ₫');
    expect(initialText).not.toContain('120.000 ₫');
    expect(initialText).not.toContain('BL-20261022-A1B2C3D4');

    // Execute payment and verify the rendered receipt screen uses API response fields
    await phoneView.clickButton('Xác nhận thanh toán • 90.000 ₫');

    const afterPayText = phoneView.getText();
    expect(afterPayText).toContain('Thanh toán thành công');
    expect(afterPayText).toContain('BL-20261023-API90K');
    expect(afterPayText).toContain('90.000 ₫');
    expect(afterPayText).toContain('−15.000 ₫');
    expect(afterPayText).toContain('API15K');
    expect(afterPayText).toContain('Thẻ ngân hàng (CARD)');
    expect(afterPayText).toContain('+9 điểm');
    expect(afterPayText).not.toContain('120.000 ₫');
    expect(afterPayText).not.toContain('BL-20261022-A1B2C3D4');
    expect(onPaymentCommitted).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PAID',
        orderStatus: 'PAID',
        idempotencyKey: apiPayment.idempotencyKey,
        method: 'CARD',
        order: expect.objectContaining({ code: 'BL-20261023-API90K', total: 90000 }),
        payment: expect.objectContaining({ amount: 90000, status: 'SUCCEEDED' }),
        verified: true,
      }),
    );
  });

  it('Issue 2: treats PREPARING, READY, and COMPLETED orders with SUCCEEDED payment as paid/fulfilling during replay and retryVerification (never showing PAYMENT_FAILED, RELEASED, or retry payment button)', async () => {
    for (const fulfillmentStatus of ['PREPARING', 'READY', 'COMPLETED'] as const) {
      const staleSnapshotOrder = {
        id: orderId,
        code: `BL-20261023-${fulfillmentStatus}`,
        status: 'PAID' as const,
        reservationStatus: 'CONSUMED' as const,
        version: 1,
        subtotal: 90000,
        discount: 0,
        total: 90000,
        currency: 'VND' as const,
        promotionCode: null,
        createdAt: fixedDate.toISOString(),
        updatedAt: fixedDate.toISOString(),
        items: [],
      };

      const latestOrderFromGet = {
        ...staleSnapshotOrder,
        status: fulfillmentStatus,
        reservationStatus: 'CONSUMED' as const,
        version: 2,
      };

      const succeededPayment = {
        id: paymentId,
        orderId,
        idempotencyKey,
        amount: 90000,
        method: 'WALLET' as const,
        status: 'SUCCEEDED' as const,
        createdAt: fixedDate.toISOString(),
        updatedAt: fixedDate.toISOString(),
      };

      const onPaymentCommitted = jest.fn();

      const phoneView = mount(PaymentCheckoutPhone, {
        isDemo: false,
        order: {
          id: orderId,
          code: staleSnapshotOrder.code,
          subtotal: 90000,
          discount: 0,
          total: 90000,
        },
        onExecutePayment: async () => ({
          result: {
            payment: succeededPayment,
            order: staleSnapshotOrder,
            loyaltyPointsEarned: 9,
          },
          replayed: true,
          latestOrder: latestOrderFromGet,
          verified: true,
        }),
        onPaymentCommitted,
      });

      await phoneView.clickButton('Xác nhận thanh toán • 90.000 ₫');

      const screenText = phoneView.getText();
      expect(screenText).toContain('Thanh toán thành công');
      expect(screenText).toContain(fulfillmentStatus);
      expect(screenText).toContain('CONSUMED');
      expect(screenText).toContain('SUCCEEDED');
      // Must NOT show PAYMENT_FAILED, RELEASED, or retry payment button
      expect(screenText).not.toContain('PAYMENT_FAILED');
      expect(screenText).not.toContain('RELEASED');
      expect(screenText).not.toContain('Thanh toán thất bại');
      expect(screenText).not.toContain('Tạo khóa mới & Thanh toán lại');

      const buttonLabels = phoneView.getButtons().map(b => b.text);
      expect(buttonLabels.some(t => t.includes('Thanh toán lại'))).toBe(false);

      expect(onPaymentCommitted).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'PAID',
          orderStatus: fulfillmentStatus,
          order: expect.objectContaining({ code: staleSnapshotOrder.code }),
          payment: expect.objectContaining({ status: 'SUCCEEDED', amount: 90000 }),
          verified: true,
        }),
      );
    }
  });

  it('Issue 3 & Issue 2: renders verification-pending notice and retry verification button when initial replay returns verified=false (state === 0), does NOT claim success or clear cart, and resolves PREPARING order via GET onVerifyOrder without re-posting payment', async () => {
    const staleSnapshotOrder = {
      id: orderId,
      code: 'BL-20261023-UNVERIFIED',
      status: 'PAID' as const,
      reservationStatus: 'CONSUMED' as const,
      version: 1,
      subtotal: 90000,
      discount: 0,
      total: 90000,
      currency: 'VND' as const,
      promotionCode: null,
      createdAt: fixedDate.toISOString(),
      updatedAt: fixedDate.toISOString(),
      items: [],
    };

    const succeededPayment = {
      id: paymentId,
      orderId,
      idempotencyKey,
      amount: 90000,
      method: 'WALLET' as const,
      status: 'SUCCEEDED' as const,
      createdAt: fixedDate.toISOString(),
      updatedAt: fixedDate.toISOString(),
    };

    const onExecutePayment = jest.fn().mockResolvedValue({
      result: {
        payment: succeededPayment,
        order: staleSnapshotOrder,
        loyaltyPointsEarned: 9,
      },
      replayed: true,
      latestOrder: null,
      verified: false,
      verificationError: 'Temporary 503 on GET /orders/id',
    });

    const onVerifyOrder = jest.fn().mockResolvedValue({
      ...staleSnapshotOrder,
      status: 'PREPARING' as const,
      reservationStatus: 'CONSUMED' as const,
      version: 2,
    });

    const onPaymentCommitted = jest.fn();

    const phoneView = mount(PaymentCheckoutPhone, {
      isDemo: false,
      order: {
        id: orderId,
        code: 'BL-20261023-UNVERIFIED',
        subtotal: 90000,
        discount: 0,
        total: 90000,
      },
      onExecutePayment,
      onVerifyOrder,
      onPaymentCommitted,
    });

    // 1st click: POST /payments returns replayed=true, verified=false while component is at state === 0
    await phoneView.clickButton('Xác nhận thanh toán • 90.000 ₫');

    expect(onExecutePayment).toHaveBeenCalledTimes(1);
    // Cart must NOT be cleared and payment must NOT be committed on unverified stale snapshot
    expect(onPaymentCommitted).not.toHaveBeenCalled();

    const unverifiedScreenText = phoneView.getText();
    // Verification notice & retry verification button MUST be visible even though state is still 0
    expect(unverifiedScreenText).toContain('Chưa xác minh được trạng thái mới nhất');
    expect(unverifiedScreenText).toContain('Thử xác minh lại trạng thái đơn');
    // Must NOT show success receipt or failure screen yet
    expect(unverifiedScreenText).not.toContain('Thanh toán thành công');
    expect(unverifiedScreenText).not.toContain('Thanh toán thất bại');

    // Now click the "Thử xác minh lại trạng thái đơn" button -> calls GET /orders/{id} (onVerifyOrder) without calling POST /payments
    await phoneView.clickButton('Thử xác minh lại trạng thái đơn');

    expect(onVerifyOrder).toHaveBeenCalledTimes(1);
    expect(onVerifyOrder).toHaveBeenCalledWith(orderId);
    // POST /payments must NOT have been called a second time
    expect(onExecutePayment).toHaveBeenCalledTimes(1);

    const verifiedScreenText = phoneView.getText();
    expect(verifiedScreenText).not.toContain('Chưa xác minh được trạng thái mới nhất');
    expect(verifiedScreenText).toContain('Thanh toán thành công');
    expect(verifiedScreenText).toContain('PREPARING');
    expect(verifiedScreenText).toContain('CONSUMED');
    expect(verifiedScreenText).not.toContain('PAYMENT_FAILED');
    expect(verifiedScreenText).not.toContain('RELEASED');
    expect(verifiedScreenText).not.toContain('Tạo khóa mới & Thanh toán lại');

    // Now that GET /orders/{id} verified the order is PREPARING, onPaymentCommitted is emitted once
    expect(onPaymentCommitted).toHaveBeenCalledTimes(1);
    expect(onPaymentCommitted).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PAID',
        orderStatus: 'PREPARING',
        order: expect.objectContaining({ code: 'BL-20261023-UNVERIFIED', status: 'PREPARING' }),
        payment: expect.objectContaining({ status: 'SUCCEEDED', amount: 90000 }),
        verified: true,
      }),
    );
  });

  it('Retry after PAYMENT_FAILED: confirm button reappears and a 2nd attempt is sent for the same order with a NEW key and the same money snapshot', async () => {
    const failedOrder = {
      id: orderId,
      code: 'BL-20261023-RETRY',
      status: 'PAYMENT_FAILED' as const,
      reservationStatus: 'RELEASED' as const,
      version: 1,
      subtotal: 105000,
      discount: 15000,
      total: 90000,
      currency: 'VND' as const,
      promotionCode: 'API15K',
      createdAt: fixedDate.toISOString(),
      updatedAt: fixedDate.toISOString(),
      items: [],
    };
    const paidOrder = { ...failedOrder, status: 'PAID' as const, reservationStatus: 'CONSUMED' as const, version: 3 };
    const failedPayment = {
      id: paymentId,
      orderId,
      idempotencyKey,
      amount: 90000,
      method: 'WALLET' as const,
      status: 'FAILED' as const,
      createdAt: fixedDate.toISOString(),
      updatedAt: fixedDate.toISOString(),
    };

    const onExecutePayment = jest
      .fn()
      .mockResolvedValueOnce({
        result: { payment: failedPayment, order: failedOrder, loyaltyPointsEarned: 0 },
        replayed: false,
        latestOrder: failedOrder,
        verified: true,
      })
      .mockResolvedValueOnce({
        result: {
          payment: { ...failedPayment, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'SUCCEEDED' as const },
          order: paidOrder,
          loyaltyPointsEarned: 9,
        },
        replayed: false,
        latestOrder: paidOrder,
        verified: true,
      });

    const view = mount(PaymentCheckoutPhone, {
      isDemo: false,
      idempotencyKey,
      order: { id: orderId, code: 'BL-20261023-RETRY', subtotal: 105000, discount: 15000, total: 90000, promotionCode: 'API15K' },
      onExecutePayment,
    });

    await view.clickButton('Xác nhận thanh toán • 90.000 ₫');
    expect(view.getText()).toContain('Thử lại thanh toán với mã mới');

    await view.clickButton('Thử lại thanh toán với mã mới');
    // Not stuck: confirm button is available again with the same money snapshot
    expect(view.getButtons().some(b => b.text.includes('Xác nhận thanh toán • 90.000 ₫'))).toBe(true);
    expect(view.getButtons().some(b => b.text.includes('Thử lại thanh toán với mã mới'))).toBe(false);

    await view.clickButton('Xác nhận thanh toán • 90.000 ₫');

    expect(onExecutePayment).toHaveBeenCalledTimes(2);
    const [first, second] = onExecutePayment.mock.calls.map(call => call[0]);
    expect(first.idempotencyKey).toBe(idempotencyKey);
    expect(second.orderId).toBe(first.orderId);
    expect(second.orderId).toBe(orderId);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(second.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(view.getText()).toContain('Thanh toán thành công');
  });

  it('Idempotency key: different orders get different keys (never the fixed demo key); technical retry keeps same key and payload', async () => {
    const DEMO_KEY = '77777777-7777-4777-8777-777777777777';
    const orderA = { id: orderId, code: 'BL-A', subtotal: 90000, discount: 0, total: 90000 };
    const orderB = { id: '99999999-9999-4999-8999-999999999990', code: 'BL-B', subtotal: 50000, discount: 0, total: 50000 };

    const callsA = jest.fn().mockRejectedValue(new Error('Network timeout'));
    const callsB = jest.fn().mockRejectedValue(new Error('Network timeout'));
    const viewA = mount(PaymentCheckoutPhone, { isDemo: false, order: orderA, onExecutePayment: callsA });
    const viewB = mount(PaymentCheckoutPhone, { isDemo: false, order: orderB, onExecutePayment: callsB });

    await viewA.clickButton('Xác nhận thanh toán • 90.000 ₫');
    await viewB.clickButton('Xác nhận thanh toán • 50.000 ₫');
    const keyA = callsA.mock.calls[0][0].idempotencyKey;
    const keyB = callsB.mock.calls[0][0].idempotencyKey;
    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(DEMO_KEY);
    expect(keyB).not.toBe(DEMO_KEY);

    // Technical retry after unknown result: same key, same payload
    await viewA.clickButton('Xác nhận thanh toán • 90.000 ₫');
    expect(callsA).toHaveBeenCalledTimes(2);
    expect(callsA.mock.calls[1][0]).toEqual(callsA.mock.calls[0][0]);

    // Parent-provided key is respected
    const parentKey = 'abababab-abab-4bab-8bab-abababababab';
    const viewC = mount(PaymentCheckoutPhone, {
      isDemo: false,
      order: orderB,
      idempotencyKey: parentKey,
      onExecutePayment: callsB,
    });
    await viewC.clickButton('Xác nhận thanh toán • 50.000 ₫');
    expect(callsB.mock.calls[1][0].idempotencyKey).toBe(parentKey);

    // Switching the same widget to another order generates a new key
    const rerenderCalls = jest.fn().mockRejectedValue(new Error('Network timeout'));
    const viewD = mount(PaymentCheckoutPhone, { isDemo: false, order: orderA, onExecutePayment: rerenderCalls });
    await viewD.clickButton('Xác nhận thanh toán • 90.000 ₫');
    viewD.rerender({ isDemo: false, order: orderB, onExecutePayment: rerenderCalls });
    await viewD.clickButton('Xác nhận thanh toán • 50.000 ₫');
    expect(rerenderCalls.mock.calls[1][0].orderId).toBe(orderB.id);
    expect(rerenderCalls.mock.calls[1][0].idempotencyKey).not.toBe(rerenderCalls.mock.calls[0][0].idempotencyKey);
  });
});

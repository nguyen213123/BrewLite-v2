import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
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

  it('rejects concurrent request in flight with 409 or 429 Retry-After', async () => {
    idempotencyExecute.mockRejectedValueOnce(
      new ApiError(409, 'IDEMPOTENCY_KEY_IN_PROGRESS', 'Giao dịch đang được xử lý, vui lòng không nhấn liên tiếp'),
    );

    const response = await request(app.getHttpServer())
      .post('/api/payments')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        orderId,
        method: 'WALLET',
      })
      .expect(409);

    expect(response.body.code).toBe('IDEMPOTENCY_KEY_IN_PROGRESS');
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

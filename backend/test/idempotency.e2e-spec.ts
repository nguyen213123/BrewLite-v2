// Owner: TV5 — #11. Comprehensive E2E & Concurrency tests for Idempotency Engine.
import { randomBytes, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { UnitOfWork } from '../src/common/database/unit-of-work';
import {
  IdempotencyPort,
  LoyaltyTransactionsPort,
  OrderTransactionsPort,
} from '../src/common/contracts/ports';
import type { StoredOrder, Tx } from '../src/common/contracts/ports';
import { IdentityPort } from '../src/common/security/security';
import {
  canonicalJsonStringify,
  computePayloadHash,
  IdempotencyService,
  isLockOrTransactionTimeoutError,
  isUniqueConstraintError,
} from '../src/modules/idempotency/idempotency.service';
import { ApiError } from '../src/common/errors/api-error';

const userId1 = '11111111-1111-4111-8111-111111111111';
const userId2 = '22222222-2222-4222-8222-222222222222';
const validKey1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const validKey2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type MockRecord = {
  id: string;
  userId: string;
  scope: string;
  key: string;
  requestHash: string;
  status: 'PROCESSING' | 'COMPLETED';
  httpStatus?: number | null;
  response?: unknown;
};

describe('Idempotency Service & Engine (#11)', () => {
  let app: INestApplication;
  let idempotency: IdempotencyPort;

  // In-memory relational store to test exact Prisma transaction & constraint semantics
  const records = new Map<string, MockRecord>();

  const getCompoundKey = (userId: string, scope: string, key: string) => `${userId}:${scope}:${key.toLowerCase()}`;

  const mockPrisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    idempotencyRecord: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => {
        const { userId, scope, key } = where.userId_scope_key;
        return records.get(getCompoundKey(userId, scope, key)) ?? null;
      }),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const compoundKey = getCompoundKey(data.userId, data.scope, data.key);
        if (records.has(compoundKey)) {
          const p2002 = new Error('Unique constraint failed on userId_scope_key') as unknown as { code: string };
          p2002.code = 'P2002';
          throw p2002;
        }
        const created: MockRecord = {
          id: `rec-${Math.random()}`,
          userId: data.userId,
          scope: data.scope,
          key: data.key,
          requestHash: data.requestHash,
          status: data.status,
          httpStatus: data.httpStatus ?? null,
          response: data.response ?? null,
        };
        records.set(compoundKey, created);
        return created;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        for (const [key, rec] of records.entries()) {
          if (rec.id === where.id) {
            const updated = { ...rec, ...data };
            records.set(key, updated);
            return updated;
          }
        }
        throw new Error('Record not found');
      }),
      deleteMany: jest.fn().mockImplementation(async () => {
        records.clear();
      }),
    },
    payment: {
      create: jest.fn(),
    },
  };

  let inActiveTransaction = false;
  let txAborted = false;

  const mockUow = {
    run: jest.fn().mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => {
      // Snapshot state for transaction rollback simulation
      const snapshot = new Map(records);
      inActiveTransaction = true;
      txAborted = false;
      try {
        return await work(mockPrisma);
      } catch (err) {
        // Rollback
        records.clear();
        for (const [k, v] of snapshot.entries()) {
          records.set(k, { ...v });
        }
        throw err;
      } finally {
        inActiveTransaction = false;
        txAborted = false;
      }
    }),
  };

  const mockOrderTransactions = {
    loadOwned: jest.fn(),
    transition: jest.fn(),
    prepareRetry: jest.fn(),
  };

  const mockLoyaltyTransactions = {
    earn: jest.fn(),
    reverse: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(UnitOfWork)
      .useValue(mockUow)
      .overrideProvider(IdentityPort)
      .useValue({
        verifyAccessToken: async (token: string) => {
          if (token !== 'valid-customer-token') {
            throw new ApiError(401, 'UNAUTHORIZED', 'Token không hợp lệ');
          }
          return { id: userId1, email: 'customer@example.com', role: 'CUSTOMER' as const };
        },
      })
      .overrideProvider(OrderTransactionsPort)
      .useValue(mockOrderTransactions)
      .overrideProvider(LoyaltyTransactionsPort)
      .useValue(mockLoyaltyTransactions)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    idempotency = moduleRef.get(IdempotencyPort);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    records.clear();
    jest.clearAllMocks();
  });

  describe('Canonical JSON & Hash Determinism', () => {
    it('produces identical string and SHA-256 hash regardless of object key insertion order', () => {
      const payload1 = {
        orderId: '44444444-4444-4444-8444-444444444444',
        method: 'WALLET',
        mockOutcome: 'SUCCESS',
      };
      const payload2 = {
        mockOutcome: 'SUCCESS',
        method: 'WALLET',
        orderId: '44444444-4444-4444-8444-444444444444',
      };

      const hash1 = computePayloadHash(payload1);
      const hash2 = computePayloadHash(payload2);

      expect(hash1).toBe(hash2);
      expect(canonicalJsonStringify(payload1)).toBe(canonicalJsonStringify(payload2));
    });

    it('handles nested objects and preserves array ordering', () => {
      const complex1 = {
        items: [{ id: 1, name: 'Cappuccino' }, { id: 2, name: 'Latte' }],
        meta: { b: 2, a: 1 },
      };
      const complex2 = {
        meta: { a: 1, b: 2 },
        items: [{ id: 1, name: 'Cappuccino' }, { id: 2, name: 'Latte' }],
      };

      expect(computePayloadHash(complex1)).toBe(computePayloadHash(complex2));

      // Different array order produces different hash
      const diffArray = {
        meta: { a: 1, b: 2 },
        items: [{ id: 2, name: 'Latte' }, { id: 1, name: 'Cappuccino' }],
      };
      expect(computePayloadHash(complex1)).not.toBe(computePayloadHash(diffArray));
    });
  });

  describe('Key Validation', () => {
    it('rejects keys that are not valid UUID format with 400 VALIDATION_ERROR', async () => {
      await expect(
        idempotency.execute(
          {
            userId: userId1,
            scope: 'PAY_ORDER',
            key: 'invalid-non-uuid-key',
            payload: { orderId: '123' },
            httpStatus: 200,
          },
          async () => ({ success: true }),
        ),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      });
    });
  });

  describe('Sequential Execution & Replay', () => {
    it('executes work callback once and replays cached result on subsequent identical call', async () => {
      let callCount = 0;
      const payload = { orderId: '12345678-1234-4234-8234-1234567890ab', method: 'WALLET' };

      // 1st call
      const firstResult = await idempotency.execute(
        {
          userId: userId1,
          scope: 'PAY_ORDER',
          key: validKey1,
          payload,
          httpStatus: 200,
        },
        async () => {
          callCount += 1;
          return { paymentId: 'p-1', amount: 120000 };
        },
      );

      expect(firstResult.replayed).toBe(false);
      expect(firstResult.data).toEqual({ paymentId: 'p-1', amount: 120000 });
      expect(callCount).toBe(1);

      // 2nd call with identical key & payload
      const secondResult = await idempotency.execute(
        {
          userId: userId1,
          scope: 'PAY_ORDER',
          key: validKey1,
          payload,
          httpStatus: 200,
        },
        async () => {
          callCount += 1; // Should NEVER be executed
          return { paymentId: 'p-SHOULD-NOT-HAPPEN' };
        },
      );

      expect(secondResult.replayed).toBe(true);
      expect(secondResult.data).toEqual({ paymentId: 'p-1', amount: 120000 });
      expect(callCount).toBe(1); // Work was NOT re-executed
    });

    it('rejects reusing the same key with different payload with 409 IDEMPOTENCY_KEY_REUSED', async () => {
      const payloadA = { orderId: 'order-a', amount: 50000 };
      const payloadB = { orderId: 'order-b', amount: 90000 }; // Different payload

      // 1st call
      await idempotency.execute(
        {
          userId: userId1,
          scope: 'PAY_ORDER',
          key: validKey2,
          payload: payloadA,
          httpStatus: 200,
        },
        async () => ({ status: 'PAID' }),
      );

      // 2nd call with same key but different payload
      await expect(
        idempotency.execute(
          {
            userId: userId1,
            scope: 'PAY_ORDER',
            key: validKey2,
            payload: payloadB,
            httpStatus: 200,
          },
          async () => ({ status: 'PAID' }),
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }),
      });
    });
  });

  describe('Isolation & Scopes', () => {
    it('isolates keys by scope so CREATE_ORDER and PAY_ORDER can use the same key independently', async () => {
      const sharedKey = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

      const orderResult = await idempotency.execute(
        {
          userId: userId1,
          scope: 'CREATE_ORDER',
          key: sharedKey,
          payload: { items: ['coffee'] },
          httpStatus: 201,
        },
        async () => ({ orderCode: 'BL-001' }),
      );

      const paymentResult = await idempotency.execute(
        {
          userId: userId1,
          scope: 'PAY_ORDER',
          key: sharedKey,
          payload: { orderId: 'BL-001' },
          httpStatus: 200,
        },
        async () => ({ receipt: 'RC-001' }),
      );

      expect(orderResult.data).toEqual({ orderCode: 'BL-001' });
      expect(paymentResult.data).toEqual({ receipt: 'RC-001' });
    });

    it('isolates keys by user so User 1 and User 2 can use the same key without conflict or data leakage', async () => {
      const sharedKey = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

      const user1Result = await idempotency.execute(
        {
          userId: userId1,
          scope: 'PAY_ORDER',
          key: sharedKey,
          payload: { orderId: 'order-1' },
          httpStatus: 200,
        },
        async () => ({ forUser: 'user1' }),
      );

      const user2Result = await idempotency.execute(
        {
          userId: userId2,
          scope: 'PAY_ORDER',
          key: sharedKey,
          payload: { orderId: 'order-2' },
          httpStatus: 200,
        },
        async () => ({ forUser: 'user2' }),
      );

      expect(user1Result.data).toEqual({ forUser: 'user1' });
      expect(user2Result.data).toEqual({ forUser: 'user2' });
    });
  });

  describe('Rollback & Concurrency Guards', () => {
    it('rolls back completely when work throws, leaving no completed record and allowing retry', async () => {
      const failKey = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
      const payload = { orderId: 'order-fail' };

      // 1st call throws error inside work
      await expect(
        idempotency.execute(
          {
            userId: userId1,
            scope: 'PAY_ORDER',
            key: failKey,
            payload,
            httpStatus: 200,
          },
          async () => {
            throw new ApiError(400, 'OUT_OF_STOCK', 'Sản phẩm đã hết hàng');
          },
        ),
      ).rejects.toMatchObject({ status: 400 });

      // Record was rolled back, Map is empty
      expect(records.size).toBe(0);

      // 2nd call with same key is permitted and succeeds
      const retryResult = await idempotency.execute(
        {
          userId: userId1,
          scope: 'PAY_ORDER',
          key: failKey,
          payload,
          httpStatus: 200,
        },
        async () => ({ recovered: true }),
      );

      expect(retryResult.replayed).toBe(false);
      expect(retryResult.data).toEqual({ recovered: true });
    });

    it('rejects concurrent in-flight request with 409 IDEMPOTENCY_IN_PROGRESS', async () => {
      const inFlightKey = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      const payload = { orderId: 'order-in-flight' };

      // Manually simulate a PROCESSING record
      const compoundKey = getCompoundKey(userId1, 'PAY_ORDER', inFlightKey);
      records.set(compoundKey, {
        id: 'rec-processing',
        userId: userId1,
        scope: 'PAY_ORDER',
        key: inFlightKey,
        requestHash: computePayloadHash(payload),
        status: 'PROCESSING',
      });

      await expect(
        idempotency.execute(
          {
            userId: userId1,
            scope: 'PAY_ORDER',
            key: inFlightKey,
            payload,
            httpStatus: 200,
          },
          async () => ({ shouldNotRun: true }),
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({ code: 'IDEMPOTENCY_IN_PROGRESS' }),
      });
    });

    it('detects PostgreSQL 55P03 lock_timeout, statement_timeout 57014, Prisma DriverAdapterError (P2039), and transaction timeout (P2028)', () => {
      expect(isLockOrTransactionTimeoutError({ code: '55P03', message: 'canceling statement due to lock timeout' })).toBe(true);
      expect(isLockOrTransactionTimeoutError({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(true);
      expect(isLockOrTransactionTimeoutError({ code: 'P2028', message: 'Transaction API error: Transaction already closed' })).toBe(true);
      expect(
        isLockOrTransactionTimeoutError({
          code: 'P2039',
          meta: {
            driverAdapterError: {
              name: 'DriverAdapterError',
              cause: {
                kind: 'postgres',
                code: '55P03',
                message: 'canceling statement due to lock timeout',
              },
            },
          },
        }),
      ).toBe(true);
      expect(isUniqueConstraintError({ code: 'P2002' })).toBe(true);
      expect(
        isUniqueConstraintError({
          code: 'P2039',
          meta: {
            driverAdapterError: {
              cause: { code: '23505' },
            },
          },
        }),
      ).toBe(true);
    });

    it('rolls back aborted transaction before querying race record when concurrent unique constraint occurs (preventing 25P02)', async () => {
      const raceKey = '12121212-1212-4212-8212-121212121212';
      const payload = { orderId: '44444444-4444-4444-8444-444444444444', method: 'WALLET', mockOutcome: 'SUCCESS' };
      const compoundKey = getCompoundKey(userId1, 'PAY_ORDER', raceKey);

      let findUniqueCount = 0;
      mockPrisma.idempotencyRecord.findUnique.mockImplementation(async ({ where }) => {
        findUniqueCount += 1;
        // If queried while an aborted transaction is still open, PostgreSQL throws 25P02
        if (inActiveTransaction && txAborted) {
          const abortedErr = new Error('current transaction is aborted, commands ignored until end of transaction block') as Error & { code: string };
          abortedErr.code = '25P02';
          throw abortedErr;
        }
        if (findUniqueCount === 1) {
          return null;
        }
        const { userId, scope, key } = where.userId_scope_key;
        return records.get(getCompoundKey(userId, scope, key)) ?? null;
      });

      mockPrisma.idempotencyRecord.create.mockImplementationOnce(async () => {
        // Simulate concurrent winner committing just as our insert fails with 23505 / P2002
        txAborted = true;
        const p2002 = new Error('Unique constraint failed') as Error & { code: string };
        p2002.code = 'P2002';
        throw p2002;
      });

      // Simulate the concurrent winner still PROCESSING in DB after our rollback completes
      mockUow.run.mockImplementationOnce(async (work: (tx: unknown) => Promise<unknown>) => {
        inActiveTransaction = true;
        txAborted = false;
        try {
          return await work(mockPrisma);
        } finally {
          inActiveTransaction = false;
          txAborted = false;
          records.set(compoundKey, {
            id: 'rec-winner',
            userId: userId1,
            scope: 'PAY_ORDER',
            key: raceKey,
            requestHash: computePayloadHash(payload),
            status: 'PROCESSING',
          });
        }
      });

      await expect(
        idempotency.execute(
          {
            userId: userId1,
            scope: 'PAY_ORDER',
            key: raceKey,
            payload,
            httpStatus: 200,
          },
          async () => ({ shouldNotRun: true }),
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({ code: 'IDEMPOTENCY_IN_PROGRESS' }),
      });
    });

    it('handles PostgreSQL 55P03 lock_timeout after rollback by returning HTTP 409 IDEMPOTENCY_IN_PROGRESS with Retry-After: 1 and replays cleanly on retry without duplicate side effects', async () => {
      const lockKey = '34343434-3434-4434-8434-343434343434';
      const orderId = '44444444-4444-4444-8444-444444444444';
      const fixedDate = new Date('2026-10-22T12:00:00.000Z');

      // Reset default findUnique implementation
      mockPrisma.idempotencyRecord.findUnique.mockImplementation(async ({ where }) => {
        const { userId, scope, key } = where.userId_scope_key;
        return records.get(getCompoundKey(userId, scope, key)) ?? null;
      });

      // 1st competing request hits PostgreSQL 55P03 lock_timeout on idempotencyRecord.create (wrapped in Prisma P2039 DriverAdapterError)
      mockPrisma.idempotencyRecord.create.mockImplementationOnce(async () => {
        const pgLockTimeout = Object.assign(
          new Error('Invalid `tx.idempotencyRecord.create()` invocation: canceling statement due to lock timeout'),
          {
            code: 'P2039',
            meta: {
              driverAdapterError: {
                name: 'DriverAdapterError',
                cause: {
                  kind: 'postgres',
                  code: '55P03',
                  message: 'canceling statement due to lock timeout',
                },
              },
            },
          },
        );
        throw pgLockTimeout;
      });

      const contendingRes = await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', 'Bearer valid-customer-token')
        .set('Idempotency-Key', lockKey)
        .send({
          orderId,
          method: 'WALLET',
          mockOutcome: 'SUCCESS',
        })
        .expect(409)
        .expect('Retry-After', '1');

      expect(contendingRes.body).toMatchObject({
        statusCode: 409,
        code: 'IDEMPOTENCY_IN_PROGRESS',
      });
      // Transaction rolled back cleanly and business logic was never invoked
      expect(records.size).toBe(0);
      expect(mockOrderTransactions.loadOwned).not.toHaveBeenCalled();

      // Now the primary request (or retry after lock release) executes with the same key
      const pendingOrder: StoredOrder = {
        id: orderId,
        code: 'BL-20261022-LOCKTEST',
        userId: userId1,
        promotionId: null,
        promotionCode: null,
        subtotal: 90000,
        discount: 0,
        total: 90000,
        status: 'PENDING',
        reservationStatus: 'HELD',
        version: 0,
        createdAt: fixedDate,
        updatedAt: fixedDate,
        items: [],
      };
      const paidOrder: StoredOrder = {
        ...pendingOrder,
        status: 'PAID',
        reservationStatus: 'CONSUMED',
        version: 1,
      };

      mockOrderTransactions.loadOwned.mockResolvedValueOnce(pendingOrder);
      mockOrderTransactions.transition.mockResolvedValueOnce(paidOrder);
      mockLoyaltyTransactions.earn.mockResolvedValueOnce(9);
      mockPrisma.payment.create.mockResolvedValueOnce({
        id: '66666666-6666-4666-8666-666666666666',
        orderId,
        idempotencyRecordId: 'rec-1',
        idempotencyKey: lockKey,
        amount: 90000,
        method: 'WALLET',
        status: 'SUCCEEDED',
        createdAt: fixedDate,
        updatedAt: fixedDate,
      });

      const primaryRes = await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', 'Bearer valid-customer-token')
        .set('Idempotency-Key', lockKey)
        .send({
          orderId,
          method: 'WALLET',
          mockOutcome: 'SUCCESS',
        })
        .expect(200)
        .expect('Idempotency-Replayed', 'false');

      expect(primaryRes.body.payment.amount).toBe(90000);
      expect(primaryRes.body.order.status).toBe('PAID');
      expect(mockOrderTransactions.transition).toHaveBeenCalledTimes(1);
      expect(mockLoyaltyTransactions.earn).not.toHaveBeenCalled();

      // Client retries with the SAME key after receiving 409 Retry-After: 1 -> replays cached response with 0 extra side effects
      const retryRes = await request(app.getHttpServer())
        .post('/api/payments')
        .set('Authorization', 'Bearer valid-customer-token')
        .set('Idempotency-Key', lockKey)
        .send({
          orderId,
          method: 'WALLET',
          mockOutcome: 'SUCCESS',
        })
        .expect(200)
        .expect('Idempotency-Replayed', 'true');

      expect(retryRes.body).toEqual(primaryRes.body);
      expect(mockOrderTransactions.transition).toHaveBeenCalledTimes(1);
      expect(mockLoyaltyTransactions.earn).not.toHaveBeenCalled();
      expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1);
    });
  });
});

// Real PostgreSQL Concurrency & Lock Timeout Integration Suite (runs when RUN_DB_TESTS === '1')
const pgIntegration = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
pgIntegration('Idempotency Engine Real PostgreSQL Concurrency & lock_timeout (55P03) (#11)', () => {
  let pgApp: INestApplication;
  let prisma: PrismaService;
  let uow: UnitOfWork;
  let idempotencyService: IdempotencyService;
  let testUserId: string;

  const mockOrderTx = {
    loadOwned: jest.fn(),
    transition: jest.fn(),
    prepareRetry: jest.fn(),
  };
  const mockLoyaltyTx = {
    earn: jest.fn(),
    reverse: jest.fn(),
  };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('RUN_DB_TESTS requires DATABASE_URL');
    }
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(IdentityPort)
      .useValue({
        verifyAccessToken: async () => ({
          id: testUserId,
          email: 'pg-concurrency@example.com',
          role: 'CUSTOMER' as const,
        }),
      })
      .overrideProvider(OrderTransactionsPort)
      .useValue(mockOrderTx)
      .overrideProvider(LoyaltyTransactionsPort)
      .useValue(mockLoyaltyTx)
      .compile();

    pgApp = moduleRef.createNestApplication();
    configureApp(pgApp);
    await pgApp.init();

    prisma = moduleRef.get(PrismaService);
    uow = moduleRef.get(UnitOfWork);
    idempotencyService = new IdempotencyService(prisma, uow);

    const createdUser = await prisma.user.create({
      data: {
        email: `idemp-pg-${randomUUID()}@example.com`,
        passwordHash: 'test-only-hash',
      },
    });
    testUserId = createdUser.id;
  });

  afterAll(async () => {
    if (pgApp) {
      await pgApp.close();
    }
  });

  it(
    'returns 409 IDEMPOTENCY_IN_PROGRESS with Retry-After: 1 when concurrent same-key request hits PostgreSQL lock_timeout (55P03), and replays without duplicate business effects on retry',
    async () => {
      const sharedKey = randomUUID();
      const orderCode = `BL-20261022-${randomBytes(4).toString('hex').toUpperCase()}`;
      const createdOrder = await prisma.order.create({
        data: {
          code: orderCode,
          userId: testUserId,
          subtotal: 90000,
          discount: 0,
          total: 90000,
          status: 'PENDING',
          reservationStatus: 'HELD',
        },
      });

      const storedPending: StoredOrder = {
        id: createdOrder.id,
        code: createdOrder.code,
        userId: testUserId,
        promotionId: null,
        promotionCode: null,
        subtotal: 90000,
        discount: 0,
        total: 90000,
        status: 'PENDING',
        reservationStatus: 'HELD',
        version: 0,
        createdAt: createdOrder.createdAt,
        updatedAt: createdOrder.updatedAt,
        items: [],
      };

      let signalFirstEnteredTx!: () => void;
      const firstEnteredTx = new Promise<void>(resolve => {
        signalFirstEnteredTx = resolve;
      });

      let businessEffectCount = 0;
      mockOrderTx.loadOwned.mockImplementation(async () => {
        businessEffectCount += 1;
        signalFirstEnteredTx();
        // Hold transaction > 3s lock_timeout (but < 5s interactive tx timeout) so contending request hits 55P03
        await new Promise(resolve => setTimeout(resolve, 3250));
        return storedPending;
      });
      mockOrderTx.transition.mockImplementation(async (tx: Tx) => {
        await tx.order.update({
          where: { id: createdOrder.id },
          data: { status: 'PAID', reservationStatus: 'CONSUMED', version: 1 },
        });
        return {
          ...storedPending,
          status: 'PAID',
          reservationStatus: 'CONSUMED',
          version: 1,
        };
      });
      mockLoyaltyTx.earn.mockResolvedValue(9);

      // Start Request 1 (holds lock on (userId, scope, key) for ~3.25s)
      const req1Promise = request(pgApp.getHttpServer())
        .post('/api/payments')
        .set('Authorization', 'Bearer pg-token')
        .set('Idempotency-Key', sharedKey)
        .send({
          orderId: createdOrder.id,
          method: 'WALLET',
          mockOutcome: 'SUCCESS',
        }).then(res => res);

      // Wait until Request 1 has inserted the PROCESSING record and holds the PostgreSQL index lock
      await firstEnteredTx;

      // Start Request 2 concurrently with the exact same Idempotency-Key -> hits PostgreSQL 55P03 after 3s lock_timeout
      const req2Promise = request(pgApp.getHttpServer())
        .post('/api/payments')
        .set('Authorization', 'Bearer pg-token')
        .set('Idempotency-Key', sharedKey)
        .send({
          orderId: createdOrder.id,
          method: 'WALLET',
          mockOutcome: 'SUCCESS',
        }).then(res => res);

      const [res1, res2] = await Promise.all([req1Promise, req2Promise]);

      // Request 2 must return 409 IDEMPOTENCY_IN_PROGRESS with Retry-After: 1 (not 500)
      expect(res2.status).toBe(409);
      expect(res2.headers['retry-after']).toBe('1');
      expect(res2.body.code).toBe('IDEMPOTENCY_IN_PROGRESS');

      // Request 1 must succeed with 200 OK
      expect(res1.status).toBe(200);
      expect(res1.headers['idempotency-replayed']).toBe('false');
      expect(res1.body.payment.status).toBe('SUCCEEDED');
      expect(res1.body.order.status).toBe('PAID');
      expect(businessEffectCount).toBe(1);

      // Retry with the same key after Retry-After -> replays cached result without re-running business logic
      const retryRes = await request(pgApp.getHttpServer())
        .post('/api/payments')
        .set('Authorization', 'Bearer pg-token')
        .set('Idempotency-Key', sharedKey)
        .send({
          orderId: createdOrder.id,
          method: 'WALLET',
          mockOutcome: 'SUCCESS',
        })
        .expect(200)
        .expect('Idempotency-Replayed', 'true');

      expect(retryRes.body).toEqual(res1.body);
      expect(businessEffectCount).toBe(1);

      const paymentsInDb = await prisma.payment.count({ where: { orderId: createdOrder.id } });
      expect(paymentsInDb).toBe(1);
    },
    15000,
  );

  it('replays cleanly without duplicate execution when concurrent same-key request waits and hits unique constraint after winner commits', async () => {
    const fastKey = randomUUID();
    const payload = { orderId: randomUUID(), method: 'WALLET' };
    let executions = 0;

    let releaseFirst!: () => void;
    const waitFirst = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    let firstInserted!: () => void;
    const onFirstInserted = new Promise<void>(resolve => {
      firstInserted = resolve;
    });

    const call1 = idempotencyService.execute(
      {
        userId: testUserId,
        scope: 'CREATE_ORDER',
        key: fastKey,
        payload,
        httpStatus: 201,
      },
      async () => {
        executions += 1;
        firstInserted();
        await waitFirst;
        return { orderCode: 'BL-FAST-1' };
      },
    );

    await onFirstInserted;

    const call2 = idempotencyService.execute(
      {
        userId: testUserId,
        scope: 'CREATE_ORDER',
        key: fastKey,
        payload,
        httpStatus: 201,
      },
      async () => {
        executions += 1;
        return { orderCode: 'BL-SHOULD-NOT-RUN' };
      },
    );

    setTimeout(() => releaseFirst(), 150);

    const [r1, r2] = await Promise.all([call1, call2]);
    expect(r1).toEqual({ data: { orderCode: 'BL-FAST-1' }, replayed: false });
    expect(r2).toEqual({ data: { orderCode: 'BL-FAST-1' }, replayed: true });
    expect(executions).toBe(1);
  });
});

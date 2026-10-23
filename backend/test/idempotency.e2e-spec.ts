// Owner: TV5 — #11. Comprehensive E2E & Concurrency tests for Idempotency Engine.
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { UnitOfWork } from '../src/common/database/unit-of-work';
import { IdempotencyPort } from '../src/common/contracts/ports';
import { canonicalJsonStringify, computePayloadHash } from '../src/modules/idempotency/idempotency.service';
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
  };

  const mockUow = {
    run: jest.fn().mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => {
      // Snapshot state for transaction rollback simulation
      const snapshot = new Map(records);
      try {
        return await work(mockPrisma);
      } catch (err) {
        // Rollback
        records.clear();
        for (const [k, v] of snapshot.entries()) {
          records.set(k, { ...v });
        }
        throw err;
      }
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(UnitOfWork)
      .useValue(mockUow)
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
  });
});

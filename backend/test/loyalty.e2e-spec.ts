import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { LoyaltyService } from '../src/modules/loyalty/loyalty.service';
import { AUTH_POLICY } from '../src/modules/auth/auth-policy';
import type { StoredOrder, Tx } from '../src/common/contracts/ports';

const TEST_SECRET = 'this-is-a-valid-test-jwt-secret-with-at-least-32-characters';

describe('Loyalty module (Issue #15)', () => {
  let app: INestApplication;
  let loyaltyService: LoyaltyService;

  const userA = { id: '33333333-3333-4333-8333-333333333333', email: 'userA@example.com', role: 'CUSTOMER' as const, loyaltyPoints: 25 };
  const userB = { id: '44444444-4444-4444-8444-444444444444', email: 'userB@example.com', role: 'CUSTOMER' as const, loyaltyPoints: 0 };
  const userC = { id: '55555555-5555-4555-8555-555555555555', email: 'userC@example.com', role: 'CUSTOMER' as const, loyaltyPoints: 100 };

  const tokenA = jwt.sign({ sub: userA.id, role: userA.role }, TEST_SECRET, {
    issuer: AUTH_POLICY.issuer,
    audience: AUTH_POLICY.audience,
    expiresIn: 3600,
  });

  const tokenC = jwt.sign({ sub: userC.id, role: userC.role }, TEST_SECRET, {
    issuer: AUTH_POLICY.issuer,
    audience: AUTH_POLICY.audience,
    expiresIn: 3600,
  });

  const sharedCreatedAt = new Date('2026-10-22T10:00:00Z');
  const userCEntries = [
    {
      id: 'entry-c-0001',
      userId: userC.id,
      orderId: 'order-c-0001',
      kind: 'EARN' as const,
      points: 10,
      createdAt: sharedCreatedAt,
    },
    {
      id: 'entry-c-0002',
      userId: userC.id,
      orderId: 'order-c-0002',
      kind: 'EARN' as const,
      points: 20,
      createdAt: sharedCreatedAt,
    },
    {
      id: 'entry-c-0003',
      userId: userC.id,
      orderId: 'order-c-0003',
      kind: 'EARN' as const,
      points: 30,
      createdAt: sharedCreatedAt,
    },
    {
      id: 'entry-c-0004',
      userId: userC.id,
      orderId: 'order-c-0004',
      kind: 'EARN' as const,
      points: 40,
      createdAt: sharedCreatedAt,
    },
    {
      id: 'entry-c-0005',
      userId: userC.id,
      orderId: 'order-c-0005',
      kind: 'EARN' as const,
      points: 50,
      createdAt: sharedCreatedAt,
    },
  ];

  const entryUserA = {
    id: 'entry-a-1',
    userId: userA.id,
    orderId: 'order-1',
    kind: 'EARN' as const,
    points: 25,
    createdAt: new Date('2026-10-22T10:00:00Z'),
  };

  const entryUserB = {
    id: 'entry-b-1',
    userId: userB.id,
    orderId: 'order-2',
    kind: 'EARN' as const,
    points: 0,
    createdAt: new Date('2026-10-22T11:00:00Z'),
  };

  const mockPrisma = {
    user: {
      findUnique: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (where.id === userA.id) return userA;
        if (where.id === userB.id) return userB;
        if (where.id === userC.id) return userC;
        return null;
      }),
      update: jest.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: { loyaltyPoints: { increment?: number; decrement?: number } } }) => {
        const u = where.id === userA.id ? userA : userB;
        if (data.loyaltyPoints.increment) u.loyaltyPoints += data.loyaltyPoints.increment;
        if (data.loyaltyPoints.decrement) u.loyaltyPoints -= data.loyaltyPoints.decrement;
        return u;
      }),
    },
    loyaltyEntry: {
      count: jest.fn().mockImplementation(async ({ where }: { where: { userId: string } }) => {
        if (where.userId === userA.id) return 1;
        if (where.userId === userB.id) return 1;
        if (where.userId === userC.id) return userCEntries.length;
        return 0;
      }),
      findMany: jest.fn().mockImplementation(async (args: {
        where: { userId: string };
        orderBy?: Array<{ createdAt?: 'desc' | 'asc'; id?: 'desc' | 'asc' }> | { createdAt?: 'desc' | 'asc' };
        skip?: number;
        take?: number;
      }) => {
        let list: Array<typeof entryUserA | typeof entryUserB | (typeof userCEntries)[number]> = [];
        if (args.where.userId === userA.id) list = [entryUserA];
        else if (args.where.userId === userB.id) list = [entryUserB];
        else if (args.where.userId === userC.id) list = [...userCEntries];

        const orderByArray = (Array.isArray(args.orderBy)
          ? args.orderBy
          : args.orderBy
            ? [args.orderBy]
            : []) as Array<{ createdAt?: 'desc' | 'asc'; id?: 'desc' | 'asc' }>;
        if (orderByArray.length > 0) {
          list.sort((a, b) => {
            for (const orderClause of orderByArray) {
              if (orderClause.createdAt) {
                const diff = b.createdAt.getTime() - a.createdAt.getTime();
                if (diff !== 0) return orderClause.createdAt === 'desc' ? diff : -diff;
              }
              if (orderClause.id) {
                const cmp = b.id.localeCompare(a.id);
                if (cmp !== 0) return orderClause.id === 'desc' ? cmp : -cmp;
              }
            }
            return 0;
          });
        }

        const skip = args.skip ?? 0;
        const take = args.take ?? list.length;
        return list.slice(skip, skip + take);
      }),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .compile();

    app = module.createNestApplication();
    configureApp(app);
    await app.init();

    loyaltyService = app.get(LoyaltyService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/loyalty/me', () => {
    it('rejects unauthenticated request with 401 UNAUTHORIZED', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/loyalty/me')
        .expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('returns loyalty balance and earnRateVnd for userA', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/loyalty/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(response.body).toEqual({
        points: 25,
        earnRateVnd: 10000,
      });
    });
  });

  describe('GET /api/loyalty/me/entries', () => {
    it('returns paginated ledger entries only for current user', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/loyalty/me/entries')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe(entryUserA.id);
      expect(response.body.data[0].points).toBe(25);
      expect(response.body.data[0].kind).toBe('EARN');
      expect(response.body.meta).toEqual({
        page: 1,
        limit: 12,
        total: 1,
        totalPages: 1,
      });
    });

    it('sorts entries with identical createdAt deterministically by id DESC across pages without missing or duplicated entries', async () => {
      // Page 1 with limit 2
      const page1 = await request(app.getHttpServer())
        .get('/api/loyalty/me/entries?page=1&limit=2')
        .set('Authorization', `Bearer ${tokenC}`)
        .expect(200);

      expect(page1.body.data).toHaveLength(2);
      expect(page1.body.meta).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3 });

      // Page 2 with limit 2
      const page2 = await request(app.getHttpServer())
        .get('/api/loyalty/me/entries?page=2&limit=2')
        .set('Authorization', `Bearer ${tokenC}`)
        .expect(200);

      expect(page2.body.data).toHaveLength(2);
      expect(page2.body.meta).toEqual({ page: 2, limit: 2, total: 5, totalPages: 3 });

      // Page 3 with limit 2
      const page3 = await request(app.getHttpServer())
        .get('/api/loyalty/me/entries?page=3&limit=2')
        .set('Authorization', `Bearer ${tokenC}`)
        .expect(200);

      expect(page3.body.data).toHaveLength(1);
      expect(page3.body.meta).toEqual({ page: 3, limit: 2, total: 5, totalPages: 3 });

      // Verify deterministic sorting: id DESC (entry-c-0005, entry-c-0004 -> entry-c-0003, entry-c-0002 -> entry-c-0001)
      const page1Ids = page1.body.data.map((e: { id: string }) => e.id);
      const page2Ids = page2.body.data.map((e: { id: string }) => e.id);
      const page3Ids = page3.body.data.map((e: { id: string }) => e.id);

      expect(page1Ids).toEqual(['entry-c-0005', 'entry-c-0004']);
      expect(page2Ids).toEqual(['entry-c-0003', 'entry-c-0002']);
      expect(page3Ids).toEqual(['entry-c-0001']);

      const allIds = [...page1Ids, ...page2Ids, ...page3Ids];
      expect(new Set(allIds).size).toBe(5);

      // Verify prisma received orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      expect(mockPrisma.loyaltyEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
      );
    });
  });

  describe('Header and /loyalty points synchronization (Issue #15 feedback)', () => {
    it('returns dynamically updated points from /api/loyalty/me when user balance changes', async () => {
      // Initially userA has 25 points
      const initial = await request(app.getHttpServer())
        .get('/api/loyalty/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(initial.body.points).toBe(25);

      // User earns points from order (+15 points)
      userA.loyaltyPoints = 40;

      // On refresh / subsequent call, returns updated 40 points
      const refreshed = await request(app.getHttpServer())
        .get('/api/loyalty/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(refreshed.body.points).toBe(40);
    });

    it('auto-reconciles COMPLETED orders that are missing an EARN entry when fetching /api/loyalty/me', async () => {
      userB.loyaltyPoints = 0;
      const unrewardedCompletedOrders = [
        { id: 'order-studio-completed', userId: userB.id, total: 35000, status: 'COMPLETED' },
      ];
      (mockPrisma as Record<string, unknown>).order = {
        findMany: jest.fn().mockImplementation(async ({ where }: { where: { userId: string } }) => {
          if (where.userId === userB.id) return unrewardedCompletedOrders.splice(0);
          return [];
        }),
      };
      mockPrisma.loyaltyEntry.findUnique.mockResolvedValueOnce(null);
      mockPrisma.loyaltyEntry.create.mockResolvedValueOnce({
        id: 'entry-studio-1',
        userId: userB.id,
        orderId: 'order-studio-completed',
        kind: 'EARN',
        points: 3,
        createdAt: new Date(),
      });

      const tokenB = jwt.sign({ sub: userB.id, role: userB.role }, TEST_SECRET, {
        issuer: AUTH_POLICY.issuer,
        audience: AUTH_POLICY.audience,
        expiresIn: 3600,
      });

      const res = await request(app.getHttpServer())
        .get('/api/loyalty/me')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body.points).toBe(3);
      expect(mockPrisma.loyaltyEntry.create).toHaveBeenCalledWith({
        data: {
          userId: userB.id,
          orderId: 'order-studio-completed',
          kind: 'EARN',
          points: 3,
        },
      });
      delete (mockPrisma as Record<string, unknown>).order;
    });

    it('verifies frontend updateUserPoints synchronizes loyaltyPoints into shared auth store without infinite loops', () => {
      const authPath = resolve(__dirname, '../../frontend/src/lib/auth.ts');
      const authContent = readFileSync(authPath, 'utf8');

      // Check updateUserPoints export
      expect(authContent).toContain('export function updateUserPoints(points: number): void');
      // Check guard preventing infinite loop when points are identical
      expect(authContent).toContain('if (current.loyaltyPoints === points) return;');
      // Check event dispatch
      expect(authContent).toContain("window.dispatchEvent(new Event('brewlite-auth-change'))");

      const pagePath = resolve(__dirname, '../../frontend/src/app/loyalty/page.tsx');
      const pageContent = readFileSync(pagePath, 'utf8');

      // Check that loyalty page imports and invokes updateUserPoints when balance loads/refreshes
      expect(pageContent).toContain('updateUserPoints');
      expect(pageContent).toMatch(/updateUserPoints\s*\(\s*balRes\.points\s*\)/);
    });
  });

  describe('LoyaltyTransactionsPort: earn & reverse', () => {
    const memoryEntries = new Map<string, { id: string; orderId: string; kind: 'EARN' | 'REVERSE'; points: number; userId: string }>();

    const fakeTx = {
      loyaltyEntry: {
        findUnique: jest.fn().mockImplementation(async ({ where }: { where: { orderId_kind: { orderId: string; kind: string } } }) => {
          const key = `${where.orderId_kind.orderId}:${where.orderId_kind.kind}`;
          return memoryEntries.get(key) ?? null;
        }),
        create: jest.fn().mockImplementation(async ({ data }: { data: { id?: string; orderId: string; kind: 'EARN' | 'REVERSE'; points: number; userId: string } }) => {
          const key = `${data.orderId}:${data.kind}`;
          const entry = { id: `entry-${key}`, ...data };
          memoryEntries.set(key, entry);
          return entry;
        }),
      },
      user: {
        update: jest.fn().mockImplementation(async ({ _where, data }: { _where?: { id: string }; data: { loyaltyPoints: { increment?: number; decrement?: number } } }) => {
          if (data.loyaltyPoints.increment) userA.loyaltyPoints += data.loyaltyPoints.increment;
          if (data.loyaltyPoints.decrement) userA.loyaltyPoints -= data.loyaltyPoints.decrement;
          return userA;
        }),
      },
    } as unknown as Tx;

    beforeEach(() => {
      memoryEntries.clear();
      jest.clearAllMocks();
      userA.loyaltyPoints = 25;
    });

    it('earns floor(total / 10000) points and increments user balance', async () => {
      const storedOrder = {
        id: 'order-108k',
        userId: userA.id,
        total: 108000,
      } as StoredOrder;

      const earned = await loyaltyService.earn(fakeTx, storedOrder);
      expect(earned).toBe(10);
      expect(userA.loyaltyPoints).toBe(35);

      const entry = memoryEntries.get('order-108k:EARN');
      expect(entry).toBeDefined();
      expect(entry?.points).toBe(10);
    });

    it('records EARN = 0 points for orders total < 10000 without incrementing user balance', async () => {
      const smallOrder = {
        id: 'order-5k',
        userId: userA.id,
        total: 5000,
      } as StoredOrder;

      const earned = await loyaltyService.earn(fakeTx, smallOrder);
      expect(earned).toBe(0);
      expect(userA.loyaltyPoints).toBe(25); // unchanged

      const entry = memoryEntries.get('order-5k:EARN');
      expect(entry).toBeDefined();
      expect(entry?.points).toBe(0);
    });

    it('does not duplicate earn if called a second time for the same order', async () => {
      const order = {
        id: 'order-duplicate-earn',
        userId: userA.id,
        total: 50000,
      } as StoredOrder;

      const first = await loyaltyService.earn(fakeTx, order);
      expect(first).toBe(5);
      expect(userA.loyaltyPoints).toBe(30);

      const second = await loyaltyService.earn(fakeTx, order);
      expect(second).toBe(5);
      expect(userA.loyaltyPoints).toBe(30); // not incremented again
    });

    it('reverses exact earned points when order is cancelled before preparing', async () => {
      const order = {
        id: 'order-to-reverse',
        userId: userA.id,
        total: 120000,
      } as StoredOrder;

      await loyaltyService.earn(fakeTx, order);
      expect(userA.loyaltyPoints).toBe(37); // 25 + 12

      await loyaltyService.reverse(fakeTx, order);
      expect(userA.loyaltyPoints).toBe(25); // 37 - 12

      const reverseEntry = memoryEntries.get('order-to-reverse:REVERSE');
      expect(reverseEntry).toBeDefined();
      expect(reverseEntry?.points).toBe(-12);
    });

    it('does not reverse repeatedly if reverse is called twice', async () => {
      const order = {
        id: 'order-dup-reverse',
        userId: userA.id,
        total: 40000,
      } as StoredOrder;

      await loyaltyService.earn(fakeTx, order);
      expect(userA.loyaltyPoints).toBe(29); // 25 + 4

      await loyaltyService.reverse(fakeTx, order);
      expect(userA.loyaltyPoints).toBe(25); // 29 - 4

      await loyaltyService.reverse(fakeTx, order);
      expect(userA.loyaltyPoints).toBe(25); // still 25
    });
  });
});

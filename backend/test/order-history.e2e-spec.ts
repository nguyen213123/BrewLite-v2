import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { AUTH_POLICY } from '../src/modules/auth/auth-policy';

const TEST_SECRET = 'this-is-a-valid-test-jwt-secret-with-at-least-32-characters';

describe('Order History module (Issue #12)', () => {
  let app: INestApplication;

  const userA = { id: '33333333-3333-4333-8333-333333333333', email: 'userA@example.com', role: 'CUSTOMER' as const };
  const userB = { id: '44444444-4444-4444-8444-444444444444', email: 'userB@example.com', role: 'CUSTOMER' as const };

  const tokenA = jwt.sign({ sub: userA.id, role: userA.role }, TEST_SECRET, {
    issuer: AUTH_POLICY.issuer,
    audience: AUTH_POLICY.audience,
    expiresIn: 3600,
  });

  const tokenB = jwt.sign({ sub: userB.id, role: userB.role }, TEST_SECRET, {
    issuer: AUTH_POLICY.issuer,
    audience: AUTH_POLICY.audience,
    expiresIn: 3600,
  });

  const sampleOrderA = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    code: 'BL-20261022-A1A1A1A1',
    userId: userA.id,
    status: 'PAID' as const,
    reservationStatus: 'CONSUMED' as const,
    version: 1,
    subtotal: 120000,
    discount: 12000,
    total: 108000,
    currency: 'VND' as const,
    promotionId: null,
    promotionCode: 'SAVE10',
    createdAt: new Date('2026-10-22T10:00:00Z'),
    updatedAt: new Date('2026-10-22T10:05:00Z'),
    items: [
      {
        id: 'item-1',
        orderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        productId: '11111111-1111-4111-8111-111111111111',
        productName: 'Cappuccino',
        size: 'M' as const,
        sizePrice: 50000,
        qty: 2,
        unitPrice: 60000,
        lineTotal: 120000,
        toppings: [
          {
            id: 'topping-item-1',
            orderItemId: 'item-1',
            toppingId: '22222222-2222-4222-8222-222222222222',
            name: 'Kem cheese',
            price: 10000,
          },
        ],
      },
    ],
  };

  const sampleOrderB = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    code: 'BL-20261022-B2B2B2B2',
    userId: userB.id,
    status: 'PENDING' as const,
    reservationStatus: 'HELD' as const,
    version: 1,
    subtotal: 50000,
    discount: 0,
    total: 50000,
    currency: 'VND' as const,
    promotionId: null,
    promotionCode: null,
    createdAt: new Date('2026-10-22T11:00:00Z'),
    updatedAt: new Date('2026-10-22T11:00:00Z'),
    items: [],
  };

  const mockPrisma = {
    user: {
      findUnique: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (where.id === userA.id) return userA;
        if (where.id === userB.id) return userB;
        return null;
      }),
    },
    order: {
      count: jest.fn().mockImplementation(async ({ where }: { where: { userId: string } }) => {
        if (where.userId === userA.id) return 1;
        if (where.userId === userB.id) return 1;
        return 0;
      }),
      findMany: jest.fn().mockImplementation(async ({ where }: { where: { userId: string } }) => {
        if (where.userId === userA.id) return [sampleOrderA];
        if (where.userId === userB.id) return [sampleOrderB];
        return [];
      }),
      findUnique: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        if (where.id === sampleOrderA.id) return sampleOrderA;
        if (where.id === sampleOrderB.id) return sampleOrderB;
        return null;
      }),
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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/orders/me (list user orders)', () => {
    it('rejects unauthenticated request with 401 UNAUTHORIZED', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/orders/me')
        .expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('returns only orders belonging to userA', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/orders/me')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe(sampleOrderA.id);
      expect(response.body.data[0].code).toBe(sampleOrderA.code);
      expect(response.body.data[0].status).toBe('PAID');
      expect(response.body.meta).toEqual({
        page: 1,
        limit: 12,
        total: 1,
        totalPages: 1,
      });
    });

    it('returns only orders belonging to userB', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/orders/me')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe(sampleOrderB.id);
      expect(response.body.data[0].code).toBe(sampleOrderB.code);
      expect(response.body.data[0].status).toBe('PENDING');
    });
  });

  describe('GET /api/orders/:id (order detail & confirmation)', () => {
    it('rejects unauthenticated request with 401 UNAUTHORIZED', async () => {
      await request(app.getHttpServer())
        .get(`/api/orders/${sampleOrderA.id}`)
        .expect(401);
    });

    it('returns 400 VALIDATION_ERROR if :id is not a valid UUID', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/orders/not-a-valid-uuid')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('returns full order details with snapshot items when requested by owner', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/orders/${sampleOrderA.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(response.body.id).toBe(sampleOrderA.id);
      expect(response.body.code).toBe(sampleOrderA.code);
      expect(response.body.subtotal).toBe(120000);
      expect(response.body.discount).toBe(12000);
      expect(response.body.total).toBe(108000);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0]).toEqual({
        id: 'item-1',
        productId: '11111111-1111-4111-8111-111111111111',
        productName: 'Cappuccino',
        size: 'M',
        sizePrice: 50000,
        qty: 2,
        unitPrice: 60000,
        lineTotal: 120000,
        toppings: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Kem cheese',
            price: 10000,
          },
        ],
      });
    });

    it('returns 404 ORDER_NOT_FOUND when non-existent order ID is queried', async () => {
      const nonExistentId = '99999999-9999-4999-8999-999999999999';
      const response = await request(app.getHttpServer())
        .get(`/api/orders/${nonExistentId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);

      expect(response.body.code).toBe('ORDER_NOT_FOUND');
    });

    it('prevents User A from accessing User B order (returns 404 ORDER_NOT_FOUND without revealing data)', async () => {
      // User A attempts to view User B's order
      const response = await request(app.getHttpServer())
        .get(`/api/orders/${sampleOrderB.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);

      expect(response.body.code).toBe('ORDER_NOT_FOUND');
      expect(response.body.message).toBe('Không tìm thấy đơn hàng');
    });
  });
});

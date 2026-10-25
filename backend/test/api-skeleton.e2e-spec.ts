import { INestApplication, InternalServerErrorException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthPort, LoyaltyPort, OrderReadPort, OrdersPort, PaymentsPort, ProductsPort, PromotionsPort } from '../src/common/contracts/ports';
import { IdentityPort } from '../src/common/security/security';
import { ApiError } from '../src/common/errors/api-error';

type Fixture = {
  name: string; operationId: string; method: string; path: string;
  pathParameters?: Record<string, string>;
  request?: { body?: object; headers?: Record<string, string> };
  response: { status: number; body: Record<string, unknown> };
};
const fixtures: Fixture[] = JSON.parse(readFileSync(resolve(__dirname, '../../docs/api/examples.json'), 'utf8')).examples;
const success = new Map<string, Fixture>();
for (const fixture of fixtures) if (fixture.response.status < 300 && !success.has(fixture.operationId)) success.set(fixture.operationId, fixture);
const result = (operationId: string) => success.get(operationId)!.response.body;
const userId = '33333333-3333-4333-8333-333333333333';
const orderId = '44444444-4444-4444-8444-444444444444';
const productId = '11111111-1111-4111-8111-111111111111';
const key = '77777777-7777-4777-8777-777777777777';
const auth = 'Bearer customer-token';
const validOrder = fixtures.find(f => f.name === 'create pending')!.request!.body!;

// Transport integration only. Mocks below are test overrides, never runtime fixtures.
describe('API skeleton transport (business ports mocked)', () => {
  let app: INestApplication;
  const create = jest.fn().mockResolvedValue({ data: result('createOrder'), replayed: false });
  const products = { list: jest.fn().mockResolvedValue(result('listProducts')), detail: jest.fn().mockResolvedValue(result('getProduct')) };
  const quote = jest.fn().mockResolvedValue(result('quoteOrder'));
  const register = jest.fn().mockResolvedValue(result('register'));
  const listMine = jest.fn().mockResolvedValue(result('listMyOrders'));
  const findMine = jest.fn().mockResolvedValue(result('getMyOrder'));
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue({ $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) })
      .overrideProvider(IdentityPort).useValue({ verifyAccessToken: async (token: string) => {
        if (!['customer-token', 'staff-token'].includes(token)) throw new ApiError(401, 'UNAUTHORIZED', 'Token không hợp lệ');
        return { id: userId, email: 'customer@example.com', role: token === 'staff-token' ? 'STAFF' : 'CUSTOMER' };
      } })
      .overrideProvider(ProductsPort).useValue(products)
      .overrideProvider(AuthPort).useValue({ register, login: async () => result('login'), me: async () => result('getCurrentUser') })
      .overrideProvider(OrdersPort).useValue({ create, quote, cancel: async () => result('cancelMyOrder'), transition: async () => result('transitionOrderStatus') })
      .overrideProvider(OrderReadPort).useValue({ listMine, findMine })
      .overrideProvider(PaymentsPort).useValue({ pay: async () => ({ data: result('payOrder'), replayed: false }) })
      .overrideProvider(PromotionsPort).useValue({ validate: async () => result('validatePromotion') })
      .overrideProvider(LoyaltyPort).useValue({ balance: async () => result('getMyLoyalty'), entries: async () => result('listMyLoyaltyEntries') })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  for (const fixture of success.values()) {
    it(`mounts ${fixture.method} ${fixture.path} with contract status/body`, async () => {
      let path = `/api${fixture.path}`;
      for (const [name, value] of Object.entries(fixture.pathParameters ?? {})) path = path.replace(`{${name}}`, value);
      const agent = request(app.getHttpServer());
      const req = fixture.method === 'POST' ? agent.post(path) : fixture.method === 'PATCH' ? agent.patch(path) : agent.get(path);
      req.set('Authorization', fixture.operationId === 'transitionOrderStatus' ? 'Bearer staff-token' : auth);
      for (const [header, value] of Object.entries(fixture.request?.headers ?? {})) {
        if (header !== 'Authorization') req.set(header, value);
      }
      if (fixture.request?.body) req.send(fixture.request.body);
      await req.expect(fixture.response.status, fixture.response.body);
    });
  }

  it('routes /orders/me before a UUID detail route and propagates the verified owner', async () => {
    await request(app.getHttpServer()).get('/api/orders/me').set('Authorization', auth).expect(200);
    expect(listMine).toHaveBeenLastCalledWith(userId, expect.objectContaining({ page: 1, limit: 12 }));
    await request(app.getHttpServer()).get(`/api/orders/${orderId}`).set('Authorization', auth).expect(200);
    expect(findMine).toHaveBeenLastCalledWith(userId, orderId);
  });

  it.each([undefined, 'Basic abc', 'Bearer abc def', 'Bearer invalid-token'])('rejects unauthorized header %s', async header => {
    const req = request(app.getHttpServer()).post('/api/orders').send(validOrder);
    if (header) req.set('Authorization', header);
    const response = await req.expect(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
  });
  it('requires STAFF for state updates', async () => {
    const response = await request(app.getHttpServer()).patch(`/api/orders/${orderId}/status`).set('Authorization', auth)
      .send({ expectedVersion: 1, status: 'PREPARING' }).expect(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });
  it.each([undefined, 'not-a-uuid'])('requires UUID Idempotency-Key (%s)', async value => {
    const req = request(app.getHttpServer()).post('/api/orders').set('Authorization', auth).send(validOrder);
    if (value) req.set('Idempotency-Key', value);
    const response = await req.expect(400);
    expect(response.body.details[0].field).toBe('Idempotency-Key');
  });
  const invalidBodies = [
    { ...validOrder, total: 1 },
    { ...validOrder, userId },
    { items: [] },
    { items: [{ productId, size: 'M', qty: '1' }] },
    { items: [{ productId, size: 'M', qty: 0 }] },
    { items: [{ productId, size: 'M', qty: 1.5 }] },
    { items: [{ productId, size: 'XL', qty: 1 }] },
    { items: [{ productId, size: 'S', qty: 1, toppingIds: null }] },
    { items: [{ productId, size: 'S', qty: 1, toppingIds: [productId, productId] }] },
    { items: [{ productId, size: 'S', qty: 1 }], promotionCode: null },
    { items: [1] },
  ];
  it.each(invalidBodies)('rejects malformed cart or client-controlled fields: %j', async body => {
    const response = await request(app.getHttpServer()).post('/api/orders').set('Authorization', auth)
      .set('Idempotency-Key', key).send(body).expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.details.length).toBeGreaterThan(0);
  });
  it.each(['?page=0', '?limit=51', '?page=1.5', '?page=0x10', '?page[]=1', '?other=1'])('rejects invalid pagination/query %s', async query => {
    await request(app.getHttpServer()).get(`/api/products${query}`).expect(400);
  });
  it('rejects unrecognized query keys on endpoints without a query contract', async () => {
    await request(app.getHttpServer()).get(`/api/products/${productId}?other=1`).expect(400);
  });
  it('normalizes email/promotion and forwards verified user, not a request userId', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send({ email: ' Customer@Example.com ', password: 'DemoPass123!' }).expect(201);
    expect(register).toHaveBeenLastCalledWith(expect.objectContaining({ email: 'customer@example.com' }));
    await request(app.getHttpServer()).post('/api/orders/quote').set('Authorization', auth).send({ ...validOrder, promotionCode: ' save10 ' }).expect(200);
    expect(quote).toHaveBeenLastCalledWith(userId, expect.objectContaining({ promotionCode: 'SAVE10' }));
  });
  it('does not accept registration role or passwords beyond the bcrypt byte limit', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send({ email: 'a@example.com', password: 'DemoPass123!', role: 'STAFF' }).expect(400);
    const password = 'đ'.repeat(40);
    const response = await request(app.getHttpServer()).post('/api/auth/register').send({ email: 'a@example.com', password }).expect(400);
    expect(JSON.stringify(response.body)).not.toContain(password);
  });
  it('sends replay and readable CORS headers', async () => {
    create.mockResolvedValueOnce({ data: result('createOrder'), replayed: true });
    await request(app.getHttpServer()).post('/api/orders').set('Authorization', auth).set('Idempotency-Key', key)
      .set('Origin', 'http://localhost:3000').send(validOrder)
      .expect('Idempotency-Replayed', 'true').expect('Access-Control-Expose-Headers', 'Idempotency-Replayed,Retry-After').expect(201);
  });
  it('preflights Authorization and Idempotency-Key for checkout', async () => {
    await request(app.getHttpServer()).options('/api/orders').set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization,idempotency-key,content-type')
      .expect('Access-Control-Allow-Headers', 'Authorization,Content-Type,Idempotency-Key').expect(204);
  });
  it('masks unexpected exception text', async () => {
    products.list.mockRejectedValueOnce(new Error('private-database-password'));
    const response = await request(app.getHttpServer()).get('/api/products').expect(500);
    expect(response.body).toEqual({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'Lỗi nội bộ', details: [] });
  });
  it('also masks a framework 500 exception containing private details', async () => {
    products.list.mockRejectedValueOnce(new InternalServerErrorException('private-database-password'));
    const response = await request(app.getHttpServer()).get('/api/products').expect(500);
    expect(JSON.stringify(response.body)).not.toContain('private-database-password');
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
});

describe('Default skeleton fails closed without mocked ports', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  it('does not decode-and-trust a token or call order handlers', async () => {
    const response = await request(app.getHttpServer()).post('/api/orders').set('Authorization', 'Bearer not-a-verified-token')
      .set('Idempotency-Key', key).send(validOrder).expect(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
  });
  it('still refuses a protected request without a token', async () => {
    await request(app.getHttpServer()).get('/api/orders/me').expect(401);
  });
});

describe('Public catalog API (database mocked)', () => {
  let app: INestApplication;
  const product = {
    id: productId,
    name: 'Cappuccino',
    description: 'Cà phê espresso và sữa',
    price: 45000,
    imageUrl: 'http://localhost:3000/images/cappuccino.jpg',
    stock: 20,
  };
  const prismaMock = {
    product: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([product]),
    },
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prismaMock)
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => { await app?.close(); });

  it('returns 200 with product data and pagination metadata', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/products?page=1&limit=12')
      .expect(200);

    expect(response.body).toEqual({
      data: [product],
      meta: { page: 1, limit: 12, total: 1, totalPages: 1 },
    });
    expect(prismaMock.product.count).toHaveBeenCalledWith({ where: { active: true } });
    expect(prismaMock.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true }, skip: 0, take: 12 }),
    );
  });
});

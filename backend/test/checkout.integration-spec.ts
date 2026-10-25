import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTempDatabase, type TempDatabase } from './support/temp-database';

const integration = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
integration('Real checkout: auth/catalog/create/inventory/promotion/payment/loyalty', () => {
  let db: TempDatabase | undefined;
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let userId: string;
  const originalUrl = process.env.DATABASE_URL;
  const originalSecret = process.env.JWT_SECRET;
  const backend = path.resolve(__dirname, '..');
  beforeAll(async () => {
    db = await createTempDatabase(originalUrl);
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET = 'checkout-integration-test-only-secret-at-least-32';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication(); configureApp(app); await app.init();
    prisma = app.get(PrismaService);
    const auth = await request(app.getHttpServer()).post('/api/auth/register')
      .send({ email: `checkout-${randomUUID()}@example.com`, password: 'CheckoutPass123!' }).expect(201);
    token = auth.body.accessToken as string; userId = auth.body.user.id as string;
  }, 120_000);
  afterAll(async () => {
    try { await app?.close(); } finally {
      if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
      if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
      await db?.drop();
    }
  }, 60_000);
  function post(url: string, body: unknown, key = randomUUID()) {
    return request(app.getHttpServer()).post(`/api${url}`).auth(token, { type: 'bearer' })
      .set('Idempotency-Key', key).send(body as object);
  }
  async function fixture(stock = 20, maxUses = 100) {
    const id = randomUUID(), toppingId = randomUUID(), code = `T${randomUUID().slice(0, 8).toUpperCase()}`;
    await prisma.topping.create({ data: { id: toppingId, name: 'Kem', price: 10000 } });
    await prisma.product.create({ data: { id, name: 'Cappuccino', description: 'Checkout fixture', price: 45000,
      imageUrl: 'http://localhost:3000/images/cappuccino.jpg', stock,
      sizes: { create: [{ size: 'S', price: 45000 }, { size: 'M', price: 50000 }, { size: 'L', price: 55000 }] },
      toppings: { create: [{ toppingId }] } } });
    const promo = await prisma.promotion.create({ data: { code, type: 'PERCENT', value: 10, minSubtotal: 100000,
      maxDiscount: 30000, maxUses, startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3600_000) } });
    return { id, promo, body: { items: [{ productId: id, size: 'M', toppingIds: [toppingId], qty: 2 }], promotionCode: code } };
  }
  it('seed runs twice without duplicates, and seeded catalog has sizes and toppings', async () => {
    const build = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.seed.json'], { cwd: backend, encoding: 'utf8' });
    expect(build.status).toBe(0);
    const runSeed = () => {
      const result = spawnSync(process.execPath, ['dist/seed/seed.js'], { cwd: backend,
        env: { ...process.env, DATABASE_URL: db!.url }, encoding: 'utf8' });
      expect(result.status).toBe(0);
    };
    runSeed();
    const counts = async () => Promise.all([prisma.product.count(), prisma.productSize.count(), prisma.topping.count(), prisma.productTopping.count(), prisma.promotion.count()]);
    const first = await counts(); runSeed(); expect(await counts()).toEqual(first);
    expect(first).toEqual([17, 51, 5, 85, 3]);
    const response = await request(app.getHttpServer()).get('/api/products/11111111-1111-4111-8111-111111111111').expect(200);
    expect(response.body.sizes).toHaveLength(3); expect(response.body.toppings).toHaveLength(5);
  }, 60_000);
  it('quotes, creates once, pays once, and atomically refunds/cancels with points reversed', async () => {
    const f = await fixture();
    const quote = await post('/orders/quote', f.body).expect(200);
    expect(quote.body).toMatchObject({ subtotal: 120000, discount: 12000, total: 108000 });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: f.id } })).stock).toBe(20);
    const key = randomUUID();
    const created = await post('/orders', f.body, key).expect(201);
    const replay = await post('/orders', f.body, key).expect(201);
    expect(replay.body.id).toBe(created.body.id); expect(replay.headers['idempotency-replayed']).toBe('true');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: f.id } })).stock).toBe(18);
    const paymentKey = randomUUID(), payBody = { orderId: created.body.id, method: 'CARD', mockOutcome: 'SUCCESS' };
    const paid = await post('/payments', payBody, paymentKey).expect(200);
    expect(paid.body).toMatchObject({ order: { status: 'PAID', total: 108000 }, loyaltyPointsEarned: 10 });
    await post('/payments', payBody, paymentKey).expect(200);
    expect(await prisma.payment.count({ where: { orderId: created.body.id } })).toBe(1);
    expect(await prisma.loyaltyEntry.count({ where: { orderId: created.body.id, kind: 'EARN' } })).toBe(1);
    await post('/payments', payBody).expect(409);
    const cancelled = await post(`/orders/${created.body.id}/cancel`, { expectedVersion: paid.body.order.version }).expect(200);
    await post(`/orders/${created.body.id}/cancel`, { expectedVersion: cancelled.body.version }).expect(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: f.id } })).stock).toBe(20);
    expect((await prisma.promotion.findUniqueOrThrow({ where: { id: f.promo.id } })).usedCount).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).loyaltyPoints).toBe(0);
    expect(await prisma.loyaltyEntry.count({ where: { orderId: created.body.id, kind: 'REVERSE' } })).toBe(1);
    expect((await prisma.payment.findFirstOrThrow({ where: { orderId: created.body.id } })).status).toBe('REFUNDED');
  });
  it('failed payment releases once; a new key retries the same order with the original prices', async () => {
    const f = await fixture(); const created = await post('/orders', f.body).expect(201);
    const failedKey = randomUUID(), body = { orderId: created.body.id, method: 'WALLET', mockOutcome: 'FAIL' };
    await post('/payments', body, failedKey).expect(200); await post('/payments', body, failedKey).expect(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: f.id } })).stock).toBe(20);
    expect((await prisma.promotion.findUniqueOrThrow({ where: { id: f.promo.id } })).usedCount).toBe(0);
    await prisma.productSize.updateMany({ where: { productId: f.id }, data: { price: 99999 } });
    const paid = await post('/payments', { ...body, mockOutcome: 'SUCCESS' }).expect(200);
    expect(paid.body.order).toMatchObject({ id: created.body.id, total: 108000, status: 'PAID' });
    expect(await prisma.order.count({ where: { items: { some: { productId: f.id } } } })).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: f.id } })).stock).toBe(18);
  });
  it('out of stock rolls back promotion, idempotency and all order writes', async () => {
    const f = await fixture(1), key = randomUUID();
    const response = await post('/orders', f.body, key).expect(409); expect(response.body.code).toBe('OUT_OF_STOCK');
    expect((await prisma.promotion.findUniqueOrThrow({ where: { id: f.promo.id } })).usedCount).toBe(0);
    expect(await prisma.order.count({ where: { items: { some: { productId: f.id } } } })).toBe(0);
    expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(0);
  });
  it('invalid selections and client price/userId are rejected; another user cannot pay the order', async () => {
    const f = await fixture();
    await post('/orders', { ...f.body, total: 1, userId }).expect(400);
    await post('/orders', { items: [{ productId: f.id, size: 'M', qty: 1, toppingIds: [randomUUID()] }] }).expect(422);
    const created = await post('/orders', f.body).expect(201);
    const auth = await request(app.getHttpServer()).post('/api/auth/register').send({ email: `${randomUUID()}@example.com`, password: 'CheckoutPass123!' }).expect(201);
    const response = await request(app.getHttpServer()).post('/api/payments').auth(auth.body.accessToken as string, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID()).send({ orderId: created.body.id, method: 'CARD' }).expect(404);
    expect(response.body.code).toBe('ORDER_NOT_FOUND');
  });
  it('ten competing creates for the last cup result in one order and non-negative stock', async () => {
    const f = await fixture(1);
    const body = { items: [{ productId: f.id, size: 'S', qty: 1 }] };
    const responses = await Promise.all(Array.from({ length: 10 }, () => post('/orders', body)));
    expect(responses.filter(r => r.status === 201)).toHaveLength(1);
    expect(responses.filter(r => r.status === 409)).toHaveLength(9);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: f.id } })).stock).toBe(0);
  }, 30_000);
});

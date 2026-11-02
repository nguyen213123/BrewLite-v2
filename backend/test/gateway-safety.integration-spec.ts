import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { VnPayService, sortAndEncode } from '../src/modules/payments/vnpay.service';
import { createTempDatabase, type TempDatabase } from './support/temp-database';

const integration = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const secret = 'whsec_gateway_integration_only';
const vnSecret = 'vnpay_gateway_integration_only';
jest.setTimeout(30_000);

integration('Gateway safety: active sessions, duplicate receipts, webhook and loyalty', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stripe: StripeService;
  let db: TempDatabase | undefined;
  let token: string;
  let foreignToken: string;
  let staffToken: string;
  let userId: string;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    db = await createTempDatabase(originalEnv.DATABASE_URL);
    Object.assign(process.env, {
      DATABASE_URL: db.url, STRIPE_WEBHOOK_SECRET: secret,
      // Session verification uses mocked fetch, but still requires an explicit test API key.
      STRIPE_SECRET_KEY: 'sk_test_gateway_integration_only',
      JWT_SECRET: 'gateway-integration-jwt-secret-with-32-characters',
      VNPAY_TMN_CODE: 'TESTTMN1', VNPAY_HASH_SECRET: vnSecret,
      VNPAY_URL: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
      VNPAY_RETURN_URL: 'http://localhost:3000/payments/vnpay-return',
    });
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    stripe = app.get(StripeService);
    const register = () => request(app.getHttpServer()).post('/api/auth/register')
      .send({ email: `gateway-${randomUUID()}@example.com`, password: 'Password123!' }).expect(201);
    const own = await register();
    token = own.body.accessToken;
    userId = own.body.user.id;
    foreignToken = (await register()).body.accessToken;
    const staff = await register();
    await prisma.user.update({ where: { id: staff.body.user.id }, data: { role: 'STAFF' } });
    staffToken = (await request(app.getHttpServer()).post('/api/auth/login')
      .send({ email: staff.body.user.email, password: 'Password123!' }).expect(200)).body.accessToken;
  }, 120_000);
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    try { await app?.close(); }
    finally { process.env = originalEnv; await db?.drop(); }
  }, 60_000);

  async function fixture(free = false) {
    const ingredient = await prisma.ingredient.create({ data: {
      name: `ingredient-${randomUUID()}`, unit: 'PIECE', stock: 20, packageSize: 1, packageLabel: 'unit',
    } });
    const product = await prisma.product.create({ data: {
      name: 'Gateway fixture', description: 'Test', price: 50000, imageUrl: 'http://localhost/image.png',
      sizes: { create: { size: 'M', price: 50000 } },
      ingredients: { create: { ingredientId: ingredient.id, amount: 1 } },
    } });
    const promotion = free ? await prisma.promotion.create({ data: {
      code: `FREE${randomUUID().slice(0, 8).toUpperCase()}`, type: 'PERCENT', value: 100, maxUses: 10,
      startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3600_000),
    } }) : null;
    const response = await request(app.getHttpServer()).post('/api/orders').auth(token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID()).send({ items: [{ productId: product.id, size: 'M', qty: 1 }],
        ...(promotion ? { promotionCode: promotion.code } : {}),
      }).expect(201);
    return { order: response.body as { id: string; code: string; total: number; version: number }, ingredient, promotion };
  }
  function createStripe(orderId: string) {
    return request(app.getHttpServer()).post('/api/payments/stripe/create-session').auth(token, { type: 'bearer' }).send({ orderId });
  }
  function createVn(orderId: string) {
    return request(app.getHttpServer()).post('/api/payments/vnpay/create-url').auth(token, { type: 'bearer' }).send({ orderId });
  }
  function mockCreate() {
    return jest.spyOn(stripe, 'createCheckoutSession').mockImplementation(async () => ({
      sessionId: `cs_test_${randomUUID()}`, url: `https://checkout.stripe.com/${randomUUID()}`,
    }));
  }
  function webhook(sessionId: string, type = 'checkout.session.completed', timestamp = Math.floor(Date.now() / 1000)) {
    const raw = JSON.stringify({ id: `evt_${randomUUID()}`, type, data: { object: { id: sessionId } } }, null, 2);
    const signature = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
    return request(app.getHttpServer()).post('/api/payments/stripe/webhook')
      .set('Content-Type', 'application/json').set('Stripe-Signature', `t=${timestamp},v1=${signature}`).send(raw);
  }

  it.each(['cancel', 'complete', 'cancel-before-confirm'])('handles a 100 percent discount with no PaymentIntent and no refund API (%s)', async action => {
    const { order, ingredient, promotion } = await fixture(true);
    expect(order.total).toBe(0);
    await createVn(order.id).expect(422).expect(({ body }) => expect(body.code).toBe('PAYMENT_METHOD_UNSUPPORTED'));
    mockCreate();
    const session = (await createStripe(order.id).expect(201)).body;
    if (action === 'cancel-before-confirm') {
      await request(app.getHttpServer()).post(`/api/orders/${order.id}/cancel`).auth(token, { type: 'bearer' })
        .send({ expectedVersion: order.version }).expect(200);
    }
    const api = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
      status: 'complete', payment_status: 'no_payment_required', amount_total: 0,
      metadata: { orderId: order.id, orderCode: order.code, stripeRef: session.stripeRef },
    })));
    const refund = jest.spyOn(stripe, 'refundPayment');
    await webhook(session.sessionId).expect(200);
    const verified = await request(app.getHttpServer()).get('/api/payments/stripe/verify')
      .query({ session_id: session.sessionId }).expect(200);
    const recorded = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    await request(app.getHttpServer()).post('/api/payments/vnpay/refund').auth(token, { type: 'bearer' })
      .send({ paymentId: recorded.id }).expect(404);
    if (action === 'cancel-before-confirm') {
      expect(verified.body).toMatchObject({ success: false, requiresManualReview: false, orderStatus: 'CANCELLED' });
      expect((await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } })).stock).toBe(20);
      expect(await prisma.payment.findFirst({ where: { orderId: order.id } })).toMatchObject({ amount: 0, status: 'REFUNDED' });
      expect(refund).not.toHaveBeenCalled();
      return;
    }
    expect(verified.body.success).toBe(true);
    expect(await prisma.payment.count({ where: { orderId: order.id, amount: 0, status: 'SUCCEEDED' } })).toBe(1);
    expect((await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } })).stock).toBe(19);
    let current = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    if (action === 'cancel') {
      const cancelled = await request(app.getHttpServer()).post(`/api/orders/${order.id}/cancel`)
        .auth(token, { type: 'bearer' }).send({ expectedVersion: current.version }).expect(200);
      await request(app.getHttpServer()).post(`/api/orders/${order.id}/cancel`).auth(token, { type: 'bearer' })
        .send({ expectedVersion: current.version }).expect(409);
      await request(app.getHttpServer()).post(`/api/orders/${order.id}/cancel`).auth(token, { type: 'bearer' })
        .send({ expectedVersion: cancelled.body.version }).expect(200);
      expect((await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } })).stock).toBe(20);
      expect((await prisma.promotion.findUniqueOrThrow({ where: { id: promotion!.id } })).usedCount).toBe(0);
      const receipt = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id }, include: { idempotency: true } });
      expect(receipt).toMatchObject({ status: 'REFUNDED', amount: 0, idempotency: { response: { refundStatus: 'NOT_REQUIRED' } } });
    } else {
      const points = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).loyaltyPoints;
      for (const status of ['PREPARING', 'READY', 'COMPLETED']) {
        const result = await request(app.getHttpServer()).patch(`/api/orders/${order.id}/status`).auth(staffToken, { type: 'bearer' })
          .send({ expectedVersion: current.version, status }).expect(200);
        current = result.body;
      }
      expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).loyaltyPoints).toBe(points);
      expect(await prisma.loyaltyEntry.findFirst({ where: { orderId: order.id, kind: 'EARN' } })).toMatchObject({ points: 0 });
    }
    expect(refund).not.toHaveBeenCalled();
    expect(api.mock.calls.every(([url]) => String(url).includes('/checkout/sessions/'))).toBe(true);
  });

  it('reuses one Stripe session under concurrent requests, prevents gateway switching and can replace expired sessions', async () => {
    const { order } = await fixture();
    const create = mockCreate();
    const replies = await Promise.all(Array.from({ length: 4 }, () => createStripe(order.id).expect(201)));
    expect(create).toHaveBeenCalledTimes(1);
    expect(new Set(replies.map(reply => reply.body.sessionId)).size).toBe(1);
    const attempt = await prisma.idempotencyRecord.findFirstOrThrow({ where: { key: replies[0].body.stripeRef } });
    expect(attempt.response).toBeNull();
    expect(attempt.context).toMatchObject({ orderId: order.id, provider: 'STRIPE', url: replies[0].body.checkoutUrl });
    await createVn(order.id).expect(409);
    await request(app.getHttpServer()).post('/api/payments/stripe/create-session')
      .auth(foreignToken, { type: 'bearer' }).send({ orderId: order.id }).expect(403);
    await prisma.idempotencyRecord.update({ where: { id: attempt.id }, data: { context: {
      ...(attempt.context as Record<string, string>), expiresAt: new Date(Date.now() - 60_000).toISOString(),
    } } });
    const next = await createStripe(order.id).expect(201);
    expect(next.body.sessionId).not.toBe(replies[0].body.sessionId);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('reuses VNPay sessions and serializes competing gateways on the same order', async () => {
    const { order } = await fixture();
    const create = mockCreate();
    const sessions = await Promise.all(Array.from({ length: 3 }, () => createVn(order.id).expect(201)));
    expect(new Set(sessions.map(session => session.body.txnRef)).size).toBe(1);
    await createStripe(order.id).expect(409);
    expect(create).not.toHaveBeenCalled();
    const other = await fixture();
    const mixed = await Promise.all([createStripe(other.order.id), createVn(other.order.id)]);
    expect(mixed.map(response => response.status).sort()).toEqual([201, 409]);
  });

  it.each(['PROCESSING', 'COMPLETED'] as const)('records a second Stripe receipt once via webhook, legacy state=%s', async oldStatus => {
    const { order, ingredient } = await fixture();
    mockCreate();
    const first = (await createStripe(order.id).expect(201)).body;
    const second = { sessionId: `cs_legacy_${randomUUID()}`, stripeRef: `${order.code}_ST_legacy` };
    await prisma.idempotencyRecord.create({ data: {
      userId, scope: 'PAY_ORDER', key: second.stripeRef, status: oldStatus,
      ...(oldStatus === 'COMPLETED' ? { httpStatus: 200, response: { provider: 'STRIPE', success: true } } : {}),
      requestHash: createHash('sha256').update(JSON.stringify({ provider: 'STRIPE', stripeRef: second.stripeRef,
        sessionId: second.sessionId, orderId: order.id, amount: order.total })).digest('hex'),
    } });
    jest.spyOn(stripe, 'verifySession').mockImplementation(async sessionId => ({
      isValid: true, isPaid: true, orderId: order.id, orderCode: order.code, amount: order.total,
      stripeRef: sessionId === first.sessionId ? first.stripeRef : second.stripeRef,
      paymentIntentId: sessionId === first.sessionId ? 'pi_primary' : 'pi_duplicate', message: 'Paid',
    }));
    await webhook(first.sessionId).expect(200);
    const before = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    await Promise.all(Array.from({ length: 5 }, (_, index) => index % 2
      ? webhook(second.sessionId).expect(200)
      : request(app.getHttpServer()).get('/api/payments/stripe/verify').query({ session_id: second.sessionId }).expect(200)));
    const payments = await prisma.payment.findMany({ where: { orderId: order.id }, include: { idempotency: true } });
    expect(payments).toHaveLength(2);
    expect(payments.filter(payment => !payment.isDuplicate)).toHaveLength(1);
    expect(payments.find(payment => payment.isDuplicate)).toMatchObject({ status: 'SUCCEEDED', amount: order.total,
      idempotency: { response: { requiresManualReview: true, refundStatus: 'DUPLICATE_PAYMENT_MANUAL_REFUND_REQUIRED' } },
    });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toEqual(before);
    expect((await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } })).stock).toBe(19);
    const result = await request(app.getHttpServer()).get('/api/payments/stripe/verify').query({ session_id: second.sessionId }).expect(200);
    expect(result.body).toMatchObject({ success: false, paymentReceived: true, requiresManualReview: true });
    const refund = jest.spyOn(stripe, 'refundPayment').mockResolvedValue({ outcome: 'SUCCESS', refundId: 're_primary', status: 'succeeded' });
    await request(app.getHttpServer()).post(`/api/orders/${order.id}/cancel`).auth(token, { type: 'bearer' })
      .send({ expectedVersion: before.version }).expect(200);
    expect(refund).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentId: 'pi_primary' }));
    expect(await prisma.payment.count({ where: { orderId: order.id, isDuplicate: true, status: 'SUCCEEDED' } })).toBe(1);
  });

  it.each(['PROCESSING', 'COMPLETED'] as const)('records a duplicate VNPay receipt without cancelling the primary order, legacy state=%s', async oldStatus => {
    const { order } = await fixture();
    const first = (await createVn(order.id).expect(201)).body;
    const vn = app.get(VnPayService);
    const second = vn.createPaymentSession({ orderId: order.id, orderCode: order.code, amount: order.total });
    await prisma.idempotencyRecord.create({ data: {
      userId, scope: 'PAY_ORDER', key: second.txnRef, status: oldStatus,
      ...(oldStatus === 'COMPLETED' ? { httpStatus: 200, response: { provider: 'VNPAY', success: true } } : {}),
      requestHash: createHash('sha256').update(JSON.stringify({ orderId: order.id, orderCode: order.code,
        txnRef: second.txnRef, tmnCode: 'TESTTMN1', amount: order.total })).digest('hex'),
    } });
    function params(txnRef: string) {
      const body = { vnp_TxnRef: txnRef, vnp_TmnCode: 'TESTTMN1', vnp_Amount: String(order.total * 100),
        vnp_OrderInfo: `Thanh toan don hang ${order.code}`, vnp_ResponseCode: '00', vnp_TransactionStatus: '00' };
      return { ...body, vnp_SecureHash: createHmac('sha512', vnSecret).update(sortAndEncode(body).signData).digest('hex') };
    }
    await request(app.getHttpServer()).get('/api/payments/vnpay/ipn').query(params(first.txnRef)).expect(200);
    const before = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    await Promise.all(Array.from({ length: 3 }, () => request(app.getHttpServer()).get('/api/payments/vnpay/ipn').query(params(second.txnRef)).expect(200)));
    const duplicate = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id, isDuplicate: true } });
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(2);
    await request(app.getHttpServer()).post('/api/payments/vnpay/refund').auth(token, { type: 'bearer' })
      .send({ paymentId: duplicate.id }).expect(409).expect(({ body }) => expect(body.code).toBe('MANUAL_REFUND_REQUIRED'));
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toEqual(before);
  });

  it('records late money for a failed order without trying to reserve released stock again', async () => {
    const { order, ingredient } = await fixture();
    mockCreate();
    const session = (await createStripe(order.id).expect(201)).body;
    await request(app.getHttpServer()).post('/api/payments').auth(token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID()).send({ orderId: order.id, method: 'WALLET', mockOutcome: 'FAIL' }).expect(200);
    await prisma.ingredient.update({ where: { id: ingredient.id }, data: { stock: 0 } });
    jest.spyOn(stripe, 'verifySession').mockResolvedValue({ isValid: true, isPaid: true,
      orderId: order.id, orderCode: order.code, stripeRef: session.stripeRef, amount: order.total,
      paymentIntentId: 'pi_late_after_failure', message: 'Paid' });
    await webhook(session.sessionId).expect(200);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: 'CANCELLED', reservationStatus: 'RELEASED' });
    expect((await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } })).stock).toBe(0);
    const receipt = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id, status: 'SUCCEEDED' }, include: { idempotency: true } });
    expect(receipt.idempotency.response).toMatchObject({ requiresManualReview: true, refundStatus: 'MANUAL_REFUND_REQUIRED' });
  });

  it('rejects unsigned, tampered and stale webhooks, retries unsettled events, and accepts delayed payment completion', async () => {
    const { order } = await fixture();
    mockCreate();
    const session = (await createStripe(order.id).expect(201)).body;
    const verify = jest.spyOn(stripe, 'verifySession').mockResolvedValue({ isValid: false, isPaid: false, orderId: '', orderCode: '', amount: 0, message: 'Temporary failure' });
    await request(app.getHttpServer()).post('/api/payments/stripe/webhook').send({}).expect(400);
    await request(app.getHttpServer()).post('/api/payments/stripe/webhook').set('Stripe-Signature', 't=1,v1=bad').send({}).expect(400);
    await webhook(session.sessionId, 'checkout.session.completed', Math.floor(Date.now() / 1000) - 600).expect(400);
    expect(verify).not.toHaveBeenCalled();
    await webhook(session.sessionId, 'unrelated.event').expect(200);
    expect(verify).not.toHaveBeenCalled();
    await webhook(session.sessionId).expect(409);
    verify.mockResolvedValue({ isValid: true, isPaid: false, orderId: order.id, orderCode: order.code,
      stripeRef: session.stripeRef, amount: order.total, message: 'Unpaid' });
    await webhook(session.sessionId).expect(200);
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(0);
    verify.mockResolvedValue({ isValid: true, isPaid: true, orderId: order.id, orderCode: order.code,
      stripeRef: session.stripeRef, amount: order.total, paymentIntentId: 'pi_async', message: 'Paid' });
    await webhook(session.sessionId, 'checkout.session.async_payment_succeeded').expect(200);
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('never awards loyalty for a refunded primary payment, but a refunded duplicate does not remove earned eligibility', async () => {
    const before = (await request(app.getHttpServer()).get('/api/loyalty/me').auth(token, { type: 'bearer' }).expect(200)).body.points;
    for (const primaryRefunded of [true, false]) {
      const { order } = await fixture();
      await prisma.order.update({ where: { id: order.id }, data: { status: 'COMPLETED', reservationStatus: 'CONSUMED' } });
      for (const duplicate of primaryRefunded ? [false] : [false, true]) {
        const key = randomUUID();
        const record = await prisma.idempotencyRecord.create({ data: { userId, scope: 'PAY_ORDER', key,
          requestHash: 'a'.repeat(64), status: 'COMPLETED', httpStatus: 200, response: {} } });
        await prisma.payment.create({ data: { orderId: order.id, idempotencyRecordId: record.id, idempotencyKey: key,
          amount: order.total, method: 'CARD', isDuplicate: duplicate, status: primaryRefunded || duplicate ? 'REFUNDED' : 'SUCCEEDED' } });
      }
      await request(app.getHttpServer()).get('/api/loyalty/me').auth(token, { type: 'bearer' }).expect(200);
      expect(await prisma.loyaltyEntry.count({ where: { orderId: order.id, kind: 'EARN' } })).toBe(primaryRefunded ? 0 : 1);
    }
    const after = (await request(app.getHttpServer()).get('/api/loyalty/me').auth(token, { type: 'bearer' }).expect(200)).body.points;
    expect(after - before).toBe(5);
  });
});

import { createHmac, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  computeVnPayQueryDrResponseHash,
  computeVnPayRefundResponseHash,
  sortAndEncode,
} from '../src/modules/payments/vnpay.service';
import { createTempDatabase, type TempDatabase } from './support/temp-database';

const integration = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

const TEST_TMN_CODE = 'TESTTMN1';
const TEST_HASH_SECRET = 'integration-test-vnpay-hmac-sha512-secret-key';
const TEST_VNP_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
const TEST_RETURN_URL = 'http://localhost:3000/payments/vnpay-return';
const TEST_API_URL = 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction';

function buildSignedVnPayCallback(
  params: Record<string, string>,
  secret = TEST_HASH_SECRET,
): Record<string, string> {
  const { signData } = sortAndEncode(params);
  const secureHash = createHmac('sha512', secret).update(Buffer.from(signData, 'utf-8')).digest('hex');
  return {
    ...params,
    vnp_SecureHash: secureHash,
  };
}

function buildSignedRefundGatewayResponse(
  params: {
    txnRef: string;
    orderCode: string;
    amount: number;
    responseCode?: string;
    transactionStatus?: string;
    message?: string;
    transactionNo?: string;
    tmnCode?: string;
    command?: string;
    transactionType?: string;
  },
  secret = TEST_HASH_SECRET,
): Record<string, string> {
  const body: Record<string, string> = {
    vnp_ResponseId: 'REFUND_RES_01',
    vnp_Command: params.command ?? 'refund',
    vnp_ResponseCode: params.responseCode ?? '00',
    vnp_Message: params.message ?? 'Refund Success',
    vnp_TmnCode: params.tmnCode ?? TEST_TMN_CODE,
    vnp_TxnRef: params.txnRef,
    vnp_Amount: String(params.amount * 100),
    vnp_BankCode: 'NCB',
    vnp_PayDate: '20261028152500',
    vnp_TransactionNo: params.transactionNo ?? '15889000',
    vnp_TransactionType: params.transactionType ?? '02',
    vnp_TransactionStatus: params.transactionStatus ?? params.responseCode ?? '00',
    vnp_OrderInfo: `Hoan tien don hang ${params.orderCode}`,
  };
  return {
    ...body,
    vnp_SecureHash: computeVnPayRefundResponseHash(body, secret),
  };
}

function buildSignedQueryDrGatewayResponse(
  params: {
    txnRef: string;
    orderCode: string;
    amount: number;
    responseCode?: string;
    transactionType?: string;
    transactionStatus?: string;
    message?: string;
  },
  secret = TEST_HASH_SECRET,
): Record<string, string> {
  const body: Record<string, string> = {
    vnp_ResponseId: 'QUERY_RES_01',
    vnp_Command: 'querydr',
    vnp_ResponseCode: params.responseCode ?? '00',
    vnp_Message: params.message ?? 'QueryDR Success',
    vnp_TmnCode: TEST_TMN_CODE,
    vnp_TxnRef: params.txnRef,
    vnp_Amount: String(params.amount * 100),
    vnp_BankCode: 'NCB',
    vnp_PayDate: '20261028152500',
    vnp_TransactionNo: '15889000',
    vnp_TransactionType: params.transactionType ?? '01',
    vnp_TransactionStatus: params.transactionStatus ?? '00',
    vnp_OrderInfo: `Truy van giao dich ${params.orderCode}`,
    vnp_PromotionCode: '',
    vnp_PromotionAmount: '',
  };
  return {
    ...body,
    vnp_SecureHash: computeVnPayQueryDrResponseHash(body, secret),
  };
}

integration('VNPay PostgreSQL Integration: Auth, Callback, IPN Concurrency & Refund (#10)', () => {
  let db: TempDatabase | undefined;
  let app: INestApplication;
  let prisma: PrismaService;
  let customerAToken: string;
  let customerBToken: string;
  let staffToken: string;

  const originalEnv = { ...process.env };

  beforeAll(async () => {
    db = await createTempDatabase(originalEnv.DATABASE_URL);
    process.env.DATABASE_URL = db.url;
    process.env.JWT_SECRET = 'vnpay-integration-test-jwt-secret-at-least-32-chars';
    process.env.VNPAY_TMN_CODE = TEST_TMN_CODE;
    process.env.VNPAY_HASH_SECRET = TEST_HASH_SECRET;
    process.env.VNPAY_URL = TEST_VNP_URL;
    process.env.VNPAY_RETURN_URL = TEST_RETURN_URL;
    process.env.VNPAY_API_URL = TEST_API_URL;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);

    const authA = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: `vnpay-a-${randomUUID()}@example.com`, password: 'Password123!' })
      .expect(201);
    customerAToken = authA.body.accessToken as string;

    const authB = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: `vnpay-b-${randomUUID()}@example.com`, password: 'Password123!' })
      .expect(201);
    customerBToken = authB.body.accessToken as string;

    const staffEmail = `vnpay-staff-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: staffEmail, password: 'Password123!' })
      .expect(201);
    await prisma.user.update({ where: { email: staffEmail }, data: { role: 'STAFF' } });
    const staffLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: staffEmail, password: 'Password123!' })
      .expect(200);
    staffToken = staffLogin.body.accessToken as string;
  }, 120_000);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      process.env = { ...originalEnv };
      await db?.drop();
    }
  }, 60_000);

  async function createOrderFixture(stock = 20, token = customerAToken) {
    const productId = randomUUID();
    const promoCode = `VNP${randomUUID().slice(0, 6).toUpperCase()}`;
    const ingredient = await prisma.ingredient.create({
      data: { name: `Coffee-${productId.slice(0, 6)}`, unit: 'PIECE', stock, packageSize: 10, packageLabel: 'túi' },
    });
    await prisma.product.create({
      data: {
        id: productId,
        name: 'Cà phê sữa VNPay',
        description: 'VNPay fixture',
        price: 50000,
        imageUrl: 'http://localhost:3000/images/caphe.jpg',
        sizes: { create: [{ size: 'M', price: 50000 }] },
        ingredients: { create: [{ ingredientId: ingredient.id, amount: 1 }] },
      },
    });
    const promo = await prisma.promotion.create({
      data: {
        code: promoCode,
        type: 'FIXED',
        value: 10000,
        minSubtotal: 80000,
        maxUses: 50,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 3600_000),
      },
    });

    const createRes = await request(app.getHttpServer())
      .post('/api/orders')
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({
        items: [{ productId, size: 'M', qty: 2 }],
        promotionCode: promoCode,
      })
      .expect(201);

    return {
      order: createRes.body as { id: string; code: string; total: number; version: number },
      ingredient,
      promo,
    };
  }

  it('[#4] chặn callback có chữ ký hợp lệ nhưng sai số tiền, sai vnp_TransactionStatus hoặc sai vnp_TxnRef', async () => {
    const { order } = await createOrderFixture();

    const urlRes = await request(app.getHttpServer())
      .post('/api/payments/vnpay/create-url')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(201);

    const txnRef = urlRes.body.txnRef as string;
    expect(txnRef).toBeTruthy();

    // 1. Sai số tiền (đơn 90.000đ nhưng callback gửi 10.000đ) -> IPN trả 04, Return trả success: false, đơn vẫn PENDING
    const wrongAmountParams = buildSignedVnPayCallback({
      vnp_Amount: '1000000', // 10.000đ thay vì 90.000đ
      vnp_BankCode: 'NCB',
      vnp_OrderInfo: `Thanh toan don hang ${order.code}`,
      vnp_PayDate: '20261028150000',
      vnp_ResponseCode: '00',
      vnp_TmnCode: TEST_TMN_CODE,
      vnp_TransactionNo: '15000001',
      vnp_TransactionStatus: '00',
      vnp_TxnRef: txnRef,
    });

    const ipnWrongAmount = await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(wrongAmountParams)
      .expect(200);
    expect(ipnWrongAmount.body).toEqual({ RspCode: '04', Message: 'Invalid amount' });

    const verifyWrongAmount = await request(app.getHttpServer())
      .get('/api/payments/vnpay/verify')
      .query(wrongAmountParams)
      .expect(200);
    expect(verifyWrongAmount.body.success).toBe(false);

    const orderAfterWrongAmount = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderAfterWrongAmount.status).toBe('PENDING');

    // 2. Callback với vnp_TxnRef lạ chưa từng tạo qua create-url -> IPN trả 01, đơn vẫn PENDING
    const unknownRefParams = buildSignedVnPayCallback({
      vnp_Amount: String(order.total * 100),
      vnp_BankCode: 'NCB',
      vnp_OrderInfo: `Thanh toan don hang ${order.code}`,
      vnp_PayDate: '20261028150000',
      vnp_ResponseCode: '00',
      vnp_TmnCode: TEST_TMN_CODE,
      vnp_TransactionNo: '15000002',
      vnp_TransactionStatus: '00',
      vnp_TxnRef: `${order.code}_FAKE99`,
    });

    const ipnUnknownRef = await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(unknownRefParams)
      .expect(200);
    expect(ipnUnknownRef.body).toEqual({ RspCode: '01', Message: 'Order not found' });

    // 3. Callback có vnp_ResponseCode = '00' nhưng vnp_TransactionStatus = '02' (chưa thành công) -> KHÔNG đánh dấu PAID
    const badStatusParams = buildSignedVnPayCallback({
      vnp_Amount: String(order.total * 100),
      vnp_BankCode: 'NCB',
      vnp_OrderInfo: `Thanh toan don hang ${order.code}`,
      vnp_PayDate: '20261028150000',
      vnp_ResponseCode: '00',
      vnp_TmnCode: TEST_TMN_CODE,
      vnp_TransactionNo: '15000003',
      vnp_TransactionStatus: '02',
      vnp_TxnRef: txnRef,
    });

    const verifyBadStatus = await request(app.getHttpServer())
      .get('/api/payments/vnpay/verify')
      .query(badStatusParams)
      .expect(200);
    expect(verifyBadStatus.body.success).toBe(false);

    const orderAfterBadStatus = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderAfterBadStatus.status).toBe('PAYMENT_FAILED');
  });

  it('[#3] xử lý IPN trên PostgreSQL không lỗi khóa ngoại P2003 và chống tạo trùng Payment khi IPN gửi lặp / đồng thời', async () => {
    const { order } = await createOrderFixture();

    const urlRes = await request(app.getHttpServer())
      .post('/api/payments/vnpay/create-url')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(201);

    const txnRef = urlRes.body.txnRef as string;
    const validIpnParams = buildSignedVnPayCallback({
      vnp_Amount: String(order.total * 100),
      vnp_BankCode: 'NCB',
      vnp_BankTranNo: 'VNP15777888',
      vnp_CardType: 'ATM',
      vnp_OrderInfo: `Thanh toan don hang ${order.code}`,
      vnp_PayDate: '20261028151000',
      vnp_ResponseCode: '00',
      vnp_TmnCode: TEST_TMN_CODE,
      vnp_TransactionNo: '15777888',
      vnp_TransactionStatus: '00',
      vnp_TxnRef: txnRef,
    });

    // Gửi đồng thời 5 request IPN (không dùng JWT, xác thực bằng chữ ký VNPay)
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer()).get('/api/payments/vnpay/ipn').query(validIpnParams),
      ),
    );

    const confirmSuccessCount = responses.filter((r) => r.body.RspCode === '00').length;
    const alreadyConfirmedCount = responses.filter((r) => r.body.RspCode === '02').length;

    expect(confirmSuccessCount).toBe(1);
    expect(alreadyConfirmedCount).toBe(4);

    // Kiểm tra DB: chỉ có đúng 1 bản ghi Payment SUCCEEDED, đơn hàng ở trạng thái PAID (version = 1)
    const payments = await prisma.payment.findMany({ where: { orderId: order.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe('SUCCEEDED');

    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updatedOrder.status).toBe('PAID');
    expect(updatedOrder.reservationStatus).toBe('CONSUMED');
    expect(updatedOrder.version).toBe(1);
  });

  it('[#1, #2, #5] phân quyền các API giao dịch, chặn hoàn tiền đơn người khác / đơn COMPLETED, giữ chờ đối soát khi gateway lỗi và hoàn tiền nguyên tử khi thành công', async () => {
    const { order, ingredient, promo } = await createOrderFixture(20, customerAToken);

    const urlRes = await request(app.getHttpServer())
      .post('/api/payments/vnpay/create-url')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(201);

    const txnRef = urlRes.body.txnRef as string;
    const callbackParams = buildSignedVnPayCallback({
      vnp_Amount: String(order.total * 100),
      vnp_BankCode: 'NCB',
      vnp_BankTranNo: 'VNP15888999',
      vnp_CardType: 'ATM',
      vnp_OrderInfo: `Thanh toan don hang ${order.code}`,
      vnp_PayDate: '20261028152000',
      vnp_ResponseCode: '00',
      vnp_TmnCode: TEST_TMN_CODE,
      vnp_TransactionNo: '15888999',
      vnp_TransactionStatus: '00',
      vnp_TxnRef: txnRef,
    });

    await request(app.getHttpServer())
      .get('/api/payments/vnpay/verify')
      .query(callbackParams)
      .expect(200);

    // 1. Không đăng nhập -> 401 trên cả 3 API
    await request(app.getHttpServer()).get('/api/payments/vnpay/transactions').expect(401);
    await request(app.getHttpServer())
      .post('/api/payments/vnpay/querydr')
      .send({ orderId: order.id })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/payments/vnpay/refund')
      .send({ orderId: order.id })
      .expect(401);

    // 2. Customer B không được xem, đối soát hay hoàn tiền đơn của Customer A
    const listB = await request(app.getHttpServer())
      .get('/api/payments/vnpay/transactions')
      .auth(customerBToken, { type: 'bearer' })
      .expect(200);
    expect(listB.body.items.some((i: { orderId: string }) => i.orderId === order.id)).toBe(false);

    await request(app.getHttpServer())
      .post('/api/payments/vnpay/querydr')
      .auth(customerBToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(404);

    await request(app.getHttpServer())
      .post('/api/payments/vnpay/refund')
      .auth(customerBToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(404);

    // 3. Khi cổng VNPay trả về lỗi 91 có chữ ký hợp lệ (từ chối hoàn tiền) -> báo lỗi 502, KHÔNG cập nhật REFUNDED, đơn vẫn PAID
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          buildSignedRefundGatewayResponse({
            txnRef,
            orderCode: order.code,
            amount: order.total,
            responseCode: '91',
            transactionStatus: '91',
            message: 'Transaction not found',
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await request(app.getHttpServer())
      .post('/api/payments/vnpay/refund')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(502);

    const stillPaidOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stillPaidOrder.status).toBe('PAID');

    // Giả lập đơn đã có bút toán cộng điểm thưởng (EARN 9 điểm) để kiểm tra đảo điểm thưởng (REVERSE) khi hoàn tiền
    await prisma.loyaltyEntry.create({
      data: {
        userId: stillPaidOrder.userId,
        orderId: order.id,
        kind: 'EARN',
        points: 9,
      },
    });
    await prisma.user.update({
      where: { id: stillPaidOrder.userId },
      data: { loyaltyPoints: { increment: 9 } },
    });

    // 4. Khi cổng VNPay xác nhận hoàn tiền hợp lệ có chữ ký (vnp_ResponseCode = '00') và có nhiều request hoàn tiền đồng thời:
    // chỉ 1 request thành công (200), các request đồng thời bị chặn (409), tồn kho, voucher và điểm thưởng được hoàn/đảo
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return new Response(
        JSON.stringify(
          buildSignedRefundGatewayResponse({
            txnRef,
            orderCode: order.code,
            amount: order.total,
            responseCode: '00',
            transactionStatus: '00',
            message: 'Refund Success',
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const refundResults = await Promise.all([
      request(app.getHttpServer())
        .post('/api/payments/vnpay/refund')
        .auth(customerAToken, { type: 'bearer' })
        .send({ orderId: order.id }),
      request(app.getHttpServer())
        .post('/api/payments/vnpay/refund')
        .auth(customerAToken, { type: 'bearer' })
        .send({ orderId: order.id }),
      request(app.getHttpServer())
        .post('/api/payments/vnpay/refund')
        .auth(staffToken, { type: 'bearer' })
        .send({ orderId: order.id }),
    ]);

    const okRefunds = refundResults.filter((r) => r.status === 200);
    const conflictRefunds = refundResults.filter((r) => r.status === 409);
    expect(okRefunds).toHaveLength(1);
    expect(conflictRefunds).toHaveLength(2);

    // Kiểm tra đồng bộ trạng thái đơn CANCELLED, payment REFUNDED, tồn kho hoàn trả về 20, mã giảm giá về usedCount = 0, đảo điểm thưởng REVERSE (-9)
    const cancelledOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(cancelledOrder.status).toBe('CANCELLED');
    expect(cancelledOrder.reservationStatus).toBe('RELEASED');

    const refundedPayment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(refundedPayment.status).toBe('REFUNDED');

    const restoredIngredient = await prisma.ingredient.findUniqueOrThrow({
      where: { id: ingredient.id },
    });
    expect(restoredIngredient.stock).toBe(20);

    const restoredPromo = await prisma.promotion.findUniqueOrThrow({ where: { id: promo.id } });
    expect(restoredPromo.usedCount).toBe(0);

    const reverseEntry = await prisma.loyaltyEntry.findUnique({
      where: { orderId_kind: { orderId: order.id, kind: 'REVERSE' } },
    });
    expect(reverseEntry?.points).toBe(-9);
  });

  it('[#2, #5] chặn tự hoàn tiền cho đơn đã COMPLETED và giữ trạng thái chờ đối soát khi gateway timeout / trả mã 99', async () => {
    // 1. Tạo đơn và chuyển sang COMPLETED -> không cho phép hoàn tiền (409 ORDER_NOT_REFUNDABLE)
    const { order: completedOrder } = await createOrderFixture(20, customerAToken);
    const urlRes1 = await request(app.getHttpServer())
      .post('/api/payments/vnpay/create-url')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: completedOrder.id })
      .expect(201);

    const txnRef1 = urlRes1.body.txnRef as string;
    await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(
        buildSignedVnPayCallback({
          vnp_Amount: String(completedOrder.total * 100),
          vnp_BankCode: 'NCB',
          vnp_OrderInfo: `Thanh toan don hang ${completedOrder.code}`,
          vnp_PayDate: '20261028153000',
          vnp_ResponseCode: '00',
          vnp_TmnCode: TEST_TMN_CODE,
          vnp_TransactionNo: '15900001',
          vnp_TransactionStatus: '00',
          vnp_TxnRef: txnRef1,
        }),
      )
      .expect(200);

    // STAFF chuyển đơn PAID -> PREPARING -> READY -> COMPLETED
    await request(app.getHttpServer())
      .patch(`/api/orders/${completedOrder.id}/status`)
      .auth(staffToken, { type: 'bearer' })
      .send({ expectedVersion: 1, status: 'PREPARING' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/orders/${completedOrder.id}/status`)
      .auth(staffToken, { type: 'bearer' })
      .send({ expectedVersion: 2, status: 'READY' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/orders/${completedOrder.id}/status`)
      .auth(staffToken, { type: 'bearer' })
      .send({ expectedVersion: 3, status: 'COMPLETED' })
      .expect(200);

    const completedRefundRes = await request(app.getHttpServer())
      .post('/api/payments/vnpay/refund')
      .auth(staffToken, { type: 'bearer' })
      .send({ orderId: completedOrder.id })
      .expect(409);
    expect(completedRefundRes.body.code).toBe('ORDER_NOT_REFUNDABLE');

    // 2. Tạo đơn PAID thứ hai: khi gọi refund mà gateway timeout (UNCERTAIN) -> giữ trạng thái chờ đối soát, chặn gửi hoàn tiền lặp
    const { order: uncertainOrder } = await createOrderFixture(20, customerAToken);
    const urlRes2 = await request(app.getHttpServer())
      .post('/api/payments/vnpay/create-url')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: uncertainOrder.id })
      .expect(201);
    const txnRef2 = urlRes2.body.txnRef as string;

    await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(
        buildSignedVnPayCallback({
          vnp_Amount: String(uncertainOrder.total * 100),
          vnp_BankCode: 'NCB',
          vnp_OrderInfo: `Thanh toan don hang ${uncertainOrder.code}`,
          vnp_PayDate: '20261028153500',
          vnp_ResponseCode: '00',
          vnp_TmnCode: TEST_TMN_CODE,
          vnp_TransactionNo: '15900002',
          vnp_TransactionStatus: '00',
          vnp_TxnRef: txnRef2,
        }),
      )
      .expect(200);

    jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Gateway timeout'));

    const uncertainRes = await request(app.getHttpServer())
      .post('/api/payments/vnpay/refund')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: uncertainOrder.id })
      .expect(502);
    expect(uncertainRes.body.code).toBe('VNPAY_REFUND_UNCERTAIN');

    // Đơn vẫn PAID, Payment vẫn SUCCEEDED (chưa đánh dấu REFUNDED khi chưa xác nhận)
    const paymentStillSucceeded = await prisma.payment.findFirstOrThrow({
      where: { orderId: uncertainOrder.id },
    });
    expect(paymentStillSucceeded.status).toBe('SUCCEEDED');

    // Gửi tiếp lệnh hoàn tiền khi đang chờ đối soát -> bị chặn ngay với 409 REFUND_PENDING_RECONCILIATION
    const duplicateWhileUncertain = await request(app.getHttpServer())
      .post('/api/payments/vnpay/refund')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: uncertainOrder.id })
      .expect(409);
    expect(duplicateWhileUncertain.body.code).toBe('REFUND_PENDING_RECONCILIATION');
  });

  it('[Review 2 - #1] bắt buộc xác minh chữ ký phản hồi hoàn tiền: thiếu chữ ký ({"vnp_ResponseCode":"00"}), sai chữ ký hoặc sai thông tin giao dịch đều giữ ở PENDING_RECONCILIATION, không cập nhật REFUNDED', async () => {
    const { order } = await createOrderFixture(20, customerAToken);
    const urlRes = await request(app.getHttpServer())
      .post('/api/payments/vnpay/create-url')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(201);
    const txnRef = urlRes.body.txnRef as string;

    await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(
        buildSignedVnPayCallback({
          vnp_Amount: String(order.total * 100),
          vnp_BankCode: 'NCB',
          vnp_OrderInfo: `Thanh toan don hang ${order.code}`,
          vnp_PayDate: '20261028160000',
          vnp_ResponseCode: '00',
          vnp_TmnCode: TEST_TMN_CODE,
          vnp_TransactionNo: '16000001',
          vnp_TransactionStatus: '00',
          vnp_TxnRef: txnRef,
        }),
      )
      .expect(200);

    // 1. Phản hồi chỉ chứa {"vnp_ResponseCode":"00"} (thiếu vnp_SecureHash) -> 502 VNPAY_REFUND_UNCERTAIN, giữ PENDING_RECONCILIATION
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ vnp_ResponseCode: '00' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const noSigRefund = await request(app.getHttpServer())
      .post('/api/payments/vnpay/refund')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(502);
    expect(noSigRefund.body.code).toBe('VNPAY_REFUND_UNCERTAIN');

    const paymentAfterNoSig = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(paymentAfterNoSig.status).toBe('SUCCEEDED');
    const orderAfterNoSig = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderAfterNoSig.status).toBe('PAID');

    // Đối soát QueryDR xác nhận chưa hoàn tiền -> mở khóa để test tiếp trường hợp sai chữ ký & sai số tiền
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          buildSignedQueryDrGatewayResponse({
            txnRef,
            orderCode: order.code,
            amount: order.total,
            transactionType: '01',
            transactionStatus: '00',
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await request(app.getHttpServer())
      .post('/api/payments/vnpay/querydr')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(200);

    // 2. Phản hồi có vnp_ResponseCode = '00' và chữ ký hợp lệ nhưng sai số tiền (amount = 10.000đ thay vì 90.000đ) -> giữ PENDING_RECONCILIATION
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          buildSignedRefundGatewayResponse({
            txnRef,
            orderCode: order.code,
            amount: 10000, // Sai số tiền
            responseCode: '00',
            transactionStatus: '00',
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const wrongAmountRefund = await request(app.getHttpServer())
      .post('/api/payments/vnpay/refund')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(502);
    expect(wrongAmountRefund.body.code).toBe('VNPAY_REFUND_UNCERTAIN');

    const paymentAfterWrongAmount = await prisma.payment.findFirstOrThrow({
      where: { orderId: order.id },
    });
    expect(paymentAfterWrongAmount.status).toBe('SUCCEEDED');
  });

  it('[Review 2 - #2] API hủy đơn cũ (/api/orders/:id/cancel) không bỏ qua VNPay đối với đơn đã thanh toán VNPay', async () => {
    const { order, ingredient, promo } = await createOrderFixture(20, customerAToken);
    const urlRes = await request(app.getHttpServer())
      .post('/api/payments/vnpay/create-url')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(201);
    const txnRef = urlRes.body.txnRef as string;

    await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(
        buildSignedVnPayCallback({
          vnp_Amount: String(order.total * 100),
          vnp_BankCode: 'NCB',
          vnp_OrderInfo: `Thanh toan don hang ${order.code}`,
          vnp_PayDate: '20261028161000',
          vnp_ResponseCode: '00',
          vnp_TmnCode: TEST_TMN_CODE,
          vnp_TransactionNo: '16100001',
          vnp_TransactionStatus: '00',
          vnp_TxnRef: txnRef,
        }),
      )
      .expect(200);

    // 1. Gọi POST /api/orders/:id/cancel khi cổng VNPay trả về phản hồi thiếu chữ ký -> bị chặn 502 VNPAY_REFUND_UNCERTAIN,
    // KHÔNG tự hủy đơn, KHÔNG hoàn kho, KHÔNG đánh dấu REFUNDED, giữ trạng thái chờ đối soát
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ vnp_ResponseCode: '00' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const cancelUncertain = await request(app.getHttpServer())
      .post(`/api/orders/${order.id}/cancel`)
      .auth(customerAToken, { type: 'bearer' })
      .send({ expectedVersion: 1 })
      .expect(502);
    expect(cancelUncertain.body.code).toBe('VNPAY_REFUND_UNCERTAIN');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const orderStillPaid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderStillPaid.status).toBe('PAID');
    expect(orderStillPaid.reservationStatus).toBe('CONSUMED');

    const paymentStillSucceeded = await prisma.payment.findFirstOrThrow({
      where: { orderId: order.id },
    });
    expect(paymentStillSucceeded.status).toBe('SUCCEEDED');

    // Gọi lặp POST /api/orders/:id/cancel khi đang chờ đối soát -> bị chặn 409 REFUND_PENDING_RECONCILIATION, không gọi gateway thêm
    const duplicateCancel = await request(app.getHttpServer())
      .post(`/api/orders/${order.id}/cancel`)
      .auth(customerAToken, { type: 'bearer' })
      .send({ expectedVersion: 1 })
      .expect(409);
    expect(duplicateCancel.body.code).toBe('REFUND_PENDING_RECONCILIATION');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // 2. Đối soát qua QueryDR xác nhận chưa hoàn tiền -> mở khóa -> gọi lại POST /api/orders/:id/cancel với phản hồi VNPay hợp lệ có chữ ký
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          buildSignedQueryDrGatewayResponse({
            txnRef,
            orderCode: order.code,
            amount: order.total,
            transactionType: '01',
            transactionStatus: '00',
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await request(app.getHttpServer())
      .post('/api/payments/vnpay/querydr')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(200);

    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          buildSignedRefundGatewayResponse({
            txnRef,
            orderCode: order.code,
            amount: order.total,
            responseCode: '00',
            transactionStatus: '00',
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const cancelOk = await request(app.getHttpServer())
      .post(`/api/orders/${order.id}/cancel`)
      .auth(customerAToken, { type: 'bearer' })
      .send({ expectedVersion: 1 })
      .expect(200);
    expect(cancelOk.body.status).toBe('CANCELLED');
    expect(cancelOk.body.reservationStatus).toBe('RELEASED');

    const refundedPayment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(refundedPayment.status).toBe('REFUNDED');
    const restoredIng = await prisma.ingredient.findUniqueOrThrow({ where: { id: ingredient.id } });
    expect(restoredIng.stock).toBe(20);
    const restoredPromo = await prisma.promotion.findUniqueOrThrow({ where: { id: promo.id } });
    expect(restoredPromo.usedCount).toBe(0);
  });

  it('[Review 2 - #3] giữ trạng thái chờ đối soát khi VNPay trả mã 94, chặn gọi lặp (gateway không nhận thêm yêu cầu) và đối soát qua querydr', async () => {
    const { order, ingredient } = await createOrderFixture(20, customerAToken);
    const urlRes = await request(app.getHttpServer())
      .post('/api/payments/vnpay/create-url')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(201);
    const txnRef = urlRes.body.txnRef as string;

    await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(
        buildSignedVnPayCallback({
          vnp_Amount: String(order.total * 100),
          vnp_BankCode: 'NCB',
          vnp_OrderInfo: `Thanh toan don hang ${order.code}`,
          vnp_PayDate: '20261028162000',
          vnp_ResponseCode: '00',
          vnp_TmnCode: TEST_TMN_CODE,
          vnp_TransactionNo: '16200001',
          vnp_TransactionStatus: '00',
          vnp_TxnRef: txnRef,
        }),
      )
      .expect(200);

    // 1. Cổng VNPay trả về mã 94 (yêu cầu hoàn tiền trước đó đang được xử lý)
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          buildSignedRefundGatewayResponse({
            txnRef,
            orderCode: order.code,
            amount: order.total,
            responseCode: '94',
            transactionStatus: '94',
            message: 'Duplicate refund request / processing',
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const res94 = await request(app.getHttpServer())
      .post('/api/payments/vnpay/refund')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(502);
    expect(res94.body.code).toBe('VNPAY_REFUND_UNCERTAIN');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // 2. Lần gọi tiếp theo trên cả /api/payments/vnpay/refund lẫn /api/orders/:id/cancel đều bị chặn 409,
    // và gateway (fetchSpy) KHÔNG nhận thêm bất kỳ yêu cầu hoàn tiền nào
    const secondRefund = await request(app.getHttpServer())
      .post('/api/payments/vnpay/refund')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(409);
    expect(secondRefund.body.code).toBe('REFUND_PENDING_RECONCILIATION');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const cancelWhile94 = await request(app.getHttpServer())
      .post(`/api/orders/${order.id}/cancel`)
      .auth(customerAToken, { type: 'bearer' })
      .send({ expectedVersion: 1 })
      .expect(409);
    expect(cancelWhile94.body.code).toBe('REFUND_PENDING_RECONCILIATION');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // 3. Đối soát qua POST /api/payments/vnpay/querydr: cổng VNPay xác nhận yêu cầu hoàn tiền trước đó đã hoàn tất (vnp_TransactionType = '02', vnp_TransactionStatus = '00')
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          buildSignedQueryDrGatewayResponse({
            txnRef,
            orderCode: order.code,
            amount: order.total,
            transactionType: '02',
            transactionStatus: '00',
            message: 'Refund confirmed via QueryDR',
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const reconcileRes = await request(app.getHttpServer())
      .post('/api/payments/vnpay/querydr')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(200);

    expect(reconcileRes.body.transaction.orderStatus).toBe('CANCELLED');
    expect(reconcileRes.body.transaction.paymentStatus).toBe('REFUNDED');
    expect(reconcileRes.body.transaction.refundStatus).toBe('REFUNDED');

    const reconciledOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(reconciledOrder.status).toBe('CANCELLED');
    expect(reconciledOrder.reservationStatus).toBe('RELEASED');

    const restoredStock = await prisma.ingredient.findUniqueOrThrow({
      where: { id: ingredient.id },
    });
    expect(restoredStock.stock).toBe(20);
  });

  it('[Review 3 - #1] không mở khóa khi QueryDR trả về mã 05 (đang xử lý hoàn tiền) hoặc 06 (đã gửi sang ngân hàng); chặn cả API hoàn tiền lẫn API hủy đơn và không gọi thêm gateway', async () => {
    const { order } = await createOrderFixture(20, customerAToken);
    const urlRes = await request(app.getHttpServer())
      .post('/api/payments/vnpay/create-url')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(201);
    const txnRef = urlRes.body.txnRef as string;

    await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(
        buildSignedVnPayCallback({
          vnp_Amount: String(order.total * 100),
          vnp_BankCode: 'NCB',
          vnp_OrderInfo: `Thanh toan don hang ${order.code}`,
          vnp_PayDate: '20261028170000',
          vnp_ResponseCode: '00',
          vnp_TmnCode: TEST_TMN_CODE,
          vnp_TransactionNo: '17000001',
          vnp_TransactionStatus: '00',
          vnp_TxnRef: txnRef,
        }),
      )
      .expect(200);

    // 1. Gửi hoàn tiền lần đầu gặp timeout -> chuyển sang PENDING_RECONCILIATION (httpStatus = 201)
    jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Gateway network timeout'));

    await request(app.getHttpServer())
      .post('/api/payments/vnpay/refund')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(502);

    // 2. Kiểm tra lần lượt mã 05 (VNPay đang xử lý giao dịch hoàn tiền) và mã 06 (VNPay đã gửi yêu cầu hoàn tiền sang ngân hàng)
    for (const status of ['05', '06']) {
      const fetchSpy = jest.spyOn(globalThis, 'fetch');
      fetchSpy.mockClear();
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            buildSignedQueryDrGatewayResponse({
              txnRef,
              orderCode: order.code,
              amount: order.total,
              transactionType: '02',
              transactionStatus: status,
              message: `Refund processing status ${status}`,
            }),
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const queryRes = await request(app.getHttpServer())
        .post('/api/payments/vnpay/querydr')
        .auth(customerAToken, { type: 'bearer' })
        .send({ orderId: order.id })
        .expect(200);

      // Không được chuyển sang RECONCILED_NOT_REFUNDED mà phải giữ nguyên PENDING_RECONCILIATION
      expect(queryRes.body.transaction.refundStatus).toBe('PENDING_RECONCILIATION');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const recordInDb = await prisma.idempotencyRecord.findFirstOrThrow({
        where: { key: txnRef },
      });
      expect(recordInDb.httpStatus).toBe(201);
      expect((recordInDb.response as Record<string, unknown>).refundStatus).toBe(
        'PENDING_RECONCILIATION',
      );

      // Gọi lại API hoàn tiền và API hủy đơn đều bị chặn 409 và KHÔNG gọi thêm tới gateway (fetchSpy vẫn = 1)
      const retryRefund = await request(app.getHttpServer())
        .post('/api/payments/vnpay/refund')
        .auth(customerAToken, { type: 'bearer' })
        .send({ orderId: order.id })
        .expect(409);
      expect(retryRefund.body.code).toBe('REFUND_PENDING_RECONCILIATION');

      const retryCancel = await request(app.getHttpServer())
        .post(`/api/orders/${order.id}/cancel`)
        .auth(customerAToken, { type: 'bearer' })
        .send({ expectedVersion: 1 })
        .expect(409);
      expect(retryCancel.body.code).toBe('REFUND_PENDING_RECONCILIATION');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    }

    // 3. Chỉ khi QueryDR xác nhận rõ ràng cho phép thao tác tiếp (ví dụ vnp_TransactionType = '01', vnp_TransactionStatus = '00') mới mở khóa
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          buildSignedQueryDrGatewayResponse({
            txnRef,
            orderCode: order.code,
            amount: order.total,
            transactionType: '01',
            transactionStatus: '00',
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const unlockedQuery = await request(app.getHttpServer())
      .post('/api/payments/vnpay/querydr')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(200);
    expect(unlockedQuery.body.transaction.refundStatus).toBe('RECONCILED_NOT_REFUNDED');
  });

  it('[Review 3 - #2] đồng bộ đúng trạng thái đơn khi hoàn tiền được xác nhận muộn, chặn chuyển trạng thái khi đang chờ đối soát, xử lý cập nhật đồng thời và QueryDR gọi lặp', async () => {
    const { order, ingredient } = await createOrderFixture(20, customerAToken);
    const urlRes = await request(app.getHttpServer())
      .post('/api/payments/vnpay/create-url')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(201);
    const txnRef = urlRes.body.txnRef as string;

    await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(
        buildSignedVnPayCallback({
          vnp_Amount: String(order.total * 100),
          vnp_BankCode: 'NCB',
          vnp_OrderInfo: `Thanh toan don hang ${order.code}`,
          vnp_PayDate: '20261028171500',
          vnp_ResponseCode: '00',
          vnp_TmnCode: TEST_TMN_CODE,
          vnp_TransactionNo: '17150001',
          vnp_TransactionStatus: '00',
          vnp_TxnRef: txnRef,
        }),
      )
      .expect(200);

    // Bước 1: Đơn PAID gửi hoàn tiền nhưng chưa rõ kết quả -> PENDING_RECONCILIATION
    jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Gateway timeout'));

    await request(app.getHttpServer())
      .post('/api/payments/vnpay/refund')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(502);

    // Bước 2A: Khi đang PENDING_RECONCILIATION, nhân viên gọi API chuyển trạng thái sang PREPARING bị chặn 409 REFUND_PENDING_RECONCILIATION
    const blockedStaffTransition = await request(app.getHttpServer())
      .patch(`/api/orders/${order.id}/status`)
      .auth(staffToken, { type: 'bearer' })
      .send({ expectedVersion: 1, status: 'PREPARING' })
      .expect(409);
    expect(blockedStaffTransition.body.code).toBe('REFUND_PENDING_RECONCILIATION');

    // Bước 2B: Giả lập ngoại lệ thực tế nơi đơn hàng đã chuyển sang PREPARING (CONSUMED) trước khi kết quả hoàn tiền muộn về tới
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'PREPARING', reservationStatus: 'CONSUMED', version: 2 },
    });

    // Bước 3: QueryDR xác nhận hoàn tiền thành công (vnp_TransactionType = '02', vnp_TransactionStatus = '00')
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          buildSignedQueryDrGatewayResponse({
            txnRef,
            orderCode: order.code,
            amount: order.total,
            transactionType: '02',
            transactionStatus: '00',
            message: 'Late refund confirmation',
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const lateQuery1 = await request(app.getHttpServer())
      .post('/api/payments/vnpay/querydr')
      .auth(staffToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(200);

    // Phản hồi KHÔNG được gán cứng orderStatus = 'CANCELLED', mà phải trả đúng trạng thái thực tế PREPARING & CONSUMED,
    // ghi nhận paymentStatus = 'REFUNDED', refundStatus = 'REFUNDED_LATE_MANUAL_REVIEW' và requiresManualReview = true
    expect(lateQuery1.body.transaction.orderStatus).toBe('PREPARING');
    expect(lateQuery1.body.transaction.reservationStatus).toBe('CONSUMED');
    expect(lateQuery1.body.transaction.paymentStatus).toBe('REFUNDED');
    expect(lateQuery1.body.transaction.refundStatus).toBe('REFUNDED_LATE_MANUAL_REVIEW');
    expect(lateQuery1.body.transaction.requiresManualReview).toBe(true);
    expect(lateQuery1.body.message).toContain('PREPARING');

    const dbOrderAfterLate1 = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(dbOrderAfterLate1.status).toBe('PREPARING');
    expect(dbOrderAfterLate1.reservationStatus).toBe('CONSUMED');

    // Nguyên liệu vẫn giữ CONSUMED (20 - 2 = 18), không tự hoàn kho trái quy tắc khi đơn đang pha chế
    const stockDuringPreparing = await prisma.ingredient.findUniqueOrThrow({
      where: { id: ingredient.id },
    });
    expect(stockDuringPreparing.stock).toBe(18);

    // Bước 4: Gọi QueryDR lặp lại lần 2 (idempotent) vẫn trả đúng PREPARING, CONSUMED, REFUNDED_LATE_MANUAL_REVIEW
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          buildSignedQueryDrGatewayResponse({
            txnRef,
            orderCode: order.code,
            amount: order.total,
            transactionType: '02',
            transactionStatus: '00',
            message: 'Repeated QueryDR call',
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const lateQuery2 = await request(app.getHttpServer())
      .post('/api/payments/vnpay/querydr')
      .auth(staffToken, { type: 'bearer' })
      .send({ orderId: order.id })
      .expect(200);

    expect(lateQuery2.body.transaction.orderStatus).toBe('PREPARING');
    expect(lateQuery2.body.transaction.reservationStatus).toBe('CONSUMED');
    expect(lateQuery2.body.transaction.paymentStatus).toBe('REFUNDED');
    expect(lateQuery2.body.transaction.refundStatus).toBe('REFUNDED_LATE_MANUAL_REVIEW');
    expect(lateQuery2.body.transaction.requiresManualReview).toBe(true);

    // Bước 5: Kiểm thử cập nhật trạng thái đồng thời giữa hoàn tiền VNPay và nhân viên chuyển sang PREPARING trên đơn mới
    const { order: orderConcurrent } = await createOrderFixture(20, customerAToken);
    const urlRes2 = await request(app.getHttpServer())
      .post('/api/payments/vnpay/create-url')
      .auth(customerAToken, { type: 'bearer' })
      .send({ orderId: orderConcurrent.id })
      .expect(201);
    const txnRef2 = urlRes2.body.txnRef as string;

    await request(app.getHttpServer())
      .get('/api/payments/vnpay/ipn')
      .query(
        buildSignedVnPayCallback({
          vnp_Amount: String(orderConcurrent.total * 100),
          vnp_BankCode: 'NCB',
          vnp_OrderInfo: `Thanh toan don hang ${orderConcurrent.code}`,
          vnp_PayDate: '20261028172000',
          vnp_ResponseCode: '00',
          vnp_TmnCode: TEST_TMN_CODE,
          vnp_TransactionNo: '17200001',
          vnp_TransactionStatus: '00',
          vnp_TxnRef: txnRef2,
        }),
      )
      .expect(200);

    jest.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return new Response(
        JSON.stringify(
          buildSignedRefundGatewayResponse({
            txnRef: txnRef2,
            orderCode: orderConcurrent.code,
            amount: orderConcurrent.total,
            responseCode: '00',
            transactionStatus: '00',
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const [refundReq, staffTransitionReq] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/payments/vnpay/refund')
        .auth(customerAToken, { type: 'bearer' })
        .send({ orderId: orderConcurrent.id }),
      new Promise<request.Response>((resolve) =>
        setTimeout(() => {
          request(app.getHttpServer())
            .patch(`/api/orders/${orderConcurrent.id}/status`)
            .auth(staffToken, { type: 'bearer' })
            .send({ expectedVersion: 1, status: 'PREPARING' })
            .then(resolve);
        }, 20),
      ),
    ]);

    expect(refundReq.status).toBe(200);
    expect(refundReq.body.transaction.orderStatus).toBe('CANCELLED');
    expect(staffTransitionReq.status).toBe(409);
    expect(staffTransitionReq.body.code).toBe('REFUND_PENDING_RECONCILIATION');
  });
});

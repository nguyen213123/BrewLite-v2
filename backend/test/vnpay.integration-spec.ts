import { createHmac, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { sortAndEncode } from '../src/modules/payments/vnpay.service';
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

    // 3. Khi cổng VNPay trả về lỗi 91 (từ chối hoàn tiền) -> báo lỗi 502, KHÔNG cập nhật REFUNDED, đơn vẫn PAID
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          vnp_ResponseCode: '91',
          vnp_Message: 'Transaction not found',
          vnp_TmnCode: TEST_TMN_CODE,
          vnp_TxnRef: txnRef,
        }),
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

    // 4. Khi cổng VNPay xác nhận hoàn tiền hợp lệ (vnp_ResponseCode = '00') và có nhiều request hoàn tiền đồng thời:
    // chỉ 1 request thành công (200), các request đồng thời bị chặn (409), tồn kho, voucher và điểm thưởng được hoàn/đảo
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 40));
      return new Response(
        JSON.stringify({
          vnp_ResponseCode: '00',
          vnp_TransactionStatus: '00',
          vnp_Message: 'Refund Success',
          vnp_TmnCode: TEST_TMN_CODE,
          vnp_TxnRef: txnRef,
          vnp_TransactionNo: '15889000',
          vnp_TransactionType: '02',
        }),
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
});

import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import { OrdersService } from '../src/modules/orders/orders.service';
import { PaymentsController } from '../src/modules/payments/payments.controller';
import {
  VnPayService,
  computeVnPayQueryDrResponseHash,
  computeVnPayRefundResponseHash,
  sortAndEncode,
} from '../src/modules/payments/vnpay.service';

const TEST_TMN_CODE = 'TESTTMN1';
const TEST_HASH_SECRET = 'test-only-vnpay-hmac-sha512-secret-key-2026';
const TEST_VNP_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
const TEST_RETURN_URL = 'http://localhost:3000/payments/vnpay-return';
const TEST_API_URL = 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction';

function signVnPayParams(params: Record<string, string>, secret = TEST_HASH_SECRET): string {
  const { signData } = sortAndEncode(params);
  return createHmac('sha512', secret).update(Buffer.from(signData, 'utf-8')).digest('hex');
}

function buildSignedRefundResponse(
  overrides: Record<string, string>,
  secret = TEST_HASH_SECRET,
): Record<string, string> {
  const base: Record<string, string> = {
    vnp_ResponseId: 'RES123456',
    vnp_Command: 'refund',
    vnp_ResponseCode: '00',
    vnp_Message: 'Refund Success',
    vnp_TmnCode: TEST_TMN_CODE,
    vnp_TxnRef: 'BL-20261028-001_123456ab',
    vnp_Amount: '5000000',
    vnp_BankCode: 'NCB',
    vnp_PayDate: '20261028140500',
    vnp_TransactionNo: '14567890',
    vnp_TransactionType: '02',
    vnp_TransactionStatus: '00',
    vnp_OrderInfo: 'Hoan tien don hang BL-20261028-001',
    ...overrides,
  };
  return {
    ...base,
    vnp_SecureHash: computeVnPayRefundResponseHash(base, secret),
  };
}

describe('VnPayService (#10 VNPay Sandbox Integration)', () => {
  let service: VnPayService;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.VNPAY_TMN_CODE = TEST_TMN_CODE;
    process.env.VNPAY_HASH_SECRET = TEST_HASH_SECRET;
    process.env.VNPAY_URL = TEST_VNP_URL;
    process.env.VNPAY_RETURN_URL = TEST_RETURN_URL;
    process.env.VNPAY_API_URL = TEST_API_URL;
    service = new VnPayService();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('báo lỗi rõ ràng (500 VNPAY_CONFIG_MISSING) khi thiếu biến môi trường cấu hình VNPay', () => {
    delete process.env.VNPAY_TMN_CODE;
    delete process.env.VNPAY_HASH_SECRET;

    expect(() =>
      service.createPaymentUrl({
        orderId: '44444444-4444-4444-8444-444444444444',
        orderCode: 'BL-20261028-001',
        amount: 50000,
      }),
    ).toThrow(/VNPAY_TMN_CODE.*VNPAY_HASH_SECRET/);
  });

  it('tạo URL thanh toán VNPay từ biến môi trường có đầy đủ tham số và chữ ký số vnp_SecureHash', () => {
    const session = service.createPaymentSession({
      orderId: '44444444-4444-4444-8444-444444444444',
      orderCode: 'BL-20261028-001',
      amount: 50000,
      ipAddr: '127.0.0.1',
    });

    expect(session.paymentUrl).toContain(`${TEST_VNP_URL}?`);
    expect(session.paymentUrl).toContain(`vnp_TmnCode=${TEST_TMN_CODE}`);
    expect(session.paymentUrl).toContain('vnp_Amount=5000000');
    expect(session.paymentUrl).toContain('vnp_Command=pay');
    expect(session.paymentUrl).toContain('vnp_CurrCode=VND');
    expect(session.paymentUrl).toContain('vnp_SecureHash=');
    expect(session.txnRef.length).toBeLessThanOrEqual(36);
  });

  it('chỉ ghi nhận isSuccess = true khi chữ ký hợp lệ, đúng vnp_TmnCode và CẢ vnp_ResponseCode lẫn vnp_TransactionStatus đều là 00', () => {
    const params: Record<string, string> = {
      vnp_Amount: '5000000',
      vnp_BankCode: 'NCB',
      vnp_CardType: 'ATM',
      vnp_OrderInfo: 'Thanh toan don hang BL-20261028-001',
      vnp_PayDate: '20261028140000',
      vnp_ResponseCode: '00',
      vnp_TmnCode: TEST_TMN_CODE,
      vnp_TransactionNo: '14567890',
      vnp_TransactionStatus: '00',
      vnp_TxnRef: 'BL-20261028-001_123456ab',
    };

    const result = service.verifyResponse({
      ...params,
      vnp_SecureHash: signVnPayParams(params),
    });

    expect(result.isValid).toBe(true);
    expect(result.isSuccess).toBe(true);
    expect(result.orderIdFromRef).toBe('BL-20261028-001');
    expect(result.orderCode).toBe('BL-20261028-001');
    expect(result.amount).toBe(50000);
    expect(result.bankCode).toBe('NCB');
    expect(result.transactionNo).toBe('14567890');
    expect(result.responseCode).toBe('00');
    expect(result.transactionStatus).toBe('00');
  });

  it('từ chối ghi nhận thành công nếu vnp_ResponseCode = 00 nhưng vnp_TransactionStatus khác 00 (hoặc bị thiếu)', () => {
    const paramsPendingStatus: Record<string, string> = {
      vnp_Amount: '5000000',
      vnp_BankCode: 'NCB',
      vnp_OrderInfo: 'Thanh toan don hang BL-20261028-001',
      vnp_ResponseCode: '00',
      vnp_TmnCode: TEST_TMN_CODE,
      vnp_TransactionNo: '14567890',
      vnp_TransactionStatus: '01', // Giao dịch chưa hoàn tất
      vnp_TxnRef: 'BL-20261028-001_123456ab',
    };

    const result = service.verifyResponse({
      ...paramsPendingStatus,
      vnp_SecureHash: signVnPayParams(paramsPendingStatus),
    });

    expect(result.isValid).toBe(true);
    expect(result.isSuccess).toBe(false);
    expect(result.message).toContain('vnp_TransactionStatus khác 00');
  });

  it('từ chối callback có chữ ký đúng nhưng vnp_TmnCode không khớp với cấu hình', () => {
    const paramsWrongMerchant: Record<string, string> = {
      vnp_Amount: '5000000',
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TmnCode: 'OTHER_TMN',
      vnp_TxnRef: 'BL-20261028-001_123456ab',
    };

    const result = service.verifyResponse({
      ...paramsWrongMerchant,
      vnp_SecureHash: signVnPayParams(paramsWrongMerchant),
    });

    expect(result.isValid).toBe(false);
    expect(result.isSuccess).toBe(false);
  });

  it('phát hiện dữ liệu bị can thiệp trái phép (chữ ký không khớp)', () => {
    const fakeParams: Record<string, string> = {
      vnp_Amount: '5000000',
      vnp_BankCode: 'NCB',
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TmnCode: TEST_TMN_CODE,
      vnp_TxnRef: 'BL-20261028-001_123456ab',
      vnp_SecureHash: 'invalid_tampered_hash_value',
    };

    const result = service.verifyResponse(fakeParams);
    expect(result.isValid).toBe(false);
    expect(result.isSuccess).toBe(false);
  });

  it('nhận diện chính xác khi khách hàng hủy giao dịch (code 24)', () => {
    const params: Record<string, string> = {
      vnp_Amount: '5000000',
      vnp_ResponseCode: '24',
      vnp_TransactionStatus: '02',
      vnp_TmnCode: TEST_TMN_CODE,
      vnp_TxnRef: 'BL-20261028-001_123456ab',
    };

    const result = service.verifyResponse({
      ...params,
      vnp_SecureHash: signVnPayParams(params),
    });

    expect(result.isValid).toBe(true);
    expect(result.isSuccess).toBe(false);
    expect(result.message).toContain('hủy bởi khách hàng');
  });

  it('không tự trả mã 00 khi cổng VNPay lỗi mạng, timeout hoặc trả mã lỗi khác 00 trong querydr và refund', async () => {
    // 1. Khi mất kết nối mạng: queryTransaction phải ném lỗi 502 VNPAY_GATEWAY_ERROR, refundTransaction trả về UNCERTAIN
    jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network timeout'));

    await expect(
      service.queryTransaction({
        txnRef: 'BL-20261028-001_123456ab',
        transactionDate: '20261028140000',
        orderCode: 'BL-20261028-001',
      }),
    ).rejects.toMatchObject({
      status: 502,
      response: {
        statusCode: 502,
        code: 'VNPAY_GATEWAY_ERROR',
      },
    });

    jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network timeout'));
    const uncertainRefund = await service.refundTransaction({
      txnRef: 'BL-20261028-001_123456ab',
      transactionDate: '20261028140000',
      orderCode: 'BL-20261028-001',
      amount: 50000,
      transactionNo: '14567890',
    });
    expect(uncertainRefund.outcome).toBe('UNCERTAIN');
    expect(uncertainRefund.vnp_ResponseCode).not.toBe('00');

    // 2. Khi VNPay trả về mã lỗi 91 (có chữ ký hợp lệ và thông tin giao dịch khớp): refundTransaction trả về REJECTED
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          buildSignedRefundResponse({
            vnp_ResponseCode: '91',
            vnp_TransactionStatus: '91',
            vnp_Message: 'Transaction not found',
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const rejectedRefund = await service.refundTransaction({
      txnRef: 'BL-20261028-001_123456ab',
      transactionDate: '20261028140000',
      orderCode: 'BL-20261028-001',
      amount: 50000,
      transactionNo: '14567890',
    });
    expect(rejectedRefund.outcome).toBe('REJECTED');
    expect(rejectedRefund.vnp_ResponseCode).toBe('91');
  });

  it('[#1] bắt buộc xác minh vnp_SecureHash và đối chiếu thông tin giao dịch trên phản hồi hoàn tiền (thiếu/sai chữ ký hoặc sai dữ liệu -> UNCERTAIN)', async () => {
    const refundInput = {
      txnRef: 'BL-20261028-001_123456ab',
      transactionDate: '20261028140000',
      orderCode: 'BL-20261028-001',
      amount: 50000,
      transactionNo: '14567890',
    };

    // 1. Phản hồi chỉ chứa {"vnp_ResponseCode":"00"} (thiếu chữ ký vnp_SecureHash) -> UNCERTAIN (không được coi là SUCCEEDED)
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ vnp_ResponseCode: '00' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const missingSigRes = await service.refundTransaction(refundInput);
    expect(missingSigRes.outcome).toBe('UNCERTAIN');
    expect(missingSigRes.vnp_ResponseCode).toBe('97');

    // 2. Phản hồi có vnp_ResponseCode = '00' nhưng sai chữ ký vnp_SecureHash -> UNCERTAIN
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...buildSignedRefundResponse({}),
          vnp_SecureHash: 'deadbeef0000invalidhash',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const invalidSigRes = await service.refundTransaction(refundInput);
    expect(invalidSigRes.outcome).toBe('UNCERTAIN');
    expect(invalidSigRes.vnp_ResponseCode).toBe('97');

    // 3. Phản hồi có chữ ký hợp lệ nhưng sai merchant (vnp_TmnCode), sai vnp_TxnRef, sai số tiền (vnp_Amount), sai loại giao dịch hoặc sai trạng thái -> UNCERTAIN
    const mismatchedCases: Array<Record<string, string>> = [
      { vnp_TmnCode: 'OTHER_TMN' },
      { vnp_TxnRef: 'BL-20261028-OTHER_999' },
      { vnp_Amount: '1000000' }, // 10.000đ thay vì 50.000đ
      { vnp_Command: 'querydr' },
      { vnp_TransactionType: '01' },
      { vnp_TransactionStatus: '02' },
    ];

    for (const badOverride of mismatchedCases) {
      jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(buildSignedRefundResponse(badOverride)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const res = await service.refundTransaction(refundInput);
      expect(res.outcome).toBe('UNCERTAIN');
    }

    // 4. Phản hồi mã 94 (yêu cầu hoàn tiền trước đó đang được xử lý) -> phải là UNCERTAIN (không được coi là REJECTED)
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          buildSignedRefundResponse({
            vnp_ResponseCode: '94',
            vnp_TransactionStatus: '94',
            vnp_Message: 'Duplicate request / refund in progress',
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const code94Res = await service.refundTransaction(refundInput);
    expect(code94Res.outcome).toBe('UNCERTAIN');
    expect(code94Res.vnp_ResponseCode).toBe('94');

    // 5. Phản hồi đầy đủ chữ ký hợp lệ và khớp toàn bộ thông tin giao dịch -> SUCCEEDED
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(buildSignedRefundResponse({})), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const okRes = await service.refundTransaction(refundInput);
    expect(okRes.outcome).toBe('SUCCEEDED');
    expect(okRes.vnp_ResponseCode).toBe('00');
  });

  it('[#2 & #3] OrdersService.cancel phân biệt đơn VNPay vs mock; giữ khóa chờ đối soát khi mã 94 hoặc thiếu chữ ký, chặn gọi lặp và đối soát qua querydr', async () => {
    const orderId = '44444444-4444-4444-8444-444444444444';
    const userId = '33333333-3333-4333-8333-333333333333';
    const recordId = '88888888-8888-4888-8888-888888888888';
    const paymentId = '99999999-9999-4999-8999-999999999999';
    const txnRef = 'BL-20261028-001_123456ab';

    const state = {
      orderStatus: 'PAID' as 'PAID' | 'CANCELLED',
      orderVersion: 1,
      paymentStatus: 'SUCCEEDED' as 'SUCCEEDED' | 'REFUNDED',
      idemStatus: 'COMPLETED' as 'PROCESSING' | 'COMPLETED',
      idemHttpStatus: 200,
      idemResponse: {
        provider: 'VNPAY',
        orderId,
        orderCode: 'BL-20261028-001',
        txnRef,
        tmnCode: TEST_TMN_CODE,
        expectedAmount: 50000,
        transactionNo: '14567890',
        payDate: '20261028140000',
      } as Record<string, unknown>,
    };

    const makeOrderRow = () => ({
      id: orderId,
      code: 'BL-20261028-001',
      userId,
      promotionId: null,
      promotionCode: null,
      subtotal: 50000,
      discount: 0,
      total: 50000,
      status: state.orderStatus,
      reservationStatus: state.orderStatus === 'CANCELLED' ? 'RELEASED' : 'CONSUMED',
      version: state.orderVersion,
      createdAt: new Date('2026-10-28T07:00:00Z'),
      updatedAt: new Date('2026-10-28T07:05:00Z'),
      user: { id: userId, email: 'customer@example.com' },
      items: [],
      payments: [
        {
          id: paymentId,
          orderId,
          idempotencyRecordId: recordId,
          idempotencyKey: txnRef,
          amount: 50000,
          method: 'CARD',
          status: state.paymentStatus,
          createdAt: new Date('2026-10-28T07:01:00Z'),
          updatedAt: new Date('2026-10-28T07:01:00Z'),
          idempotency: {
            id: recordId,
            status: state.idemStatus,
            httpStatus: state.idemHttpStatus,
            response: state.idemResponse,
          },
        },
      ],
    });

    const prismaBase = {
      order: {
        findFirst: jest.fn(async () => makeOrderRow()),
        findUnique: jest.fn(async () => makeOrderRow()),
      },
      payment: {
        findMany: jest.fn(async () => [
          {
            ...makeOrderRow().payments[0],
            order: makeOrderRow(),
          },
        ]),
        findUnique: jest.fn(async () => ({
          ...makeOrderRow().payments[0],
          order: makeOrderRow(),
        })),
        update: jest.fn(async ({ data }: { data: { status: 'REFUNDED' } }) => {
          state.paymentStatus = data.status;
        }),
      },
      idempotencyRecord: {
        updateMany: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string; status: string; httpStatus: number };
            data: { httpStatus: number };
          }) => {
            if (
              where.id === recordId &&
              state.idemStatus === where.status &&
              state.idemHttpStatus === where.httpStatus
            ) {
              state.idemHttpStatus = data.httpStatus;
              return { count: 1 };
            }
            return { count: 0 };
          },
        ),
        update: jest.fn(
          async ({
            data,
          }: {
            data: { status: 'COMPLETED'; httpStatus: number; response: Record<string, unknown> };
          }) => {
            state.idemStatus = data.status;
            state.idemHttpStatus = data.httpStatus;
            state.idemResponse = data.response;
          },
        ),
      },
    };
    const prismaMock = {
      ...prismaBase,
      $transaction: jest.fn(
        async <T>(cb: (tx: typeof prismaBase) => Promise<T>): Promise<T> => cb(prismaBase),
      ),
    };

    const transitionsMock = {
      loadOwned: jest.fn(async () => makeOrderRow()),
      transition: jest.fn(async () => {
        state.orderStatus = 'CANCELLED';
        state.orderVersion += 1;
        return makeOrderRow();
      }),
    };
    const loyaltyMock = { earn: jest.fn(), reverse: jest.fn(async () => undefined) };
    const uowMock = { run: async <T>(cb: (tx: unknown) => Promise<T>) => cb(prismaMock) };

    const ordersService = new OrdersService(
      uowMock as never,
      {} as never,
      {} as never,
      {} as never,
      transitionsMock as never,
      loyaltyMock as never,
      {} as never,
      prismaMock as never,
      service,
    );

    const paymentsController = new PaymentsController(
      {} as never,
      service,
      prismaMock as never,
      transitionsMock as never,
      loyaltyMock as never,
    );

    const fakeReq = {
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    // 1. Gọi OrdersService.cancel cho đơn VNPay nhưng gateway trả mã 94 -> ném 502 VNPAY_REFUND_UNCERTAIN,
    // giữ khóa httpStatus = 201 và refundStatus = 'PENDING_RECONCILIATION', đơn vẫn PAID
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          buildSignedRefundResponse({
            vnp_ResponseCode: '94',
            vnp_TransactionStatus: '94',
            vnp_Message: 'Refund request already processing',
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(ordersService.cancel(userId, orderId, 1)).rejects.toMatchObject({
      status: 502,
      response: { code: 'VNPAY_REFUND_UNCERTAIN' },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(state.orderStatus).toBe('PAID');
    expect(state.paymentStatus).toBe('SUCCEEDED');
    expect(state.idemHttpStatus).toBe(201);
    expect(state.idemResponse.refundStatus).toBe('PENDING_RECONCILIATION');

    // 2. Gọi lại OrdersService.cancel hoặc PaymentsController.refundVnPayTransaction khi đang PENDING_RECONCILIATION:
    // bị chặn ngay với 409 REFUND_PENDING_RECONCILIATION và fetchSpy KHÔNG bị gọi thêm lần nào
    await expect(ordersService.cancel(userId, orderId, 1)).rejects.toMatchObject({
      status: 409,
      response: { code: 'REFUND_PENDING_RECONCILIATION' },
    });
    await expect(
      paymentsController.refundVnPayTransaction(
        { id: userId, email: 'customer@example.com', role: 'CUSTOMER' },
        { orderId },
        fakeReq,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'REFUND_PENDING_RECONCILIATION' },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // 3. Đối soát qua queryVnPayTransaction: cổng xác nhận giao dịch vẫn là '01' (chưa hoàn tiền) -> mở khóa (httpStatus = 200)
    const queryBody: Record<string, string> = {
      vnp_ResponseId: 'QRES01',
      vnp_Command: 'querydr',
      vnp_ResponseCode: '00',
      vnp_Message: 'QueryDR Success',
      vnp_TmnCode: TEST_TMN_CODE,
      vnp_TxnRef: txnRef,
      vnp_Amount: '5000000',
      vnp_BankCode: 'NCB',
      vnp_PayDate: '20261028140000',
      vnp_TransactionNo: '14567890',
      vnp_TransactionType: '01',
      vnp_TransactionStatus: '00',
      vnp_OrderInfo: 'Truy van giao dich BL-20261028-001',
      vnp_PromotionCode: '',
      vnp_PromotionAmount: '',
    };
    queryBody.vnp_SecureHash = computeVnPayQueryDrResponseHash(queryBody, TEST_HASH_SECRET);

    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(queryBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const queryRes = await paymentsController.queryVnPayTransaction(
      { id: userId, email: 'customer@example.com', role: 'CUSTOMER' },
      { orderId },
      fakeReq,
    );
    expect(queryRes.transaction.refundStatus).toBe('RECONCILED_NOT_REFUNDED');
    expect(state.idemHttpStatus).toBe(200);

    // 4. Sau khi đã đối soát và mở khóa, gọi lại OrdersService.cancel với phản hồi VNPay hợp lệ có chữ ký -> hủy đơn & REFUNDED thành công
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(buildSignedRefundResponse({})), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const cancelledOrder = await ordersService.cancel(userId, orderId, 1);
    expect(cancelledOrder.status).toBe('CANCELLED');
    expect(state.paymentStatus).toBe('REFUNDED');
    expect(state.idemResponse.refundStatus).toBe('REFUNDED');
    expect(loyaltyMock.reverse).toHaveBeenCalledTimes(1);
  });
});

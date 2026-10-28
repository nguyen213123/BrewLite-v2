import { createHmac } from 'node:crypto';
import { VnPayService, sortAndEncode } from '../src/modules/payments/vnpay.service';

const TEST_TMN_CODE = 'TESTTMN1';
const TEST_HASH_SECRET = 'test-only-vnpay-hmac-sha512-secret-key-2026';
const TEST_VNP_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
const TEST_RETURN_URL = 'http://localhost:3000/payments/vnpay-return';
const TEST_API_URL = 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction';

function signVnPayParams(params: Record<string, string>, secret = TEST_HASH_SECRET): string {
  const { signData } = sortAndEncode(params);
  return createHmac('sha512', secret).update(Buffer.from(signData, 'utf-8')).digest('hex');
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

    // 2. Khi VNPay trả về mã lỗi 91 (không tìm thấy giao dịch hoàn tiền): refundTransaction phải trả về REJECTED
    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          vnp_ResponseCode: '91',
          vnp_Message: 'Transaction not found',
          vnp_TmnCode: TEST_TMN_CODE,
          vnp_TxnRef: 'BL-20261028-001_123456ab',
        }),
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
});

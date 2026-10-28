import { createHmac } from 'node:crypto';
import { VnPayService } from '../src/modules/payments/vnpay.service';

describe('VnPayService (#10 VNPay Sandbox Integration)', () => {
  let service: VnPayService;

  beforeEach(() => {
    service = new VnPayService();
  });

  it('tạo URL thanh toán VNPay có đầy đủ tham số và chữ ký số vnp_SecureHash', () => {
    const url = service.createPaymentUrl({
      orderId: '44444444-4444-4444-8444-444444444444',
      orderCode: 'ORD-20261027-001',
      amount: 50000,
      ipAddr: '127.0.0.1',
    });

    expect(url).toContain('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?');
    expect(url).toContain('vnp_TmnCode=8FIGK6AJ');
    expect(url).toContain('vnp_Amount=5000000'); // 50.000 x 100
    expect(url).toContain('vnp_Command=pay');
    expect(url).toContain('vnp_CurrCode=VND');
    expect(url).toContain('vnp_SecureHash=');
  });

  it('xác thực chữ ký hợp lệ khi nhận kết quả thành công (ResponseCode 00)', () => {
    const secret = process.env.VNPAY_HASH_SECRET ?? 'KXJYZOSLMJNANNWEZJJYYOBDLOZAMOTF';
    const params: Record<string, string> = {
      vnp_Amount: '5000000',
      vnp_BankCode: 'NCB',
      vnp_CardType: 'ATM',
      vnp_OrderInfo: 'Thanh toan don hang BL-20261027-001',
      vnp_PayDate: '20261027140000',
      vnp_ResponseCode: '00',
      vnp_TmnCode: '8FIGK6AJ',
      vnp_TransactionNo: '14567890',
      vnp_TxnRef: '44444444-4444-4444-8444-444444444444_1730000000000',
    };

    // Tạo chữ ký mẫu chuẩn cho params
    const sortedKeys = Object.keys(params).sort();
    const signParts = sortedKeys.map(
      (k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k]).replace(/%20/g, '+')}`,
    );
    const signData = signParts.join('&');
    const hmac = createHmac('sha512', secret);
    const secureHash = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

    const result = service.verifyResponse({
      ...params,
      vnp_SecureHash: secureHash,
    });

    expect(result.isValid).toBe(true);
    expect(result.isSuccess).toBe(true);
    expect(result.orderIdFromRef).toBe('44444444-4444-4444-8444-444444444444');
    expect(result.orderCode).toBe('BL-20261027-001');
    expect(result.amount).toBe(50000);
    expect(result.bankCode).toBe('NCB');
    expect(result.transactionNo).toBe('14567890');
    expect(result.responseCode).toBe('00');
  });

  it('phát hiện dữ liệu bị can thiệp trái phép (chữ ký không khớp)', () => {
    const fakeParams: Record<string, string> = {
      vnp_Amount: '5000000',
      vnp_BankCode: 'NCB',
      vnp_ResponseCode: '00',
      vnp_TxnRef: 'test-order-123_1730000000',
      vnp_SecureHash: 'invalid_tampered_hash_value',
    };

    const result = service.verifyResponse(fakeParams);
    expect(result.isValid).toBe(false);
    expect(result.isSuccess).toBe(false);
  });

  it('nhận diện chính xác khi khách hàng hủy giao dịch (code 24)', () => {
    const secret = process.env.VNPAY_HASH_SECRET ?? 'KXJYZOSLMJNANNWEZJJYYOBDLOZAMOTF';
    const params: Record<string, string> = {
      vnp_Amount: '5000000',
      vnp_ResponseCode: '24',
      vnp_TxnRef: 'test-order-123_1730000000',
    };
    const signParts = Object.keys(params)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k]).replace(/%20/g, '+')}`);
    const secureHash = createHmac('sha512', secret)
      .update(Buffer.from(signParts.join('&'), 'utf-8'))
      .digest('hex');

    const result = service.verifyResponse({
      ...params,
      vnp_SecureHash: secureHash,
    });

    expect(result.isValid).toBe(true);
    expect(result.isSuccess).toBe(false);
    expect(result.message).toContain('hủy bởi khách hàng');
  });
});

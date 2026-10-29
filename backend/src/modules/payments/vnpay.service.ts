import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { ApiError } from '../../common/errors/api-error';

export interface VnPayConfig {
  tmnCode: string;
  hashSecret: string;
  vnpUrl: string;
  returnUrl: string;
  apiUrl: string;
}

export interface VnPayPaymentSession {
  paymentUrl: string;
  txnRef: string;
  tmnCode: string;
  createDate: string;
  expireDate: string;
}

export interface VnPayVerifyResult {
  isValid: boolean;
  isSuccess: boolean;
  tmnCode: string;
  orderCode: string;
  orderIdFromRef: string;
  txnRef: string;
  amount: number;
  bankCode?: string;
  bankTranNo?: string;
  cardType?: string;
  payDate?: string;
  transactionNo?: string;
  responseCode: string;
  transactionStatus: string;
  message: string;
}

export interface VnPayGatewayApiResult {
  outcome: 'SUCCEEDED' | 'REJECTED' | 'UNCERTAIN';
  vnp_ResponseCode: string;
  vnp_Message: string;
  vnp_TmnCode: string;
  vnp_TxnRef: string;
  vnp_Amount: string;
  vnp_BankCode: string;
  vnp_PayDate: string;
  vnp_TransactionNo: string;
  vnp_TransactionType: string;
  vnp_TransactionStatus: string;
  vnp_Command: 'querydr' | 'refund';
  /** Mã phản hồi nguyên văn do cổng VNPay trả về (không qua diễn giải), để hiển thị đúng thông báo của VNPay */
  gatewayResponseCode?: string;
  /** Thông điệp nguyên văn do cổng VNPay trả về */
  gatewayMessage?: string;
}

/**
 * Mô tả nguyên văn phản hồi của cổng VNPay để hiển thị cho người dùng (không tự diễn giải thành công).
 */
export function describeVnPayGatewayReply(result: Pick<VnPayGatewayApiResult, 'gatewayResponseCode' | 'gatewayMessage'>): string {
  if (!result.gatewayResponseCode && !result.gatewayMessage) {
    return 'Không nhận được phản hồi từ cổng VNPay.';
  }
  return `Phản hồi từ VNPay: "${result.gatewayMessage ?? ''}" (mã ${result.gatewayResponseCode ?? 'không có'}).`;
}

export function formatVnPayDate(date: Date): string {
  const vnOffset = 7 * 60; // UTC+7
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const vnTime = new Date(utc + vnOffset * 60000);
  const year = vnTime.getFullYear();
  const month = String(vnTime.getMonth() + 1).padStart(2, '0');
  const day = String(vnTime.getDate()).padStart(2, '0');
  const hours = String(vnTime.getHours()).padStart(2, '0');
  const minutes = String(vnTime.getMinutes()).padStart(2, '0');
  const seconds = String(vnTime.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

export function sortAndEncode(obj: Record<string, string>): { signData: string; queryString: string } {
  const sortedKeys = Object.keys(obj).sort();
  const parts: string[] = [];

  for (const key of sortedKeys) {
    const val = obj[key];
    if (val !== undefined && val !== null && val.length > 0) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(val).replace(/%20/g, '+')}`);
    }
  }

  const signData = parts.join('&');
  return { signData, queryString: signData };
}

/**
 * Các mã vnp_TransactionStatus cho biết giao dịch hoàn tiền đang được VNPay / ngân hàng xử lý hoặc chưa rõ kết quả cuối:
 * - '01': Giao dịch chưa hoàn tất / đang xử lý
 * - '05': VNPay đang xử lý giao dịch hoàn tiền
 * - '06': VNPay đã gửi yêu cầu hoàn tiền sang ngân hàng
 * - '08': Giao dịch quá thời gian chờ / đang chờ xử lý
 * - '94': Yêu cầu hoàn tiền trước đó đang được xử lý (trùng lặp)
 * - '99': Trạng thái chưa xác định
 */
export const VNPAY_REFUND_PROCESSING_STATUSES = ['01', '05', '06', '08', '94', '99'] as const;

export function isVnPayRefundProcessingStatus(status?: string | null): boolean {
  if (!status) return true;
  return (VNPAY_REFUND_PROCESSING_STATUSES as readonly string[]).includes(status.trim());
}

export function computeVnPayQueryDrResponseHash(
  json: Record<string, string | undefined>,
  hashSecret: string,
): string {
  const expectedData = [
    json.vnp_ResponseId ?? '',
    json.vnp_Command ?? '',
    json.vnp_ResponseCode ?? '',
    json.vnp_Message ?? '',
    json.vnp_TmnCode ?? '',
    json.vnp_TxnRef ?? '',
    json.vnp_Amount ?? '',
    json.vnp_BankCode ?? '',
    json.vnp_PayDate ?? '',
    json.vnp_TransactionNo ?? '',
    json.vnp_TransactionType ?? '',
    json.vnp_TransactionStatus ?? '',
    json.vnp_OrderInfo ?? '',
    json.vnp_PromotionCode ?? '',
    json.vnp_PromotionAmount ?? '',
  ].join('|');
  return createHmac('sha512', hashSecret)
    .update(Buffer.from(expectedData, 'utf-8'))
    .digest('hex');
}

export function computeVnPayRefundResponseHash(
  json: Record<string, string | undefined>,
  hashSecret: string,
): string {
  const expectedData = [
    json.vnp_ResponseId ?? '',
    json.vnp_Command ?? '',
    json.vnp_ResponseCode ?? '',
    json.vnp_Message ?? '',
    json.vnp_TmnCode ?? '',
    json.vnp_TxnRef ?? '',
    json.vnp_Amount ?? '',
    json.vnp_BankCode ?? '',
    json.vnp_PayDate ?? '',
    json.vnp_TransactionNo ?? '',
    json.vnp_TransactionType ?? '',
    json.vnp_TransactionStatus ?? '',
    json.vnp_OrderInfo ?? '',
  ].join('|');
  return createHmac('sha512', hashSecret)
    .update(Buffer.from(expectedData, 'utf-8'))
    .digest('hex');
}

@Injectable()
export class VnPayService {
  /**
   * Đọc và kiểm tra cấu hình VNPay từ biến môi trường (không ghi cứng khóa bí mật hay mã merchant trong mã nguồn)
   */
  getConfig(requireApiUrl = false): VnPayConfig {
    const tmnCode = process.env.VNPAY_TMN_CODE?.trim() ?? '';
    const hashSecret = process.env.VNPAY_HASH_SECRET?.trim() ?? '';
    const vnpUrl = process.env.VNPAY_URL?.trim() ?? '';
    const returnUrl = process.env.VNPAY_RETURN_URL?.trim() ?? '';
    const apiUrl = process.env.VNPAY_API_URL?.trim() ?? '';

    const missing: string[] = [];
    if (!tmnCode) missing.push('VNPAY_TMN_CODE');
    if (!hashSecret) missing.push('VNPAY_HASH_SECRET');
    if (!vnpUrl) missing.push('VNPAY_URL');
    if (!returnUrl) missing.push('VNPAY_RETURN_URL');
    if (requireApiUrl && !apiUrl) missing.push('VNPAY_API_URL');

    if (missing.length > 0) {
      throw new ApiError(
        500,
        'VNPAY_CONFIG_MISSING',
        `Thiếu cấu hình cổng thanh toán VNPay trong biến môi trường: ${missing.join(', ')}`,
      );
    }

    return { tmnCode, hashSecret, vnpUrl, returnUrl, apiUrl };
  }

  /**
   * Tạo phiên thanh toán VNPay kèm thông tin đối chiếu (txnRef, tmnCode, createDate, expireDate)
   */
  createPaymentSession(input: {
    orderId: string;
    orderCode: string;
    amount: number;
    ipAddr?: string;
    txnRef?: string;
  }): VnPayPaymentSession {
    const config = this.getConfig(false);
    const now = new Date();
    const createDate = formatVnPayDate(now);
    const expireDate = formatVnPayDate(new Date(now.getTime() + 15 * 60 * 1000));
    const ipAddr = input.ipAddr && input.ipAddr.length > 0 ? input.ipAddr : '127.0.0.1';

    // Mã tham chiếu giao dịch duy nhất (tối đa 36 ký tự để lưu vào IdempotencyRecord.key)
    const suffix = `${Date.now().toString().slice(-6)}${randomUUID().replace(/-/g, '').slice(0, 2)}`;
    const txnRef = input.txnRef ?? `${input.orderCode}_${suffix}`;

    const vnpParams: Record<string, string> = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: config.tmnCode,
      vnp_Locale: 'vn',
      vnp_CurrCode: 'VND',
      vnp_TxnRef: txnRef,
      vnp_OrderInfo: `Thanh toan don hang ${input.orderCode}`,
      vnp_OrderType: 'other',
      vnp_Amount: String(input.amount * 100), // VNPay tính bằng VND x 100
      vnp_ReturnUrl: config.returnUrl,
      vnp_IpAddr: ipAddr,
      vnp_CreateDate: createDate,
      vnp_ExpireDate: expireDate,
    };

    const { signData, queryString } = sortAndEncode(vnpParams);
    const hmac = createHmac('sha512', config.hashSecret);
    const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

    return {
      paymentUrl: `${config.vnpUrl}?${queryString}&vnp_SecureHash=${signed}`,
      txnRef,
      tmnCode: config.tmnCode,
      createDate,
      expireDate,
    };
  }

  /**
   * Tạo URL thanh toán VNPay Sandbox với chữ ký HMAC-SHA512
   */
  createPaymentUrl(input: {
    orderId: string;
    orderCode: string;
    amount: number;
    ipAddr?: string;
  }): string {
    return this.createPaymentSession(input).paymentUrl;
  }

  /**
   * Kiểm tra chữ ký HMAC-SHA512, vnp_TmnCode, vnp_ResponseCode và vnp_TransactionStatus
   * khi nhận kết quả từ VNPay (Return URL hoặc IPN Webhook)
   */
  verifyResponse(rawParams: Record<string, string>): VnPayVerifyResult {
    const config = this.getConfig(false);
    const vnpParams: Record<string, string> = {};
    for (const [key, val] of Object.entries(rawParams)) {
      if (key.startsWith('vnp_') && val !== undefined && val !== null) {
        vnpParams[key] = String(val);
      }
    }

    const secureHash = vnpParams['vnp_SecureHash'];
    delete vnpParams['vnp_SecureHash'];
    delete vnpParams['vnp_SecureHashType'];

    const { signData } = sortAndEncode(vnpParams);
    const hmac = createHmac('sha512', config.hashSecret);
    const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

    const tmnCode = vnpParams['vnp_TmnCode'] ?? '';
    const isSignatureValid = Boolean(
      secureHash && secureHash.toLowerCase() === signed.toLowerCase(),
    );
    const isTmnCodeValid = tmnCode === config.tmnCode;

    const rawAmountStr = vnpParams['vnp_Amount'] ?? '';
    const rawAmount = Number(rawAmountStr);
    const isAmountFormatValid =
      rawAmountStr.length > 0 &&
      Number.isInteger(rawAmount) &&
      rawAmount > 0 &&
      rawAmount % 100 === 0;
    const amount = isAmountFormatValid ? Math.floor(rawAmount / 100) : -1;

    const isValid = isSignatureValid && isTmnCodeValid && isAmountFormatValid;

    const responseCode = vnpParams['vnp_ResponseCode'] ?? '99';
    const transactionStatus = vnpParams['vnp_TransactionStatus'] ?? '';

    // Chỉ ghi nhận thành công khi chữ ký + TmnCode hợp lệ và CẢ vnp_ResponseCode lẫn vnp_TransactionStatus đều là '00'
    const isSuccess = isValid && responseCode === '00' && transactionStatus === '00';

    const rawTxnRef = vnpParams['vnp_TxnRef'] ?? '';
    const parts = rawTxnRef.split('_');
    const orderIdFromRef = parts[0] ?? '';

    const message = !isValid
      ? 'Chữ ký số hoặc thông tin cấu hình merchant (vnp_TmnCode / vnp_Amount) không hợp lệ'
      : responseCode === '00' && transactionStatus !== '00'
        ? 'Trạng thái giao dịch tại cổng VNPay chưa hoàn tất (vnp_TransactionStatus khác 00)'
        : this.describeResponseCode(responseCode);

    return {
      isValid,
      isSuccess,
      tmnCode,
      orderCode: (vnpParams['vnp_OrderInfo'] ?? '').replace('Thanh toan don hang ', ''),
      orderIdFromRef,
      txnRef: rawTxnRef,
      amount,
      bankCode: vnpParams['vnp_BankCode'],
      bankTranNo: vnpParams['vnp_BankTranNo'],
      cardType: vnpParams['vnp_CardType'],
      payDate: vnpParams['vnp_PayDate'],
      transactionNo: vnpParams['vnp_TransactionNo'],
      responseCode,
      transactionStatus,
      message,
    };
  }

  /**
   * Đối soát giao dịch trực tiếp với cổng VNPay Sandbox (vnp_Command = 'querydr')
   * Không tự trả mã 00 giả lập khi gateway lỗi, timeout hoặc trả mã khác 00.
   */
  async queryTransaction(input: {
    txnRef: string;
    transactionDate: string;
    orderCode: string;
    expectedAmount?: number;
    ipAddr?: string;
  }): Promise<VnPayGatewayApiResult> {
    const config = this.getConfig(true);
    const requestId = randomUUID().replace(/-/g, '').slice(0, 16);
    const version = '2.1.0';
    const command = 'querydr';
    const createDate = formatVnPayDate(new Date());
    const ipAddr = input.ipAddr && input.ipAddr.length > 0 ? input.ipAddr : '127.0.0.1';
    const orderInfo = `Truy van giao dich ${input.orderCode}`;

    // Chuỗi ký số chuẩn VNPay querydr:
    // vnp_RequestId|vnp_Version|vnp_Command|vnp_TmnCode|vnp_TxnRef|vnp_TransactionDate|vnp_CreateDate|vnp_IpAddr|vnp_OrderInfo
    const data = [
      requestId,
      version,
      command,
      config.tmnCode,
      input.txnRef,
      input.transactionDate,
      createDate,
      ipAddr,
      orderInfo,
    ].join('|');

    const secureHash = createHmac('sha512', config.hashSecret)
      .update(Buffer.from(data, 'utf-8'))
      .digest('hex');

    const payload = {
      vnp_RequestId: requestId,
      vnp_Version: version,
      vnp_Command: command,
      vnp_TmnCode: config.tmnCode,
      vnp_TxnRef: input.txnRef,
      vnp_OrderInfo: orderInfo,
      vnp_TransactionDate: input.transactionDate,
      vnp_CreateDate: createDate,
      vnp_IpAddr: ipAddr,
      vnp_SecureHash: secureHash,
    };

    let res: Response;
    try {
      res = await fetch(config.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new ApiError(
        502,
        'VNPAY_GATEWAY_ERROR',
        'Không thể kết nối hoặc quá thời gian chờ phản hồi từ cổng VNPay khi đối soát giao dịch',
      );
    }

    if (!res.ok) {
      throw new ApiError(
        502,
        'VNPAY_GATEWAY_ERROR',
        `Cổng VNPay trả về mã trạng thái HTTP không hợp lệ (${res.status})`,
      );
    }

    let json: Record<string, string>;
    try {
      json = (await res.json()) as Record<string, string>;
    } catch {
      throw new ApiError(502, 'VNPAY_GATEWAY_ERROR', 'Phản hồi từ cổng VNPay không đúng định dạng JSON');
    }

    const responseHash = typeof json.vnp_SecureHash === 'string' ? json.vnp_SecureHash.trim() : '';
    const expectedHash = computeVnPayQueryDrResponseHash(json, config.hashSecret);
    if (!responseHash || responseHash.toLowerCase() !== expectedHash.toLowerCase()) {
      throw new ApiError(
        502,
        'VNPAY_INVALID_SIGNATURE',
        'Thiếu hoặc sai chữ ký số (vnp_SecureHash) trong phản hồi đối soát từ cổng VNPay',
      );
    }

    if (json.vnp_ResponseCode !== '00') {
      throw new ApiError(
        502,
        'VNPAY_QUERY_FAILED',
        `Đối soát giao dịch VNPay thất bại: ${json.vnp_Message ?? 'Lỗi từ cổng VNPay'} (Mã: ${json.vnp_ResponseCode ?? '99'})`,
      );
    }

    const isContextValid =
      json.vnp_TmnCode === config.tmnCode &&
      json.vnp_TxnRef === input.txnRef &&
      json.vnp_Command === 'querydr' &&
      typeof json.vnp_TransactionType === 'string' &&
      json.vnp_TransactionType.length > 0 &&
      typeof json.vnp_TransactionStatus === 'string' &&
      json.vnp_TransactionStatus.length > 0 &&
      (input.expectedAmount === undefined || json.vnp_Amount === String(input.expectedAmount * 100));

    if (!isContextValid) {
      throw new ApiError(
        502,
        'VNPAY_GATEWAY_ERROR',
        'Thông tin đối soát phản hồi từ cổng VNPay (merchant, mã tham chiếu, loại/trạng thái giao dịch hoặc số tiền) không khớp với giao dịch đã lưu',
      );
    }

    return {
      outcome: 'SUCCEEDED',
      vnp_ResponseCode: json.vnp_ResponseCode,
      vnp_Message: json.vnp_Message ?? 'QueryDR Success',
      vnp_TmnCode: json.vnp_TmnCode,
      vnp_TxnRef: json.vnp_TxnRef,
      vnp_Amount: json.vnp_Amount ?? '0',
      vnp_BankCode: json.vnp_BankCode ?? '',
      vnp_PayDate: json.vnp_PayDate ?? input.transactionDate,
      vnp_TransactionNo: json.vnp_TransactionNo ?? '',
      vnp_TransactionType: json.vnp_TransactionType,
      vnp_TransactionStatus: json.vnp_TransactionStatus,
      vnp_Command: 'querydr',
    };
  }

  /**
   * Gửi lệnh hoàn tiền giao dịch sang cổng VNPay Sandbox (vnp_Command = 'refund', vnp_TransactionType = '02')
   * - Bắt buộc có chữ ký hợp lệ (vnp_SecureHash) trước khi xác nhận kết quả.
   * - Đối chiếu merchant (vnp_TmnCode), mã tham chiếu (vnp_TxnRef), số tiền (vnp_Amount), lệnh (vnp_Command), loại giao dịch (vnp_TransactionType) với yêu cầu đã lưu.
   * - Phản hồi thiếu/sai chữ ký, thiếu/sai dữ liệu giao dịch, mất kết nối, timeout hoặc trả mã 94 / 99 / 08 đều trả về outcome = 'UNCERTAIN' để giữ trạng thái chờ đối soát (PENDING_RECONCILIATION).
   */
  async refundTransaction(input: {
    txnRef: string;
    transactionDate: string;
    orderCode: string;
    amount: number;
    transactionNo: string;
    createBy?: string;
    ipAddr?: string;
  }): Promise<VnPayGatewayApiResult> {
    const config = this.getConfig(true);
    const requestId = randomUUID().replace(/-/g, '').slice(0, 16);
    const version = '2.1.0';
    const command = 'refund';
    const transactionType = '02'; // Hoàn tiền toàn phần
    const amountStr = String(input.amount * 100);
    const createBy = input.createBy ?? 'customer@brewlite.local';
    const createDate = formatVnPayDate(new Date());
    const ipAddr = input.ipAddr && input.ipAddr.length > 0 ? input.ipAddr : '127.0.0.1';
    const orderInfo = `Hoan tien don hang ${input.orderCode}`;

    // Chuỗi ký số chuẩn VNPay refund:
    // vnp_RequestId|vnp_Version|vnp_Command|vnp_TmnCode|vnp_TransactionType|vnp_TxnRef|vnp_Amount|vnp_TransactionNo|vnp_TransactionDate|vnp_CreateBy|vnp_CreateDate|vnp_IpAddr|vnp_OrderInfo
    const data = [
      requestId,
      version,
      command,
      config.tmnCode,
      transactionType,
      input.txnRef,
      amountStr,
      input.transactionNo,
      input.transactionDate,
      createBy,
      createDate,
      ipAddr,
      orderInfo,
    ].join('|');

    const secureHash = createHmac('sha512', config.hashSecret)
      .update(Buffer.from(data, 'utf-8'))
      .digest('hex');

    const payload = {
      vnp_RequestId: requestId,
      vnp_Version: version,
      vnp_Command: command,
      vnp_TmnCode: config.tmnCode,
      vnp_TransactionType: transactionType,
      vnp_TxnRef: input.txnRef,
      vnp_Amount: amountStr,
      vnp_OrderInfo: orderInfo,
      vnp_TransactionNo: input.transactionNo,
      vnp_TransactionDate: input.transactionDate,
      vnp_CreateBy: createBy,
      vnp_CreateDate: createDate,
      vnp_IpAddr: ipAddr,
      vnp_SecureHash: secureHash,
    };

    let res: Response;
    try {
      res = await fetch(config.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      return {
        outcome: 'UNCERTAIN',
        vnp_ResponseCode: '99',
        vnp_Message: 'Mất kết nối hoặc quá thời gian chờ phản hồi hoàn tiền từ cổng VNPay',
        vnp_TmnCode: config.tmnCode,
        vnp_TxnRef: input.txnRef,
        vnp_Amount: amountStr,
        vnp_BankCode: '',
        vnp_PayDate: createDate,
        vnp_TransactionNo: input.transactionNo,
        vnp_TransactionType: transactionType,
        vnp_TransactionStatus: '99',
        vnp_Command: 'refund',
      };
    }

    if (!res.ok) {
      return {
        outcome: 'UNCERTAIN',
        vnp_ResponseCode: String(res.status),
        vnp_Message: `Cổng VNPay trả về HTTP ${res.status}`,
        vnp_TmnCode: config.tmnCode,
        vnp_TxnRef: input.txnRef,
        vnp_Amount: amountStr,
        vnp_BankCode: '',
        vnp_PayDate: createDate,
        vnp_TransactionNo: input.transactionNo,
        vnp_TransactionType: transactionType,
        vnp_TransactionStatus: '99',
        vnp_Command: 'refund',
        gatewayResponseCode: `HTTP ${res.status}`,
        gatewayMessage: res.statusText,
      };
    }

    let json: Record<string, string>;
    try {
      json = (await res.json()) as Record<string, string>;
    } catch {
      return {
        outcome: 'UNCERTAIN',
        vnp_ResponseCode: '99',
        vnp_Message: 'Phản hồi hoàn tiền từ cổng VNPay không đúng định dạng JSON',
        vnp_TmnCode: config.tmnCode,
        vnp_TxnRef: input.txnRef,
        vnp_Amount: amountStr,
        vnp_BankCode: '',
        vnp_PayDate: createDate,
        vnp_TransactionNo: input.transactionNo,
        vnp_TransactionType: transactionType,
        vnp_TransactionStatus: '99',
        vnp_Command: 'refund',
      };
    }

    // 1. Bắt buộc phải có vnp_SecureHash hợp lệ
    const responseHash = typeof json.vnp_SecureHash === 'string' ? json.vnp_SecureHash.trim() : '';
    const expectedHash = computeVnPayRefundResponseHash(json, config.hashSecret);
    if (!responseHash || responseHash.toLowerCase() !== expectedHash.toLowerCase()) {
      return {
        outcome: 'UNCERTAIN',
        vnp_ResponseCode: '97',
        vnp_Message: 'Thiếu hoặc sai chữ ký số (vnp_SecureHash) trong phản hồi hoàn tiền từ cổng VNPay',
        vnp_TmnCode: json.vnp_TmnCode ?? config.tmnCode,
        vnp_TxnRef: json.vnp_TxnRef ?? input.txnRef,
        vnp_Amount: json.vnp_Amount ?? amountStr,
        vnp_BankCode: json.vnp_BankCode ?? '',
        vnp_PayDate: json.vnp_PayDate ?? createDate,
        vnp_TransactionNo: json.vnp_TransactionNo ?? input.transactionNo,
        vnp_TransactionType: json.vnp_TransactionType ?? transactionType,
        vnp_TransactionStatus: json.vnp_TransactionStatus ?? '99',
        vnp_Command: 'refund',
        gatewayResponseCode: json.vnp_ResponseCode,
        gatewayMessage: json.vnp_Message,
      };
    }

    // 2. Đối chiếu đầy đủ merchant, mã tham chiếu, số tiền, lệnh và loại giao dịch với yêu cầu đã lưu
    const isMerchantMatched = json.vnp_TmnCode === config.tmnCode;
    const isTxnRefMatched = json.vnp_TxnRef === input.txnRef;
    const isAmountMatched = json.vnp_Amount === amountStr;
    const isCommandMatched = json.vnp_Command === command;
    const isTxTypeMatched = json.vnp_TransactionType === transactionType;
    const isOrderInfoMatched = !json.vnp_OrderInfo || json.vnp_OrderInfo === orderInfo;

    if (
      !isMerchantMatched ||
      !isTxnRefMatched ||
      !isAmountMatched ||
      !isCommandMatched ||
      !isTxTypeMatched ||
      !isOrderInfoMatched
    ) {
      return {
        outcome: 'UNCERTAIN',
        vnp_ResponseCode: json.vnp_ResponseCode ?? '99',
        vnp_Message:
          'Phản hồi hoàn tiền từ cổng VNPay thiếu hoặc sai thông tin giao dịch (merchant, mã tham chiếu, số tiền hoặc loại giao dịch)',
        vnp_TmnCode: json.vnp_TmnCode ?? '',
        vnp_TxnRef: json.vnp_TxnRef ?? '',
        vnp_Amount: json.vnp_Amount ?? '',
        vnp_BankCode: json.vnp_BankCode ?? '',
        vnp_PayDate: json.vnp_PayDate ?? createDate,
        vnp_TransactionNo: json.vnp_TransactionNo ?? input.transactionNo,
        vnp_TransactionType: json.vnp_TransactionType ?? '',
        vnp_TransactionStatus: json.vnp_TransactionStatus ?? '99',
        vnp_Command: 'refund',
        gatewayResponseCode: json.vnp_ResponseCode,
        gatewayMessage: json.vnp_Message,
      };
    }

    const responseCode = json.vnp_ResponseCode ?? '';
    const transactionStatus = json.vnp_TransactionStatus ?? '';

    // 3. Chỉ xác nhận hoàn tiền thành công khi cả vnp_ResponseCode === '00' VÀ vnp_TransactionStatus === '00'
    const isConfirmedSuccess = responseCode === '00' && transactionStatus === '00';

    // Mã 05 (VNPay đang xử lý hoàn tiền), 06 (VNPay đã gửi hoàn tiền sang ngân hàng),
    // 94 (yêu cầu hoàn tiền trước đó đang được xử lý), 01, 08, 99 hoặc responseCode = '00' nhưng thiếu/sai transactionStatus
    // đều được giữ ở trạng thái chờ đối soát (UNCERTAIN -> PENDING_RECONCILIATION), không mở khóa và không gửi hoàn tiền lặp
    const isUncertain =
      !isConfirmedSuccess &&
      (responseCode === '00' ||
        ['05', '06', '08', '94', '99'].includes(responseCode) ||
        isVnPayRefundProcessingStatus(transactionStatus) ||
        responseCode.length === 0 ||
        transactionStatus.length === 0);

    return {
      outcome: isConfirmedSuccess ? 'SUCCEEDED' : isUncertain ? 'UNCERTAIN' : 'REJECTED',
      vnp_ResponseCode: responseCode || '99',
      vnp_Message: json.vnp_Message ?? (isConfirmedSuccess ? 'Refund Success' : 'Refund Failed'),
      vnp_TmnCode: json.vnp_TmnCode,
      vnp_TxnRef: json.vnp_TxnRef,
      vnp_Amount: json.vnp_Amount,
      vnp_BankCode: json.vnp_BankCode ?? '',
      vnp_PayDate: json.vnp_PayDate ?? createDate,
      vnp_TransactionNo: json.vnp_TransactionNo ?? input.transactionNo,
      vnp_TransactionType: json.vnp_TransactionType,
      vnp_TransactionStatus: transactionStatus || responseCode || '99',
      vnp_Command: 'refund',
      gatewayResponseCode: json.vnp_ResponseCode,
      gatewayMessage: json.vnp_Message,
    };
  }

  private describeResponseCode(code: string): string {
    switch (code) {
      case '00':
        return 'Giao dịch thành công';
      case '07':
        return 'Trừ tiền thành công. Giao dịch bị nghi ngờ (liên quan tới lừa đảo, giao dịch bất thường).';
      case '09':
        return 'Thẻ/Tài khoản chưa đăng ký dịch vụ Internet Banking tại ngân hàng.';
      case '10':
        return 'Xác thực thông tin thẻ/tài khoản không đúng quá 3 lần.';
      case '11':
        return 'Đã hết hạn chờ thanh toán. Vui lòng thực hiện lại giao dịch.';
      case '12':
        return 'Thẻ/Tài khoản bị khóa.';
      case '13':
        return 'Quý khách nhập sai mật khẩu xác thực OTP. Vui lòng thực hiện lại giao dịch.';
      case '24':
        return 'Giao dịch bị hủy bởi khách hàng.';
      case '51':
        return 'Tài khoản của quý khách không đủ số dư để thực hiện giao dịch.';
      case '65':
        return 'Tài khoản đã vượt quá hạn mức giao dịch trong ngày.';
      case '75':
        return 'Ngân hàng thanh toán đang bảo trì.';
      case '79':
        return 'Nhập sai mật khẩu thanh toán quá số lần quy định.';
      default:
        return 'Giao dịch không thành công hoặc xảy ra lỗi trong quá trình xử lý.';
    }
  }
}

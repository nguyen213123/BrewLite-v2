import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../../common/errors/api-error';

export interface StripeCheckoutResult {
  sessionId: string;
  url: string;
  expiresAt?: string;
}

export interface StripeSessionVerifyResult {
  isValid: boolean;
  isPaid: boolean;
  orderId: string;
  orderCode: string;
  stripeRef?: string;
  amount: number;
  paymentIntentId?: string;
  message: string;
}

export interface StripeRefundResult {
  outcome: 'SUCCESS' | 'FAILED' | 'UNCERTAIN';
  refundId?: string;
  status?: string;
  message?: string;
}

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);

  constructor(private readonly config: ConfigService) {}

  verifyWebhook(rawBody: Buffer | undefined, signature: string | undefined): { type: string; sessionId?: string } {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET') || process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new ApiError(503, 'STRIPE_WEBHOOK_CONFIG_MISSING', 'Chưa cấu hình khóa xác thực Stripe webhook');
    if (!rawBody || !signature) throw new ApiError(400, 'STRIPE_WEBHOOK_INVALID_SIGNATURE', 'Thiếu chữ ký Stripe webhook');
    const parts = signature.split(',').map(part => part.trim().split('='));
    const timestamp = parts.find(([key]) => key === 't')?.[1] ?? '';
    const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
    const valid = /^\d+$/.test(timestamp) && Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300 &&
      parts.some(([key, value]) => key === 'v1' && /^[0-9a-f]{64}$/i.test(value ?? '') &&
        timingSafeEqual(expected, Buffer.from(value, 'hex')));
    if (!valid) throw new ApiError(400, 'STRIPE_WEBHOOK_INVALID_SIGNATURE', 'Chữ ký Stripe webhook không hợp lệ hoặc đã hết hạn');
    let event: { type?: unknown; data?: { object?: { id?: unknown } } };
    try { event = JSON.parse(rawBody.toString('utf8')) as typeof event; }
    catch { throw new ApiError(400, 'STRIPE_WEBHOOK_INVALID_EVENT', 'Dữ liệu Stripe webhook không hợp lệ'); }
    if (!event || typeof event.type !== 'string') throw new ApiError(400, 'STRIPE_WEBHOOK_INVALID_EVENT', 'Thiếu loại sự kiện Stripe');
    if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return { type: event.type };
    const id = event.data?.object?.id;
    if (typeof id !== 'string' || !id.startsWith('cs_') || id.length > 255) {
      throw new ApiError(400, 'STRIPE_WEBHOOK_INVALID_EVENT', 'Thiếu mã phiên thanh toán Stripe');
    }
    return { type: event.type, sessionId: id };
  }

  private getSecretKey(): string {
    const key =
      this.config.get<string>('STRIPE_SECRET_KEY') ||
      process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_CONFIG_MISSING: Stripe secret key is missing');
    }
    return key;
  }

  /**
   * Tạo Checkout Session cho khách hàng thanh toán qua Stripe.
   */
  async createCheckoutSession(params: {
    orderId: string;
    orderCode: string;
    amount: number;
    stripeRef?: string;
    items?: Array<{ name: string; quantity: number; price: number }>;
  }): Promise<StripeCheckoutResult> {
    const secretKey = this.getSecretKey();
    const returnUrl =
      this.config.get<string>('STRIPE_RETURN_URL') ||
      process.env.STRIPE_RETURN_URL ||
      'http://localhost:3000/payments/stripe-return';

    const clientRef = params.stripeRef || params.orderId;
    const bodyObj: Record<string, string> = {
      mode: 'payment',
      success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000'}/orders/${params.orderId}`,
      client_reference_id: clientRef,
      'metadata[orderId]': params.orderId,
      'metadata[orderCode]': params.orderCode,
      'metadata[stripeRef]': clientRef,
      'line_items[0][price_data][currency]': 'vnd',
      'line_items[0][price_data][product_data][name]': `Đơn hàng ${params.orderCode}`,
      'line_items[0][price_data][unit_amount]': String(params.amount),
      'line_items[0][quantity]': '1',
      expires_at: String(Math.floor(Date.now() / 1000) + 31 * 60),
    };

    const payload = new URLSearchParams(bodyObj).toString();

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': clientRef,
      },
      body: payload,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errText = await response.text();
      this.logger.error(`Stripe create checkout error: ${errText}`);
      throw new Error(`Stripe error: ${response.statusText}`);
    }

    const data = (await response.json()) as { id: string; url: string; expires_at?: number };
    return {
      sessionId: data.id,
      url: data.url,
      expiresAt: new Date((data.expires_at ?? Math.floor(Date.now() / 1000) + 31 * 60) * 1000).toISOString(),
    };
  }

  /**
   * Xác thực trạng thái Session khi khách hàng quay lại trang stripe-return.
   */
  async verifySession(sessionId: string): Promise<StripeSessionVerifyResult> {
    const secretKey = this.getSecretKey();

    try {
      const response = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${secretKey}`,
          },
          signal: AbortSignal.timeout(10000),
        },
      );

      if (!response.ok) {
        return {
          isValid: false,
          isPaid: false,
          orderId: '',
          orderCode: '',
          amount: 0,
          message: `Không tìm thấy phiên thanh toán Stripe: ${response.statusText}`,
        };
      }

      const data = (await response.json()) as {
        payment_status: string;
        status: string;
        client_reference_id?: string;
        metadata?: { orderId?: string; orderCode?: string; stripeRef?: string };
        amount_total?: number;
        payment_intent?: string;
      };

      const amount = data.amount_total ?? -1;
      const isValidAmount = Number.isSafeInteger(amount) && amount >= 0;
      const isPaid = isValidAmount && data.status === 'complete' &&
        (data.payment_status === 'paid' || (data.payment_status === 'no_payment_required' && amount === 0));
      const orderId = data.metadata?.orderId || data.client_reference_id || '';
      const orderCode = data.metadata?.orderCode || '';
      const stripeRef = data.metadata?.stripeRef || data.client_reference_id || '';

      return {
        isValid: isValidAmount,
        isPaid,
        orderId,
        orderCode,
        stripeRef,
        amount,
        paymentIntentId: data.payment_intent,
        message: isPaid ? 'Thanh toán Stripe thành công' : 'Chưa hoàn tất thanh toán Stripe',
      };
    } catch (err) {
      return {
        isValid: false,
        isPaid: false,
        orderId: '',
        orderCode: '',
        amount: 0,
        message: err instanceof Error ? err.message : 'Lỗi kết nối tới Stripe',
      };
    }
  }

  /**
   * Gọi API Hoàn tiền (Refund) sang Stripe khi đơn hàng bị hủy.
   */
  async refundPayment(params: {
    paymentIntentId?: string;
    chargeId?: string;
    amount?: number;
    reason?: string;
    idempotencyKey?: string;
    refundId?: string;
  }): Promise<StripeRefundResult> {
    if (params.amount !== undefined && (!Number.isSafeInteger(params.amount) || params.amount <= 0)) {
      return { outcome: 'FAILED', message: 'Số tiền hoàn phải là số nguyên dương; đơn miễn phí không gọi API hoàn tiền' };
    }
    const secretKey = this.getSecretKey();

    const bodyObj: Record<string, string> = {};
    if (params.paymentIntentId) {
      bodyObj.payment_intent = params.paymentIntentId;
    } else if (params.chargeId) {
      bodyObj.charge = params.chargeId;
    } else if (!params.refundId) {
      return {
        outcome: 'FAILED',
        message: 'Thiếu payment_intent hoặc charge ID để hoàn tiền',
      };
    }

    if (params.amount && params.amount > 0) {
      bodyObj.amount = String(params.amount);
    }

    const payload = new URLSearchParams(bodyObj).toString();

    try {
      const response = await fetch(params.refundId
        ? `https://api.stripe.com/v1/refunds/${encodeURIComponent(params.refundId)}`
        : 'https://api.stripe.com/v1/refunds', {
        method: params.refundId ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : {}),
        },
        body: params.refundId ? undefined : payload,
        signal: AbortSignal.timeout(10000),
      });

      const data = (await response.json()) as {
        id?: string;
        status?: string;
        error?: { message?: string };
      };

      if (!response.ok) {
        return {
          outcome: response.status >= 500 || response.status === 409 || params.refundId ? 'UNCERTAIN' : 'FAILED',
          message: data.error?.message || response.statusText,
        };
      }

      if (data.status === 'succeeded') {
        return {
          outcome: 'SUCCESS',
          refundId: data.id,
          status: data.status,
          message: 'Hoàn tiền qua Stripe thành công',
        };
      }

      return {
        outcome: data.status === 'failed' || data.status === 'canceled' ? 'FAILED' : 'UNCERTAIN',
        refundId: data.id,
        status: data.status,
        message: `Trạng thái hoàn tiền Stripe: ${data.status}`,
      };
    } catch (err) {
      return {
        outcome: 'UNCERTAIN',
        message: err instanceof Error ? err.message : 'Lỗi kết nối hoàn tiền tới Stripe',
      };
    }
  }
}

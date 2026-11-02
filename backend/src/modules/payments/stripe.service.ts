import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface StripeCheckoutResult {
  sessionId: string;
  url: string;
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
    };

    const payload = new URLSearchParams(bodyObj).toString();

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: payload,
    });

    if (!response.ok) {
      const errText = await response.text();
      this.logger.error(`Stripe create checkout error: ${errText}`);
      throw new Error(`Stripe error: ${response.statusText}`);
    }

    const data = (await response.json()) as { id: string; url: string };
    return {
      sessionId: data.id,
      url: data.url,
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

      const isPaid = data.payment_status === 'paid' && data.status === 'complete';
      const orderId = data.metadata?.orderId || data.client_reference_id || '';
      const orderCode = data.metadata?.orderCode || '';
      const stripeRef = data.metadata?.stripeRef || data.client_reference_id || '';
      const amount = data.amount_total || 0;

      return {
        isValid: true,
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
  }): Promise<StripeRefundResult> {
    const secretKey = this.getSecretKey();

    const bodyObj: Record<string, string> = {};
    if (params.paymentIntentId) {
      bodyObj.payment_intent = params.paymentIntentId;
    } else if (params.chargeId) {
      bodyObj.charge = params.chargeId;
    } else {
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
      const response = await fetch('https://api.stripe.com/v1/refunds', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: payload,
      });

      const data = (await response.json()) as {
        id?: string;
        status?: string;
        error?: { message?: string };
      };

      if (!response.ok) {
        return {
          outcome: 'FAILED',
          message: data.error?.message || response.statusText,
        };
      }

      if (data.status === 'succeeded' || data.status === 'pending') {
        return {
          outcome: 'SUCCESS',
          refundId: data.id,
          status: data.status,
          message: 'Hoàn tiền qua Stripe thành công',
        };
      }

      return {
        outcome: 'UNCERTAIN',
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

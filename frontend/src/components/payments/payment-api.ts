// Owner: TV5 — #10. Client API & helpers for cashless mock payment (WALLET/CARD) & Idempotency-Key.
import type * as Api from '../../lib/contracts/api.generated';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export type PaymentExecutionOutcome = {
  result: Api.PaymentResult;
  replayed: boolean;
  latestOrder: Api.Order | null;
  verified: boolean;
  verificationError?: string;
};

export class PaymentClientError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Api.Error['details'];
  readonly retryAfterSeconds: number | null;

  constructor(payload: Api.Error, retryAfterSeconds: number | null = null) {
    super(payload.message);
    this.name = 'PaymentClientError';
    this.statusCode = payload.statusCode;
    this.code = payload.code;
    this.details = payload.details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function createPaymentIdempotencyKey(): string {
  return crypto.randomUUID().toLowerCase();
}

export function formatVnd(amount: number): string {
  return `${Math.max(0, Math.trunc(amount)).toLocaleString('vi-VN')} ₫`;
}

export function calculateExpectedLoyaltyPoints(totalVnd: number): number {
  return Math.max(0, Math.floor(Math.trunc(totalVnd) / 10_000));
}

export async function fetchCurrentOrder(orderId: string, accessToken: string): Promise<Api.Order> {
  const response = await fetch(`${apiUrl}/orders/${encodeURIComponent(orderId.trim().toLowerCase())}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as Api.Error | null;
    throw new PaymentClientError(
      errorBody ?? {
        statusCode: response.status,
        code: 'ORDER_FETCH_FAILED',
        message: 'Không thể tải trạng thái đơn hàng hiện tại',
        details: [],
      },
    );
  }

  return (await response.json()) as Api.Order;
}

/**
 * Calls POST /api/payments with Idempotency-Key.
 * Per business-rules.md 7.9: after a replay (Idempotency-Replayed: true),
 * always fetches GET /api/orders/{id} to verify current order status before clearing cart.
 */
export async function submitPayment(options: {
  accessToken: string;
  idempotencyKey: string;
  request: Api.PaymentRequest;
}): Promise<PaymentExecutionOutcome> {
  const normalizedKey = options.idempotencyKey.trim().toLowerCase();
  const payload: Api.PaymentRequest = {
    orderId: options.request.orderId.trim().toLowerCase(),
    method: options.request.method,
    mockOutcome: options.request.mockOutcome ?? 'SUCCESS',
  };

  const response = await fetch(`${apiUrl}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.accessToken}`,
      'Idempotency-Key': normalizedKey,
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    const retryAfterHeader = response.headers.get('Retry-After');
    const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : null;
    const errorBody = (await response.json().catch(() => null)) as Api.Error | null;
    throw new PaymentClientError(
      errorBody ?? {
        statusCode: response.status,
        code: 'PAYMENT_REQUEST_FAILED',
        message: 'Không thể xử lý yêu cầu thanh toán',
        details: [],
      },
      Number.isNaN(retryAfterSeconds) ? null : retryAfterSeconds,
    );
  }

  const replayed = response.headers.get('Idempotency-Replayed') === 'true';
  const result = (await response.json()) as Api.PaymentResult;

  let latestOrder: Api.Order | null = null;
  let verified = true;
  let verificationError: string | undefined;

  if (replayed) {
    try {
      latestOrder = await fetchCurrentOrder(payload.orderId, options.accessToken);
      verified = true;
    } catch (error: unknown) {
      // Per business-rules.md 7.9: DO NOT reuse stale snapshot from result.order
      // when fresh order status fetch fails after replay!
      verified = false;
      latestOrder = null;
      verificationError =
        error instanceof PaymentClientError
          ? error.message
          : 'Không thể xác minh trạng thái đơn hàng mới nhất sau khi nhận phản hồi replay.';
    }
  } else {
    latestOrder = result.order;
    verified = true;
  }

  return {
    result,
    replayed,
    latestOrder,
    verified,
    verificationError,
  };
}

/**
 * Re-attempts verification of a replayed order without re-charging.
 */
export async function verifyReplayedOrder(
  orderId: string,
  accessToken: string,
): Promise<{ order: Api.Order; verified: boolean }> {
  const order = await fetchCurrentOrder(orderId, accessToken);
  return { order, verified: true };
}

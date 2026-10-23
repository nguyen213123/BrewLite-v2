import type { Error as ApiErrorBody } from '@/lib/contracts/api.generated';

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(/\/+$/, '');
const DEFAULT_TIMEOUT_MS = 10_000;

/** Lỗi do backend trả về theo error envelope trong docs/api/README.md. Client xử lý theo `code`, không parse `message`. */
export class ApiError extends Error {
  status: number;
  code: string;
  details: ApiErrorBody['details'];
  retryAfterSeconds: number | null;

  constructor(status: number, code: string, message: string, details: ApiErrorBody['details'], retryAfterSeconds: number | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Không nhận được phản hồi (mất mạng, timeout, CORS). Kết quả phía server là chưa biết. */
export class NetworkError extends Error {
  constructor(message = 'Không kết nối được máy chủ') {
    super(message);
    this.name = 'NetworkError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  token?: string | null;
  body?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ApiResult<T> {
  data: T;
  /** Header Idempotency-Replayed: true khi backend trả lại kết quả cũ của cùng key. */
  replayed: boolean;
}

function parseErrorBody(raw: unknown, status: number): { code: string; message: string; details: ApiErrorBody['details'] } {
  if (raw && typeof raw === 'object') {
    const body = raw as Partial<ApiErrorBody>;
    return {
      code: typeof body.code === 'string' ? body.code : `HTTP_${status}`,
      message: typeof body.message === 'string' ? body.message : 'Yêu cầu thất bại',
      details: Array.isArray(body.details) ? body.details : [],
    };
  }
  return { code: `HTTP_${status}`, message: 'Yêu cầu thất bại', details: [] };
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const { method = 'GET', token, body, idempotencyKey, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', forwardAbort, { once: true });
  }

  try {
    let response: Response;
    try {
      response = await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch (error) {
      // Người gọi chủ động hủy (đổi trang, unmount): để họ tự bỏ qua.
      if (signal?.aborted && !timedOut) throw error;
      throw new NetworkError(timedOut ? 'Máy chủ phản hồi quá lâu' : undefined);
    }

    const replayed = response.headers.get('Idempotency-Replayed') === 'true';
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const { code, message, details } = parseErrorBody(parsed, response.status);
      const retryAfter = Number(response.headers.get('Retry-After'));
      throw new ApiError(response.status, code, message, details, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
    }
    return { data: parsed as T, replayed };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

const MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: 'Dữ liệu chưa hợp lệ, vui lòng kiểm tra lại.',
  UNAUTHORIZED: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.',
  PRODUCT_NOT_FOUND: 'Sản phẩm không còn tồn tại.',
  ORDER_NOT_FOUND: 'Không tìm thấy đơn hàng.',
  OUT_OF_STOCK: 'Một số sản phẩm không đủ số lượng. Vui lòng giảm số lượng hoặc chọn món khác.',
  STOCK_CONFLICT: 'Nhiều khách đang đặt cùng lúc, vui lòng thử lại sau ít giây.',
  PROMOTION_EXHAUSTED: 'Mã giảm giá đã hết lượt sử dụng.',
  PROMOTION_INVALID: 'Mã giảm giá không hợp lệ hoặc chưa đủ điều kiện áp dụng.',
  PRODUCT_UNAVAILABLE: 'Có sản phẩm đã ngừng bán. Vui lòng xóa khỏi giỏ hàng.',
  INVALID_PRODUCT_OPTION: 'Size hoặc topping đã thay đổi. Vui lòng chọn lại sản phẩm.',
  ORDER_NOT_PAYABLE: 'Đơn hàng này không còn có thể thanh toán.',
  INVALID_ORDER_TRANSITION: 'Trạng thái đơn hàng đã thay đổi, vui lòng tải lại.',
  ORDER_VERSION_CONFLICT: 'Đơn hàng vừa được cập nhật, vui lòng tải lại.',
  IDEMPOTENCY_IN_PROGRESS: 'Yêu cầu đang được xử lý, vui lòng chờ giây lát.',
  IDEMPOTENCY_KEY_REUSED: 'Yêu cầu bị trùng khóa với nội dung khác. Vui lòng thử lại.',
  FEATURE_NOT_IMPLEMENTED: 'Chức năng này chưa sẵn sàng trên máy chủ.',
  INTERNAL_ERROR: 'Máy chủ gặp lỗi, vui lòng thử lại sau.',
};

/** Thông báo tiếng Việt cho người dùng, chọn theo `code` của backend. */
export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) return MESSAGES[error.code] ?? 'Yêu cầu không thành công, vui lòng thử lại.';
  if (error instanceof NetworkError) return `${error.message}. Kiểm tra kết nối rồi thử lại.`;
  return 'Đã xảy ra lỗi không mong muốn.';
}

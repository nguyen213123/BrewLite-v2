export type CheckoutErrorKind = 'network' | 'auth' | 'stock' | 'selection' | 'promotion' | 'order' | 'unknown';

export type CheckoutErrorInfo = {
  kind: CheckoutErrorKind;
  message: string;
  /** true khi chưa biết server đã xử lý yêu cầu hay chưa: không được hiển thị như thành công. */
  uncertain: boolean;
};

type ErrorLike = { statusCode?: unknown; code?: unknown; message?: unknown; name?: unknown };

const NETWORK_NAMES = ['TypeError', 'AbortError', 'TimeoutError'];

function asErrorLike(error: unknown): ErrorLike {
  return typeof error === 'object' && error !== null ? (error as ErrorLike) : {};
}

/**
 * Chuyển lỗi từ apiFetch (ApiRequestError) hoặc lỗi mạng của fetch thành thông báo cho người dùng.
 * Lỗi không có mã HTTP (mất mạng, timeout) luôn là "uncertain": POST có thể đã được server ghi nhận.
 */
export function describeCheckoutError(error: unknown): CheckoutErrorInfo {
  const e = asErrorLike(error);
  const code = typeof e.code === 'string' ? e.code : '';
  const statusCode = typeof e.statusCode === 'number' ? e.statusCode : 0;
  const serverMessage = typeof e.message === 'string' ? e.message : '';
  const name = typeof e.name === 'string' ? e.name : '';

  if (!statusCode && !code && NETWORK_NAMES.includes(name)) {
    return {
      kind: 'network',
      uncertain: true,
      message: 'Lỗi mạng hoặc quá thời gian chờ nên chưa xác nhận được kết quả. Giỏ hàng được giữ nguyên; hãy bấm xác minh lại hoặc gửi lại cùng yêu cầu.',
    };
  }

  switch (code) {
    case 'OUT_OF_STOCK':
    case 'STOCK_CONFLICT':
      return {
        kind: 'stock', uncertain: false,
        message: 'Một hoặc nhiều món đã hết hàng hoặc không đủ số lượng. Hãy giảm số lượng hoặc xóa món đó khỏi giỏ rồi tính giá lại. Giỏ hàng vẫn được giữ.',
      };
    case 'INVALID_SELECTION':
    case 'PRODUCT_NOT_FOUND':
      return {
        kind: 'selection', uncertain: false,
        message: 'Có món, size hoặc topping không còn hợp lệ hoặc đã ngừng bán. Hãy xóa dòng đó và chọn lại từ menu, sau đó tính giá lại.',
      };
    case 'PROMOTION_INVALID':
      return { kind: 'promotion', uncertain: false, message: 'Mã khuyến mãi không hợp lệ, đã hết hạn hoặc đơn chưa đủ điều kiện áp dụng. Hãy kiểm tra lại mã hoặc bỏ mã để tiếp tục.' };
    case 'PROMOTION_EXHAUSTED':
      return { kind: 'promotion', uncertain: false, message: 'Mã khuyến mãi đã hết lượt sử dụng. Hãy bỏ mã để tiếp tục.' };
    case 'ORDER_NOT_PAYABLE':
    case 'ORDER_VERSION_CONFLICT':
    case 'INVALID_ORDER_TRANSITION':
      return { kind: 'order', uncertain: false, message: 'Trạng thái đơn đã thay đổi. Hãy bấm xác minh lại để xem trạng thái hiện tại của đơn.' };
    case 'UNAUTHORIZED':
      return { kind: 'auth', uncertain: false, message: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại; yêu cầu đang chờ và giỏ hàng vẫn được giữ.' };
    default:
      break;
  }
  if (statusCode === 401) {
    return { kind: 'auth', uncertain: false, message: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại; yêu cầu đang chờ và giỏ hàng vẫn được giữ.' };
  }
  if (!statusCode && !code) {
    // Lỗi do logic client (ví dụ session từ chối thao tác): giữ nguyên nội dung đã được viết cho người dùng.
    return { kind: 'unknown', uncertain: false, message: serverMessage || 'Không thể xử lý yêu cầu. Hãy thử lại.' };
  }
  return { kind: 'unknown', uncertain: statusCode >= 500, message: serverMessage || 'Không thể xử lý yêu cầu. Hãy thử lại.' };
}

export type PriceCheck = { changed: boolean; quotedTotal?: number; orderTotal: number; difference: number };

/** So sánh tổng đã báo giá với tổng server dùng khi tạo đơn (VND nguyên). */
export function comparePrice(quotedTotal: number | undefined, orderTotal: number): PriceCheck {
  if (typeof quotedTotal !== 'number') return { changed: false, orderTotal, difference: 0 };
  return { changed: quotedTotal !== orderTotal, quotedTotal, orderTotal, difference: orderTotal - quotedTotal };
}

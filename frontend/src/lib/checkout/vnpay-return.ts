import type { CheckoutState } from './session';
import type { Order, OrderStatus } from '../contracts/api.generated';
import type { PurchasedLine } from '../cart/cart-store';

const PAID_ORDER_STATUSES: readonly OrderStatus[] = ['PAID', 'PREPARING', 'READY', 'COMPLETED'];

export interface VnPayVerifyResponse {
  success: boolean;
  message: string;
  orderCode: string;
  orderId?: string;
  orderStatus?: OrderStatus;
  amount?: number;
  bankCode?: string;
  transactionNo?: string;
  responseCode?: string;
}

export interface VnPayReturnReconcileDeps {
  userId?: string | null;
  readSession: (storageKey: string) => string | null;
  writeSession: (storageKey: string, value: string) => void;
  findOrder: (orderId: string) => Promise<Order>;
  settleOrder: (orderId: string, purchased: PurchasedLine[]) => void;
}

/**
 * Xác minh trạng thái đơn hàng hiện tại từ máy chủ sau khi nhận kết quả VNPay Return,
 * và chỉ khấu trừ đúng các dòng sản phẩm đã chọn mua thuộc đơn hàng đó (settleOrder).
 * Tuyệt đối không gọi clear() xóa toàn bộ giỏ hàng.
 */
export async function reconcileVnPayReturnOrder(
  verifyResult: VnPayVerifyResponse,
  deps: VnPayReturnReconcileDeps,
): Promise<{ settled: boolean; currentOrder?: Order }> {
  if (!verifyResult.success || !verifyResult.orderId) {
    return { settled: false };
  }

  let currentOrder: Order | undefined;
  try {
    currentOrder = await deps.findOrder(verifyResult.orderId);
  } catch {
    // Nếu không xác minh được đơn hàng từ máy chủ, không tự ý trừ giỏ hàng chỉ dựa vào res.success
    return { settled: false };
  }

  // Chỉ trừ giỏ hàng khi đơn hàng thực sự đang ở trạng thái đã thanh toán (PAID, PREPARING, READY, COMPLETED).
  // Nếu đơn đã bị hủy hoặc hoàn tiền (CANCELLED), hoặc đang PENDING / PAYMENT_FAILED thì giữ nguyên giỏ hàng.
  if (!currentOrder || !PAID_ORDER_STATUSES.includes(currentOrder.status)) {
    return { settled: false, currentOrder };
  }

  if (!deps.userId) {
    return { settled: false, currentOrder };
  }

  const storageKey = `brewlite-checkout:${deps.userId}`;
  let saved: CheckoutState | null = null;
  try {
    saved = JSON.parse(deps.readSession(storageKey) ?? 'null') as CheckoutState | null;
  } catch {
    saved = null;
  }

  // Chỉ loại bỏ các dòng thuộc đúng đơn hàng vừa thanh toán (saved.orderId === currentOrder.id).
  // Nếu người dùng mở lại URL callback cũ của một đơn khác, không trừ nhầm giỏ hàng hiện tại.
  if (
    !saved ||
    saved.userId !== deps.userId ||
    saved.orderId !== currentOrder.id ||
    !Array.isArray(saved.purchased) ||
    saved.purchased.length === 0
  ) {
    return { settled: false, currentOrder };
  }

  saved.order = currentOrder;
  deps.writeSession(storageKey, JSON.stringify(saved));
  deps.settleOrder(currentOrder.id, saved.purchased);

  return { settled: true, currentOrder };
}

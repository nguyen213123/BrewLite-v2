import type { Order, OrderRequest, PaymentRequest, PaymentResult, Quote } from '../contracts/api.generated';
import type { PurchasedLine } from '../cart/cart-store';

export const paidStatuses = ['PAID', 'PREPARING', 'READY', 'COMPLETED'];
export function createCheckoutLifecycle() {
  let active = true, busy = false;
  return {
    isActive: () => active,
    setActive: (value: boolean) => { active = value; },
    acquire: () => { if (busy) return false; busy = true; return true; },
    release: () => { busy = false; },
  };
}
export type CheckoutState = {
  userId: string;
  request?: OrderRequest;
  purchased: PurchasedLine[];
  createKey?: string;
  createUncertain?: boolean;
  orderId?: string;
  order?: Order;
  attempt?: { key: string; request: PaymentRequest };
};
export type CheckoutDependencies = {
  read: () => string | null;
  write: (value: string) => void;
  key: () => string;
  quote: (request: OrderRequest) => Promise<Quote>;
  create: (key: string, request: OrderRequest) => Promise<Order>;
  pay: (key: string, request: PaymentRequest) => Promise<PaymentResult>;
  find: (id: string) => Promise<Order>;
  settle: (orderId: string, purchased: PurchasedLine[]) => void;
  active: () => boolean;
};

// Persist the immutable intent BEFORE each POST. A timeout or reload retries the same key/payload.
export function createCheckoutSession(userId: string, deps: CheckoutDependencies) {
  let state: CheckoutState = { userId, purchased: [] };
  try {
    const saved = JSON.parse(deps.read() ?? 'null') as CheckoutState | null;
    if (saved?.userId === userId && Array.isArray(saved.purchased)) state = saved;
  } catch { /* Ignore malformed browser storage; never trust it as a payment confirmation. */ }
  let busy = false;
  let verified = false;
  const save = () => deps.write(JSON.stringify(state));
  async function exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (!deps.active()) throw new Error('Phiên đăng nhập đã thay đổi. Vui lòng đăng nhập lại.');
    if (busy) throw new Error('Yêu cầu đang xử lý.');
    busy = true;
    try { return await work(); } finally { busy = false; }
  }
  async function refresh() {
    verified = false;
    if (!state.orderId) return;
    const fresh = await deps.find(state.orderId);
    if (!deps.active()) throw new Error('Phiên đăng nhập đã thay đổi.');
    state.order = fresh;
    save();
    verified = true;
    if (paidStatuses.includes(fresh.status)) deps.settle(fresh.id, state.purchased);
    return fresh;
  }
  return {
    snapshot: () => ({ ...state, verified }),
    resume: (orderId: string) => exclusive(async () => {
      if (state.createUncertain && !state.orderId) throw new Error('Hãy khôi phục yêu cầu tạo đơn đang chờ trước.');
      if (state.orderId && state.orderId !== orderId) {
        await refresh();
        if (!state.order || ![...paidStatuses, 'CANCELLED'].includes(state.order.status)) {
          throw new Error('Hãy hoàn tất hoặc hủy đơn đang mở trước khi tiếp tục đơn từ lịch sử.');
        }
      }
      if (state.orderId !== orderId) {
        const fresh = await deps.find(orderId);
        if (!deps.active()) throw new Error('Phiên đăng nhập đã thay đổi.');
        // Without the original cart snapshot, never deduct the current cart by matching product keys.
        state = { userId, orderId, order: fresh, purchased: [] }; save();
        verified = true;
        return fresh;
      }
      return refresh();
    }),
    quote: (request: OrderRequest) => exclusive(() => deps.quote(request)),
    create: (request: OrderRequest, purchased: PurchasedLine[]) => exclusive(async () => {
      if (!state.request) {
        state = { userId, request: structuredClone(request), purchased: structuredClone(purchased),
          createKey: deps.key(), createUncertain: false };
        save();
      }
      if (!state.orderId) {
        const previousCreateWasUncertain = state.createUncertain === true;
        state.createUncertain = true;
        save();
        try {
          const order = await deps.create(state.createKey!, state.request!);
          state.orderId = order.id;
          state.order = order;
          state.createUncertain = false;
          save();
        } catch (error) {
          const e = error as { statusCode?: number; code?: string };
          // A rejected retry says nothing about an earlier POST whose response was lost.
          // In particular a 401 happens before the idempotency lookup. Keep its original
          // key/payload through re-login until the server can recover that same request.
          const definitelyRejected = [400, 401, 403, 404, 409, 422].includes(e.statusCode ?? 0) &&
            !e.code?.startsWith('IDEMPOTENCY_');
          if (!previousCreateWasUncertain && definitelyRejected) {
            state.createUncertain = false;
            save();
          }
          throw error;
        }
      }
      // Even a replayed create may contain an old PENDING snapshot.
      return refresh();
    }),
    verify: () => exclusive(refresh),
    pay: (method: PaymentRequest['method'], mockOutcome: 'SUCCESS' | 'FAIL', newAttempt = false) => exclusive(async () => {
      if (!verified || !state.orderId || !state.order) throw new Error('Hãy xác minh trạng thái đơn trước khi thanh toán.');
      if (paidStatuses.includes(state.order.status) || state.order.status === 'CANCELLED') {
        throw new Error('Đơn không còn ở trạng thái thanh toán.');
      }
      if (newAttempt && state.order.status !== 'PAYMENT_FAILED') throw new Error('Chỉ tạo lần thử mới sau khi xác nhận thanh toán thất bại.');
      if (!state.attempt || newAttempt) {
        state.attempt = { key: deps.key(), request: { orderId: state.orderId, method, mockOutcome } };
        save();
      }
      verified = false;
      // Always GET the current order after POST, including replay. If either request fails,
      // keep the original intent and the cart; the user can verify or retry that same attempt.
      await deps.pay(state.attempt.key, state.attempt.request);
      return refresh();
    }),
    startOver: () => {
      if (busy || (state.createUncertain && !state.orderId) ||
        (state.orderId && (!verified || !state.order || ![...paidStatuses, 'CANCELLED'].includes(state.order.status)))) {
        throw new Error('Cần xác minh hoặc hủy đơn hiện tại trước khi tạo đơn khác.');
      }
      state = { userId, purchased: [] };
      verified = false;
      save();
    },
  };
}

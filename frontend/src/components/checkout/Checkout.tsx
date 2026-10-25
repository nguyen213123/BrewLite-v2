'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiGet, apiPost } from '@/lib/api';
import { getToken, getUser, getAuthSnapshot, getAuthServerSnapshot, subscribeAuth, updateUserPoints } from '@/lib/auth';
import { useCartStore, useCartHydrated, toCartItems } from '@/lib/cart/cart-store';
import { createCheckoutSession, createCheckoutLifecycle, paidStatuses } from '@/lib/checkout/session';
import { describeCheckoutError, comparePrice } from '@/lib/checkout/errors';
import type { Order, OrderStatus, PaymentMethod, Quote, User } from '@/lib/contracts/api.generated';
import { formatVnd } from '@/components/payments/payment-api';

const ORDER_STATUS_LABELS: Record<OrderStatus, { label: string; className: string }> = {
  PENDING: { label: 'Chờ thanh toán (PENDING)', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  PAID: { label: 'Đã thanh toán (PAID)', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  PREPARING: { label: 'Đang pha chế (PREPARING)', className: 'border-blue-200 bg-blue-50 text-blue-800' },
  READY: { label: 'Sẵn sàng nhận (READY)', className: 'border-purple-200 bg-purple-50 text-purple-800' },
  COMPLETED: { label: 'Hoàn thành (COMPLETED)', className: 'border-zinc-300 bg-zinc-100 text-zinc-800' },
  PAYMENT_FAILED: { label: 'Thanh toán lỗi (PAYMENT_FAILED)', className: 'border-red-200 bg-red-50 text-red-800' },
  CANCELLED: { label: 'Đã hủy (CANCELLED)', className: 'border-gray-300 bg-gray-100 text-gray-600' },
};

const QUICK_PROMOS = [
  { code: 'SAVE10', desc: 'Giảm 10% (đơn từ 50.000₫)' },
  { code: 'BREW20K', desc: 'Giảm 20.000₫ (đơn từ 100.000₫)' },
  { code: 'FREETOPPING', desc: 'Tặng 10.000₫ phí Topping' },
];

export default function Checkout({ initialOrderId }: { initialOrderId?: string }) {
  const user = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthServerSnapshot);
  const hydrated = useCartHydrated();

  if (!user) {
    return (
      <main className="shop mx-auto max-w-5xl px-6 py-12">
        <div className="mx-auto max-w-lg rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-8 text-center shadow-xs">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-[#cbe8d3] text-2xl">
            🔒
          </div>
          <p className="eyebrow mt-4">BrewLite Mộc Vị / Thanh toán</p>
          <h1 className="mt-2 text-2xl font-extrabold text-[#4a2e20]">Thanh toán</h1>
          <p className="mt-2 text-sm text-[#7a6254]">
            Đăng nhập để tạo đơn. Giỏ hàng của bạn vẫn được giữ.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/login"
              className="rounded-full bg-[#6d4c3d] px-6 py-2.5 text-xs font-bold text-white transition hover:bg-[#563a2d]"
            >
              Đăng nhập
            </Link>
            <Link
              href="/register"
              className="rounded-full border-2 border-[#6d4c3d] bg-white px-5 py-2.5 text-xs font-bold text-[#4a2e20] transition hover:bg-[#6d4c3d] hover:text-white"
            >
              Đăng ký tài khoản
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!hydrated) {
    return (
      <main className="shop mx-auto max-w-5xl px-6 py-10" role="status">
        <div className="rounded-2xl border border-[#decbb4] bg-white p-8 text-center text-sm font-medium text-[#7a6254]">
          Đang khôi phục giỏ hàng…
        </div>
      </main>
    );
  }

  return <UserCheckout key={`${user.id}:${initialOrderId ?? ''}`} user={user} initialOrderId={initialOrderId} />;
}

function UserCheckout({ user, initialOrderId }: { user: User; initialOrderId?: string }) {
  const router = useRouter();
  const lines = useCartStore((s) => s.lines);
  const [promo, setPromo] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [quote, setQuote] = useState<{ fingerprint: string; value: Quote }>();
  const [lifecycle] = useState(createCheckoutLifecycle);
  const [session] = useState(() => {
    const token = getToken();
    const storageKey = `brewlite-checkout:${user.id}`;
    const active = () => lifecycle.isActive() && getUser()?.id === user.id && getToken() === token;
    return createCheckoutSession(user.id, {
      read: () => sessionStorage.getItem(storageKey),
      write: (value) => sessionStorage.setItem(storageKey, value),
      key: () => crypto.randomUUID(),
      active,
      quote: (request) => apiPost('/orders/quote', request),
      create: (key, request) => apiPost('/orders', request, { 'Idempotency-Key': key }),
      pay: (key, request) => apiPost('/payments', request, { 'Idempotency-Key': key }),
      find: (id) => apiGet(`/orders/${id}`),
      settle: (id, purchased) => {
        if (active()) useCartStore.getState().settleOrder(id, purchased);
      },
    });
  });
  const [state, setState] = useState(session.snapshot);
  const [method, setMethod] = useState<PaymentMethod>(state.attempt?.request.method ?? 'WALLET');
  const [outcome, setOutcome] = useState<'SUCCESS' | 'FAIL'>(state.attempt?.request.mockOutcome ?? 'SUCCESS');
  const [busy, setBusy] = useState(Boolean(state.orderId || initialOrderId));
  const request = {
    items: toCartItems(lines),
    ...(promo.trim() ? { promotionCode: promo.trim().toUpperCase() } : {}),
  };
  const fingerprint = JSON.stringify(request);
  const currentQuote = quote?.fingerprint === fingerprint ? quote.value : undefined;
  const order = state.order;
  const replayAttempt =
    state.attempt && !(state.verified && order?.status === 'PAYMENT_FAILED')
      ? state.attempt
      : undefined;
  const paid = state.verified && order && paidStatuses.includes(order.status);
  const terminal = state.verified && order && (paid || order.status === 'CANCELLED');
  // Tổng của đơn đã tạo khác tổng đã báo giá: người dùng phải xác nhận trước khi thanh toán.
  const priceCheck = comparePrice(state.quotedTotal, order?.total ?? 0);
  const needsPriceConfirm = Boolean(
    state.verified && order?.status === 'PENDING' && priceCheck.changed && !state.priceAcknowledged,
  );

  useEffect(() => {
    lifecycle.setActive(true);
    let cancelled = false;
    if (session.snapshot().orderId || initialOrderId) {
      Promise.resolve()
        .then(() => {
          if (!cancelled) return initialOrderId ? session.resume(initialOrderId) : session.verify();
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : 'Chưa xác minh được đơn.');
        })
        .finally(() => {
          if (!cancelled) {
            setState(session.snapshot());
            setBusy(false);
          }
        });
    }
    return () => {
      cancelled = true;
      lifecycle.setActive(false);
    };
  }, [session, lifecycle, initialOrderId]);

  async function run(work: () => Promise<unknown>) {
    if (!lifecycle.acquire()) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      if (session.snapshot().orderId && getUser()?.id === user.id && lifecycle.isActive()) {
        // Read the balance, rather than incrementing a cached client balance on replay.
        try {
          const balance = await apiGet<{ points: number }>('/loyalty/me');
          if (getUser()?.id === user.id && lifecycle.isActive()) updateUserPoints(balance.points);
        } catch {
          setNotice('Đơn đã được xử lý. Chưa tải được điểm mới; xem lại tại trang Điểm thưởng.');
        }
      }
    } catch (e) {
      if (lifecycle.isActive()) setError(describeCheckoutError(e).message);
    } finally {
      lifecycle.release();
      if (lifecycle.isActive()) {
        setState(session.snapshot());
        setBusy(false);
      }
    }
  }

  const inOrderPhase = Boolean(state.request || state.orderId);
  const currentStep = paid ? 3 : inOrderPhase ? 2 : 1;

  return (
    <main className="shop mx-auto max-w-6xl px-6 py-8">
      <div className="rounded-2xl border border-[#b5dcc0] bg-[#cbe8d3] p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">BrewLite Mộc Vị / Thanh toán</p>
            <h1 className="mt-1.5">Hoàn tất đơn của bạn</h1>
            <p className="my-1 text-sm text-[#5c4033]">
              Thanh toán Ví/Thẻ sử dụng cổng mô phỏng của bài tập. Giá, tồn kho và điểm được xử lý bởi backend.
            </p>
          </div>
          <div className="flex items-center gap-2.5 text-xs font-bold">
            <Link
              href="/cart"
              className="rounded-full border-2 border-[#6d4c3d] bg-white px-4 py-2 text-[#4a2e20] no-underline transition hover:bg-[#6d4c3d] hover:text-white"
            >
              ← Về giỏ hàng
            </Link>
            <Link
              href="/orders"
              className="rounded-full bg-[#6d4c3d] px-4 py-2 text-white no-underline transition hover:bg-[#563a2d]"
            >
              Lịch sử đơn →
            </Link>
          </div>
        </div>

        {/* Tiến trình 3 bước */}
        <div className="mt-5 grid grid-cols-3 gap-2.5">
          {[
            { step: 1, title: '1. Kiểm tra & Báo giá' },
            { step: 2, title: '2. Giữ hàng & Thanh toán' },
            { step: 3, title: '3. Hoàn tất & Tích điểm' },
          ].map((item) => {
            const active = currentStep === item.step;
            const done = currentStep > item.step;
            return (
              <div
                key={item.step}
                className={`rounded-full border px-3.5 py-2 text-center text-xs font-bold transition ${
                  active
                    ? 'border-[#6d4c3d] bg-[#6d4c3d] text-white'
                    : done
                      ? 'border-[#2d6a4f] bg-white text-[#2d6a4f]'
                      : 'border-[#b5dcc0] bg-white/65 text-[#7a6254]'
                }`}
              >
                {done ? `✓ ${item.title}` : item.title}
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <p role="alert" className="shop-error mt-6">
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mt-6 rounded-2xl border border-[#decbb4] bg-white px-4 py-3 text-sm font-medium text-[#4a2e20]"
        >
          {notice}
        </p>
      )}

      {!state.request && !state.orderId ? (
        <section className="shop-panel mt-6">
          {!lines.length ? (
            <div className="py-8 text-center">
              <div className="mx-auto grid size-14 place-items-center rounded-full bg-[#cbe8d3] text-2xl">
                ☕
              </div>
              <h2 className="mt-4">Kiểm tra đơn hàng</h2>
              <p className="text-sm text-[#7a6254]">
                Giỏ hàng đang trống.{' '}
                <Link href="/menu" className="font-bold text-[#6d4c3d]">
                  Chọn đồ uống
                </Link>
              </p>
            </div>
          ) : (
            <div className="grid items-start gap-8 lg:grid-cols-[1.35fr_1fr]">
              <div>
                <div className="flex items-center justify-between border-b border-[#decbb4] pb-3">
                  <h2 className="m-0">Kiểm tra đơn hàng</h2>
                  <span className="rounded-full bg-[#cbe8d3] px-3 py-0.5 text-xs font-bold text-[#2d6a4f]">
                    {lines.length} dòng món
                  </span>
                </div>

                <ul className="divide-y divide-[#decbb4]/70">
                  {lines.map((l) => (
                    <li
                      key={l.id}
                      className="flex items-center justify-between gap-3 py-3 text-sm"
                    >
                      <div>
                        <span className="font-bold text-[#4a2e20]">
                          {l.productName} · {l.size}
                        </span>
                        <span className="block text-xs text-[#7a6254]">
                          {l.toppings.map((t) => t.name).join(', ') || 'Không topping'} × {l.qty}
                        </span>
                      </div>
                      <span className="rounded-full bg-[#efe5d4] px-3 py-1 text-xs font-bold text-[#4a2e20]">
                        × {l.qty}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="mt-5 rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-4">
                  <label className="m-0">
                    Mã khuyến mãi
                    <input
                      value={promo}
                      maxLength={32}
                      placeholder="Nhập mã ưu đãi (VD: SAVE10, BREW20K...)"
                      onChange={(e) => setPromo(e.target.value)}
                      disabled={busy}
                    />
                  </label>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold text-[#7a6254]">Chọn nhanh:</span>
                    {QUICK_PROMOS.map((p) => {
                      const selected = promo.trim().toUpperCase() === p.code;
                      return (
                        <button
                          key={p.code}
                          type="button"
                          disabled={busy}
                          onClick={() => setPromo(selected ? '' : p.code)}
                          style={{
                            margin: 0,
                            padding: '5px 12px',
                            fontSize: '12px',
                            background: selected ? '#6d4c3d' : '#ffffff',
                            color: selected ? '#ffffff' : '#4a2e20',
                            border: '1px solid #decbb4',
                          }}
                        >
                          {p.code}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4">
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const value = await session.quote(request);
                          setQuote({ fingerprint, value });
                        })
                      }
                    >
                      Tính giá từ hệ thống
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-5">
                <h2 className="m-0 text-base font-extrabold text-[#4a2e20]">Báo giá từ hệ thống</h2>
                {!currentQuote ? (
                  <p className="mt-3 text-xs leading-relaxed text-[#7a6254]">
                    Bấm <strong>“Tính giá từ hệ thống”</strong> để máy chủ kiểm tra tồn kho, áp dụng mã khuyến mãi và báo giá chính xác trước khi tạo đơn.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3 rounded-xl bg-white p-4 text-sm">
                    <p className="m-0 flex items-center justify-between text-[#7a6254]">
                      <span>Tạm tính:</span>
                      <span className="font-bold text-[#4a2e20]">
                        {formatVnd(currentQuote.subtotal)}
                      </span>
                    </p>
                    <p className="m-0 flex items-center justify-between text-[#2d6a4f]">
                      <span>Giảm:</span>
                      <span className="font-bold">−{formatVnd(currentQuote.discount)}</span>
                    </p>
                    <p className="m-0 flex items-center justify-between border-t border-[#decbb4] pt-3 text-base">
                      <strong>Tổng: {formatVnd(currentQuote.total)}</strong>
                      <span className="rounded-full bg-[#cbe8d3] px-2.5 py-0.5 text-xs font-bold text-[#2d6a4f]">
                        +{Math.floor(currentQuote.total / 10000)} điểm
                      </span>
                    </p>
                    <div className="pt-2">
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(() =>
                            session.create(
                              request,
                              lines.map((l) => ({ id: l.id, key: l.key, qty: l.qty })),
                              currentQuote.total,
                            ),
                          )
                        }
                        style={{ width: '100%', margin: 0 }}
                      >
                        Tạo đơn và giữ hàng
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      ) : (
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1.35fr_1fr]">
          <div className="space-y-6">
            {order && (
              <section className="shop-panel m-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#decbb4] pb-4">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-[#7a6254]">
                      Mã đơn hàng
                    </span>
                    <h2 className="m-0 mt-0.5 font-mono text-xl font-extrabold text-[#4a2e20]">
                      Đơn {order.code}
                    </h2>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${
                      state.verified
                        ? ORDER_STATUS_LABELS[order.status]?.className ??
                          'border-gray-200 bg-gray-100 text-gray-700'
                        : 'border-amber-200 bg-amber-50 text-amber-800'
                    }`}
                  >
                    Trạng thái:{' '}
                    <strong className="ml-1">
                      {state.verified
                        ? ORDER_STATUS_LABELS[order.status]?.label ?? order.status
                        : 'Đang chờ xác minh'}
                    </strong>
                  </span>
                </div>

                <ul className="divide-y divide-[#decbb4]/70">
                  {order.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 py-3 text-sm"
                    >
                      <div>
                        <span className="font-bold text-[#4a2e20]">
                          {item.productName} · {item.size} × {item.qty}
                        </span>
                        {item.toppings.length > 0 && (
                          <span className="block text-xs text-[#7a6254]">
                            Topping: {item.toppings.map((t) => t.name).join(', ')}
                          </span>
                        )}
                      </div>
                      <span className="font-bold text-[#6d4c3d]">{formatVnd(item.lineTotal)}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-4 rounded-xl border border-[#e2d2b8] bg-[#efe5d4] p-4">
                  <p className="m-0 text-sm text-[#7a6254]">
                    Tạm tính {formatVnd(order.subtotal)} · Giảm {formatVnd(order.discount)}{' '}
                    {order.promotionCode && `(${order.promotionCode})`}
                  </p>
                  <div className="mt-2 flex items-center justify-between border-t border-[#decbb4] pt-2">
                    <span className="text-sm font-bold text-[#4a2e20]">Tổng thanh toán</span>
                    <h2 className="m-0 text-2xl font-extrabold text-[#6d4c3d]">
                      {formatVnd(order.total)}
                    </h2>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <Link href={`/orders/${order.id}`} className="font-bold text-[#6d4c3d]">
                    Xem chi tiết và lịch sử đơn →
                  </Link>
                  <span className="text-[#7a6254]">
                    Giữ kho: <strong>{order.reservationStatus}</strong> · Phiên bản v{order.version}
                  </span>
                </div>
              </section>
            )}

            {needsPriceConfirm && order && (
              <section className="shop-panel shop-error m-0" role="alert">
                <h2>Tổng tiền đã thay đổi</h2>
                <p>
                  Giá đã báo trước đó là {formatVnd(priceCheck.quotedTotal ?? 0)} nhưng đơn vừa tạo có tổng{' '}
                  {formatVnd(order.total)} ({priceCheck.difference > 0 ? 'tăng' : 'giảm'}{' '}
                  {formatVnd(Math.abs(priceCheck.difference))}). Giá, khuyến mãi hoặc lựa chọn có thể đã thay đổi trên hệ thống.
                </p>
                <p>
                  Hãy kiểm tra các dòng bên trên. Bạn chỉ có thể thanh toán sau khi xác nhận tổng mới, hoặc hủy đơn để trả lại hàng đã giữ.
                </p>
                <button
                  disabled={busy}
                  onClick={() => {
                    try {
                      session.acknowledgePrice();
                      setState(session.snapshot());
                    } catch (e) {
                      setError(describeCheckoutError(e).message);
                    }
                  }}
                >
                  Tôi đồng ý với tổng {formatVnd(order.total)}
                </button>
              </section>
            )}

            {paid && (
              <section
                className="shop-panel m-0 border-[#b5dcc0] bg-[#cbe8d3]"
                role="status"
              >
                <h2 className="text-[#2d6a4f]">✓ Thanh toán thành công</h2>
                <p className="text-sm text-[#4a2e20]">
                  {state.purchased.length
                    ? 'Đã xác minh đơn từ hệ thống. Các món đã mua đã được trừ khỏi giỏ; món thêm sau vẫn được giữ.'
                    : 'Đã xác minh đơn từ hệ thống. Giỏ hiện tại được giữ nguyên vì không có snapshot giỏ của đơn khôi phục từ lịch sử.'}
                </p>
                <p className="text-sm text-[#4a2e20]">
                  Điểm tích lũy hiện tại (từ hệ thống): <strong>{user.loyaltyPoints}</strong>
                </p>
                <Link href="/loyalty" className="font-bold text-[#6d4c3d]">
                  Xem điểm thưởng →
                </Link>
              </section>
            )}
          </div>

          <div className="space-y-6">
            {order && !terminal && (
              <section className="shop-panel m-0">
                <div className="flex items-center justify-between border-b border-[#decbb4] pb-3">
                  <h2 className="m-0">Thanh toán mô phỏng</h2>
                  <span className="rounded-full bg-[#cbe8d3] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#2d6a4f]">
                    Mock Gateway
                  </span>
                </div>

                {state.attempt && (
                  <p className="rounded-xl border border-[#e2d2b8] bg-[#efe5d4] p-3 text-xs text-[#4a2e20]">
                    Lần thanh toán hiện tại được lưu để thử lại an toàn sau lỗi mạng.
                  </p>
                )}

                <label>
                  Phương thức{' '}
                  <select
                    value={replayAttempt?.request.method ?? method}
                    disabled={busy || Boolean(replayAttempt)}
                    onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  >
                    <option value="WALLET">Ví điện tử</option>
                    <option value="CARD">Thẻ ngân hàng</option>
                  </select>
                </label>

                <label>
                  Kịch bản{' '}
                  <select
                    value={replayAttempt ? (replayAttempt.request.mockOutcome ?? 'SUCCESS') : outcome}
                    disabled={busy || Boolean(replayAttempt)}
                    onChange={(e) => setOutcome(e.target.value as 'SUCCESS' | 'FAIL')}
                  >
                    <option value="SUCCESS">Thành công</option>
                    <option value="FAIL">Thất bại</option>
                  </select>
                </label>

                {order.status === 'PAYMENT_FAILED' && state.verified ? (
                  <div className="mt-4 rounded-xl border border-[#e5b8b8] bg-[#fbeaea] p-4">
                    <p className="m-0 mb-3 text-xs font-medium text-[#9b2c2c]">
                      Thanh toán thất bại. Giỏ hàng được giữ; kho và lượt khuyến mãi đã trả lại.
                    </p>
                    <button
                      disabled={busy}
                      onClick={() => run(() => session.pay(method, outcome, true))}
                      style={{ width: '100%', margin: 0 }}
                    >
                      Thử lại thanh toán bằng khóa mới
                    </button>
                  </div>
                ) : (
                  <div className="mt-4">
                    <button
                      disabled={busy || !state.verified || needsPriceConfirm}
                      onClick={() => run(() => session.pay(method, outcome))}
                      style={{ width: '100%', margin: 0 }}
                    >
                      {state.attempt ? 'Gửi lại cùng lần thanh toán' : 'Xác nhận thanh toán'}
                    </button>
                  </div>
                )}
              </section>
            )}

            <section className="shop-panel m-0">
              <h2 className="text-sm font-extrabold text-[#4a2e20]">Thao tác quản lý đơn</h2>
              <div className="flex flex-wrap gap-2">
                {!order && !state.orderId && state.request && (
                  <button
                    disabled={busy}
                    onClick={() => run(() => session.create(state.request!, state.purchased))}
                  >
                    Khôi phục yêu cầu tạo đơn
                  </button>
                )}
                {state.orderId && (
                  <button
                    disabled={busy}
                    onClick={() => run(() => session.verify())}
                    style={{
                      background: '#efe5d4',
                      color: '#4a2e20',
                      border: '1px solid #decbb4',
                    }}
                  >
                    Xác minh lại trạng thái đơn
                  </button>
                )}
                {order && ['PENDING', 'PAYMENT_FAILED', 'PAID'].includes(order.status) && (
                  <button
                    disabled={busy || !state.verified}
                    onClick={() =>
                      run(async () => {
                        await apiPost<Order>(`/orders/${order.id}/cancel`, {
                          expectedVersion: order.version,
                        });
                        await session.verify();
                      })
                    }
                    style={{
                      background: '#fbeaea',
                      color: '#9b2c2c',
                      border: '1px solid #e5b8b8',
                    }}
                  >
                    {order.status === 'PAID'
                      ? 'Hủy đơn và hoàn thanh toán mô phỏng'
                      : 'Hủy đơn và trả hàng đã giữ'}
                  </button>
                )}
                {(terminal || (!state.orderId && !state.createUncertain)) && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      try {
                        session.startOver();
                        setState(session.snapshot());
                        setQuote(undefined);
                        if (initialOrderId) router.replace('/checkout');
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Bắt đầu đơn mới
                  </button>
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {busy && (
        <p
          role="status"
          className="mt-6 rounded-2xl border border-[#decbb4] bg-white px-4 py-3 text-center text-sm font-bold text-[#4a2e20]"
        >
          Đang xử lý, vui lòng chờ…
        </p>
      )}
    </main>
  );
}

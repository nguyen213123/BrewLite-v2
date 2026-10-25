'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiGet, apiPost } from '@/lib/api';
import { getToken, getUser, getAuthSnapshot, getAuthServerSnapshot, subscribeAuth, updateUserPoints } from '@/lib/auth';
import { useCartStore, useCartHydrated, toCartItems } from '@/lib/cart/cart-store';
import { createCheckoutSession, createCheckoutLifecycle, paidStatuses } from '@/lib/checkout/session';
import type { Order, PaymentMethod, Quote, User } from '@/lib/contracts/api.generated';
import { formatVnd } from '@/components/payments/payment-api';

export default function Checkout({ initialOrderId }: { initialOrderId?: string }) {
  const user = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthServerSnapshot);
  const hydrated = useCartHydrated();
  if (!user) return <main className="shop"><h1>Thanh toán</h1><p>Đăng nhập để tạo đơn. Giỏ hàng của bạn vẫn được giữ.</p><Link href="/login">Đăng nhập</Link></main>;
  if (!hydrated) return <main className="shop">Đang khôi phục giỏ hàng…</main>;
  return <UserCheckout key={`${user.id}:${initialOrderId ?? ''}`} user={user} initialOrderId={initialOrderId} />;
}

function UserCheckout({ user, initialOrderId }: { user: User; initialOrderId?: string }) {
  const router = useRouter();
  const lines = useCartStore(s => s.lines);
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
      read: () => sessionStorage.getItem(storageKey), write: value => sessionStorage.setItem(storageKey, value),
      key: () => crypto.randomUUID(), active,
      quote: request => apiPost('/orders/quote', request),
      create: (key, request) => apiPost('/orders', request, { 'Idempotency-Key': key }),
      pay: (key, request) => apiPost('/payments', request, { 'Idempotency-Key': key }),
      find: id => apiGet(`/orders/${id}`),
      settle: (id, purchased) => { if (active()) useCartStore.getState().settleOrder(id, purchased); },
    });
  });
  const [state, setState] = useState(session.snapshot);
  const [method, setMethod] = useState<PaymentMethod>(state.attempt?.request.method ?? 'WALLET');
  const [outcome, setOutcome] = useState<'SUCCESS' | 'FAIL'>(state.attempt?.request.mockOutcome ?? 'SUCCESS');
  const [busy, setBusy] = useState(Boolean(state.orderId || initialOrderId));
  const request = { items: toCartItems(lines), ...(promo.trim() ? { promotionCode: promo.trim().toUpperCase() } : {}) };
  const fingerprint = JSON.stringify(request);
  const currentQuote = quote?.fingerprint === fingerprint ? quote.value : undefined;
  const order = state.order;
  const replayAttempt = state.attempt && !(state.verified && order?.status === 'PAYMENT_FAILED')
    ? state.attempt : undefined;
  const paid = state.verified && order && paidStatuses.includes(order.status);
  const terminal = state.verified && order && (paid || order.status === 'CANCELLED');

  useEffect(() => {
    lifecycle.setActive(true);
    let cancelled = false;
    if (session.snapshot().orderId || initialOrderId) {
      Promise.resolve().then(() => { if (!cancelled) return initialOrderId ? session.resume(initialOrderId) : session.verify(); })
        .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Chưa xác minh được đơn.'); })
        .finally(() => { if (!cancelled) { setState(session.snapshot()); setBusy(false); } });
    }
    return () => { cancelled = true; lifecycle.setActive(false); };
  }, [session, lifecycle, initialOrderId]);

  async function run(work: () => Promise<unknown>) {
    if (!lifecycle.acquire()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await work();
      if (session.snapshot().orderId && getUser()?.id === user.id && lifecycle.isActive()) {
        // Read the balance, rather than incrementing a cached client balance on replay.
        try { const balance = await apiGet<{ points: number }>('/loyalty/me');
          if (getUser()?.id === user.id && lifecycle.isActive()) updateUserPoints(balance.points);
        } catch { setNotice('Đơn đã được xử lý. Chưa tải được điểm mới; xem lại tại trang Điểm thưởng.'); }
      }
    } catch (e) {
      if (lifecycle.isActive()) setError(e instanceof Error ? e.message : 'Không thể xử lý yêu cầu. Hãy thử lại.');
    } finally { lifecycle.release(); if (lifecycle.isActive()) { setState(session.snapshot()); setBusy(false); } }
  }

  return <main className="shop">
    <p className="eyebrow">BrewLite / Thanh toán</p><h1>Hoàn tất đơn của bạn</h1>
    <p>Thanh toán Ví/Thẻ sử dụng cổng mô phỏng của bài tập. Giá, tồn kho và điểm được xử lý bởi backend.</p>
    {error && <p role="alert" className="shop-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!state.request && !state.orderId ? <section className="shop-panel">
      <h2>Kiểm tra đơn hàng</h2>
      {!lines.length ? <p>Giỏ hàng đang trống. <Link href="/menu">Chọn đồ uống</Link></p> : <>
        <ul>{lines.map(l => <li key={l.id}>{l.productName} · {l.size} · {l.toppings.map(t => t.name).join(', ') || 'Không topping'} × {l.qty}</li>)}</ul>
        <label>Mã khuyến mãi <input value={promo} maxLength={32} onChange={e => setPromo(e.target.value)} disabled={busy} /></label>
        <button disabled={busy} onClick={() => run(async () => {
          const value = await session.quote(request); setQuote({ fingerprint, value });
        })}>Tính giá từ hệ thống</button>
        {currentQuote && <><p>Tạm tính: {formatVnd(currentQuote.subtotal)} · Giảm: {formatVnd(currentQuote.discount)}</p>
          <p><strong>Tổng: {formatVnd(currentQuote.total)}</strong></p>
          <button disabled={busy} onClick={() => run(() => session.create(request, lines.map(l => ({ id: l.id, key: l.key, qty: l.qty }))))}>Tạo đơn và giữ hàng</button></>}
      </>}
    </section> : <>
      {order && <section className="shop-panel"><h2>Đơn {order.code}</h2>
        <p>Trạng thái: <strong>{state.verified ? order.status : 'Đang chờ xác minh'}</strong></p>
        <ul>{order.items.map(item => <li key={item.id}>{item.productName} · {item.size} × {item.qty} — {formatVnd(item.lineTotal)}</li>)}</ul>
        <p>Tạm tính {formatVnd(order.subtotal)} · Giảm {formatVnd(order.discount)} {order.promotionCode && `(${order.promotionCode})`}</p>
        <h2>{formatVnd(order.total)}</h2>
        <Link href={`/orders/${order.id}`}>Xem chi tiết và lịch sử đơn</Link>
      </section>}
      {!order && !state.orderId && state.request && <button disabled={busy} onClick={() => run(() => session.create(state.request!, state.purchased))}>Khôi phục yêu cầu tạo đơn</button>}
      {state.orderId && <button disabled={busy} onClick={() => run(() => session.verify())}>Xác minh lại trạng thái đơn</button>}
      {order && !terminal && <section className="shop-panel"><h2>Thanh toán mô phỏng</h2>
        {state.attempt && <p>Lần thanh toán hiện tại được lưu để thử lại an toàn sau lỗi mạng.</p>}
        <label>Phương thức <select value={replayAttempt?.request.method ?? method} disabled={busy || Boolean(replayAttempt)} onChange={e => setMethod(e.target.value as PaymentMethod)}><option value="WALLET">Ví điện tử</option><option value="CARD">Thẻ ngân hàng</option></select></label>
        <label>Kịch bản <select value={replayAttempt ? replayAttempt.request.mockOutcome ?? 'SUCCESS' : outcome} disabled={busy || Boolean(replayAttempt)} onChange={e => setOutcome(e.target.value as 'SUCCESS' | 'FAIL')}><option value="SUCCESS">Thành công</option><option value="FAIL">Thất bại</option></select></label>
        {order.status === 'PAYMENT_FAILED' && state.verified ? <>
          <p>Thanh toán thất bại. Giỏ hàng được giữ; kho và lượt khuyến mãi đã trả lại.</p>
          <button disabled={busy} onClick={() => run(() => session.pay(method, outcome, true))}>Thử lại thanh toán bằng khóa mới</button>
        </> : <button disabled={busy || !state.verified} onClick={() => run(() => session.pay(method, outcome))}>{state.attempt ? 'Gửi lại cùng lần thanh toán' : 'Xác nhận thanh toán'}</button>}
      </section>}
      {order && ['PENDING', 'PAYMENT_FAILED', 'PAID'].includes(order.status) && <button disabled={busy || !state.verified} onClick={() => run(async () => {
        await apiPost<Order>(`/orders/${order.id}/cancel`, { expectedVersion: order.version });
        await session.verify();
      })}>{order.status === 'PAID' ? 'Hủy đơn và hoàn thanh toán mô phỏng' : 'Hủy đơn và trả hàng đã giữ'}</button>}
      {paid && <section className="shop-panel" role="status"><h2>Thanh toán thành công</h2><p>{state.purchased.length ? 'Đã xác minh đơn từ hệ thống. Các món đã mua đã được trừ khỏi giỏ; món thêm sau vẫn được giữ.' : 'Đã xác minh đơn từ hệ thống. Giỏ hiện tại được giữ nguyên vì không có snapshot giỏ của đơn khôi phục từ lịch sử.'}</p><Link href="/loyalty">Xem điểm thưởng</Link></section>}
      {(terminal || !state.orderId && !state.createUncertain) && <button disabled={busy} onClick={() => { try { session.startOver(); setState(session.snapshot()); setQuote(undefined); if (initialOrderId) router.replace('/checkout'); } catch(e) { setError((e as Error).message); } }}>Bắt đầu đơn mới</button>}
    </>}
    {busy && <p role="status">Đang xử lý, vui lòng chờ…</p>}
    <p><Link href="/cart">Về giỏ hàng</Link> · <Link href="/orders">Lịch sử đơn</Link></p>
  </main>;
}

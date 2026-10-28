'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiGet, apiPost } from '@/lib/api';
import { getToken, getUser, getAuthSnapshot, getAuthServerSnapshot, subscribeAuth, updateUserPoints } from '@/lib/auth';
import { useCartStore, useCartHydrated, toCartItems } from '@/lib/cart/cart-store';
import { createCheckoutSession, createCheckoutLifecycle, paidStatuses } from '@/lib/checkout/session';
import { describeCheckoutError, comparePrice } from '@/lib/checkout/errors';
import type { Order, OrderRequest, OrderStatus, PaymentMethod, Quote, User } from '@/lib/contracts/api.generated';
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

type DbPromotion = {
  code: string;
  type: 'FIXED' | 'PERCENT';
  value: number;
  minSubtotal: number;
  maxDiscount: number | null;
  maxUses: number | null;
  usedCount: number;
};

const DEFAULT_PROMOTIONS: DbPromotion[] = [
  {
    code: 'GIAM20K',
    type: 'FIXED',
    value: 20000,
    minSubtotal: 80000,
    maxDiscount: null,
    maxUses: null,
    usedCount: 0,
  },
  {
    code: 'SAVE10',
    type: 'PERCENT',
    value: 10,
    minSubtotal: 100000,
    maxDiscount: 30000,
    maxUses: 100,
    usedCount: 0,
  },
];

function computePromoDiscount(promo: DbPromotion, subtotal: number): number {
  if (subtotal < promo.minSubtotal) return 0;
  if (promo.type === 'FIXED') return Math.min(promo.value, subtotal);
  let discount = Math.floor((subtotal * promo.value) / 100);
  if (promo.maxDiscount !== null) discount = Math.min(discount, promo.maxDiscount);
  return Math.min(discount, subtotal);
}

type OrderWithPaymentData = Order & {
  paymentMethod?: PaymentMethod | null;
  method?: PaymentMethod | null;
  payment?: { method?: PaymentMethod | null } | null;
  payments?: Array<{ method?: PaymentMethod | null }> | null;
};

export function getConfirmedPaymentMethod(
  order?: Order | null,
  attempt?: { request?: { method?: PaymentMethod } } | null,
): PaymentMethod | undefined {
  const o = order as OrderWithPaymentData | undefined;
  if (o?.paymentMethod) return o.paymentMethod;
  if (o?.method) return o.method;
  if (o?.payment?.method) return o.payment.method;
  if (o?.payments && o.payments.length > 0 && o.payments[0]?.method) return o.payments[0].method;
  if (attempt?.request?.method) return attempt.request.method;
  return undefined;
}

function formatPromoTitle(promo: DbPromotion): string {
  if (promo.type === 'FIXED') return `Giảm ${formatVnd(promo.value)}`;
  return promo.maxDiscount !== null
    ? `Giảm ${promo.value}% (tối đa ${formatVnd(promo.maxDiscount)})`
    : `Giảm ${promo.value}%`;
}

function formatPromoCondition(promo: DbPromotion): string {
  const minText =
    promo.minSubtotal > 0 ? `Đơn tối thiểu ${formatVnd(promo.minSubtotal)}` : 'Áp dụng mọi đơn hàng';
  if (promo.maxUses !== null) {
    const remaining = Math.max(0, promo.maxUses - promo.usedCount);
    return `${minText} · Còn ${remaining} lượt`;
  }
  return minText;
}

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
  const allLines = useCartStore((s) => s.lines);
  const lines = allLines.filter((l) => l.selected !== false);
  const [promo, setPromo] = useState('');
  const [promoInput, setPromoInput] = useState('');
  const [vouchers, setVouchers] = useState<DbPromotion[]>(DEFAULT_PROMOTIONS);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loyaltyError, setLoyaltyError] = useState(false);
  const [quote, setQuote] = useState<{ fingerprint: string; value?: Quote }>();
  const [lifecycle] = useState(createCheckoutLifecycle);
  const [session] = useState(() => {
    const token = getToken();
    const storageKey = `brewlite-checkout:${user.id}`;
    const active = () => lifecycle.isActive() && getUser()?.id === user.id && getToken() === token;
    let resetTerminalOnMount = false;
    if (!initialOrderId && lines.length > 0) {
      try {
        const parsed = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as {
          order?: { status?: OrderStatus };
        } | null;
        if (parsed?.order?.status && [...paidStatuses, 'CANCELLED'].includes(parsed.order.status)) {
          resetTerminalOnMount = true;
          sessionStorage.setItem(storageKey, JSON.stringify({ userId: user.id, purchased: [] }));
        }
      } catch {
        // Ignore malformed storage
      }
    }
    return createCheckoutSession(user.id, {
      read: () => {
        if (resetTerminalOnMount) {
          resetTerminalOnMount = false;
          return null;
        }
        return sessionStorage.getItem(storageKey);
      },
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
  const [vnpayLoading, setVnpayLoading] = useState(false);

  const handleVnPayPayment = async () => {
    if (!state.order) return;
    setError('');
    setVnpayLoading(true);
    try {
      const data = await apiPost<{ paymentUrl: string }>('/payments/vnpay/create-url', {
        orderId: state.order.id,
      });
      if (data?.paymentUrl && typeof window !== 'undefined') {
        window.location.href = data.paymentUrl;
      } else {
        throw new Error('Không thể tạo liên kết thanh toán VNPAY');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi kết nối tới cổng thanh toán VNPAY';
      setError(msg);
      setVnpayLoading(false);
    }
  };

  const getLineUnitPrice = (l: (typeof lines)[number]) =>
    (l.sizePrice ?? 0) + (l.toppings ?? []).reduce((sum, t) => sum + (t.price ?? 0), 0);
  const estimatedSubtotal = lines.reduce((sum, l) => sum + getLineUnitPrice(l) * l.qty, 0);
  const totalItems = lines.reduce((sum, l) => sum + l.qty, 0);

  const normalizedPromo = promo.trim().toUpperCase();
  const knownVoucher = vouchers.find((v) => v.code === normalizedPromo);
  const activePromo =
    knownVoucher && estimatedSubtotal < knownVoucher.minSubtotal ? '' : normalizedPromo;

  const request: OrderRequest = {
    items: toCartItems(lines),
    ...(activePromo ? { promotionCode: activePromo } : {}),
  };
  const fingerprint = JSON.stringify(request);
  const currentQuote = quote?.fingerprint === fingerprint ? quote.value : undefined;
  const previewDiscount = knownVoucher ? computePromoDiscount(knownVoucher, estimatedSubtotal) : 0;
  const displaySubtotal = currentQuote ? currentQuote.subtotal : estimatedSubtotal;
  const displayDiscount = currentQuote ? currentQuote.discount : previewDiscount;
  const displayTotal = currentQuote
    ? currentQuote.total
    : Math.max(0, estimatedSubtotal - previewDiscount);

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
  const confirmedPaymentMethod = getConfirmedPaymentMethod(order, state.attempt);

  useEffect(() => {
    lifecycle.setActive(true);
    let cancelled = false;
    if (session.snapshot().orderId || initialOrderId) {
      Promise.resolve()
        .then(async () => {
          if (cancelled) return;
          const fresh = initialOrderId ? await session.resume(initialOrderId) : await session.verify();
          if (
            !cancelled &&
            !initialOrderId &&
            fresh &&
            [...paidStatuses, 'CANCELLED'].includes(fresh.status) &&
            useCartStore.getState().lines.some((l) => l.selected !== false)
          ) {
            session.startOver();
          }
          if (!cancelled && fresh && typeof apiGet === 'function' && getUser()?.id === user.id) {
            try {
              const balance = await apiGet<{ points: number }>('/loyalty/me');
              if (!cancelled && getUser()?.id === user.id) {
                updateUserPoints(balance.points);
                setLoyaltyError(false);
              }
            } catch {
              if (!cancelled) setLoyaltyError(true);
            }
          }
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
  }, [session, lifecycle, initialOrderId, user.id]);

  useEffect(() => {
    let cancelled = false;
    if (typeof apiGet === 'function') {
      apiGet<DbPromotion[]>('/promotions')
        .then((rows) => {
          if (!cancelled && Array.isArray(rows)) {
            setVouchers(rows);
          }
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const inOrderPhase = Boolean(state.request || state.orderId);
  const quoting = !inOrderPhase && lines.length > 0 && quote?.fingerprint !== fingerprint;

  useEffect(() => {
    if (inOrderPhase || !lines.length || quote?.fingerprint === fingerprint) return;
    let cancelled = false;
    const body = JSON.parse(fingerprint) as OrderRequest;
    apiPost<Quote>('/orders/quote', body)
      .then((value) => {
        if (!cancelled) {
          setQuote({ fingerprint, value });
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(describeCheckoutError(e).message);
          setQuote({ fingerprint });
          if (activePromo) {
            setPromo('');
            setPromoInput('');
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [inOrderPhase, lines.length, quote?.fingerprint, fingerprint, activePromo]);

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
          if (getUser()?.id === user.id && lifecycle.isActive()) {
            updateUserPoints(balance.points);
            setLoyaltyError(false);
          }
        } catch {
          setLoyaltyError(true);
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

  const currentStep = paid ? 3 : inOrderPhase ? 2 : 1;

  return (
    <main className="shop mx-auto max-w-6xl px-6 py-8">
      <div className="rounded-2xl border border-[#b5dcc0] bg-[#cbe8d3] p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">BrewLite Mộc Vị / Thanh toán</p>
            <h1 className="mt-1.5">Hoàn tất đơn của bạn</h1>
            <p className="my-1 text-sm text-[#5c4033]">
              Thanh toán trực tuyến an toàn qua cổng VNPAY Sandbox. Giá, tồn kho và điểm được xử lý bởi backend.
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
            <div className="mx-auto max-w-3xl space-y-6">
              <div>
                <div className="flex items-center justify-between border-b border-[#decbb4] pb-3">
                  <h2 className="m-0">Tóm tắt món đặt ({totalItems} ly)</h2>
                  <span className="rounded-full bg-[#cbe8d3] px-3 py-0.5 text-xs font-bold text-[#2d6a4f]">
                    {lines.length} dòng món
                  </span>
                </div>

                <ul className="divide-y divide-[#decbb4]/70">
                  {lines.map((l) => {
                    const unit = getLineUnitPrice(l);
                    const lineSum = unit * l.qty;
                    return (
                      <li
                        key={l.id}
                        className="flex items-center justify-between gap-3 py-3.5 text-sm"
                      >
                        <div>
                          <span className="font-bold text-[#4a2e20]">
                            {l.productName} · Size {l.size}
                          </span>
                          <span className="block text-xs text-[#7a6254]">
                            {l.toppings.map((t) => t.name).join(', ') || 'Không topping'} ·{' '}
                            {formatVnd(unit)} × {l.qty}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="block font-extrabold text-[#6d4c3d]">
                            {formatVnd(lineSum)}
                          </span>
                          <span className="inline-block rounded-full bg-[#efe5d4] px-2.5 py-0.5 text-[11px] font-bold text-[#4a2e20]">
                            × {l.qty}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Khu vực chọn Voucher / Mã giảm giá lấy từ bảng Promotion trong DB, cuộn dọc từ trên xuống dưới */}
              <div className="rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="m-0 text-base font-extrabold text-[#4a2e20]">
                      🎟️ Ưu đãi &amp; Mã giảm giá (Voucher)
                    </h3>
                    <p className="m-0 mt-0.5 text-xs text-[#7a6254]">
                      Danh sách mã lấy trực tiếp từ bảng Promotion trong Database. Cuộn xuống để chọn mã.
                    </p>
                  </div>
                  {activePromo && (
                    <span className="rounded-full bg-[#2d6a4f] px-3 py-1 text-xs font-bold text-white">
                      Đang dùng: {activePromo}
                    </span>
                  )}
                </div>

                <div className="mt-4 max-h-72 space-y-2.5 overflow-y-auto pr-1">
                  {vouchers.map((v) => {
                    const eligible = estimatedSubtotal >= v.minSubtotal;
                    const selected = activePromo === v.code;
                    const estSave = computePromoDiscount(v, estimatedSubtotal);
                    return (
                      <div
                        key={v.code}
                        className={`flex items-center justify-between gap-3 rounded-xl border p-3.5 transition ${
                          selected
                            ? 'border-[#2d6a4f] bg-[#cbe8d3]/60 shadow-2xs'
                            : eligible
                              ? 'border-[#decbb4] bg-white hover:border-[#6d4c3d]'
                              : 'border-[#e2d2b8] bg-white/60 opacity-75'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-md bg-[#6d4c3d] px-2 py-0.5 font-mono text-xs font-extrabold text-white">
                              {v.code}
                            </span>
                            <span className="text-sm font-extrabold text-[#4a2e20]">
                              {formatPromoTitle(v)}
                            </span>
                          </div>
                          <p className="m-0 mt-1 text-xs text-[#7a6254]">
                            {formatPromoCondition(v)}
                            {eligible ? (
                              <span className="ml-1.5 font-bold text-[#2d6a4f]">
                                · Tiết kiệm {formatVnd(estSave)}
                              </span>
                            ) : (
                              <span className="ml-1.5 font-semibold text-amber-800">
                                · Mua thêm {formatVnd(v.minSubtotal - estimatedSubtotal)} để dùng mã
                              </span>
                            )}
                          </p>
                        </div>

                        <button
                          type="button"
                          disabled={busy || !eligible}
                          onClick={() => {
                            setError('');
                            const next = selected ? '' : v.code;
                            setPromo(next);
                            setPromoInput(next);
                          }}
                          style={{
                            margin: 0,
                            padding: '6px 14px',
                            fontSize: '12px',
                            background: selected ? '#2d6a4f' : eligible ? '#6d4c3d' : '#decbb4',
                            color: '#ffffff',
                            border: 'none',
                          }}
                        >
                          {selected ? '✓ Đã chọn' : eligible ? 'Chọn mã' : 'Chưa đủ ĐK'}
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 border-t border-[#decbb4] pt-3">
                  <p className="m-0 mb-2 text-xs font-bold text-[#7a6254]">
                    Hoặc nhập mã khuyến mãi khác:
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={promoInput}
                      maxLength={32}
                      placeholder="Nhập mã ưu đãi (VD: SAVE10, GIAM20K...)"
                      onChange={(e) => setPromoInput(e.target.value)}
                      disabled={busy}
                      style={{ margin: 0, flex: 1 }}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setError('');
                        setPromo(promoInput.trim().toUpperCase());
                      }}
                      style={{
                        margin: 0,
                        padding: '8px 16px',
                        fontSize: '12px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {promoInput.trim() ? 'Áp dụng' : 'Bỏ mã'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Bảng tổng kết thanh toán hiển thị ngay bên dưới theo chiều dọc */}
              <div className="rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="m-0 text-base font-extrabold text-[#4a2e20]">
                    Chi tiết thanh toán
                  </h2>
                  <span className="rounded-full bg-[#cbe8d3] px-2.5 py-0.5 text-[11px] font-bold text-[#2d6a4f]">
                    {quoting
                      ? 'Đang cập nhật giá…'
                      : currentQuote
                        ? '✓ Giá từ hệ thống'
                        : 'Giá tạm tính'}
                  </span>
                </div>

                <div className="mt-4 space-y-3 rounded-xl bg-white p-4 text-sm">
                  <p className="m-0 flex items-center justify-between text-[#7a6254]">
                    <span>Tạm tính ({totalItems} ly):</span>
                    <span className="font-bold text-[#4a2e20]">{formatVnd(displaySubtotal)}</span>
                  </p>
                  <p className="m-0 flex items-center justify-between text-[#2d6a4f]">
                    <span>
                      Ưu đãi Voucher{activePromo ? ` (${activePromo})` : ''}:
                    </span>
                    <span className="font-bold">−{formatVnd(displayDiscount)}</span>
                  </p>
                  <div className="border-t border-[#decbb4] pt-3">
                    <div className="flex items-center justify-between text-base">
                      <strong className="text-[#4a2e20]">Tổng thanh toán:</strong>
                      <strong className="text-xl font-extrabold text-[#6d4c3d]">
                        {formatVnd(displayTotal)}
                      </strong>
                    </div>
                    <p className="m-0 mt-1.5 flex items-center justify-between text-xs text-[#7a6254]">
                      <span>Điểm thưởng khi hoàn thành đơn:</span>
                      <span className="rounded-full bg-[#cbe8d3] px-2.5 py-0.5 font-bold text-[#2d6a4f]">
                        +{Math.floor(displayTotal / 10000)} điểm
                      </span>
                    </p>
                  </div>

                  <div className="pt-2">
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          let quotedTotal = currentQuote?.total;
                          if (quotedTotal === undefined) {
                            const q = await session.quote(request);
                            setQuote({ fingerprint, value: q });
                            quotedTotal = q.total;
                          }
                          await session.create(
                            request,
                            lines.map((l) => ({ id: l.id, key: l.key, qty: l.qty })),
                            quotedTotal,
                          );
                        })
                      }
                      style={{ width: '100%', margin: 0 }}
                    >
                      Đặt đơn &amp; Tiếp tục thanh toán
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      ) : paid && order ? (
        /* MÀN HÌNH THANH TOÁN THÀNH CÔNG */
        <div className="mx-auto mt-6 max-w-2xl space-y-6">
          <div className="overflow-hidden rounded-3xl border border-[#decbb4] bg-white shadow-md">
            {/* Header Hero */}
            <div className="border-b border-[#decbb4]/60 bg-gradient-to-b from-[#dff2e4] to-[#faf6ec] px-6 py-10 text-center">
              <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-[#2d6a4f] text-white shadow-lg">
                <svg className="size-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="inline-block rounded-full bg-[#cbe8d3] px-3.5 py-1 text-xs font-extrabold uppercase tracking-wider text-[#2d6a4f]">
                Giao dịch thành công
              </span>
              <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold text-[#4a2e20]">
                Thanh toán thành công!
              </h1>
              <p className="mt-2 text-sm text-[#7a6254]">
                Cảm ơn bạn! Đơn hàng đã được xác nhận và đang được chuyển tới quầy pha chế.
              </p>
            </div>

            {/* Chi tiết biên nhận */}
            <div className="space-y-6 p-6 sm:p-8">
              {/* Thẻ thông tin thanh toán */}
              <div className="rounded-2xl border border-[#e2d2b8] bg-[#faf6ec] p-5">
                <div className="flex items-center justify-between border-b border-[#decbb4] pb-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#7a6254]">Mã đơn hàng</span>
                  <span className="font-mono text-base font-extrabold text-[#4a2e20]">{order.code}</span>
                </div>

                <div className="mt-3 space-y-2.5 text-sm">
                  <div className="flex items-center justify-between text-[#7a6254]">
                    <span>Phương thức:</span>
                    <span className="font-bold text-[#4a2e20]">
                      {confirmedPaymentMethod === 'WALLET'
                        ? 'Ví điện tử'
                        : confirmedPaymentMethod === 'CARD'
                          ? 'Thẻ ngân hàng'
                          : 'Chưa có thông tin'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[#7a6254]">
                    <span>Trạng thái đơn:</span>
                    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                      ✓ {ORDER_STATUS_LABELS[order.status]?.label ?? 'Đã thanh toán (PAID)'}
                    </span>
                  </div>
                  {order.promotionCode && (
                    <div className="flex items-center justify-between text-[#2d6a4f]">
                      <span>Ưu đãi áp dụng:</span>
                      <span className="font-bold">{order.promotionCode} (−{formatVnd(order.discount)})</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between border-t border-[#decbb4] pt-3 text-base">
                    <strong className="text-[#4a2e20]">Tổng tiền thanh toán:</strong>
                    <strong className="text-2xl font-black text-[#6d4c3d]">
                      {formatVnd(order.total)}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Tích điểm thưởng Loyalty */}
              <div className="flex items-center gap-4 rounded-2xl border border-[#b5dcc0] bg-[#eef7f0] p-4 text-[#2d6a4f]">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#cbe8d3] text-2xl">
                  ⭐
                </div>
                <div className="flex-1 text-sm">
                  {order.status === 'COMPLETED' ? (
                    <p className="m-0 font-extrabold text-[#1b4332]">
                      Đơn đã hoàn thành. Điểm thưởng đã được cộng.
                    </p>
                  ) : (
                    <p className="m-0 font-extrabold text-[#1b4332]">
                      Điểm dự kiến: +{Math.floor(order.total / 10000)}. Điểm được cộng khi đơn hoàn thành.
                    </p>
                  )}
                  {loyaltyError ? (
                    <p className="m-0 mt-0.5 text-xs text-amber-700">
                      Chưa cập nhật được số dư điểm mới nhất từ hệ thống.
                    </p>
                  ) : (
                    <p className="m-0 mt-0.5 text-xs text-[#2d6a4f]">
                      Số dư hiện tại: <strong>{user.loyaltyPoints}</strong> điểm.
                    </p>
                  )}
                </div>
                <Link href="/loyalty" className="text-xs font-bold underline hover:text-[#1b4332]">
                  Xem điểm →
                </Link>
              </div>

              {/* Tóm tắt món đã mua */}
              <div className="rounded-2xl border border-[#e2d2b8] bg-[#efe5d4]/40 p-4">
                <h3 className="m-0 mb-3 text-xs font-bold uppercase tracking-wider text-[#7a6254]">
                  Món trong đơn ({order.items.reduce((sum, item) => sum + item.qty, 0)} ly)
                </h3>
                <ul className="divide-y divide-[#decbb4]/60">
                  {order.items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between py-2.5 text-sm">
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
              </div>

              {/* Nút hành động */}
              <div className="space-y-3 pt-2">
                <Link
                  href={`/orders/${order.id}`}
                  className="block w-full rounded-full bg-[#6d4c3d] py-3 text-center text-sm font-bold text-white shadow-sm transition hover:bg-[#563a2d]"
                >
                  Theo dõi &amp; Xem chi tiết đơn hàng →
                </Link>
                <div className="flex gap-3">
                  <Link
                    href="/menu"
                    className="flex-1 rounded-full border border-[#decbb4] bg-[#efe5d4] py-2.5 text-center text-xs font-bold text-[#4a2e20] transition hover:bg-[#e2d2b8]"
                  >
                    Tiếp tục mua sắm
                  </Link>
                  <button
                    disabled={busy}
                    onClick={() => {
                      try {
                        session.startOver();
                        setState(session.snapshot());
                        setQuote(undefined);
                        if (initialOrderId) router.replace('/checkout');
                      } catch (e) {
                        setError(describeCheckoutError(e).message);
                      }
                    }}
                    style={{ margin: 0 }}
                    className="flex-1 rounded-full border border-[#decbb4] bg-white py-2.5 text-center text-xs font-bold text-[#4a2e20] transition hover:bg-gray-50"
                  >
                    Bắt đầu đơn mới
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : state.verified && order?.status === 'PAYMENT_FAILED' ? (
        /* MÀN HÌNH THANH TOÁN THẤT BẠI (CHẮC CHẮN) */
        <div className="mx-auto mt-6 max-w-2xl space-y-6">
          <div className="overflow-hidden rounded-3xl border border-[#e5b8b8] bg-white shadow-md">
            {/* Header Hero */}
            <div className="border-b border-[#e5b8b8]/60 bg-gradient-to-b from-[#fbeaea] to-[#faf6ec] px-6 py-10 text-center">
              <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-[#9b2c2c] text-white shadow-lg">
                <svg className="size-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <span className="inline-block rounded-full bg-red-100 px-3.5 py-1 text-xs font-extrabold uppercase tracking-wider text-[#9b2c2c]">
                Thanh toán không thành công
              </span>
              <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold text-[#4a2e20]">
                Thanh toán thất bại
              </h1>
              <p className="mt-2 text-sm text-[#7a6254]">
                Cổng thanh toán ghi nhận giao dịch không thành công (PAYMENT_FAILED).
              </p>
            </div>

            {/* Content Body */}
            <div className="space-y-6 p-6 sm:p-8">
              {/* Bảo vệ an toàn */}
              <div className="rounded-2xl border border-[#decbb4] bg-[#efe5d4] p-4 text-xs text-[#4a2e20]">
                <p className="m-0 font-bold text-[#2d6a4f] flex items-center gap-1.5">
                  <span className="text-base">🛡️</span> Giỏ hàng của bạn vẫn được giữ nguyên đầy đủ!
                </p>
                <p className="m-0 mt-1 text-[#7a6254]">
                  Kho hàng và lượt dùng mã khuyến mãi đã được hoàn trả an toàn (RELEASED). Bạn có thể đổi phương thức hoặc thử lại kịch bản thanh toán bất kỳ lúc nào.
                </p>
              </div>

              {/* Thông tin đơn */}
              <div className="rounded-2xl border border-[#e2d2b8] bg-[#faf6ec] p-5">
                <div className="flex items-center justify-between border-b border-[#decbb4] pb-3 text-sm">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#7a6254]">Mã đơn hàng</span>
                  <span className="font-mono font-bold text-[#4a2e20]">{order.code}</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-base">
                  <span className="font-bold text-[#4a2e20]">Số tiền cần thanh toán:</span>
                  <span className="text-xl font-extrabold text-[#6d4c3d]">{formatVnd(order.total)}</span>
                </div>
              </div>

              {/* Khu vực Thử lại thanh toán */}
              <div className="rounded-2xl border-2 border-[#005baa]/30 bg-gradient-to-br from-blue-50/40 to-white p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="m-0 text-sm font-extrabold text-[#005baa]">
                    Thử lại thanh toán qua cổng VNPAY
                  </h3>
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-800">
                    Bên thứ 3 (Sandbox)
                  </span>
                </div>

                <button
                  type="button"
                  disabled={busy || vnpayLoading}
                  onClick={() => void handleVnPayPayment()}
                  style={{
                    width: '100%',
                    margin: 0,
                    backgroundColor: '#005baa',
                    color: '#ffffff',
                    fontWeight: 'bold',
                    border: 'none',
                  }}
                  className="rounded-full py-3 text-sm transition hover:bg-[#004885] disabled:opacity-50"
                >
                  {vnpayLoading ? 'Đang mở cổng VNPAY…' : 'Thanh toán lại qua VNPAY Sandbox →'}
                </button>
              </div>

              {/* Thao tác khác */}
              <div className="flex flex-wrap gap-3 pt-2">
                <Link
                  href="/cart"
                  className="flex-1 rounded-full border border-[#decbb4] bg-[#efe5d4] py-2.5 text-center text-xs font-bold text-[#4a2e20] transition hover:bg-[#e2d2b8]"
                >
                  Quay lại giỏ hàng
                </Link>
                <button
                  disabled={busy}
                  onClick={() => run(() => session.verify())}
                  style={{
                    background: '#efe5d4',
                    color: '#4a2e20',
                    border: '1px solid #decbb4',
                    margin: 0,
                  }}
                  className="flex-1 rounded-full py-2.5 text-center text-xs font-bold transition hover:bg-[#e2d2b8]"
                >
                  Xác minh lại trạng thái
                </button>
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
                    margin: 0,
                  }}
                  className="flex-1 rounded-full py-2.5 text-center text-xs font-bold transition hover:bg-[#f5d5d5]"
                >
                  Hủy đơn hàng này
                </button>
                <Link
                  href={`/orders/${order.id}`}
                  className="w-full text-center text-xs font-bold text-[#6d4c3d] hover:underline"
                >
                  Xem chi tiết đơn hàng →
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : (!state.verified && (order?.status === 'PAYMENT_FAILED' || order?.status === 'CANCELLED' || (Boolean(state.attempt) && order?.status !== 'PENDING'))) ? (
        /* MÀN HÌNH CHƯA XÁC NHẬN ĐƯỢC TRẠNG THÁI ĐƠN HÀNG (TIMEOUT / LỖI MẠNG) */
        <div className="mx-auto mt-6 max-w-2xl space-y-6">
          <div className="overflow-hidden rounded-3xl border border-amber-300 bg-white shadow-md">
            {/* Header Hero */}
            <div className="border-b border-amber-200 bg-gradient-to-b from-amber-50 to-[#faf6ec] px-6 py-10 text-center">
              <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-amber-600 text-white shadow-lg">
                <svg className="size-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <span className="inline-block rounded-full bg-amber-100 px-3.5 py-1 text-xs font-extrabold uppercase tracking-wider text-amber-800">
                Đang chờ xác minh
              </span>
              <h1 className="mt-3 text-2xl sm:text-3xl font-extrabold text-[#4a2e20]">
                {order?.status === 'CANCELLED'
                  ? 'Chưa xác nhận được trạng thái hủy đơn'
                  : 'Chưa xác nhận được kết quả thanh toán'}
              </h1>
              <p className="mt-2 text-sm text-[#7a6254]">
                {order?.status === 'CANCELLED'
                  ? 'Dữ liệu đơn hàng chưa được xác minh từ máy chủ do lỗi mạng hoặc gián đoạn kết nối. Vui lòng bấm xác minh lại để cập nhật trạng thái mới nhất.'
                  : 'Yêu cầu thanh toán đã được gửi đi nhưng hệ thống chưa thể xác nhận trạng thái cuối cùng do gián đoạn kết nối hoặc quá thời gian chờ (timeout).'}
              </p>
            </div>

            {/* Content Body */}
            <div className="space-y-6 p-6 sm:p-8">
              {/* Bảo vệ an toàn */}
              <div className="rounded-2xl border border-[#b5dcc0] bg-[#eef7f0] p-4 text-xs text-[#2d6a4f]">
                <p className="m-0 font-bold flex items-center gap-1.5">
                  <span className="text-base">🛡️</span> Giỏ hàng của bạn vẫn được giữ nguyên đầy đủ!
                </p>
                <p className="m-0 mt-1 text-[#2d6a4f]/90">
                  {order?.status === 'CANCELLED'
                    ? 'Thông tin đơn hàng và giỏ hàng đang được giữ an toàn. Hệ thống cần xác nhận trạng thái đơn từ máy chủ trước khi bắt đầu đơn mới.'
                    : 'Dữ liệu giỏ hàng, thông tin đơn và lượt áp dụng ưu đãi vẫn được bảo toàn an toàn. Hệ thống chưa xác nhận thành công hay thất bại nên chưa thực hiện trừ giỏ hàng.'}
                </p>
              </div>

              {/* Thông tin đơn và lần thử thanh toán */}
              <div className="rounded-2xl border border-[#e2d2b8] bg-[#faf6ec] p-5">
                <div className="flex items-center justify-between border-b border-[#decbb4] pb-3 text-sm">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#7a6254]">Mã đơn hàng</span>
                  <span className="font-mono font-bold text-[#4a2e20]">{order?.code}</span>
                </div>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex items-center justify-between text-[#7a6254]">
                    <span>Trạng thái ghi nhận:</span>
                    <span className="font-bold text-[#4a2e20]">
                      {order?.status === 'CANCELLED'
                        ? 'Đã hủy (chưa xác minh lại)'
                        : order?.status === 'PAYMENT_FAILED'
                          ? 'Thất bại (chưa xác minh lại)'
                          : order?.status ?? '---'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[#7a6254]">
                    <span>Số tiền cần thanh toán:</span>
                    <strong className="text-base font-extrabold text-[#6d4c3d]">
                      {order ? formatVnd(order.total) : '---'}
                    </strong>
                  </div>
                  {state.attempt && (
                    <>
                      <div className="flex items-center justify-between text-[#7a6254]">
                        <span>Phương thức gửi đi:</span>
                        <span className="font-bold text-[#4a2e20]">
                          {state.attempt.request.method === 'WALLET' ? 'Ví điện tử' : 'Thẻ ngân hàng'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[#7a6254]">
                        <span>Kịch bản thử nghiệm:</span>
                        <span className="font-bold text-[#4a2e20]">
                          {state.attempt.request.mockOutcome === 'SUCCESS' ? 'Thành công (SUCCESS)' : 'Thất bại (FAIL)'}
                        </span>
                      </div>
                    </>
                  )}
                </div>
                <p className="m-0 mt-3 border-t border-[#decbb4] pt-3 text-[11px] text-[#7a6254]">
                  * Dữ liệu đang được giữ nguyên an toàn. Vui lòng bấm &ldquo;Xác minh lại trạng thái đơn&rdquo; để kiểm tra kết quả từ máy chủ.
                </p>
              </div>

              {/* Nút hành động chính: Verify */}
              <div className="space-y-3 pt-2">
                <button
                  disabled={busy}
                  onClick={() => run(() => session.verify())}
                  style={{ width: '100%', margin: 0 }}
                  className="rounded-full bg-[#6d4c3d] py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#563a2d]"
                >
                  {busy ? 'Đang xác minh với hệ thống…' : 'Xác minh lại trạng thái đơn'}
                </button>

                <div className="flex gap-3">
                  <Link
                    href="/cart"
                    className="flex-1 rounded-full border border-[#decbb4] bg-[#efe5d4] py-2.5 text-center text-xs font-bold text-[#4a2e20] transition hover:bg-[#e2d2b8]"
                  >
                    Quay lại giỏ hàng
                  </Link>
                  {order && (
                    <Link
                      href={`/orders/${order.id}`}
                      className="flex-1 rounded-full border border-[#decbb4] bg-white py-2.5 text-center text-xs font-bold text-[#4a2e20] transition hover:bg-gray-50"
                    >
                      Xem chi tiết đơn hàng →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : state.verified && order?.status === 'CANCELLED' ? (
        /* MÀN HÌNH ĐƠN HÀNG ĐÃ HỦY (CHẮC CHẮN) */
        <div className="mx-auto mt-6 max-w-2xl space-y-6">
          <div className="overflow-hidden rounded-3xl border border-[#decbb4] bg-white p-8 text-center shadow-md">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-gray-200 text-gray-600 text-2xl font-bold">
              ✕
            </div>
            <h1 className="text-2xl font-extrabold text-[#4a2e20]">
              Đơn hàng đã được hủy
            </h1>
            <p className="mt-2 text-sm text-[#7a6254]">
              Đơn hàng {order.code} đã được hủy thành công. Hàng giữ kho và mã khuyến mãi đã được hoàn trả an toàn.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Link
                href="/menu"
                className="rounded-full bg-[#6d4c3d] px-6 py-2.5 text-xs font-bold text-white transition hover:bg-[#563a2d]"
              >
                Về thực đơn
              </Link>
              <button
                disabled={busy || !state.verified}
                onClick={() => {
                  try {
                    session.startOver();
                    setState(session.snapshot());
                    setQuote(undefined);
                    if (initialOrderId) router.replace('/checkout');
                  } catch (e) {
                    setError(describeCheckoutError(e).message);
                  }
                }}
                className="rounded-full border border-[#decbb4] bg-[#efe5d4] px-6 py-2.5 text-xs font-bold text-[#4a2e20] transition hover:bg-[#e2d2b8]"
              >
                Bắt đầu đơn mới
              </button>
              <button
                disabled={busy}
                onClick={() => run(() => session.verify())}
                className="rounded-full border border-[#decbb4] bg-white px-6 py-2.5 text-xs font-bold text-[#4a2e20] transition hover:bg-gray-50"
              >
                Xác minh lại
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mx-auto mt-6 max-w-3xl space-y-6">
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
                  {order.status === 'COMPLETED'
                    ? 'Đơn đã hoàn thành. Điểm thưởng đã được cộng.'
                    : `Điểm dự kiến: +${Math.floor(order.total / 10000)}. Điểm được cộng khi đơn hoàn thành.`}
                </p>
                <p className="text-sm text-[#4a2e20]">
                  {loyaltyError
                    ? 'Chưa cập nhật được số dư điểm mới nhất từ hệ thống.'
                    : `Điểm tích lũy hiện tại (từ hệ thống): ${user.loyaltyPoints}`}
                </p>
                <Link href="/loyalty" className="font-bold text-[#6d4c3d]">
                  Xem điểm thưởng →
                </Link>
              </section>
            )}
          </div>

          <div className="space-y-6">
            {order && !terminal && (
              <section className="shop-panel m-0 border-2 border-[#005baa]/30 bg-gradient-to-br from-blue-50/40 to-white">
                <div className="flex items-center justify-between border-b border-[#decbb4] pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-lg bg-[#005baa] text-white text-xs font-black">
                      VNP
                    </span>
                    <h2 className="m-0 text-base font-extrabold text-[#005baa]">
                      Cổng thanh toán VNPAY
                    </h2>
                  </div>
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-800">
                    Bên thứ 3 (Sandbox)
                  </span>
                </div>

                <p className="mt-3 text-xs text-[#7a6254]">
                  Thanh toán an toàn qua cổng <strong>VNPAY Sandbox</strong> hỗ trợ thẻ ATM nội địa (NCB...), Internet Banking và quét mã VNPAY-QR.
                </p>

                <div className="mt-4">
                  <button
                    type="button"
                    disabled={busy || !state.verified || needsPriceConfirm || vnpayLoading}
                    onClick={() => void handleVnPayPayment()}
                    style={{
                      width: '100%',
                      margin: 0,
                      backgroundColor: '#005baa',
                      color: '#ffffff',
                      fontWeight: 'bold',
                      border: 'none',
                    }}
                    className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm shadow-sm transition hover:bg-[#004885] disabled:opacity-50"
                  >
                    {vnpayLoading ? 'Đang mở cổng VNPAY…' : `Thanh toán ${formatVnd(order.total)} qua VNPAY →`}
                  </button>
                </div>
              </section>
            )}

            {order && !terminal && state.attempt && (
              <div className="hidden" aria-hidden="true">
                <select
                  value={replayAttempt?.request.method ?? method}
                  disabled={busy || Boolean(replayAttempt)}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                >
                  <option value="WALLET">Ví điện tử</option>
                  <option value="CARD">Thẻ ngân hàng</option>
                </select>
                <select
                  value={replayAttempt ? (replayAttempt.request.mockOutcome ?? 'SUCCESS') : outcome}
                  disabled={busy || Boolean(replayAttempt)}
                  onChange={(e) => setOutcome(e.target.value as 'SUCCESS' | 'FAIL')}
                >
                  <option value="SUCCESS">Thành công</option>
                  <option value="FAIL">Thất bại</option>
                </select>
              </div>
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
                {order && (['PENDING', 'PAYMENT_FAILED', 'PAID'] as OrderStatus[]).includes(order.status) && (
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
                      ? 'Hủy đơn và hoàn tiền'
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

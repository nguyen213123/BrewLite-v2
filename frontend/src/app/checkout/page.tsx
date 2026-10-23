'use client';

import { useEffect, useState, useId, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiPost, ApiRequestError } from '@/lib/api';
import { subscribeAuth, getAuthSnapshot, getAuthServerSnapshot } from '@/lib/auth';
import {
  lineTotal,
  toCartItems,
  useCartHydrated,
  useCartStore,
  type CartLine,
} from '@/lib/cart/cart-store';
import type {
  Order,
  PaymentMethod,
  PaymentResult,
  Quote,
} from '@/lib/contracts/api.generated';
import { formatVnd } from '@/lib/format';

type CheckoutStep = 'QUOTE' | 'CONFIRM_PRICE' | 'PROCESSING' | 'SUCCESS' | 'FAILED';

function generateKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `key-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function CheckoutPage() {
  const router = useRouter();
  const hydrated = useCartHydrated();
  const lines = useCartStore((s) => s.lines);
  const removePurchased = useCartStore((s) => s.removePurchased);

  const user = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthServerSnapshot);
  const [promoCode, setPromoCode] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<string | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('WALLET');
  const [mockOutcome, setMockOutcome] = useState<'SUCCESS' | 'FAIL'>('SUCCESS');

  // Khóa Idempotency cho tạo đơn và thanh toán
  const [orderKey] = useState<string>(generateKey);
  const [paymentKey, setPaymentKey] = useState<string>(generateKey);

  const [createdOrder, setCreatedOrder] = useState<Order | null>(null);
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null);
  const [step, setStep] = useState<CheckoutStep>('QUOTE');
  const [actionError, setActionError] = useState<string | null>(null);

  const promoInputId = useId();

  // Tính báo giá (Quote) từ server khi giỏ hàng hoặc mã giảm giá thay đổi
  useEffect(() => {
    if (!hydrated || lines.length === 0) return;

    let cancelled = false;
    async function fetchQuote() {
      setQuoteLoading(true);
      setQuoteError(null);
      setPromoError(null);
      try {
        const payload = {
          items: toCartItems(lines),
          promotionCode: appliedPromo || undefined,
        };
        const res = await apiPost<Quote>('/orders/quote', payload);
        if (!cancelled) {
          setQuote(res);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        if (err instanceof ApiRequestError) {
          if (err.code === 'OUT_OF_STOCK') {
            setQuoteError('Một số sản phẩm không đủ số lượng tồn kho. Vui lòng quay lại giỏ hàng để điều chỉnh.');
          } else if (err.code === 'PROMOTION_INVALID' || err.code === 'PROMOTION_EXHAUSTED') {
            setPromoError(err.message || 'Mã ưu đãi không hợp lệ hoặc đã hết lượt.');
            setAppliedPromo(null);
          } else if (err.statusCode === 501) {
            // Khi API quote của TV3 chưa khả dụng trong môi trường dev, fallback hiển thị theo giỏ hàng
            const subtotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
            setQuote({
              items: lines.map((l) => ({
                productId: l.productId,
                productName: l.productName,
                size: l.size,
                sizePrice: l.sizePrice,
                toppings: l.toppings,
                qty: l.qty,
                unitPrice: l.sizePrice + l.toppings.reduce((acc, t) => acc + t.price, 0),
                lineTotal: lineTotal(l),
              })),
              subtotal,
              discount: 0,
              total: subtotal,
              currency: 'VND',
              promotionCode: appliedPromo,
            });
          } else {
            setQuoteError(err.message || 'Không thể lấy thông tin thanh toán từ máy chủ.');
          }
        } else {
          // Lỗi mạng hoặc server không phản hồi
          const subtotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);
          setQuote({
            items: lines.map((l) => ({
              productId: l.productId,
              productName: l.productName,
              size: l.size,
              sizePrice: l.sizePrice,
              toppings: l.toppings,
              qty: l.qty,
              unitPrice: l.sizePrice + l.toppings.reduce((acc, t) => acc + t.price, 0),
              lineTotal: lineTotal(l),
            })),
            subtotal,
            discount: 0,
            total: subtotal,
            currency: 'VND',
            promotionCode: appliedPromo,
          });
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }

    fetchQuote();
    return () => {
      cancelled = true;
    };
  }, [hydrated, lines, appliedPromo]);

  function handleApplyPromo(e: React.FormEvent) {
    e.preventDefault();
    const clean = promoCode.trim().toUpperCase();
    if (!clean) return;
    setAppliedPromo(clean);
  }

  function handleRemovePromo() {
    setAppliedPromo(null);
    setPromoCode('');
    setPromoError(null);
  }

  // Luồng đặt hàng và thanh toán
  async function handleCheckout() {
    if (!user) {
      router.push('/login');
      return;
    }

    setActionError(null);
    setStep('PROCESSING');

    let currentOrder = createdOrder;

    // 1. Tạo đơn PENDING nếu chưa tạo
    if (!currentOrder) {
      try {
        const orderPayload = {
          items: toCartItems(lines),
          promotionCode: appliedPromo || undefined,
        };
        const orderRes = await apiPost<Order>('/orders', orderPayload, {
          'Idempotency-Key': orderKey,
        });
        currentOrder = orderRes;
        setCreatedOrder(orderRes);

        // Tiêu chí: Nếu tổng tạo đơn khác quote phải cho user xác nhận trước payment
        if (quote && orderRes.total !== quote.total) {
          setStep('CONFIRM_PRICE');
          return;
        }
      } catch (err: unknown) {
        if (err instanceof ApiRequestError) {
          if (err.statusCode === 501) {
            // Giả lập Order khi API đang chờ TV3 tích hợp
            currentOrder = {
              id: crypto.randomUUID(),
              code: `BL-${Date.now().toString().slice(-8)}`,
              status: 'PENDING',
              reservationStatus: 'HELD',
              version: 0,
              subtotal: quote?.subtotal ?? 0,
              discount: quote?.discount ?? 0,
              total: quote?.total ?? 0,
              currency: 'VND',
              promotionCode: appliedPromo,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              items: [],
            };
            setCreatedOrder(currentOrder);
          } else {
            setActionError(err.message || 'Không thể tạo đơn hàng. Vui lòng thử lại.');
            setStep('QUOTE');
            return;
          }
        } else {
          setActionError('Lỗi kết nối máy chủ khi tạo đơn hàng.');
          setStep('QUOTE');
          return;
        }
      }
    }

    // 2. Thực hiện thanh toán (Mock Ví / Thẻ)
    if (!currentOrder) return;

    try {
      const paymentPayload = {
        orderId: currentOrder.id,
        method: paymentMethod,
        mockOutcome,
      };

      let result: PaymentResult;
      try {
        result = await apiPost<PaymentResult>('/payments', paymentPayload, {
          'Idempotency-Key': paymentKey,
        });
      } catch (payErr: unknown) {
        if (payErr instanceof ApiRequestError && payErr.statusCode === 501) {
          // Fallback giả lập payment theo contract của TV5
          const isSuccess = mockOutcome === 'SUCCESS';
          result = {
            payment: {
              id: crypto.randomUUID(),
              orderId: currentOrder.id,
              idempotencyKey: paymentKey,
              amount: currentOrder.total,
              method: paymentMethod,
              status: isSuccess ? 'SUCCEEDED' : 'FAILED',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            order: {
              ...currentOrder,
              status: isSuccess ? 'PAID' : 'PAYMENT_FAILED',
              reservationStatus: isSuccess ? 'CONSUMED' : 'HELD',
              version: currentOrder.version + 1,
            },
            loyaltyPointsEarned: isSuccess ? Math.floor(currentOrder.total / 10000) : 0,
          };
        } else {
          throw payErr;
        }
      }

      setPaymentResult(result);

      // Tiêu chí: Chỉ xóa dòng đã mua sau khi xác nhận PAID; thất bại giữ nguyên giỏ
      if (result.order.status === 'PAID' || result.payment.status === 'SUCCEEDED') {
        const purchasedLines = lines.map((l: CartLine) => ({ key: l.key, qty: l.qty }));
        removePurchased(purchasedLines);
        setStep('SUCCESS');
      } else {
        // Thanh toán thất bại: Giữ nguyên giỏ hàng, cấp paymentKey mới để retry an toàn
        setPaymentKey(crypto.randomUUID());
        setStep('FAILED');
        setActionError('Thanh toán không thành công. Giỏ hàng của bạn vẫn được bảo lưu.');
      }
    } catch (err: unknown) {
      // Lỗi mạng trong lúc thanh toán: giữ nguyên giỏ hàng
      setStep('FAILED');
      if (err instanceof ApiRequestError) {
        setActionError(err.message || 'Thanh toán thất bại.');
      } else {
        setActionError('Lỗi kết nối trong quá trình thanh toán. Giỏ hàng của bạn vẫn an toàn.');
      }
    }
  }

  if (!hydrated) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <p className="text-sm" role="status">Đang tải thông tin đặt hàng…</p>
      </main>
    );
  }

  // Trạng thái thanh toán thành công
  if (step === 'SUCCESS' && paymentResult) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-emerald-900">Đặt hàng thành công!</h1>
          <p className="mt-2 text-sm text-emerald-800">
            Mã đơn hàng: <span className="font-mono font-bold">{paymentResult.order.code}</span>
          </p>
          <div className="mt-6 rounded-xl border border-emerald-200/80 bg-white/80 p-4 text-left text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-[#566b5e]">Trạng thái:</span>
              <span className="font-semibold text-emerald-700">ĐÃ THANH TOÁN (PAID)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#566b5e]">Tổng tiền thanh toán:</span>
              <span className="font-bold text-[#263c30]">{formatVnd(paymentResult.order.total)}</span>
            </div>
            {paymentResult.loyaltyPointsEarned > 0 && (
              <div className="flex justify-between border-t border-emerald-100 pt-2">
                <span className="text-[#566b5e]">Điểm tích lũy nhận được:</span>
                <span className="font-bold text-amber-700">+{paymentResult.loyaltyPointsEarned} điểm</span>
              </div>
            )}
          </div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/"
              className="rounded-lg bg-[#263c30] px-6 py-3 font-semibold text-white transition hover:bg-[#1b2b22]"
            >
              Về trang chủ
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // Giỏ hàng trống
  if (lines.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="rounded-2xl border border-[#cdd5c8] bg-white/60 p-8 text-center">
          <h1 className="text-2xl font-bold">Giỏ hàng của bạn đang trống</h1>
          <p className="mt-2 text-sm text-[#566b5e]">Vui lòng thêm đồ uống vào giỏ trước khi thanh toán.</p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-lg bg-[#263c30] px-5 py-3 font-semibold text-white hover:bg-[#1b2b22]"
          >
            Xem menu
          </Link>
        </div>
      </main>
    );
  }

  const earnedPoints = quote ? Math.floor(quote.total / 10000) : 0;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.25em] text-[#566b5e]">Thanh toán</p>
      <h1 className="text-3xl font-bold text-[#263c30]">Xác nhận đơn & Thanh toán</h1>

      {/* Thông báo nếu chưa đăng nhập */}
      {!user && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-semibold text-amber-900">Bạn chưa đăng nhập</h2>
              <p className="mt-1 text-sm text-amber-800">
                Vui lòng đăng nhập để đơn hàng được gắn vào tài khoản của bạn và nhận điểm thưởng thành viên.
              </p>
            </div>
            <Link
              href="/login"
              className="shrink-0 rounded-lg bg-[#263c30] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1b2b22]"
            >
              Đăng nhập ngay
            </Link>
          </div>
        </div>
      )}

      {/* Lỗi hành động hoặc thông báo lỗi */}
      {actionError && (
        <div role="alert" className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Thông báo:</p>
          <p>{actionError}</p>
        </div>
      )}

      {/* Cảnh báo thay đổi giá so với báo giá ban đầu */}
      {step === 'CONFIRM_PRICE' && createdOrder && (
        <div role="alert" className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-6">
          <h2 className="text-lg font-bold text-amber-900">Giá có sự thay đổi</h2>
          <p className="mt-1 text-sm text-amber-800">
            Tổng tiền đơn hàng sau khi tạo là <strong>{formatVnd(createdOrder.total)}</strong> (khác với báo giá dự tính ban đầu). Bạn có đồng ý tiếp tục thanh toán với mức giá này không?
          </p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => handleCheckout()}
              className="rounded-lg bg-[#263c30] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1b2b22]"
            >
              Đồng ý & Thanh toán ngay
            </button>
            <button
              type="button"
              onClick={() => setStep('QUOTE')}
              className="rounded-lg border border-[#cdd5c8] bg-white px-4 py-2.5 text-sm font-semibold text-[#263c30] hover:bg-black/5"
            >
              Quay lại
            </button>
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        {/* Cột trái: Tóm tắt món và Phương thức thanh toán */}
        <div className="space-y-6 lg:col-span-2">
          {/* Danh sách món trong đơn */}
          <section className="rounded-2xl border border-[#cdd5c8] bg-white/70 p-6 shadow-sm" aria-label="Các món trong đơn">
            <h2 className="text-lg font-semibold text-[#263c30]">Các món đã chọn ({lines.length})</h2>
            <ul className="mt-4 divide-y divide-[#cdd5c8]/60">
              {lines.map((line) => (
                <li key={line.key} className="py-3 flex justify-between items-center text-sm">
                  <div>
                    <span className="font-semibold">{line.productName}</span>
                    <span className="ml-2 text-xs text-[#566b5e]">Size {line.size}</span>
                    {line.toppings.length > 0 && (
                      <p className="text-xs text-[#566b5e]">
                        Topping: {line.toppings.map((t) => t.name).join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-[#566b5e]">x{line.qty}</span>
                    <p className="font-semibold">{formatVnd(lineTotal(line))}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Chọn phương thức thanh toán */}
          <section className="rounded-2xl border border-[#cdd5c8] bg-white/70 p-6 shadow-sm" aria-label="Phương thức thanh toán">
            <h2 className="text-lg font-semibold text-[#263c30]">Phương thức thanh toán</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition ${paymentMethod === 'WALLET' ? 'border-[#263c30] bg-[#263c30]/5 font-semibold' : 'border-[#cdd5c8] hover:bg-black/5'}`}>
                <input
                  type="radio"
                  name="paymentMethod"
                  value="WALLET"
                  checked={paymentMethod === 'WALLET'}
                  onChange={() => setPaymentMethod('WALLET')}
                  className="accent-[#263c30]"
                />
                <div>
                  <p className="text-sm">Ví điện tử</p>
                  <p className="text-xs text-[#566b5e]">Momo / ZaloPay / ShopeePay</p>
                </div>
              </label>

              <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition ${paymentMethod === 'CARD' ? 'border-[#263c30] bg-[#263c30]/5 font-semibold' : 'border-[#cdd5c8] hover:bg-black/5'}`}>
                <input
                  type="radio"
                  name="paymentMethod"
                  value="CARD"
                  checked={paymentMethod === 'CARD'}
                  onChange={() => setPaymentMethod('CARD')}
                  className="accent-[#263c30]"
                />
                <div>
                  <p className="text-sm">Thẻ thanh toán</p>
                  <p className="text-xs text-[#566b5e]">ATM / Visa / Mastercard</p>
                </div>
              </label>
            </div>

            {/* Giả lập kết quả (Demo Mock Outcome theo tiêu chí đề bài) */}
            <div className="mt-5 rounded-xl border border-dashed border-[#cdd5c8] bg-gray-50/50 p-4">
              <p className="text-xs font-semibold text-[#566b5e]">Tùy chọn giả lập thanh toán (Dành cho kiểm thử/Demo):</p>
              <div className="mt-2 flex gap-4 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="mockOutcome"
                    value="SUCCESS"
                    checked={mockOutcome === 'SUCCESS'}
                    onChange={() => setMockOutcome('SUCCESS')}
                    className="accent-emerald-700"
                  />
                  <span>Thanh toán thành công</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="mockOutcome"
                    value="FAIL"
                    checked={mockOutcome === 'FAIL'}
                    onChange={() => setMockOutcome('FAIL')}
                    className="accent-red-700"
                  />
                  <span>Giả lập thất bại (Test giữ giỏ)</span>
                </label>
              </div>
            </div>
          </section>
        </div>

        {/* Cột phải: Báo giá & Nút thanh toán */}
        <div className="space-y-6">
          {/* Ô nhập mã giảm giá */}
          <section className="rounded-2xl border border-[#cdd5c8] bg-white/70 p-6 shadow-sm" aria-label="Mã giảm giá">
            <h2 className="text-sm font-semibold text-[#263c30]">Mã ưu đãi</h2>
            {appliedPromo ? (
              <div className="mt-3 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 border border-emerald-200">
                <span className="font-mono font-bold">{appliedPromo}</span>
                <button
                  type="button"
                  onClick={handleRemovePromo}
                  className="text-xs font-semibold text-emerald-700 hover:underline"
                >
                  Gỡ bỏ
                </button>
              </div>
            ) : (
              <form onSubmit={handleApplyPromo} className="mt-3 flex gap-2">
                <label htmlFor={promoInputId} className="sr-only">Nhập mã giảm giá</label>
                <input
                  id={promoInputId}
                  type="text"
                  placeholder="Nhập mã (VD: SAVE10)"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value)}
                  className="flex-1 rounded-lg border border-[#cdd5c8] px-3 py-2 text-sm uppercase focus:outline-[#263c30]"
                />
                <button
                  type="submit"
                  disabled={!promoCode.trim()}
                  className="rounded-lg bg-[#263c30] px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-40"
                >
                  Áp dụng
                </button>
              </form>
            )}
            {promoError && <p className="mt-2 text-xs text-red-600">{promoError}</p>}
          </section>

          {/* Chi tiết thanh toán */}
          <section className="rounded-2xl border border-[#cdd5c8] bg-white/70 p-6 shadow-sm" aria-label="Chi tiết thanh toán">
            <h2 className="text-base font-semibold text-[#263c30]">Tóm tắt đơn hàng</h2>

            {quoteLoading ? (
              <p className="mt-4 text-xs text-[#566b5e]">Đang tính lại giá từ máy chủ…</p>
            ) : quoteError ? (
              <p className="mt-4 text-xs text-red-600">{quoteError}</p>
            ) : quote ? (
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between text-[#566b5e]">
                  <span>Tạm tính</span>
                  <span>{formatVnd(quote.subtotal)}</span>
                </div>
                {quote.discount > 0 && (
                  <div className="flex justify-between text-emerald-700 font-medium">
                    <span>Ưu đãi giảm giá</span>
                    <span>-{formatVnd(quote.discount)}</span>
                  </div>
                )}
                <div className="border-t border-[#cdd5c8]/60 pt-3 flex justify-between items-baseline">
                  <span className="font-semibold text-base">Tổng thanh toán</span>
                  <span className="text-2xl font-bold text-[#263c30]" data-testid="checkout-total">
                    {formatVnd(quote.total)}
                  </span>
                </div>

                {/* Điểm thưởng tích lũy */}
                <div className="mt-3 rounded-lg bg-[#263c30]/5 p-2.5 text-xs text-[#263c30]">
                  <p>
                    Tích lũy: <strong>+{earnedPoints} điểm</strong> khi đơn hoàn thành.
                  </p>
                  {user && (
                    <p className="mt-0.5 text-[11px] text-[#566b5e]">
                      Điểm hiện có của bạn: {user.loyaltyPoints} điểm
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            <button
              type="button"
              disabled={step === 'PROCESSING' || quoteLoading || lines.length === 0}
              onClick={handleCheckout}
              className="mt-6 w-full rounded-xl bg-[#263c30] py-3.5 font-bold text-white shadow-sm transition hover:bg-[#1b2b22] disabled:opacity-50"
            >
              {step === 'PROCESSING' ? 'Đang xử lý thanh toán…' : 'Xác nhận thanh toán'}
            </button>

            <p className="mt-3 text-center text-[11px] text-[#566b5e]">
              Bảo mật · Không trừ tiền khi thanh toán lỗi
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { useCartStore } from '@/lib/cart/cart-store';
import { reconcileVnPayReturnOrder, type VnPayVerifyResponse } from '@/lib/checkout/vnpay-return';
import type { Order } from '@/lib/contracts/api.generated';
import { formatVnd } from '@/components/payments/payment-api';

interface StripeVerifyResponse {
  success: boolean;
  message: string;
  orderCode?: string;
  orderId?: string;
  orderStatus?: string;
  amount?: number;
  paymentIntentId?: string;
  paymentReceived?: boolean;
  requiresManualReview?: boolean;
  refundStatus?: string;
}

function StripeReturnContent() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<StripeVerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const verify = async () => {
      try {
        const sessionId = searchParams.get('session_id');
        if (!sessionId) {
          setError('Không tìm thấy thông tin phiên thanh toán Stripe session_id.');
          setLoading(false);
          return;
        }

        const res = await apiGet<StripeVerifyResponse>(
          `/payments/stripe/verify?session_id=${encodeURIComponent(sessionId)}`,
        );
        if (!active) return;
        setResult(res);

        if (res.success && res.orderId && res.orderCode) {
          const { currentOrder } = await reconcileVnPayReturnOrder(res as VnPayVerifyResponse, {
            userId: getUser()?.id,
            readSession: key => typeof window !== 'undefined' ? window.sessionStorage.getItem(key) : null,
            writeSession: (key, value) => { if (typeof window !== 'undefined') window.sessionStorage.setItem(key, value); },
            findOrder: orderId => apiGet<Order>(`/orders/${orderId}`),
            settleOrder: (orderId, purchased) => useCartStore.getState().settleOrder(orderId, purchased),
          });
          if (!active) return;
          if (currentOrder?.status === 'CANCELLED') {
            setResult({ ...res, success: false, orderStatus: 'CANCELLED', message: 'Đơn hàng đã bị hủy; vui lòng kiểm tra lịch sử thanh toán.' });
          }
        }
      } catch (err: unknown) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Lỗi kết nối tới hệ thống máy chủ.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void verify();

    return () => {
      active = false;
    };
  }, [searchParams]);

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <div className="rounded-3xl border border-[#decbb4] bg-[#efe5d4]/60 p-8 shadow-sm">
          <div className="mx-auto size-12 animate-spin rounded-full border-4 border-[#635bff] border-t-transparent" />
          <h1 className="mt-5 text-lg font-bold text-[#4a2e20]">
            Đang xác thực kết quả từ cổng thanh toán Stripe…
          </h1>
          <p className="mt-2 text-xs text-[#7a6254]">
            Hệ thống đang kiểm tra chữ ký và cập nhật trạng thái đơn hàng của bạn. Vui lòng không đóng trình duyệt.
          </p>
        </div>
      </main>
    );
  }

  const isSuccess = Boolean(result?.success);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div
        className={`rounded-3xl border-2 p-8 shadow-sm text-center ${
          isSuccess
            ? 'border-[#2d6a4f]/30 bg-gradient-to-br from-[#eef7f0] to-white'
            : 'border-[#9b2c2c]/30 bg-gradient-to-br from-[#fbeaea] to-white'
        }`}
      >
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-white shadow-xs">
          <span className="text-3xl">{isSuccess ? '✓' : '✕'}</span>
        </div>

        <h1
          className={`mt-4 text-xl font-black ${
            isSuccess ? 'text-[#2d6a4f]' : 'text-[#9b2c2c]'
          }`}
        >
          {result?.refundStatus === 'DUPLICATE_PAYMENT_MANUAL_REFUND_REQUIRED' ? 'Đã nhận thanh toán trùng' : result?.paymentReceived ? 'Đã nhận tiền sau khi hủy đơn' : isSuccess ? 'Thanh toán Stripe thành công!' : 'Thanh toán không thành công'}
        </h1>

        <p className="mt-2 text-sm text-[#7a6254]">
          {result?.message ?? error ?? 'Đã hoàn tất quá trình thanh toán qua Stripe.'}
        </p>

        {result && (
          <div className="mt-6 space-y-2 rounded-2xl border border-[#decbb4]/60 bg-white/80 p-5 text-left text-xs">
            {result.orderCode && (
              <div className="flex justify-between border-b border-[#decbb4]/30 pb-2">
                <span className="text-[#7a6254]">Mã đơn hàng:</span>
                <span className="font-mono font-bold text-[#4a2e20]">{result.orderCode}</span>
              </div>
            )}
            {typeof result.amount === 'number' && (
              <div className="flex justify-between border-b border-[#decbb4]/30 pb-2">
                <span className="text-[#7a6254]">Số tiền thanh toán:</span>
                <span className="font-bold text-[#635bff]">{formatVnd(result.amount)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-[#7a6254]">Cổng thanh toán:</span>
              <span className="font-bold text-[#635bff]">Stripe Test Mode (Quốc tế)</span>
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {result?.orderId ? (
            <Link
              href={`/orders/${result.orderId}`}
              className="rounded-full bg-[#4a2e20] px-6 py-2.5 text-xs font-bold text-white transition hover:bg-[#6d4c3d]"
            >
              Xem chi tiết đơn hàng →
            </Link>
          ) : (
            <Link
              href="/orders"
              className="rounded-full bg-[#4a2e20] px-6 py-2.5 text-xs font-bold text-white transition hover:bg-[#6d4c3d]"
            >
              Về danh sách đơn hàng
            </Link>
          )}
          <Link
            href="/menu"
            className="rounded-full border border-[#decbb4] bg-[#efe5d4] px-6 py-2.5 text-xs font-bold text-[#4a2e20] transition hover:bg-[#e2d2b8]"
          >
            Tiếp tục mua hàng
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function StripeReturnPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-2xl px-6 py-16 text-center">
          <div className="rounded-3xl border border-[#decbb4] bg-[#efe5d4]/60 p-8 shadow-sm">
            <div className="mx-auto size-12 animate-spin rounded-full border-4 border-[#635bff] border-t-transparent" />
            <p className="mt-5 text-sm font-bold text-[#4a2e20]">Đang tải thông tin…</p>
          </div>
        </main>
      }
    >
      <StripeReturnContent />
    </Suspense>
  );
}

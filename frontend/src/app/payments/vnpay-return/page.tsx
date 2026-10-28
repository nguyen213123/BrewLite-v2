'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { useCartStore } from '@/lib/cart/cart-store';
import { formatVnd } from '@/components/payments/payment-api';

interface VnPayVerifyResponse {
  success: boolean;
  message: string;
  orderCode: string;
  orderId?: string;
  amount?: number;
  bankCode?: string;
  transactionNo?: string;
  responseCode?: string;
}

function VnPayReturnContent() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<VnPayVerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const verify = async () => {
      try {
        const query = searchParams.toString();
        if (!query) {
          setError('Không tìm thấy thông tin phản hồi từ cổng thanh toán VNPay.');
          setLoading(false);
          return;
        }

        const res = await apiGet<VnPayVerifyResponse>(`/payments/vnpay/verify?${query}`);
        if (!active) return;
        setResult(res);

        if (res.success) {
          useCartStore.getState().clear();
        }
      } catch (err: unknown) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : 'Lỗi kết nối khi xác thực giao dịch';
        setError(msg);
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
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <div className="inline-block size-12 animate-spin rounded-full border-4 border-[#6d4c3d] border-t-transparent" />
        <h2 className="mt-4 text-lg font-extrabold text-[#4a2e20]">
          Đang xác thực giao dịch với VNPay…
        </h2>
        <p className="mt-1 text-sm text-[#7a6254]">
          Vui lòng đợi giây lát, hệ thống đang kiểm tra chữ ký số bảo mật và trạng thái thanh toán.
        </p>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <div className="overflow-hidden rounded-3xl border border-red-200 bg-white shadow-md">
          <div className="bg-red-50 p-6 text-center">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-red-100 text-red-600">
              <svg className="size-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="mt-3 text-xl font-extrabold text-red-800">Không thể xác thực giao dịch</h2>
            <p className="mt-1 text-sm text-red-700">{error ?? 'Dữ liệu giao dịch không hợp lệ'}</p>
          </div>
          <div className="p-6 text-center">
            <Link
              href="/checkout"
              className="inline-block rounded-full bg-[#6d4c3d] px-6 py-2.5 text-sm font-bold text-white transition hover:bg-[#563a2d]"
            >
              Quay lại trang thanh toán
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isSuccess = result.success;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div
        className={`overflow-hidden rounded-3xl border shadow-md bg-white ${
          isSuccess ? 'border-[#b5dcc0]' : 'border-[#e5b8b8]'
        }`}
      >
        {/* Banner Header */}
        <div
          className={`px-6 py-8 text-center ${
            isSuccess
              ? 'bg-gradient-to-b from-[#dff2e4] to-[#faf6ec] border-b border-[#decbb4]/60'
              : 'bg-gradient-to-b from-[#fbeaea] to-[#faf6ec] border-b border-[#e5b8b8]/60'
          }`}
        >
          <div
            className={`mx-auto mb-4 flex size-20 items-center justify-center rounded-full text-white shadow-lg ${
              isSuccess ? 'bg-[#2d6a4f]' : 'bg-[#9b2c2c]'
            }`}
          >
            {isSuccess ? (
              <svg className="size-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="size-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </div>
          <span
            className={`inline-block rounded-full px-3.5 py-1 text-xs font-extrabold uppercase tracking-wider ${
              isSuccess ? 'bg-[#cbe8d3] text-[#2d6a4f]' : 'bg-red-100 text-[#9b2c2c]'
            }`}
          >
            {isSuccess ? 'Cổng thanh toán VNPay' : 'Thanh toán không thành công'}
          </span>
          <h1 className="mt-3 text-2xl font-extrabold text-[#4a2e20]">
            {isSuccess ? 'Thanh toán VNPay thành công!' : 'Giao dịch chưa hoàn tất'}
          </h1>
          <p className="mt-1 text-sm text-[#7a6254]">
            {result.message}
          </p>
        </div>

        {/* Thông tin chi tiết */}
        <div className="space-y-6 p-6 sm:p-8">
          <div className="rounded-2xl border border-[#e2d2b8] bg-[#faf6ec] p-5">
            <div className="flex items-center justify-between border-b border-[#decbb4] pb-3 text-sm">
              <span className="text-xs font-bold uppercase tracking-wider text-[#7a6254]">Mã đơn hàng</span>
              <span className="font-mono text-base font-extrabold text-[#4a2e20]">{result.orderCode}</span>
            </div>

            <div className="mt-3 space-y-2.5 text-sm">
              {typeof result.amount === 'number' && result.amount > 0 && (
                <div className="flex items-center justify-between text-[#7a6254]">
                  <span>Số tiền:</span>
                  <span className="text-lg font-extrabold text-[#6d4c3d]">{formatVnd(result.amount)}</span>
                </div>
              )}
              {result.bankCode && (
                <div className="flex items-center justify-between text-[#7a6254]">
                  <span>Ngân hàng thanh toán:</span>
                  <span className="font-bold text-[#4a2e20]">{result.bankCode}</span>
                </div>
              )}
              {result.transactionNo && (
                <div className="flex items-center justify-between text-[#7a6254]">
                  <span>Mã giao dịch VNPay:</span>
                  <span className="font-mono text-xs font-bold text-[#4a2e20]">{result.transactionNo}</span>
                </div>
              )}
              {result.responseCode && (
                <div className="flex items-center justify-between text-[#7a6254]">
                  <span>Mã phản hồi:</span>
                  <span className="font-mono text-xs font-bold text-[#4a2e20]">{result.responseCode}</span>
                </div>
              )}
            </div>
          </div>

          {/* Nút điều hướng */}
          <div className="flex flex-wrap gap-3">
            {isSuccess ? (
              <>
                {result.orderId ? (
                  <Link
                    href={`/orders/${result.orderId}`}
                    className="flex-1 rounded-full bg-[#6d4c3d] py-3 text-center text-sm font-bold text-white shadow-sm transition hover:bg-[#563a2d]"
                  >
                    Xem chi tiết đơn hàng
                  </Link>
                ) : (
                  <Link
                    href="/profile"
                    className="flex-1 rounded-full bg-[#6d4c3d] py-3 text-center text-sm font-bold text-white shadow-sm transition hover:bg-[#563a2d]"
                  >
                    Lịch sử đơn hàng
                  </Link>
                )}
                <Link
                  href="/"
                  className="flex-1 rounded-full border border-[#decbb4] bg-[#efe5d4] py-3 text-center text-sm font-bold text-[#4a2e20] transition hover:bg-[#e2d2b8]"
                >
                  Tiếp tục mua hàng
                </Link>
              </>
            ) : (
              <>
                {result.orderId ? (
                  <Link
                    href={`/checkout?orderId=${result.orderId}`}
                    className="flex-1 rounded-full bg-[#6d4c3d] py-3 text-center text-sm font-bold text-white shadow-sm transition hover:bg-[#563a2d]"
                  >
                    Thử lại thanh toán
                  </Link>
                ) : (
                  <Link
                    href="/checkout"
                    className="flex-1 rounded-full bg-[#6d4c3d] py-3 text-center text-sm font-bold text-white shadow-sm transition hover:bg-[#563a2d]"
                  >
                    Quay lại thanh toán
                  </Link>
                )}
                <Link
                  href="/cart"
                  className="flex-1 rounded-full border border-[#decbb4] bg-[#efe5d4] py-3 text-center text-sm font-bold text-[#4a2e20] transition hover:bg-[#e2d2b8]"
                >
                  Về giỏ hàng
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VnPayReturnPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-xl px-4 py-16 text-center text-sm text-[#7a6254]">
          Đang tải dữ liệu kết quả thanh toán…
        </div>
      }
    >
      <VnPayReturnContent />
    </Suspense>
  );
}

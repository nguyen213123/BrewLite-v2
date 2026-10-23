'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { apiGet, ApiRequestError } from '@/lib/api';
import { subscribeAuth, getAuthSnapshot, getAuthServerSnapshot } from '@/lib/auth';
import type { OrderPage, OrderSummary } from '@/lib/contracts/api.generated';
import OrderStatusBadge from '@/components/OrderStatusBadge';

export default function OrdersHistoryPage() {
  const user = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthServerSnapshot);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let ignore = false;
    if (!user) {
      return;
    }

    async function loadOrders() {
      try {
        const response = await apiGet<OrderPage>(`/orders/me?page=${page}&limit=10`);
        if (!ignore) {
          setOrders(response.data);
          setPage(response.meta.page);
          setTotalPages(response.meta.totalPages);
          setTotal(response.meta.total);
          setError(null);
        }
      } catch (err) {
        if (!ignore) {
          if (err instanceof ApiRequestError) {
            setError(err.message || 'Không thể tải lịch sử đơn hàng.');
          } else {
            setError('Lỗi kết nối tới máy chủ. Vui lòng thử lại sau.');
          }
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadOrders();
    return () => {
      ignore = true;
    };
  }, [user, page, refreshToken]);

  if (!user && !loading) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
        <div className="rounded-full bg-[#263c30]/10 p-4 text-3xl">☕</div>
        <h1 className="mt-4 text-2xl font-bold text-[#263c30]">Cần đăng nhập</h1>
        <p className="mt-2 text-sm text-[#263c30]/70">
          Vui lòng đăng nhập vào tài khoản của bạn để xem lịch sử và quản lý đơn hàng.
        </p>
        <Link
          href="/login"
          className="mt-6 rounded-lg bg-[#263c30] px-6 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-[#1f3026]"
        >
          Đăng nhập ngay
        </Link>
      </main>
    );
  }

  function handleRefresh() {
    setLoading(true);
    setRefreshToken((t) => t + 1);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#cdd5c8] pb-6">
        <div>
          <h1 className="text-3xl font-bold text-[#263c30]">Lịch sử đơn hàng</h1>
          <p className="mt-1 text-sm text-[#263c30]/70">
            Theo dõi tiến trình và thông tin các đơn đồ uống đã đặt
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="self-start sm:self-auto rounded-lg border border-[#cdd5c8] bg-white px-3.5 py-2 text-xs font-semibold text-[#263c30] shadow-sm transition hover:bg-[#263c30] hover:text-white disabled:opacity-50"
        >
          {loading ? 'Đang tải…' : '↻ Làm mới'}
        </button>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={handleRefresh}
            className="underline font-semibold hover:no-underline ml-4"
          >
            Thử lại
          </button>
        </div>
      )}

      {loading ? (
        <div className="mt-6 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse rounded-2xl border border-[#cdd5c8] bg-white p-6 h-28" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="mt-12 rounded-2xl border border-dashed border-[#cdd5c8] bg-white/50 p-12 text-center">
          <p className="text-lg font-medium text-[#263c30]">Bạn chưa có đơn hàng nào</p>
          <p className="mt-2 text-sm text-[#263c30]/70">
            Hãy khám phá thực đơn thơm ngon và đặt ly cà phê yêu thích ngay hôm nay!
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-lg bg-[#263c30] px-5 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-[#1f3026]"
          >
            Khám phá thực đơn
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {orders.map((order) => {
            const formattedDate = new Date(order.createdAt).toLocaleString('vi-VN', {
              hour: '2-digit',
              minute: '2-digit',
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            });

            return (
              <Link
                key={order.id}
                href={`/orders/${order.id}`}
                className="group block rounded-2xl border border-[#cdd5c8] bg-white p-6 shadow-sm transition hover:border-[#263c30] hover:shadow-md"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-base font-bold text-[#263c30] group-hover:underline">
                        {order.code}
                      </span>
                      <OrderStatusBadge status={order.status} />
                    </div>
                    <p className="mt-1 text-xs text-[#263c30]/60">Đặt lúc: {formattedDate}</p>
                  </div>

                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 pt-3 sm:pt-0 border-gray-100">
                    <span className="text-base font-bold text-[#263c30]">
                      {order.total.toLocaleString('vi-VN')} {order.currency}
                    </span>
                    <span className="text-xs text-[#263c30]/70 flex items-center gap-1 group-hover:text-[#263c30]">
                      Chi tiết đơn hàng →
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}

          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-between border-t border-[#cdd5c8] pt-6">
              <button
                onClick={() => {
                  setLoading(true);
                  setPage((p) => Math.max(1, p - 1));
                }}
                disabled={page <= 1}
                className="rounded-lg border border-[#cdd5c8] bg-white px-4 py-2 text-xs font-semibold text-[#263c30] transition hover:bg-[#263c30] hover:text-white disabled:opacity-40"
              >
                ← Trang trước
              </button>
              <span className="text-xs text-[#263c30]/70">
                Trang {page} / {totalPages} (Tổng {total} đơn)
              </span>
              <button
                onClick={() => {
                  setLoading(true);
                  setPage((p) => Math.min(totalPages, p + 1));
                }}
                disabled={page >= totalPages}
                className="rounded-lg border border-[#cdd5c8] bg-white px-4 py-2 text-xs font-semibold text-[#263c30] transition hover:bg-[#263c30] hover:text-white disabled:opacity-40"
              >
                Trang sau →
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { apiGet, ApiRequestError } from '@/lib/api';
import { subscribeAuth, getAuthSnapshot, getAuthServerSnapshot, updateUserPoints } from '@/lib/auth';
import type { LoyaltyBalance, OrderPage, OrderSummary } from '@/lib/contracts/api.generated';
import OrderStatusBadge from '@/components/OrderStatusBadge';
import { formatVnd } from '@/lib/format';

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
          apiGet<LoyaltyBalance>('/loyalty/me')
            .then((bal) => {
              if (!ignore) updateUserPoints(bal.points);
            })
            .catch(() => {});
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

  if (!user) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="mx-auto max-w-lg rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-10 text-center shadow-xs">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-[#cbe8d3] text-3xl">
            ☕
          </div>
          <p className="eyebrow mt-4">BrewLite Mộc Vị / Đơn hàng</p>
          <h1 className="mt-2 text-2xl font-extrabold text-[#4a2e20]">Cần đăng nhập</h1>
          <p className="mt-2 text-sm text-[#7a6254]">
            Vui lòng đăng nhập vào tài khoản của bạn để xem lịch sử và quản lý đơn hàng.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-full bg-[#6d4c3d] px-7 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#563a2d]"
          >
            Đăng nhập ngay
          </Link>
        </div>
      </main>
    );
  }

  function handleRefresh() {
    setLoading(true);
    setRefreshToken((t) => t + 1);
  }

  return (
    <div>
      {/* Banner Xanh Mint Pastel */}
      <section className="border-b border-[#b5dcc0] bg-[#cbe8d3]">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">BrewLite Mộc Vị / Đơn hàng</p>
            <h1 className="mt-1.5 text-3xl font-extrabold tracking-tight text-[#4a2e20] sm:text-4xl">
              Lịch Sử Đơn Hàng
            </h1>
            <p className="mt-1 text-sm text-[#5c4033]">
              Theo dõi tiến trình pha chế, trạng thái thanh toán và chi tiết các đơn đồ uống đã đặt
            </p>
          </div>
          <div className="flex items-center gap-2.5 self-start sm:self-auto">
            <Link
              href="/menu"
              className="rounded-full bg-[#6d4c3d] px-5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-[#563a2d]"
            >
              + Đặt đơn mới
            </Link>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className="rounded-full border-2 border-[#6d4c3d] bg-white px-4 py-1.5 text-xs font-bold text-[#4a2e20] transition hover:bg-[#6d4c3d] hover:text-white disabled:opacity-50"
            >
              {loading ? 'Đang tải…' : '↻ Làm mới'}
            </button>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {error && (
          <div
            role="alert"
            className="mb-6 flex items-center justify-between rounded-2xl border border-[#e5b8b8] bg-[#fbeaea] p-4 text-sm text-[#9b2c2c]"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={handleRefresh}
              className="ml-4 font-bold underline hover:no-underline"
            >
              Thử lại
            </button>
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-6"
              />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-12 text-center shadow-xs">
            <div className="mx-auto grid size-16 place-items-center rounded-full bg-[#cbe8d3] text-3xl">
              ☕
            </div>
            <p className="mt-4 text-lg font-extrabold text-[#4a2e20]">Bạn chưa có đơn hàng nào</p>
            <p className="mt-2 text-sm text-[#7a6254]">
              Hãy khám phá thực đơn thơm ngon và đặt ly đồ uống yêu thích ngay hôm nay!
            </p>
            <Link
              href="/menu"
              className="mt-6 inline-block rounded-full bg-[#6d4c3d] px-7 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#563a2d]"
            >
              Khám phá thực đơn →
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
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
                  className="group block rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-3.5 shadow-xs transition hover:-translate-y-0.5 hover:border-[#6d4c3d] hover:shadow-md"
                >
                  <div className="flex flex-col justify-between gap-4 rounded-xl bg-white p-5 sm:flex-row sm:items-center">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-mono text-base font-extrabold text-[#4a2e20] group-hover:text-[#6d4c3d] group-hover:underline">
                          {order.code}
                        </span>
                        <OrderStatusBadge status={order.status} />
                        {order.promotionCode && (
                          <span className="rounded-full bg-[#cbe8d3] px-2.5 py-0.5 font-mono text-xs font-bold text-[#2d6a4f]">
                            {order.promotionCode}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#7a6254]">
                        Đặt lúc: {formattedDate} · Giữ kho: <strong>{order.reservationStatus}</strong>
                      </p>
                    </div>

                    <div className="flex items-center justify-between border-t border-[#decbb4]/60 pt-3 sm:flex-col sm:items-end sm:justify-center sm:border-t-0 sm:pt-0">
                      <span className="text-lg font-extrabold text-[#6d4c3d]">
                        {formatVnd(order.total)}
                      </span>
                      <span className="flex items-center gap-1 text-xs font-bold text-[#4a2e20] transition group-hover:text-[#6d4c3d]">
                        Chi tiết đơn hàng →
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}

            {totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    setPage((p) => Math.max(1, p - 1));
                  }}
                  disabled={page <= 1}
                  className="rounded-full border-2 border-[#6d4c3d] bg-white px-5 py-2 text-xs font-bold text-[#4a2e20] transition hover:bg-[#6d4c3d] hover:text-white disabled:opacity-40"
                >
                  ← Trang trước
                </button>
                <span className="rounded-full bg-[#efe5d4] px-4 py-2 text-xs font-bold text-[#4a2e20]">
                  Trang {page} / {totalPages} (Tổng {total} đơn)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    setPage((p) => Math.min(totalPages, p + 1));
                  }}
                  disabled={page >= totalPages}
                  className="rounded-full border-2 border-[#6d4c3d] bg-white px-5 py-2 text-xs font-bold text-[#4a2e20] transition hover:bg-[#6d4c3d] hover:text-white disabled:opacity-40"
                >
                  Trang sau →
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

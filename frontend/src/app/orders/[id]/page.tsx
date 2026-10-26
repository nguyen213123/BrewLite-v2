'use client';

import { use, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { apiFetch, apiGet, ApiRequestError } from '@/lib/api';
import { getAuthSnapshot, getAuthServerSnapshot, subscribeAuth, updateUserPoints } from '@/lib/auth';
import type { LoyaltyBalance, Order, OrderStatus } from '@/lib/contracts/api.generated';
import OrderStatusBadge from '@/components/OrderStatusBadge';
import { formatVnd } from '@/lib/format';

function StatusAlert({ status }: { status: OrderStatus }) {
  switch (status) {
    case 'PAID':
      return (
        <div className="rounded-xl border border-[#b5dcc0] bg-[#cbe8d3]/75 p-4 text-sm text-[#2d6a4f]">
          <p className="font-bold">Thanh toán thành công!</p>
          <p className="mt-0.5 text-xs text-[#4a2e20]">
            Hệ thống đã xác nhận thanh toán. Đơn đang chờ bắt đầu pha chế.
          </p>
        </div>
      );
    case 'PENDING':
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-bold">Đơn hàng đang chờ thanh toán</p>
          <p className="mt-0.5 text-xs text-amber-700">
            Hàng trong kho đã được giữ tạm thời. Vui lòng hoàn tất thanh toán để barista tiến hành pha chế.
          </p>
        </div>
      );
    case 'PREPARING':
      return (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <p className="font-bold">Đang pha chế</p>
          <p className="mt-0.5 text-xs text-blue-700">
            Barista đang chuẩn bị đồ uống tươi ngon cho bạn. Vui lòng chờ ít phút!
          </p>
        </div>
      );
    case 'READY':
      return (
        <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 text-sm text-purple-900">
          <p className="font-bold">Đồ uống đã sẵn sàng!</p>
          <p className="mt-0.5 text-xs text-purple-700">
            Mời bạn xuất trình mã đơn hàng tại quầy để nhận đồ uống nhé.
          </p>
        </div>
      );
    case 'COMPLETED':
      return (
        <div className="rounded-xl border border-[#e2d2b8] bg-[#efe5d4] p-4 text-sm text-[#4a2e20]">
          <p className="font-bold">Đơn hàng hoàn thành</p>
          <p className="mt-0.5 text-xs text-[#7a6254]">
            Cảm ơn bạn đã lựa chọn BrewLite Mộc Vị! Điểm thưởng từ đơn hàng đã được cộng vào tài khoản của khách hàng.
          </p>
        </div>
      );
    case 'PAYMENT_FAILED':
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-bold">Thanh toán không thành công</p>
          <p className="mt-0.5 text-xs text-red-700">
            Giao dịch thanh toán chưa thể hoàn tất. Bạn có thể thử lại với phương thức thanh toán khác.
          </p>
        </div>
      );
    case 'CANCELLED':
      return (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          <p className="font-bold">Đơn hàng đã bị hủy</p>
          <p className="mt-0.5 text-xs text-gray-500">
            Đơn hàng đã được ghi nhận hủy và hoàn trả các khuyến mãi/tồn kho liên quan.
          </p>
        </div>
      );
  }
}

const NEXT_STAFF_STATUS: Partial<Record<OrderStatus, { next: 'PREPARING' | 'READY' | 'COMPLETED'; label: string }>> = {
  PAID: { next: 'PREPARING', label: 'Bắt đầu pha chế (PREPARING)' },
  PREPARING: { next: 'READY', label: 'Báo món sẵn sàng (READY)' },
  READY: { next: 'COMPLETED', label: 'Giao món & Hoàn tất (COMPLETED)' },
};

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthServerSnapshot);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelSuccess, setCancelSuccess] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let ignore = false;

    async function loadDetail() {
      try {
        const data = await apiGet<Order>(`/orders/${id}`);
        if (!ignore) {
          setOrder(data);
          setError(null);
          if (data.status === 'COMPLETED' && user?.role === 'CUSTOMER') {
            apiGet<LoyaltyBalance>('/loyalty/me')
              .then((bal) => {
                if (!ignore) updateUserPoints(bal.points);
              })
              .catch(() => {});
          }
        }
      } catch (err) {
        if (!ignore) {
          if (err instanceof ApiRequestError) {
            if (err.code === 'ORDER_NOT_FOUND') {
              setError('Không tìm thấy đơn hàng hoặc bạn không có quyền truy cập đơn hàng này.');
            } else {
              setError(err.message || 'Lỗi khi tải chi tiết đơn hàng.');
            }
          } else {
            setError('Không thể kết nối đến máy chủ.');
          }
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadDetail();
    return () => {
      ignore = true;
    };
  }, [id, refreshToken, user?.role]);

  function handleRefresh() {
    setLoading(true);
    setActionError(null);
    setRefreshToken((t) => t + 1);
  }

  async function handleStaffTransition(nextStatus: 'PREPARING' | 'READY' | 'COMPLETED') {
    if (!order || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const updated = await apiFetch<Order>(`/orders/${order.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ expectedVersion: order.version, status: nextStatus }),
      });
      setOrder(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Không thể cập nhật trạng thái đơn.');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleCancelOrder() {
    if (!order || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const updated = await apiFetch<Order>(`/orders/${order.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: order.version }),
      });
      setOrder(updated);
      setCancelSuccess(true);
      setConfirmCancel(false);
      if (user?.role === 'CUSTOMER') {
        try {
          const bal = await apiGet<LoyaltyBalance>('/loyalty/me');
          updateUserPoints(bal.points);
        } catch {}
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Không thể hủy đơn hàng.');
    } finally {
      setActionBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="animate-pulse space-y-6">
          <div className="h-6 w-48 rounded bg-[#decbb4]" />
          <div className="h-32 rounded-2xl border border-[#e2d2b8] bg-[#efe5d4]" />
          <div className="h-64 rounded-2xl border border-[#e2d2b8] bg-[#efe5d4]" />
        </div>
      </main>
    );
  }

  if (error || !order) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12 text-center">
        <div className="mx-auto max-w-lg rounded-2xl border border-[#e5b8b8] bg-[#fbeaea] p-8">
          <h2 className="text-lg font-bold text-[#9b2c2c]">Không thể xem đơn hàng</h2>
          <p className="mt-2 text-sm text-[#9b2c2c]/90">{error ?? 'Đơn hàng không tồn tại'}</p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={handleRefresh}
              className="rounded-full border border-[#e5b8b8] bg-white px-5 py-2 text-xs font-bold text-[#9b2c2c] transition hover:bg-[#fbeaea]"
            >
              Thử lại
            </button>
            <Link
              href="/orders"
              className="rounded-full bg-[#6d4c3d] px-5 py-2 text-xs font-bold text-white transition hover:bg-[#563a2d]"
            >
              ← Về danh sách đơn
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const formattedDate = new Date(order.createdAt).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const staffTransition = user?.role === 'STAFF' ? NEXT_STAFF_STATUS[order.status] : undefined;

  return (
    <div>
      <div className="border-b border-[#b5dcc0] bg-[#cbe8d3]/75">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5 text-xs font-bold">
          <Link
            href="/orders"
            className="text-[#4a2e20] transition hover:text-[#6d4c3d]"
          >
            ← Quay lại danh sách đơn
          </Link>
          <button
            type="button"
            onClick={handleRefresh}
            className="rounded-full bg-[#6d4c3d] px-4 py-1.5 text-white transition hover:bg-[#563a2d]"
          >
            ↻ Tải lại
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-4 shadow-xs sm:p-5">
          <div className="space-y-6 rounded-xl bg-white p-6 sm:p-8">
            <div className="flex flex-col gap-4 border-b border-[#decbb4] pb-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="eyebrow">BrewLite Mộc Vị / Chi tiết đơn hàng</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  <h1 className="font-mono text-2xl font-extrabold text-[#4a2e20]">{order.code}</h1>
                  <OrderStatusBadge status={order.status} />
                </div>
                <p className="mt-1.5 text-xs text-[#7a6254]">
                  Thời gian đặt: {formattedDate} · Giữ kho: <strong>{order.reservationStatus}</strong> · Phiên bản v{order.version}
                </p>
              </div>

              <div className="sm:text-right">
                <span className="block text-xs font-bold uppercase tracking-wider text-[#7a6254]">
                  Tổng thanh toán
                </span>
                <span className="text-2xl font-extrabold text-[#6d4c3d]">
                  {formatVnd(order.total)}
                </span>
              </div>
            </div>

            <StatusAlert status={order.status} />

            {cancelSuccess && (
              <div
                role="status"
                className="flex items-center justify-between rounded-xl border border-[#b5dcc0] bg-[#eef7f0] p-4 text-xs font-bold text-[#2d6a4f]"
              >
                <span>✓ Đơn hàng đã được hủy thành công. Tồn kho và mã ưu đãi đã được hoàn trả.</span>
                <Link
                  href="/menu"
                  className="rounded-full bg-[#2d6a4f] px-4 py-1.5 text-xs font-bold text-white transition hover:bg-[#1b4332]"
                >
                  Đặt món mới →
                </Link>
              </div>
            )}

            {actionError && (
              <div
                role="alert"
                className="rounded-xl border border-[#e5b8b8] bg-[#fbeaea] p-3.5 text-xs font-bold text-[#9b2c2c]"
              >
                {actionError}
              </div>
            )}

            {confirmCancel && (
              <div
                role="alert"
                className="space-y-3 rounded-2xl border-2 border-[#e5b8b8] bg-[#fbeaea] p-5 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl">⚠️</span>
                  <div>
                    <h3 className="m-0 text-sm font-extrabold text-[#9b2c2c]">
                      Xác nhận hủy đơn hàng {order.code}?
                    </h3>
                    <p className="m-0 mt-1 text-xs text-[#7a6254]">
                      {order.status === 'PAID'
                        ? 'Đơn hàng chưa bắt đầu pha chế. Khi hủy, hệ thống sẽ tự động hoàn trả thanh toán mô phỏng, hoàn tồn kho, hoàn lượt mã khuyến mãi và đảo điểm thưởng Loyalty.'
                        : 'Hàng trong kho và mã ưu đãi đã giữ sẽ được hoàn trả lại ngay lập tức.'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={handleCancelOrder}
                    className="rounded-full bg-[#9b2c2c] px-5 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-[#7a2222] disabled:opacity-50"
                  >
                    {actionBusy ? 'Đang hủy đơn…' : 'Đồng ý hủy đơn'}
                  </button>
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => setConfirmCancel(false)}
                    className="rounded-full border border-[#decbb4] bg-white px-5 py-2 text-xs font-bold text-[#4a2e20] transition hover:bg-gray-50"
                  >
                    Không, giữ lại đơn
                  </button>
                </div>
              </div>
            )}

            {/* Khu vực thao tác đơn hàng */}
            <div className="rounded-2xl border border-[#decbb4] bg-[#faf6ec] p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="m-0 text-xs font-extrabold uppercase tracking-wider text-[#7a6254]">
                    Thao tác đơn hàng
                  </h3>
                  <p className="m-0 mt-0.5 text-xs text-[#4a2e20]">
                    {order.status === 'PAID'
                      ? 'Đơn hàng đang chờ pha chế — Bạn có thể hủy đơn trước khi quầy bắt đầu làm món.'
                      : order.status === 'PENDING'
                        ? 'Đơn hàng chưa thanh toán. Bạn có thể tiếp tục thanh toán hoặc hủy đơn.'
                        : order.status === 'PAYMENT_FAILED'
                          ? 'Thanh toán lỗi. Bạn có thể thử lại thanh toán hoặc hủy đơn.'
                          : order.status === 'PREPARING'
                            ? 'Barista đang pha chế đồ uống. Đơn hàng không thể hủy.'
                            : order.status === 'READY'
                              ? 'Đồ uống đã sẵn sàng tại quầy nhận. Đơn hàng không thể hủy.'
                              : order.status === 'COMPLETED'
                                ? 'Đơn hàng đã hoàn tất thành công.'
                                : 'Đơn hàng đã được hủy.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  {/* Nút hủy đơn hàng khi chưa pha chế */}
                  {['PENDING', 'PAYMENT_FAILED', 'PAID'].includes(order.status) && !confirmCancel && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => setConfirmCancel(true)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#e5b8b8] bg-[#fbeaea] px-5 py-2.5 text-xs font-bold text-[#9b2c2c] transition hover:bg-[#f5d5d5] disabled:opacity-50"
                    >
                      <span>✕ Hủy đơn hàng</span>
                      {order.status === 'PAID' && <span className="font-normal">(Hoàn tiền)</span>}
                    </button>
                  )}

                  {/* Nút tiếp tục thanh toán đối với PENDING / PAYMENT_FAILED */}
                  {['PENDING', 'PAYMENT_FAILED'].includes(order.status) && (
                    <Link
                      href={`/checkout?orderId=${order.id}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#6d4c3d] px-5 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#563a2d]"
                    >
                      <span>{order.status === 'PENDING' ? 'Tiếp tục thanh toán' : 'Thử lại thanh toán'}</span>
                      <span aria-hidden="true">→</span>
                    </Link>
                  )}

                  {/* Nút thao tác dành cho STAFF */}
                  {staffTransition && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => handleStaffTransition(staffTransition.next)}
                      className="inline-flex items-center gap-2 rounded-full border-2 border-[#6d4c3d] bg-[#cbe8d3] px-5 py-2 text-xs font-bold text-[#4a2e20] transition hover:bg-[#6d4c3d] hover:text-white disabled:opacity-50"
                    >
                      <span>[STAFF] {staffTransition.label}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div>
              <h2 className="mb-3 text-base font-extrabold text-[#4a2e20]">
                Các món đã đặt (Snapshot)
              </h2>
              <div className="divide-y divide-[#decbb4]/70 rounded-2xl border border-[#e2d2b8] bg-[#faf6ec]">
                {order.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-extrabold text-[#4a2e20]">
                          {item.productName}
                        </span>
                        <span className="rounded-full bg-[#cbe8d3] px-2.5 py-0.5 text-[11px] font-bold text-[#2d6a4f]">
                          Size {item.size} ({formatVnd(item.sizePrice)})
                        </span>
                      </div>

                      {item.toppings && item.toppings.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#7a6254]">
                          <span>Topping:</span>
                          {item.toppings.map((t) => (
                            <span
                              key={t.id}
                              className="rounded-md border border-[#decbb4] bg-white px-2 py-0.5 font-medium text-[#4a2e20]"
                            >
                              {t.name} (+{formatVnd(t.price)})
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="text-xs text-[#7a6254]">
                        {formatVnd(item.unitPrice)} × {item.qty} ly
                      </div>
                    </div>

                    <div className="self-end text-right text-sm font-extrabold text-[#6d4c3d] sm:self-center">
                      {formatVnd(item.lineTotal)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2.5 border-t border-[#decbb4] pt-6">
              <div className="flex justify-between text-sm text-[#7a6254]">
                <span>Tạm tính</span>
                <span className="font-bold text-[#4a2e20]">{formatVnd(order.subtotal)}</span>
              </div>

              {order.discount > 0 && (
                <div className="flex justify-between text-sm font-bold text-[#2d6a4f]">
                  <span>Giảm giá {order.promotionCode ? `(${order.promotionCode})` : ''}</span>
                  <span>−{formatVnd(order.discount)}</span>
                </div>
              )}

              <div className="flex justify-between border-t border-dashed border-[#decbb4] pt-3 text-base font-extrabold text-[#4a2e20]">
                <span>Tổng cộng</span>
                <span className="text-xl text-[#6d4c3d]">{formatVnd(order.total)}</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

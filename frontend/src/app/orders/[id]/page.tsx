'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, ApiRequestError } from '@/lib/api';
import type { Order, OrderStatus } from '@/lib/contracts/api.generated';
import OrderStatusBadge from '@/components/OrderStatusBadge';

function StatusAlert({ status }: { status: OrderStatus }) {
  switch (status) {
    case 'PAID':
      return (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">Thanh toán thành công!</p>
          <p className="mt-0.5 text-xs text-emerald-700">
            Hệ thống đã xác nhận thanh toán. Đơn đang chờ bắt đầu pha chế.
          </p>
        </div>
      );
    case 'PENDING':
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Đơn hàng đang chờ thanh toán</p>
          <p className="mt-0.5 text-xs text-amber-700">
            Hàng trong kho đã được giữ tạm thời. Vui lòng hoàn tất thanh toán để baristar tiến hành pha chế.
          </p>
        </div>
      );
    case 'PREPARING':
      return (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <p className="font-semibold">Đang pha chế</p>
          <p className="mt-0.5 text-xs text-blue-700">
            Barista đang chuẩn bị đồ uống tươi ngon cho bạn. Vui lòng chờ ít phút!
          </p>
        </div>
      );
    case 'READY':
      return (
        <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 text-sm text-purple-900">
          <p className="font-semibold">Đồ uống đã sẵn sàng!</p>
          <p className="mt-0.5 text-xs text-purple-700">
            Mời bạn xuất trình mã đơn hàng tại quầy để nhận đồ uống nhé.
          </p>
        </div>
      );
    case 'COMPLETED':
      return (
        <div className="rounded-xl border border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-800">
          <p className="font-semibold">Đơn hàng hoàn thành</p>
          <p className="mt-0.5 text-xs text-zinc-600">
            Cảm ơn bạn đã lựa chọn BrewLite! Chúc bạn thưởng thức đồ uống ngon miệng.
          </p>
        </div>
      );
    case 'PAYMENT_FAILED':
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">Thanh toán không thành công</p>
          <p className="mt-0.5 text-xs text-red-700">
            Giao dịch thanh toán chưa thể hoàn tất. Bạn có thể thử lại với phương thức thanh toán khác.
          </p>
        </div>
      );
    case 'CANCELLED':
      return (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          <p className="font-semibold">Đơn hàng đã bị hủy</p>
          <p className="mt-0.5 text-xs text-gray-500">
            Đơn hàng đã được ghi nhận hủy và hoàn trả các khuyến mãi/tồn kho liên quan.
          </p>
        </div>
      );
  }
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let ignore = false;

    async function loadDetail() {
      try {
        const data = await apiGet<Order>(`/orders/${id}`);
        if (!ignore) {
          setOrder(data);
          setError(null);
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
  }, [id, refreshToken]);

  function handleRefresh() {
    setLoading(true);
    setRefreshToken((t) => t + 1);
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-48 rounded bg-gray-200" />
          <div className="h-24 rounded-2xl bg-gray-200" />
          <div className="h-64 rounded-2xl bg-gray-200" />
        </div>
      </main>
    );
  }

  if (error || !order) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 text-center">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-8">
          <h2 className="text-lg font-bold text-red-800">Không thể xem đơn hàng</h2>
          <p className="mt-2 text-sm text-red-600">{error ?? 'Đơn hàng không tồn tại'}</p>
          <div className="mt-6 flex justify-center gap-4">
            <button
              onClick={handleRefresh}
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-semibold text-red-800 transition hover:bg-red-100"
            >
              Thử lại
            </button>
            <Link
              href="/orders"
              className="rounded-lg bg-[#263c30] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#1f3026]"
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

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <Link
          href="/orders"
          className="text-xs font-semibold uppercase tracking-wider text-[#263c30]/70 hover:text-[#263c30]"
        >
          ← Quay lại danh sách
        </Link>
        <button
          onClick={handleRefresh}
          className="rounded-lg border border-[#cdd5c8] bg-white px-3 py-1.5 text-xs font-semibold text-[#263c30] shadow-sm transition hover:bg-[#263c30] hover:text-white"
        >
          ↻ Tải lại
        </button>
      </div>

      <div className="rounded-2xl border border-[#cdd5c8] bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#cdd5c8] pb-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-mono text-2xl font-bold text-[#263c30]">{order.code}</h1>
              <OrderStatusBadge status={order.status} />
            </div>
            <p className="mt-1 text-xs text-[#263c30]/60">Thời gian đặt: {formattedDate}</p>
          </div>

          <div className="text-right sm:text-right">
            <span className="text-xs uppercase tracking-wider text-[#263c30]/60 block">Tổng thanh toán</span>
            <span className="text-2xl font-bold text-[#263c30]">
              {order.total.toLocaleString('vi-VN')} {order.currency}
            </span>
          </div>
        </div>

        <StatusAlert status={order.status} />
        {['PENDING', 'PAYMENT_FAILED', 'PAID'].includes(order.status) && (
          <Link href={`/checkout?orderId=${order.id}`} className="mt-4 inline-block rounded-lg bg-[#263c30] px-4 py-3 text-sm font-semibold text-white">
            {order.status === 'PAID' ? 'Quản lý thanh toán / hủy trước pha chế' : 'Tiếp tục thanh toán / hủy đơn'}
          </Link>
        )}

        <div>
          <h2 className="text-base font-bold text-[#263c30] mb-4">Các món đã đặt (Snapshot)</h2>
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-gray-50/50">
            {order.items.map((item) => (
              <div key={item.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-[#263c30]">{item.productName}</span>
                    <span className="rounded bg-black/5 px-1.5 py-0.5 text-[11px] font-medium text-[#263c30]">
                      Size {item.size} ({item.sizePrice.toLocaleString('vi-VN')} đ)
                    </span>
                  </div>

                  {item.toppings && item.toppings.length > 0 && (
                    <div className="text-xs text-[#263c30]/70 flex flex-wrap gap-1.5">
                      <span>Topping:</span>
                      {item.toppings.map((t) => (
                        <span key={t.id} className="rounded bg-white border border-gray-200 px-1.5 py-0.5">
                          {t.name} (+{t.price.toLocaleString('vi-VN')} đ)
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="text-xs text-[#263c30]/60">
                    {item.unitPrice.toLocaleString('vi-VN')} đ × {item.qty} ly
                  </div>
                </div>

                <div className="text-right font-semibold text-sm text-[#263c30] self-end sm:self-center">
                  {item.lineTotal.toLocaleString('vi-VN')} đ
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-[#cdd5c8] pt-6 space-y-2">
          <div className="flex justify-between text-sm text-[#263c30]/80">
            <span>Tạm tính</span>
            <span>{order.subtotal.toLocaleString('vi-VN')} đ</span>
          </div>

          {order.discount > 0 && (
            <div className="flex justify-between text-sm text-emerald-700">
              <span>
                Giảm giá {order.promotionCode ? `(${order.promotionCode})` : ''}
              </span>
              <span>-{order.discount.toLocaleString('vi-VN')} đ</span>
            </div>
          )}

          <div className="flex justify-between text-base font-bold text-[#263c30] border-t border-dashed border-gray-200 pt-3">
            <span>Tổng cộng</span>
            <span className="text-lg">
              {order.total.toLocaleString('vi-VN')} {order.currency}
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}

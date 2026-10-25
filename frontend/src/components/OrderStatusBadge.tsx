import type { OrderStatus } from '@/lib/contracts/api.generated';

const STATUS_CONFIG: Record<OrderStatus, { label: string; className: string }> = {
  PENDING: {
    label: 'Chờ thanh toán',
    className: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  PAID: {
    label: 'Đã thanh toán',
    className: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  PREPARING: {
    label: 'Đang pha chế',
    className: 'bg-blue-50 text-blue-800 border-blue-200',
  },
  READY: {
    label: 'Sẵn sàng nhận',
    className: 'bg-purple-50 text-purple-800 border-purple-200',
  },
  COMPLETED: {
    label: 'Hoàn thành',
    className: 'bg-zinc-100 text-zinc-800 border-zinc-300',
  },
  PAYMENT_FAILED: {
    label: 'Thanh toán lỗi',
    className: 'bg-red-50 text-red-800 border-red-200',
  },
  CANCELLED: {
    label: 'Đã hủy',
    className: 'bg-gray-100 text-gray-500 border-gray-300',
  },
};

export default function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const config = STATUS_CONFIG[status] ?? { label: status, className: 'bg-gray-100 text-gray-700 border-gray-200' };

  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold ${config.className}`}>
      {config.label}
    </span>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { formatVnd } from '@/lib/format';

type ReviewPayment = {
  paymentId: string;
  orderCode: string;
  amount: number;
  transactionNo: string;
  refundStatus?: string;
  provider?: string;
};

export default function ManualPaymentReview({ staff }: { staff: boolean }) {
  const [items, setItems] = useState<ReviewPayment[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    apiGet<{ items: ReviewPayment[] }>('/payments/manual-review')
      .then((response) => { if (active) setItems(response.items); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);

  if (error) return <p role="alert" className="mb-6 text-sm text-[#9b2c2c]">Không tải được thông tin thanh toán cần xử lý. Vui lòng bấm Làm mới để thử lại.</p>;
  if (items.length === 0) return null;

  return (
    <section aria-label="Thanh toán cần xử lý thủ công" className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-[#4a2e20]">
      <h2 className="font-extrabold">Thanh toán cần xử lý thủ công</h2>
      <p className="mt-1 text-sm">{staff
        ? 'Kiểm tra và đối soát các giao dịch bên dưới. Khoản tiền nhận sau khi hủy đơn cần được hoàn thủ công ngoài hệ thống.'
        : 'Vui lòng liên hệ cửa hàng và cung cấp mã đơn cùng mã giao dịch để được hỗ trợ.'}</p>
      <ul className="mt-3 space-y-3 text-sm">
        {items.map((item) => (
          <li key={item.paymentId} className="border-t border-amber-200 pt-3">
            <p className="font-bold">{item.orderCode} · {formatVnd(item.amount)}</p>
            <p>{item.refundStatus === 'DUPLICATE_PAYMENT_MANUAL_REFUND_REQUIRED'
              ? 'Đã nhận thanh toán trùng — cần hoàn khoản tiền bổ sung thủ công. Đơn hàng giữ nguyên trạng thái.'
              : item.refundStatus === 'MANUAL_REFUND_REQUIRED'
              ? 'Đã nhận tiền sau khi hủy đơn — cần hoàn tiền thủ công. Đơn vẫn đã hủy.'
              : 'Giao dịch có ngoại lệ cần nhân viên kiểm tra.'}</p>
            <p className="break-all">Mã giao dịch {item.provider ?? 'VNPay'}: {item.transactionNo}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

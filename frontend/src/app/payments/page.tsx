import type { Metadata } from 'next';
import { PaymentDesignSystemShowcase } from '@/components/payments';

export const metadata: Metadata = {
  title: 'BrewLite — Thanh toán & Idempotency (TV5)',
  description: 'Giao diện thanh toán không tiền mặt Ví/Thẻ và kiểm thử Idempotency-Key.',
};

export default function PaymentsShowcasePage() {
  return <PaymentDesignSystemShowcase />;
}

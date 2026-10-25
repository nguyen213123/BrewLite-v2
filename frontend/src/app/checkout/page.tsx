import Checkout from '@/components/checkout/Checkout';
export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
  const { orderId } = await searchParams;
  return <Checkout initialOrderId={orderId} />;
}

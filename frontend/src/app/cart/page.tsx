'use client';
import Link from 'next/link';
import { useCartStore, useCartHydrated, lineTotal } from '@/lib/cart/cart-store';
import { formatVnd } from '@/components/payments/payment-api';
export default function CartPage() {
  const { lines, setQty, removeItem } = useCartStore();
  const hydrated = useCartHydrated();
  return <main className="shop"><p className="eyebrow">BrewLite / Giỏ hàng</p><h1>Đồ uống của bạn</h1>
    {!hydrated ? <p>Đang tải giỏ…</p> : !lines.length ? <p>Giỏ hàng đang trống.</p> : <>
      {lines.map(l => <section key={l.id} className="shop-panel"><h2>{l.productName} · {l.size}</h2>
        <p>{l.toppings.map(t => t.name).join(', ') || 'Không topping'}</p>
        <label>Số lượng <input aria-label={`Số lượng ${l.productName}`} type="number" min={1} max={99} value={l.qty} onChange={e => { const qty = Number(e.target.value); if (Number.isInteger(qty) && qty >= 1 && qty <= 99) setQty(l.id, qty); }} /></label>
        <strong>{formatVnd(lineTotal(l))}</strong> <button onClick={() => removeItem(l.id)}>Xóa</button></section>)}
      <p>Tạm tính: {formatVnd(lines.reduce((sum, l) => sum + lineTotal(l), 0))}. Giá cuối cùng được xác nhận ở bước thanh toán.</p>
      <Link className="shop-action" href="/checkout">Tiếp tục thanh toán</Link>
    </>}
    <p><Link href="/menu">Chọn thêm đồ uống</Link></p></main>;
}

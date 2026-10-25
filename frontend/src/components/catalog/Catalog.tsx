'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useCartStore } from '@/lib/cart/cart-store';
import type { ProductDetail, Size } from '@/lib/contracts/api.generated';
import { formatVnd } from '@/components/payments/payment-api';

export function Product({ id }: { id: string }) {
  const [product, setProduct] = useState<ProductDetail>();
  const [size, setSize] = useState<Size>('S');
  const [toppingIds, setToppings] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    apiFetch<ProductDetail>(`/products/${encodeURIComponent(id)}`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]) })
      .then(p => { if (!abort.signal.aborted) { setProduct(p); setSize(p.sizes[0]?.size ?? 'S'); } })
      .catch(e => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'Không thể tải sản phẩm.'); });
    return () => abort.abort();
  }, [id, retry]);
  const selectedSize = product?.sizes.find(s => s.size === size);
  const toppings = product?.toppings.filter(t => toppingIds.includes(t.id)) ?? [];
  return <main className="shop"><Link href="/menu">← Menu</Link>
    {error ? <p role="alert">{error} <button onClick={() => { setError(''); setRetry(n => n + 1); }}>Thử lại</button></p> : !product ? <p>Đang tải sản phẩm…</p> : <section className="shop-panel">
      <h1>{product.name}</h1><p>{product.description}</p>
      <label>Size <select value={size} onChange={e => setSize(e.target.value as Size)}>{product.sizes.map(s => <option key={s.size} value={s.size}>{s.size} — {formatVnd(s.price)}</option>)}</select></label>
      <fieldset><legend>Topping</legend>{product.toppings.map(t => <label key={t.id}><input type="checkbox" checked={toppingIds.includes(t.id)} onChange={e => setToppings(ids => e.target.checked ? [...ids, t.id] : ids.filter(id => id !== t.id))} /> {t.name} +{formatVnd(t.price)}</label>)}</fieldset>
      <label>Số lượng <input type="number" min={1} max={99} value={qty} onChange={e => setQty(Number(e.target.value))} /></label>
      <p>{formatVnd(((selectedSize?.price ?? 0) + toppings.reduce((sum, t) => sum + t.price, 0)) * qty)}</p>
      <button disabled={!selectedSize || product.stock < 1 || !Number.isInteger(qty) || qty < 1 || qty > 99 || toppingIds.length > 10} onClick={() => {
        const result = useCartStore.getState().addItem({ productId: product.id, productName: product.name,
          imageUrl: product.imageUrl, size, sizePrice: selectedSize!.price, toppings, qty });
        setMessage(result.message ?? (result.ok ? 'Đã thêm vào giỏ hàng.' : 'Không thể thêm vào giỏ.'));
      }}>{product.stock > 0 ? 'Thêm vào giỏ' : 'Đã hết hàng'}</button>
      <p role="status">{message}</p><Link href="/cart">Xem giỏ và thanh toán</Link>
    </section>}
  </main>;
}
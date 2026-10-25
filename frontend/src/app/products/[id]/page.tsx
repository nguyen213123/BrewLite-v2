'use client';

// Owner: TV1 — #3. Route /products/[id] (đường dẫn đã chốt trong team-handoff.md).
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiRequestError, apiGet } from '@/lib/api';
import { useCartStore } from '@/lib/cart/cart-store';
import type { ProductDetail } from '@/lib/contracts/api.generated';
import { ProductDetailView } from '@/features/products/product-detail-view';

type State = { kind: 'loading' } | { kind: 'ready'; product: ProductDetail } | { kind: 'not-found' } | { kind: 'error' };

function ProductLoader({ id }: { id: string }) {
  const addItem = useCartStore(s => s.addItem);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiGet<ProductDetail>(`/products/${id}`)
      .then(product => { if (!cancelled) setState({ kind: 'ready', product }); })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState(error instanceof ApiRequestError && error.statusCode === 404 ? { kind: 'not-found' } : { kind: 'error' });
      });
    return () => { cancelled = true; };
  }, [id, attempt]);

  if (state.kind === 'ready') return <ProductDetailView product={state.product} onAddToCart={addItem} />;
  return (
    <main className="mx-auto max-w-4xl px-6 py-16" role="status" aria-live="polite">
      {state.kind === 'loading' && <p>Đang tải sản phẩm…</p>}
      {state.kind === 'not-found' && <p>Không tìm thấy sản phẩm hoặc sản phẩm đã ngừng bán.</p>}
      {state.kind === 'error' && (
        <div>
          <p>Không tải được sản phẩm. Vui lòng thử lại.</p>
          <button type="button" onClick={() => { setState({ kind: 'loading' }); setAttempt(n => n + 1); }} className="mt-4 rounded-lg bg-[#263c30] px-5 py-3 font-semibold text-white">Thử lại</button>
        </div>
      )}
      {state.kind !== 'loading' && <Link href="/menu" className="mt-4 inline-block text-sm font-semibold underline underline-offset-4">← Quay lại menu</Link>}
    </main>
  );
}

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ProductLoader key={id} id={id} />;
}
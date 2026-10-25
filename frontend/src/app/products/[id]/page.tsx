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
  const addItem = useCartStore((s) => s.addItem);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiGet<ProductDetail>(`/products/${id}`)
      .then((product) => {
        if (!cancelled) setState({ kind: 'ready', product });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState(
          error instanceof ApiRequestError && error.statusCode === 404
            ? { kind: 'not-found' }
            : { kind: 'error' },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  if (state.kind === 'ready') {
    return <ProductDetailView product={state.product} onAddToCart={addItem} />;
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10" role="status" aria-live="polite">
      {state.kind === 'loading' && (
        <div>
          <p className="sr-only">Đang tải sản phẩm…</p>
          <div className="h-5 w-40 animate-pulse rounded bg-[#decbb4]" />
          <div className="mt-6 grid gap-8 md:grid-cols-[0.95fr_1.05fr]">
            <div className="aspect-square animate-pulse rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-4" />
            <div className="space-y-4 rounded-2xl border border-[#decbb4] bg-white p-6 sm:p-8">
              <div className="h-4 w-32 animate-pulse rounded bg-[#decbb4]" />
              <div className="h-8 w-2/3 animate-pulse rounded bg-[#decbb4]" />
              <div className="h-16 w-full animate-pulse rounded bg-[#efe5d4]" />
              <div className="h-24 w-full animate-pulse rounded bg-[#efe5d4]" />
              <div className="h-32 w-full animate-pulse rounded bg-[#efe5d4]" />
            </div>
          </div>
        </div>
      )}

      {state.kind === 'not-found' && (
        <div className="rounded-2xl border border-[#decbb4] bg-[#efe5d4] p-10 text-center shadow-xs">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-[#cbe8d3] text-2xl">
            ☕
          </div>
          <h1 className="mt-4 text-xl font-extrabold text-[#4a2e20]">Không tìm thấy sản phẩm</h1>
          <p className="mt-2 text-sm text-[#7a6254]">
            Không tìm thấy sản phẩm hoặc sản phẩm đã ngừng bán.
          </p>
          <Link
            href="/menu"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#6d4c3d] px-6 py-2.5 text-xs font-bold text-white transition hover:bg-[#563a2d]"
          >
            ← Quay lại thực đơn
          </Link>
        </div>
      )}

      {state.kind === 'error' && (
        <div className="rounded-2xl border border-[#e5b8b8] bg-[#fbeaea] p-8 text-center">
          <h1 className="text-lg font-bold text-[#9b2c2c]">Không tải được sản phẩm</h1>
          <p className="mt-2 text-sm text-[#9b2c2c]/90">
            Không tải được sản phẩm. Vui lòng thử lại.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setState({ kind: 'loading' });
                setAttempt((n) => n + 1);
              }}
              className="rounded-full bg-[#6d4c3d] px-6 py-2.5 text-xs font-bold text-white transition hover:bg-[#563a2d]"
            >
              Thử lại
            </button>
            <Link
              href="/menu"
              className="rounded-full border-2 border-[#6d4c3d] bg-white px-6 py-2.5 text-xs font-bold text-[#4a2e20] transition hover:bg-[#efe5d4]"
            >
              ← Quay lại menu
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ProductLoader key={id} id={id} />;
}

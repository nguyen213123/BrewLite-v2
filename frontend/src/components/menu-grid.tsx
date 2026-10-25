'use client';

import { useEffect, useState } from 'react';
import { apiRequest, describeApiError } from '@/lib/api-client';
import type { ProductPage } from '@/lib/contracts/api.generated';
import { ProductCard } from './product-card';

const PAGE_SIZE = 12;

interface Result {
  key: string;
  data: ProductPage | null;
  error: string | null;
}

function MenuSkeleton() {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="animate-pulse overflow-hidden rounded-2xl border border-brew-line bg-white/60">
          <div className="aspect-[4/3] bg-brew-line/60" />
          <div className="space-y-3 p-4">
            <div className="h-5 w-2/3 rounded bg-brew-line/60" />
            <div className="h-4 w-full rounded bg-brew-line/40" />
            <div className="h-5 w-1/3 rounded bg-brew-line/60" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Menu đồ uống lấy từ GET /products, có trạng thái loading / rỗng / lỗi và phân trang. */
export function MenuGrid() {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const key = `${page}:${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<ProductPage>(`/products?page=${page}&limit=${PAGE_SIZE}`, { signal: controller.signal })
      .then(({ data }) => setResult({ key, data, error: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({ key, data: null, error: describeApiError(error) });
      });
    return () => controller.abort();
  }, [key, page]);

  const loading = result?.key !== key;

  if (loading) {
    return (
      <div aria-busy="true">
        <p className="sr-only" role="status">Đang tải menu…</p>
        <MenuSkeleton />
      </div>
    );
  }

  if (result.error || !result.data) {
    return (
      <div role="alert" className="rounded-2xl border border-brew-danger/30 bg-brew-danger-bg p-6">
        <h2 className="text-lg font-semibold text-brew-danger">Không tải được menu</h2>
        <p className="mt-2 text-sm">{result.error || 'Đã xảy ra lỗi không mong muốn.'}</p>
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          className="mt-4 rounded-lg bg-brew-ink px-5 py-3 font-semibold text-white hover:bg-brew-ink-hover focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          Thử lại
        </button>
      </div>
    );
  }

  const { data: products, meta } = result.data;

  if (products.length === 0) {
    const pastEnd = meta.total > 0 && page > 1;
    return (
      <div className="rounded-2xl border border-brew-line bg-white/60 p-8 text-center" role="status">
        <h2 className="text-lg font-semibold">{pastEnd ? 'Trang này không có sản phẩm' : 'Menu đang trống'}</h2>
        <p className="mt-2 text-sm text-brew-muted">
          {pastEnd ? 'Hãy quay lại trang đầu của menu.' : 'Hiện chưa có đồ uống nào. Vui lòng quay lại sau.'}
        </p>
        {pastEnd && (
          <button
            type="button"
            onClick={() => setPage(1)}
            className="mt-4 rounded-lg bg-brew-ink px-5 py-3 font-semibold text-white hover:bg-brew-ink-hover focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Về trang đầu
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <li key={product.id} className="flex">
            <ProductCard product={product} />
          </li>
        ))}
      </ul>

      {meta.totalPages > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-4" aria-label="Phân trang menu">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-brew-ink px-4 py-2 font-semibold disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Trang trước
          </button>
          <span className="text-sm" aria-live="polite">Trang {meta.page} / {meta.totalPages}</span>
          <button
            type="button"
            onClick={() => setPage((value) => Math.min(meta.totalPages, value + 1))}
            disabled={page >= meta.totalPages}
            className="rounded-lg border border-brew-ink px-4 py-2 font-semibold disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Trang sau
          </button>
        </nav>
      )}
    </div>
  );
}

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
    <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <li
          key={index}
          className="animate-pulse overflow-hidden rounded-2xl border border-[#e2d2b8] bg-[#efe5d4] p-3.5"
        >
          <div className="aspect-square rounded-xl bg-white/70" />
          <div className="space-y-2.5 pt-4 pb-2">
            <div className="mx-auto h-4 w-2/3 rounded bg-[#decbb4]" />
            <div className="mx-auto h-3 w-4/5 rounded bg-[#decbb4]/70" />
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
      <div role="alert" className="rounded-2xl border border-[#e5b8b8] bg-[#fbeaea] p-6 text-center text-[#9b2c2c]">
        <h2 className="text-lg font-bold">Không tải được menu</h2>
        <p className="mt-1.5 text-sm">{result.error || 'Đã xảy ra lỗi không mong muốn.'}</p>
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          className="mt-4 rounded-full bg-[#6d4c3d] px-6 py-2.5 text-xs font-bold text-white transition hover:bg-[#563a2d] focus-visible:outline-2 focus-visible:outline-offset-4"
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
      <div className="rounded-2xl border border-dashed border-[#decbb4] bg-[#efe5d4]/60 p-10 text-center" role="status">
        <h2 className="text-lg font-bold text-[#4a2e20]">
          {pastEnd ? 'Trang này không có sản phẩm' : 'Menu đang trống'}
        </h2>
        <p className="mt-2 text-sm text-[#7a6254]">
          {pastEnd ? 'Hãy quay lại trang đầu của menu.' : 'Hiện chưa có đồ uống nào. Vui lòng quay lại sau.'}
        </p>
        {pastEnd && (
          <button
            type="button"
            onClick={() => setPage(1)}
            className="mt-4 rounded-full bg-[#6d4c3d] px-6 py-2.5 text-xs font-bold text-white transition hover:bg-[#563a2d] focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Về trang đầu
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <li key={product.id} className="flex">
            <ProductCard product={product} />
          </li>
        ))}
      </ul>

      {meta.totalPages > 1 && (
        <nav
          className="mt-10 flex items-center justify-center gap-4"
          aria-label="Phân trang menu"
        >
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1}
            className="rounded-full border-2 border-[#6d4c3d] bg-white px-5 py-2 text-xs font-bold text-[#4a2e20] transition hover:bg-[#6d4c3d] hover:text-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            ← Trang trước
          </button>
          <span
            className="rounded-full bg-[#efe5d4] px-4 py-2 text-xs font-bold text-[#4a2e20]"
            aria-live="polite"
          >
            Trang {meta.page} / {meta.totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((value) => Math.min(meta.totalPages, value + 1))}
            disabled={page >= meta.totalPages}
            className="rounded-full border-2 border-[#6d4c3d] bg-white px-5 py-2 text-xs font-bold text-[#4a2e20] transition hover:bg-[#6d4c3d] hover:text-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Trang sau →
          </button>
        </nav>
      )}
    </div>
  );
}

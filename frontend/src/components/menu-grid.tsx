'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiRequest, describeApiError } from '@/lib/api-client';
import type { ProductPage, ProductSummary } from '@/lib/contracts/api.generated';
import {
  filterAndSortProducts,
  getCategoryCounts,
  type ProductCategory,
  type ProductSort,
} from '@/features/products/filter';
import { ProductCard } from './product-card';
import { MenuFilter } from './menu-filter';

const PAGE_SIZE = 12;

interface CatalogState {
  products: ProductSummary[];
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

/** Menu đồ uống kèm thanh tìm kiếm, bộ lọc theo danh mục / tồn kho, sắp xếp và phân trang. */
export function MenuGrid() {
  const [catalog, setCatalog] = useState<CatalogState | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Khởi tạo bộ lọc với URL query params (nếu có trên client)
  const [searchQuery, setSearchQuery] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('q') ?? '';
  });

  const [category, setCategory] = useState<ProductCategory>(() => {
    if (typeof window === 'undefined') return 'ALL';
    const cat = new URLSearchParams(window.location.search).get('cat');
    return cat && ['ALL', 'COFFEE', 'TEA', 'SPECIAL'].includes(cat)
      ? (cat as ProductCategory)
      : 'ALL';
  });

  const [inStockOnly, setInStockOnly] = useState(false);
  const [sortBy, setSortBy] = useState<ProductSort>('DEFAULT');
  const [page, setPage] = useState(1);

  // Lấy toàn bộ danh sách sản phẩm active từ backend (limit=50)
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<ProductPage>('/products?page=1&limit=50', { signal: controller.signal })
      .then(async ({ data }) => {
        let allProducts = data.data;
        // Nếu số lượng sản phẩm vượt quá 50, tải tiếp các trang còn lại
        if (data.meta.totalPages > 1) {
          const extraPages = await Promise.all(
            Array.from({ length: data.meta.totalPages - 1 }, (_, i) =>
              apiRequest<ProductPage>(`/products?page=${i + 2}&limit=50`, {
                signal: controller.signal,
              })
            )
          );
          for (const extra of extraPages) {
            allProducts = allProducts.concat(extra.data.data);
          }
        }
        setCatalog({ products: allProducts, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setCatalog({ products: [], error: describeApiError(error) });
      });

    return () => controller.abort();
  }, [attempt]);

  // Đếm danh mục theo toàn bộ catalog
  const categoryCounts = useMemo(() => {
    return catalog ? getCategoryCounts(catalog.products) : { ALL: 0, COFFEE: 0, TEA: 0, SPECIAL: 0 };
  }, [catalog]);

  // Lọc và sắp xếp
  const filteredProducts = useMemo(() => {
    if (!catalog?.products) return [];
    return filterAndSortProducts(catalog.products, {
      query: searchQuery,
      category,
      inStockOnly,
      sortBy,
    });
  }, [catalog, searchQuery, category, inStockOnly, sortBy]);

  // Phân trang danh sách đã lọc
  const totalFiltered = filteredProducts.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const paginatedProducts = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredProducts.slice(start, start + PAGE_SIZE);
  }, [filteredProducts, safePage]);

  // Xử lý thay đổi bộ lọc (tự động về trang 1)
  const handleSearchChange = (q: string) => {
    setSearchQuery(q);
    setPage(1);
  };

  const handleCategoryChange = (cat: ProductCategory) => {
    setCategory(cat);
    setPage(1);
  };

  const handleInStockChange = (val: boolean) => {
    setInStockOnly(val);
    setPage(1);
  };

  const handleSortChange = (sort: ProductSort) => {
    setSortBy(sort);
    setPage(1);
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setCategory('ALL');
    setInStockOnly(false);
    setSortBy('DEFAULT');
    setPage(1);
  };

  // Trạng thái đang tải
  if (catalog === null) {
    return (
      <div aria-busy="true">
        <p className="sr-only" role="status">
          Đang tải menu…
        </p>
        <MenuSkeleton />
      </div>
    );
  }

  // Trạng thái lỗi tải dữ liệu
  if (catalog.error) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-[#e5b8b8] bg-[#fbeaea] p-6 text-center text-[#9b2c2c]"
      >
        <h2 className="text-lg font-bold">Không tải được menu</h2>
        <p className="mt-1.5 text-sm">{catalog.error || 'Đã xảy ra lỗi không mong muốn.'}</p>
        <button
          type="button"
          onClick={() => {
            setCatalog(null);
            setAttempt((v) => v + 1);
          }}
          className="mt-4 rounded-full bg-[#6d4c3d] px-6 py-2.5 text-xs font-bold text-white transition hover:bg-[#563a2d] focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          Thử lại
        </button>
      </div>
    );
  }

  // Toàn bộ menu hệ thống đang trống
  if (catalog.products.length === 0) {
    return (
      <div
        className="rounded-2xl border border-dashed border-[#decbb4] bg-[#efe5d4]/60 p-10 text-center"
        role="status"
      >
        <h2 className="text-lg font-bold text-[#4a2e20]">Menu đang trống</h2>
        <p className="mt-2 text-sm text-[#7a6254]">
          Hiện chưa có đồ uống nào. Vui lòng quay lại sau.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Bộ lọc tìm kiếm & sắp xếp */}
      <MenuFilter
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        selectedCategory={category}
        onCategoryChange={handleCategoryChange}
        inStockOnly={inStockOnly}
        onInStockChange={handleInStockChange}
        sortBy={sortBy}
        onSortChange={handleSortChange}
        onResetFilters={handleResetFilters}
        categoryCounts={categoryCounts}
        totalFilteredCount={totalFiltered}
        totalCatalogCount={catalog.products.length}
      />

      {/* Kết quả rỗng do bộ lọc */}
      {paginatedProducts.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed border-[#decbb4] bg-[#efe5d4]/40 p-10 text-center"
          role="status"
        >
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[#decbb4]/50 text-xl text-[#6d4c3d]">
            🔍
          </div>
          <h3 className="mt-3 text-lg font-bold text-[#4a2e20]">
            Không tìm thấy đồ uống phù hợp
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-[#7a6254]">
            Không có món nào khớp với điều kiện tìm kiếm hoặc bộ lọc hiện tại. Thử xóa bộ lọc để xem
            toàn bộ thực đơn.
          </p>
          <button
            type="button"
            onClick={handleResetFilters}
            className="mt-5 rounded-full bg-[#6d4c3d] px-6 py-2.5 text-xs font-bold text-white transition hover:bg-[#563a2d] focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Xóa bộ lọc &amp; Xem lại tất cả
          </button>
        </div>
      ) : (
        /* Lưới sản phẩm */
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {paginatedProducts.map((product) => (
            <li key={product.id} className="flex">
              <ProductCard product={product} />
            </li>
          ))}
        </ul>
      )}

      {/* Phân trang khi số món đã lọc > PAGE_SIZE (12 món) */}
      {totalPages > 1 && (
        <nav
          className="mt-10 flex items-center justify-center gap-4"
          aria-label="Phân trang menu"
        >
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={safePage <= 1}
            className="rounded-full border-2 border-[#6d4c3d] bg-white px-5 py-2 text-xs font-bold text-[#4a2e20] transition hover:bg-[#6d4c3d] hover:text-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            ← Trang trước
          </button>
          <span
            className="rounded-full bg-[#efe5d4] px-4 py-2 text-xs font-bold text-[#4a2e20]"
            aria-live="polite"
          >
            Trang {safePage} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={safePage >= totalPages}
            className="rounded-full border-2 border-[#6d4c3d] bg-white px-5 py-2 text-xs font-bold text-[#4a2e20] transition hover:bg-[#6d4c3d] hover:text-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            Trang sau →
          </button>
        </nav>
      )}
    </div>
  );
}

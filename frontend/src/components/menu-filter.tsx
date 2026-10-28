'use client';

import {
  CATEGORY_LABELS,
  SORT_LABELS,
  type ProductCategory,
  type ProductSort,
} from '@/features/products/filter';

interface MenuFilterProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedCategory: ProductCategory;
  onCategoryChange: (category: ProductCategory) => void;
  inStockOnly: boolean;
  onInStockChange: (inStockOnly: boolean) => void;
  sortBy: ProductSort;
  onSortChange: (sort: ProductSort) => void;
  onResetFilters: () => void;
  categoryCounts: Record<ProductCategory, number>;
  totalFilteredCount: number;
  totalCatalogCount: number;
}

const CATEGORIES: ProductCategory[] = ['ALL', 'COFFEE', 'TEA', 'SPECIAL'];
const SORTS: ProductSort[] = ['DEFAULT', 'PRICE_ASC', 'PRICE_DESC', 'NAME_ASC'];

export function MenuFilter({
  searchQuery,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  inStockOnly,
  onInStockChange,
  sortBy,
  onSortChange,
  onResetFilters,
  categoryCounts,
  totalFilteredCount,
  totalCatalogCount,
}: MenuFilterProps) {
  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    selectedCategory !== 'ALL' ||
    inStockOnly ||
    sortBy !== 'DEFAULT';

  return (
    <section
      aria-label="Bộ lọc thực đơn"
      className="mb-8 rounded-2xl border border-[#e2d2b8] bg-[#fbf8f5] p-4 shadow-xs sm:p-6"
    >
      {/* Hàng 1: Ô tìm kiếm */}
      <div className="relative">
        <label htmlFor="menu-search-input" className="sr-only">
          Tìm kiếm đồ uống
        </label>
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-[#7a6254]">
          <svg
            className="size-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35M16.65 10.65a6 6 0 11-12 0 6 6 0 0112 0z"
            />
          </svg>
        </div>
        <input
          id="menu-search-input"
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Tìm tên món (cà phê, trà đào, bạc xỉu, matcha...)"
          className="w-full rounded-full border border-[#decbb4] bg-white py-2.5 pr-10 pl-11 text-sm text-[#4a2e20] placeholder-[#a68e7b] transition focus:border-[#6d4c3d] focus:ring-2 focus:ring-[#6d4c3d]/20 focus:outline-hidden"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-xs text-[#7a6254] transition hover:text-[#4a2e20]"
            aria-label="Xóa từ khóa tìm kiếm"
          >
            <span className="flex size-5 items-center justify-center rounded-full bg-[#decbb4]/60 text-xs font-bold text-[#4a2e20] hover:bg-[#decbb4]">
              ✕
            </span>
          </button>
        )}
      </div>

      {/* Hàng 2: Danh mục (Pills / Tabs) */}
      <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        {CATEGORIES.map((cat) => {
          const isSelected = selectedCategory === cat;
          const count = categoryCounts[cat] ?? 0;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => onCategoryChange(cat)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold whitespace-nowrap transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6d4c3d] ${
                isSelected
                  ? 'bg-[#6d4c3d] text-white shadow-xs'
                  : 'border border-[#decbb4] bg-white text-[#5c4033] hover:border-[#6d4c3d]/50 hover:bg-[#efe5d4]/50 hover:text-[#4a2e20]'
              }`}
              aria-pressed={isSelected}
            >
              <span>{CATEGORY_LABELS[cat]}</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-semibold ${
                  isSelected ? 'bg-white/25 text-white' : 'bg-[#efe5d4] text-[#6d4c3d]'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Hàng 3: Tùy chọn lọc phụ & sắp xếp */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#decbb4]/60 pt-3.5 text-xs">
        {/* Bên trái: Lọc chỉ món còn hàng */}
        <label className="inline-flex cursor-pointer items-center gap-2 select-none">
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={(e) => onInStockChange(e.target.checked)}
            className="size-4 rounded border-[#decbb4] text-[#6d4c3d] accent-[#6d4c3d] focus:ring-[#6d4c3d]"
          />
          <span className="font-semibold text-[#4a2e20]">Chỉ hiện món còn hàng</span>
        </label>

        {/* Bên phải: Dropdown sắp xếp + nút Xóa bộ lọc */}
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-4">
          <div className="inline-flex items-center gap-1.5">
            <label htmlFor="menu-sort-select" className="text-[#7a6254]">
              Sắp xếp:
            </label>
            <select
              id="menu-sort-select"
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value as ProductSort)}
              className="rounded-full border border-[#decbb4] bg-white px-3 py-1.5 text-xs font-bold text-[#4a2e20] transition focus:border-[#6d4c3d] focus:outline-hidden"
            >
              {SORTS.map((sort) => (
                <option key={sort} value={sort}>
                  {SORT_LABELS[sort]}
                </option>
              ))}
            </select>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              className="inline-flex items-center gap-1 rounded-full border border-[#e5b8b8] bg-[#fbeaea] px-3 py-1.5 text-xs font-bold text-[#9b2c2c] transition hover:bg-[#f5d5d5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9b2c2c]"
            >
              <span>✕</span>
              <span>Xóa bộ lọc</span>
            </button>
          )}
        </div>
      </div>

      {/* Hàng 4: Tóm tắt kết quả */}
      <div className="mt-2.5 flex items-center justify-between text-[11px] text-[#7a6254]">
        <span>
          Hiển thị <strong className="font-bold text-[#4a2e20]">{totalFilteredCount}</strong> /{' '}
          {totalCatalogCount} món
        </span>
        {searchQuery.trim() && (
          <span className="truncate pl-2 italic">
            Từ khóa: &ldquo;{searchQuery.trim()}&rdquo;
          </span>
        )}
      </div>
    </section>
  );
}

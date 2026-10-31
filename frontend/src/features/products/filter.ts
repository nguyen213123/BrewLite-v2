export type ProductCategory = 'ALL' | 'COFFEE' | 'TEA' | 'SPECIAL';

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  ALL: 'Tất cả',
  COFFEE: 'Cà phê',
  TEA: 'Trà & Trà sữa',
  SPECIAL: 'Món khác / Đá xay',
};

export type ProductSort = 'DEFAULT' | 'PRICE_ASC' | 'PRICE_DESC' | 'NAME_ASC';

export const SORT_LABELS: Record<ProductSort, string> = {
  DEFAULT: 'Mặc định',
  PRICE_ASC: 'Giá: Thấp đến Cao',
  PRICE_DESC: 'Giá: Cao đến Thấp',
  NAME_ASC: 'Tên: A → Z',
};

export interface ProductFilterOptions {
  query?: string;
  category?: ProductCategory;
  inStockOnly?: boolean;
  sortBy?: ProductSort;
}

/**
 * Chuẩn hóa chuỗi tiếng Việt: bỏ dấu, chuyển chữ thường và xử lý chữ đ/Đ.
 */
export function normalizeVietnamese(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .trim();
}

/**
 * Phân loại danh mục sản phẩm dựa theo tên và mô tả.
 */
export function getProductCategory(name: string, description = ''): ProductCategory {
  const norm = normalizeVietnamese(`${name} ${description}`);

  // Matcha latte có chữ latte nhưng bản chất là thức uống đặc biệt từ bột trà matcha
  if (norm.includes('matcha')) {
    return 'SPECIAL';
  }

  // Cà phê: các món cà phê kinh điển (Cappuccino, Espresso, Mocha, Bạc xỉu, Cà phê muối, Caramel Macchiato,...)
  if (
    norm.includes('ca phe') ||
    norm.includes('cappuccino') ||
    norm.includes('americano') ||
    norm.includes('latte') ||
    norm.includes('espresso') ||
    norm.includes('mocha') ||
    norm.includes('bac xiu') ||
    norm.includes('caramel') ||
    norm.includes('macchiato') ||
    norm.includes('phin')
  ) {
    return 'COFFEE';
  }

  // Trà & Trà sữa
  if (
    norm.includes('tra') ||
    norm.includes('oolong') ||
    norm.includes('hong tra') ||
    norm.includes('luc tra') ||
    norm.includes('nhai')
  ) {
    return 'TEA';
  }

  // Đá xay & các món đặc biệt khác
  if (
    norm.includes('so co la') ||
    norm.includes('cacao') ||
    norm.includes('da xay')
  ) {
    return 'SPECIAL';
  }

  return 'SPECIAL';
}

/**
 * Đếm số lượng sản phẩm theo từng danh mục.
 */
export function getCategoryCounts<T extends { name: string; description: string }>(
  products: readonly T[]
): Record<ProductCategory, number> {
  const counts: Record<ProductCategory, number> = {
    ALL: products.length,
    COFFEE: 0,
    TEA: 0,
    SPECIAL: 0,
  };
  for (const p of products) {
    const cat = getProductCategory(p.name, p.description);
    if (cat !== 'ALL') {
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Lọc và sắp xếp danh sách sản phẩm theo từ khóa tìm kiếm, danh mục, tồn kho và tiêu chí sắp xếp.
 */
export function filterAndSortProducts<
  T extends { name: string; description: string; price: number; stock: number }
>(
  products: readonly T[],
  options: ProductFilterOptions = {}
): T[] {
  const {
    query = '',
    category = 'ALL',
    inStockOnly = false,
    sortBy = 'DEFAULT',
  } = options;

  const cleanQuery = normalizeVietnamese(query);

  const filtered = products.filter((product) => {
    // Lọc theo danh mục
    if (category !== 'ALL') {
      const itemCategory = getProductCategory(product.name, product.description);
      if (itemCategory !== category) return false;
    }

    // Lọc theo trạng thái còn hàng
    if (inStockOnly && product.stock <= 0) {
      return false;
    }

    // Lọc theo từ khóa tìm kiếm (hỗ trợ nhiều từ cách nhau bởi khoảng trắng)
    if (cleanQuery) {
      const searchSpace = normalizeVietnamese(`${product.name} ${product.description}`);
      const terms = cleanQuery.split(/\s+/).filter(Boolean);
      const matchesAll = terms.every((term) => searchSpace.includes(term));
      if (!matchesAll) return false;
    }

    return true;
  });

  // Sắp xếp
  if (sortBy === 'PRICE_ASC') {
    return [...filtered].sort((a, b) => a.price - b.price);
  }
  if (sortBy === 'PRICE_DESC') {
    return [...filtered].sort((a, b) => b.price - a.price);
  }
  if (sortBy === 'NAME_ASC') {
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }

  return filtered;
}

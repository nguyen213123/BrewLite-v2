// Owner: TV3 — #9. Domain logic tính công thức nguyên liệu theo spec A3.
import type * as Api from '../../../common/contracts/api.generated';

// Spec A3: hệ số size S: 100%, M: 125%, L: 150%
export const SIZE_FACTOR_PCT: Record<Api.Size, number> = {
  S: 100,
  M: 125,
  L: 150,
};

export type RecipeLine = {
  ingredientId: string;
  amount: number;
  unit: 'GRAM' | 'ML' | 'PIECE';
};

export type RecipeBook = {
  products: Map<string, RecipeLine[]>;
  toppings: Map<string, RecipeLine[]>;
};

// Spec A3: nguyên liệu PIECE không đổi theo size; GRAM/ML nhân hệ số rồi làm tròn lên (ceil)
export function perCupAmount(line: RecipeLine, size: Api.Size): number {
  return line.unit === 'PIECE'
    ? line.amount
    : Math.ceil((line.amount * SIZE_FACTOR_PCT[size]) / 100);
}

// Spec A3: tính tổng lượng nguyên liệu cần cho giỏ hàng, gộp theo ingredientId và sắp xếp id tăng dần.
// Topping không nhân hệ số size. Món hoặc topping không có công thức thì bỏ qua (InventoryService sẽ ném lỗi).
export function requiredIngredients(
  book: RecipeBook,
  items: Api.CartItem[],
): Array<[ingredientId: string, amount: number]> {
  const totals = new Map<string, number>();

  for (const item of items) {
    const productLines = book.products.get(item.productId) ?? [];
    for (const line of productLines) {
      const needed = perCupAmount(line, item.size) * item.qty;
      totals.set(line.ingredientId, (totals.get(line.ingredientId) ?? 0) + needed);
    }

    for (const toppingId of item.toppingIds ?? []) {
      const toppingLines = book.toppings.get(toppingId) ?? [];
      for (const line of toppingLines) {
        const needed = line.amount * item.qty;
        totals.set(line.ingredientId, (totals.get(line.ingredientId) ?? 0) + needed);
      }
    }
  }

  return [...totals.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

// Spec A3: số ly còn bán được của một size (hoặc topping khi size === null).
// Công thức rỗng thì trả về 0. Lấy giá trị nhỏ nhất trên mọi nguyên liệu: floor(stock / needed).
export function availableCups(
  lines: RecipeLine[],
  size: Api.Size | null,
  stockById: Map<string, number>,
): number {
  if (lines.length === 0) return 0;

  let minCups = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    const needed = size === null ? line.amount : perCupAmount(line, size);
    if (needed <= 0) return 0;
    const stock = Math.max(0, stockById.get(line.ingredientId) ?? 0);
    const cups = Math.floor(stock / needed);
    if (cups < minCups) minCups = cups;
  }

  return minCups === Number.POSITIVE_INFINITY ? 0 : minCups;
}

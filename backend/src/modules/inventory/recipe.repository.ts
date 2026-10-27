// Owner: TV3 — #9. Tải công thức món và topping từ cơ sở dữ liệu.
import type { Tx } from '../../common/contracts/ports';
import type { RecipeBook, RecipeLine } from './domain/recipe';

export type RecipeDbClient = Pick<Tx, 'productIngredient' | 'toppingIngredient'>;

export type LoadedRecipeBook = RecipeBook & {
  stockById: Map<string, number>;
};

// Tải công thức của các món và topping được chọn kèm đơn vị gốc và tồn kho nguyên liệu.
export async function loadRecipeBook(
  db: RecipeDbClient,
  productIds: string[],
  toppingIds: string[],
): Promise<LoadedRecipeBook> {
  const uniqueProductIds = [...new Set(productIds)];
  const uniqueToppingIds = [...new Set(toppingIds)];

  const [productRows, toppingRows] = await Promise.all([
    uniqueProductIds.length > 0
      ? db.productIngredient.findMany({
          where: { productId: { in: uniqueProductIds } },
          include: { ingredient: { select: { unit: true, stock: true } } },
        })
      : Promise.resolve([]),
    uniqueToppingIds.length > 0
      ? db.toppingIngredient.findMany({
          where: { toppingId: { in: uniqueToppingIds } },
          include: { ingredient: { select: { unit: true, stock: true } } },
        })
      : Promise.resolve([]),
  ]);

  const products = new Map<string, RecipeLine[]>();
  const stockById = new Map<string, number>();

  for (const row of productRows) {
    const lines = products.get(row.productId) ?? [];
    lines.push({
      ingredientId: row.ingredientId,
      amount: row.amount,
      unit: row.ingredient.unit,
    });
    products.set(row.productId, lines);
    if (typeof row.ingredient.stock === 'number') {
      stockById.set(row.ingredientId, row.ingredient.stock);
    }
  }

  const toppings = new Map<string, RecipeLine[]>();
  for (const row of toppingRows) {
    const lines = toppings.get(row.toppingId) ?? [];
    lines.push({
      ingredientId: row.ingredientId,
      amount: row.amount,
      unit: row.ingredient.unit,
    });
    toppings.set(row.toppingId, lines);
    if (typeof row.ingredient.stock === 'number') {
      stockById.set(row.ingredientId, row.ingredient.stock);
    }
  }

  return { products, toppings, stockById };
}

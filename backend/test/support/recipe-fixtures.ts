import { randomUUID } from 'node:crypto';
import type { PrismaClient, IngredientUnit, Size } from '../../src/generated/prisma/client';
import type { Tx } from '../../src/common/contracts/ports';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { availableCups, type RecipeLine } from '../../src/modules/inventory/domain/recipe';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaDb = PrismaClient | Tx | PrismaService | any;

export async function createTestIngredient(
  prisma: PrismaDb,
  data?: Partial<{
    id: string;
    name: string;
    unit: IngredientUnit;
    stock: number;
    packageSize: number;
    packageLabel: string;
    version: number;
  }>,
) {
  const id = data?.id ?? randomUUID();
  return prisma.ingredient.create({
    data: {
      id,
      name: data?.name ?? `Ingredient ${id.slice(0, 8)}`,
      unit: data?.unit ?? 'GRAM',
      stock: data?.stock ?? 1000,
      packageSize: data?.packageSize ?? 250,
      packageLabel: data?.packageLabel ?? 'túi',
      version: data?.version ?? 0,
    },
  });
}

export async function seedIngredients(
  prisma: PrismaDb,
  rows: Array<
    Partial<{
      id: string;
      name: string;
      unit: IngredientUnit;
      stock: number;
      packageSize: number;
      packageLabel: string;
      version: number;
    }>
  >,
) {
  const created = [];
  for (const row of rows) {
    created.push(await createTestIngredient(prisma, row));
  }
  return created;
}

export async function createTestRecipe(
  prisma: PrismaDb,
  productId: string,
  lines: Array<{ ingredientId: string; amount: number }>,
) {
  const created = [];
  for (const line of lines) {
    created.push(
      await prisma.productIngredient.create({
        data: {
          productId,
          ingredientId: line.ingredientId,
          amount: line.amount,
        },
      }),
    );
  }
  return created;
}

export const seedRecipe = createTestRecipe;

export async function createTestToppingRecipe(
  prisma: PrismaDb,
  toppingId: string,
  lines: Array<{ ingredientId: string; amount: number }>,
) {
  const created = [];
  for (const line of lines) {
    created.push(
      await prisma.toppingIngredient.create({
        data: {
          toppingId,
          ingredientId: line.ingredientId,
          amount: line.amount,
        },
      }),
    );
  }
  return created;
}

export async function seedSingleIngredientProduct(
  prisma: PrismaDb,
  options: {
    productId?: string;
    productName?: string;
    price?: number;
    stockCups: number;
    cupAmount?: number;
    unit?: IngredientUnit;
    size?: Size;
    withSizes?: boolean;
  },
) {
  const productId = options.productId ?? randomUUID();
  const cupAmount = options.cupAmount ?? 18;
  const unit: IngredientUnit = options.unit ?? 'GRAM';
  const size: Size = options.size ?? 'M';
  const perCup = unit === 'PIECE'
    ? cupAmount
    : Math.ceil((cupAmount * (size === 'S' ? 100 : size === 'M' ? 125 : 150)) / 100);
  const stock = options.stockCups * perCup;

  const ingredient = await createTestIngredient(prisma, {
    name: `Ing for ${options.productName ?? productId.slice(0, 8)}`,
    unit,
    stock,
    packageSize: unit === 'PIECE' ? 10 : 250,
    packageLabel: unit === 'PIECE' ? 'túi' : 'gói',
  });

  const product = await prisma.product.create({
    data: {
      id: productId,
      name: options.productName ?? `Test Product ${productId.slice(0, 8)}`,
      description: 'Single ingredient fixture',
      price: options.price ?? 45000,
      imageUrl: 'http://localhost/test.jpg',
      ...(options.withSizes ? {
        sizes: {
          create: [
            { size: 'S', price: options.price ?? 45000 },
            { size: 'M', price: (options.price ?? 45000) + 5000 },
            { size: 'L', price: (options.price ?? 45000) + 10000 },
          ],
        },
      } : {}),
    },
  });

  await createTestRecipe(prisma, productId, [{ ingredientId: ingredient.id, amount: cupAmount }]);

  return { product, ingredient, cupAmount, perCup };
}

export async function stockOfProduct(
  prisma: PrismaDb,
  productId: string,
  size: Size = 'S',
): Promise<number> {
  const rows = await prisma.productIngredient.findMany({
    where: { productId },
    include: { ingredient: true },
  });
  if (rows.length === 0) return 0;
  const lines: RecipeLine[] = rows.map((r: { ingredientId: string; amount: number; ingredient: { unit: 'GRAM' | 'ML' | 'PIECE' } }) => ({
    ingredientId: r.ingredientId,
    amount: r.amount,
    unit: r.ingredient.unit,
  }));
  const stockById = new Map<string, number>(rows.map((r: { ingredientId: string; ingredient: { stock: number } }) => [r.ingredientId, r.ingredient.stock]));
  return availableCups(lines, size, stockById);
}

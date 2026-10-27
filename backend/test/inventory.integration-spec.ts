import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { UnitOfWork } from '../src/common/database/unit-of-work';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { ApiError } from '../src/common/errors/api-error';
import type { StoredOrder } from '../src/common/contracts/ports';
import { createTempDatabase, type TempDatabase } from './support/temp-database';
import {
  createTestIngredient,
  createTestRecipe,
  createTestToppingRecipe,
  seedSingleIngredientProduct,
  stockOfProduct,
} from './support/recipe-fixtures';

// Real PostgreSQL concurrency test for Issue #9. Opt-in like the schema test:
//   $env:DATABASE_URL = "<server in backend/.env>"; $env:RUN_DB_TESTS = "1"; npm --prefix backend test -- inventory.integration
// It creates its own temporary database (migrations applied), writes every fixture there and drops it afterwards,
// so nothing is written to the development database. See test/support/temp-database.ts.
const integration = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

integration('Inventory on PostgreSQL: transaction + optimistic locking', () => {
  let prisma: PrismaService;
  let unitOfWork: UnitOfWork;
  let testUser: { id: string };
  const inventory = new InventoryService();

  let tempDatabase: TempDatabase | undefined;
  const serverUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    tempDatabase = await createTempDatabase(serverUrl);
    process.env.DATABASE_URL = tempDatabase.url; // PrismaService reads it when constructed
    prisma = new PrismaService();
    unitOfWork = new UnitOfWork(prisma);
    testUser = await prisma.user.create({
      data: { email: `${randomUUID()}@example.com`, passwordHash: 'test-only-not-an-auth-account' },
    });
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    if (serverUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = serverUrl;
    await tempDatabase?.drop();
  }, 60_000);

  const newProduct = async (stockCups: number, id: string = randomUUID()) => {
    const res = await seedSingleIngredientProduct(prisma, {
      productId: id,
      stockCups,
      size: 'M',
      cupAmount: 18,
      unit: 'GRAM',
    });
    return { ...res.product, ingredient: res.ingredient, perCup: res.perCup };
  };
  const stockOf = async (id: string) => stockOfProduct(prisma, id, 'M');
  const reserve = (lines: Array<[string, number]>, size: 'S' | 'M' = 'M') =>
    unitOfWork.run(async tx => {
      const order = await tx.order.create({
        data: {
          code: `BL-${randomBytes(4).toString('hex').toUpperCase()}`,
          userId: testUser.id,
          subtotal: 100000,
          total: 100000,
        },
      });
      await inventory.reserve(
        tx,
        order.id,
        lines.map(([productId, qty]) => ({ productId, size, qty })),
      );
    });
  async function expectApiCode(promise: Promise<unknown>, code: string) {
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await promise.catch((error: ApiError) => expect(error.getResponse()).toMatchObject({ code }));
  }

  it('missing legacy hold snapshot rolls back the cancellation, event, stock and reservation change', async () => {
    const product = await newProduct(8);
    const order = await prisma.order.create({
      data: {
        code: `BL-${randomBytes(4).toString('hex').toUpperCase()}`,
        userId: testUser.id, subtotal: 100000, total: 100000,
        items: { create: [{ productId: product.id, productName: 'Legacy order', size: 'M', sizePrice: 50000, unitPrice: 50000, qty: 2, lineTotal: 100000 }] },
      },
      include: { items: { include: { toppings: true } } },
    });
    await expectApiCode(unitOfWork.run(async tx => {
      await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', version: { increment: 1 } } });
      await tx.orderEvent.create({ data: { orderId: order.id, actorUserId: testUser.id, fromStatus: 'PENDING', toStatus: 'CANCELLED', orderVersion: 1 } });
      await inventory.release(tx, order);
    }), 'STOCK_CONFLICT');
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: 'PENDING', reservationStatus: 'HELD', version: 0 });
    expect(await prisma.orderEvent.count({ where: { orderId: order.id } })).toBe(0);
    expect(await stockOf(product.id)).toBe(8);
  });

  it('stock=1 with 10 concurrent orders: exactly one holds the last cup', async () => {
    const product = await newProduct(1);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => reserve([[product.id, 1]])));
    const winners = results.filter(r => r.status === 'fulfilled').length;
    expect(winners).toBe(1);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(ApiError);
        expect((result.reason as ApiError).getResponse()).toMatchObject({ code: expect.stringMatching(/^(OUT_OF_STOCK|STOCK_CONFLICT)$/) });
      }
    }
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(9);
    expect(await stockOf(product.id)).toBe(0);
  });

  it('stock=5 with 20 concurrent orders: never holds more than the starting stock, never negative', async () => {
    const product = await newProduct(5);
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => reserve([[product.id, 1]])));
    const winners = results.filter(r => r.status === 'fulfilled').length;
    expect(winners).toBeGreaterThanOrEqual(1);
    expect(winners).toBeLessThanOrEqual(5);
    // STOCK_CONFLICT (3 lost races) is allowed: the client retries. What must hold is stock accounting.
    expect(await stockOf(product.id)).toBe(5 - winners);
  });

  it('adds duplicate lines of one product before checking stock', async () => {
    const product = await newProduct(3);
    await expectApiCode(reserve([[product.id, 2], [product.id, 2]]), 'OUT_OF_STOCK');
    expect(await stockOf(product.id)).toBe(3);
  });

  it('rolls back every product already held when a later product is short', async () => {
    const [first, second] = [randomUUID(), randomUUID()].sort(); // reserve() visits ids in ascending order
    await newProduct(1, first);
    await newProduct(0, second);
    await expectApiCode(reserve([[first, 1], [second, 1]]), 'OUT_OF_STOCK');
    expect(await stockOf(first)).toBe(1); // the hold on `first` was rolled back with the transaction
  });

  it('returns stock exactly once when the same order is released concurrently', async () => {
    const product = await newProduct(7);
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, passwordHash: 'test-only-not-an-auth-account' } });
    const order = await prisma.order.create({
      data: {
        code: `BL-20261022-${randomBytes(4).toString('hex').toUpperCase()}`,
        userId: user.id, subtotal: 135000, total: 135000, status: 'PENDING', reservationStatus: 'HELD',
        items: { create: [{ productId: product.id, productName: 'Fixture', size: 'M', sizePrice: 45000, unitPrice: 45000, qty: 3, lineTotal: 135000 }] },
      },
      include: { items: { include: { toppings: true } } },
    });
    // Create hold row matching the 3 cups held for this order
    await prisma.orderIngredientHold.create({
      data: {
        orderId: order.id,
        ingredientId: product.ingredient.id,
        amount: 3 * product.perCup,
      },
    });
    const stored = order as StoredOrder;

    const results = await Promise.allSettled([
      unitOfWork.run(tx => inventory.release(tx, stored)),
      unitOfWork.run(tx => inventory.release(tx, stored)),
      unitOfWork.run(tx => inventory.release(tx, stored)),
    ]);
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
    expect(await stockOf(product.id)).toBe(10); // 7 + 3, not 7 + 9
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).reservationStatus).toBe('RELEASED');
  });

  // Review Focus 4: Hai món khác nhau tranh phần cà phê cuối cùng cùng lúc. Chỉ một đơn được thắng.
  it('review focus 4: latte and cappuccino share coffee ingredient (stock=18, exactly 1 cup); 10 concurrent requests -> exactly 1 succeeds', async () => {
    const coffee = await createTestIngredient(prisma, {
      name: 'Shared Coffee Beans',
      unit: 'GRAM',
      stock: 18,
      packageSize: 250,
      packageLabel: 'túi',
    });
    const milk = await createTestIngredient(prisma, {
      name: 'Fresh Milk',
      unit: 'ML',
      stock: 1000,
      packageSize: 1000,
      packageLabel: 'hộp',
    });

    const latte = await prisma.product.create({
      data: {
        name: 'Latte',
        description: 'Espresso with milk',
        price: 48000,
        imageUrl: 'http://localhost/latte.jpg',
      },
    });
    await createTestRecipe(prisma, latte.id, [
      { ingredientId: coffee.id, amount: 18 },
      { ingredientId: milk.id, amount: 180 },
    ]);

    const cappuccino = await prisma.product.create({
      data: {
        name: 'Cappuccino',
        description: 'Espresso with foamed milk',
        price: 45000,
        imageUrl: 'http://localhost/cappuccino.jpg',
      },
    });
    await createTestRecipe(prisma, cappuccino.id, [
      { ingredientId: coffee.id, amount: 18 },
      { ingredientId: milk.id, amount: 120 },
    ]);

    // 10 concurrent requests: 5 Latte (size S), 5 Cappuccino (size S). Each requires 18g coffee.
    const requests = Array.from({ length: 10 }, (_, i) => {
      const productId = i % 2 === 0 ? latte.id : cappuccino.id;
      return reserve([[productId, 1]], 'S');
    });

    const results = await Promise.allSettled(requests);
    const winners = results.filter(r => r.status === 'fulfilled');
    const losers = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(9);
    for (const loser of losers) {
      expect(loser.reason).toBeInstanceOf(ApiError);
      expect((loser.reason as ApiError).getResponse()).toMatchObject({
        code: expect.stringMatching(/^(OUT_OF_STOCK|STOCK_CONFLICT)$/),
      });
    }

    const updatedCoffee = await prisma.ingredient.findUniqueOrThrow({ where: { id: coffee.id } });
    expect(updatedCoffee.stock).toBe(0); // exactly 0, never negative
  });

  // Review Focus 3: Món và topping cùng dùng một nguyên liệu (Trà sữa trân châu thêm topping Trân châu). Phải gộp lượng cần trước khi kiểm tra, nếu không sẽ bán vượt.
  it('review focus 3: milk tea with bubble topping both use bubbles; total demand 100g exceeds stock 75g -> OUT_OF_STOCK, 0 held', async () => {
    const tea = await createTestIngredient(prisma, {
      name: 'Black Tea',
      unit: 'GRAM',
      stock: 500,
      packageSize: 100,
      packageLabel: 'gói',
    });
    const bubbles = await createTestIngredient(prisma, {
      name: 'Tapioca Pearls',
      unit: 'GRAM',
      stock: 75, // enough for 1 drink (50g) OR 1 topping (50g), but not both (100g)
      packageSize: 1000,
      packageLabel: 'túi',
    });

    const milkTea = await prisma.product.create({
      data: {
        name: 'Milk Tea',
        description: 'Milk tea with bubbles',
        price: 45000,
        imageUrl: 'http://localhost/milktea.jpg',
      },
    });
    await createTestRecipe(prisma, milkTea.id, [
      { ingredientId: tea.id, amount: 6 },
      { ingredientId: bubbles.id, amount: 50 },
    ]);

    const bubbleTopping = await prisma.topping.create({
      data: { name: 'Trân châu', price: 8000 },
    });
    await createTestToppingRecipe(prisma, bubbleTopping.id, [{ ingredientId: bubbles.id, amount: 50 }]);

    const orderId = randomUUID();
    await expectApiCode(
      unitOfWork.run(tx =>
        inventory.reserve(tx, orderId, [
          { productId: milkTea.id, size: 'S', qty: 1, toppingIds: [bubbleTopping.id] },
        ]),
      ),
      'OUT_OF_STOCK',
    );

    // Verify 0 ingredients held and transaction rolled back completely
    const teaAfter = await prisma.ingredient.findUniqueOrThrow({ where: { id: tea.id } });
    const bubblesAfter = await prisma.ingredient.findUniqueOrThrow({ where: { id: bubbles.id } });
    expect(teaAfter.stock).toBe(500);
    expect(bubblesAfter.stock).toBe(75);
    const holds = await prisma.orderIngredientHold.findMany({ where: { orderId } });
    expect(holds).toHaveLength(0);
  });
});

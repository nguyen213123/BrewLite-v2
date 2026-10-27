// Owner: TV3 — #9. Kiểm thử giữ kho, kiểm tra kho và hoàn kho theo nguyên liệu + công thức.
import { InventoryService, MAX_STOCK_ATTEMPTS } from '../src/modules/inventory/inventory.service';
import { loadRecipeBook } from '../src/modules/inventory/recipe.repository';
import { requiredIngredients } from '../src/modules/inventory/domain/recipe';
import { ApiError } from '../src/common/errors/api-error';
import type { StoredOrder, Tx } from '../src/common/contracts/ports';
import type * as Api from '../src/common/contracts/api.generated';

type Unit = 'GRAM' | 'ML' | 'PIECE';
type FakeProduct = { active: boolean };
type FakeIngredient = { unit: Unit; stock: number; version: number };
type FakeProductRecipe = { productId: string; ingredientId: string; amount: number };
type FakeToppingRecipe = { toppingId: string; ingredientId: string; amount: number };
type FakeHold = { orderId: string; ingredientId: string; amount: number };
type ReservationStatus = 'HELD' | 'CONSUMED' | 'RELEASED';

const PROD_A = '11111111-1111-4111-8111-11111111110a';
const PROD_B = '11111111-1111-4111-8111-11111111110b';
const PROD_NO_RECIPE = '11111111-1111-4111-8111-11111111110c';
const TOP_KEM = '22222222-2222-4222-8222-222222222201';
const TOP_PEARL = '22222222-2222-4222-8222-222222222202';
const TOP_NO_RECIPE = '22222222-2222-4222-8222-222222222203';

// Sắp thứ tự id nguyên liệu rõ ràng: ING_1 < ING_2 < ING_3 < ING_4
const ING_1 = '33333333-3333-4333-8333-333333333301'; // Cà phê (GRAM)
const ING_2 = '33333333-3333-4333-8333-333333333302'; // Sữa tươi (ML)
const ING_3 = '33333333-3333-4333-8333-333333333303'; // Chanh tươi (PIECE)
const ING_4 = '33333333-3333-4333-8333-333333333304'; // Trân châu (GRAM)
const ORDER = '44444444-4444-4444-8444-444444444444';

type FakeDbOptions = {
  products?: Record<string, Partial<FakeProduct>>;
  ingredients?: Record<string, Partial<FakeIngredient>>;
  productIngredients?: FakeProductRecipe[];
  toppingIngredients?: FakeToppingRecipe[];
  holds?: FakeHold[];
  reservationStatus?: ReservationStatus;
};

function fakeDb(options: FakeDbOptions = {}) {
  const defaultProducts: Record<string, FakeProduct> = {
    [PROD_A]: { active: true },
    [PROD_B]: { active: true },
    [PROD_NO_RECIPE]: { active: true },
  };
  const products = new Map<string, FakeProduct>(
    Object.entries({ ...defaultProducts, ...options.products }).map(([id, p]) => [id, { active: true, ...p }]),
  );

  const ingredients = new Map<string, FakeIngredient>(
    Object.entries(options.ingredients ?? {}).map(([id, ing]) => [
      id,
      { unit: 'GRAM', stock: 0, version: 0, ...ing },
    ]),
  );

  const productIngredients: FakeProductRecipe[] = options.productIngredients
    ? [...options.productIngredients]
    : [
        { productId: PROD_A, ingredientId: ING_1, amount: 25 },
        { productId: PROD_A, ingredientId: ING_2, amount: 100 },
        { productId: PROD_B, ingredientId: ING_1, amount: 18 },
        { productId: PROD_B, ingredientId: ING_3, amount: 1 },
      ];

  const toppingIngredients: FakeToppingRecipe[] = options.toppingIngredients
    ? [...options.toppingIngredients]
    : [
        { toppingId: TOP_KEM, ingredientId: ING_2, amount: 30 },
        { toppingId: TOP_PEARL, ingredientId: ING_4, amount: 50 },
      ];

  const holds: FakeHold[] = options.holds ? options.holds.map(h => ({ ...h })) : [];
  const order = { id: ORDER, reservationStatus: options.reservationStatus ?? ('HELD' as ReservationStatus) };
  const visited: string[] = [];
  const hooks = { beforeUpdate: (_ingredientId: string, _attempt: number): void => undefined };
  let reads = 0;
  let writes = 0;
  const attempts = new Map<string, number>();

  const tx = {
    product: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = products.get(where.id);
        return row ? { id: where.id, ...row } : null;
      },
      findMany: async ({ where }: { where?: { id?: { in: string[] }; active?: boolean } }) => {
        const ids = where?.id?.in;
        const result: Array<{ id: string; active: boolean }> = [];
        for (const [id, row] of products.entries()) {
          if (ids && !ids.includes(id)) continue;
          if (where?.active !== undefined && row.active !== where.active) continue;
          result.push({ id, ...row });
        }
        return result;
      },
    },
    productIngredient: {
      findMany: async ({ where }: { where: { productId: { in: string[] } } }) =>
        productIngredients
          .filter(r => where.productId.in.includes(r.productId))
          .map(r => ({
            ...r,
            ingredient: { unit: ingredients.get(r.ingredientId)?.unit ?? 'GRAM' },
          })),
    },
    toppingIngredient: {
      findMany: async ({ where }: { where: { toppingId: { in: string[] } } }) =>
        toppingIngredients
          .filter(r => where.toppingId.in.includes(r.toppingId))
          .map(r => ({
            ...r,
            ingredient: { unit: ingredients.get(r.ingredientId)?.unit ?? 'GRAM' },
          })),
    },
    ingredient: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        reads++;
        visited.push(where.id);
        const row = ingredients.get(where.id);
        return row ? { ...row } : null;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; version?: number; stock?: { gte: number } };
        data: { stock: { decrement?: number; increment?: number }; version: { increment: number } };
      }) => {
        const attempt = (attempts.get(where.id) ?? 0) + 1;
        attempts.set(where.id, attempt);
        hooks.beforeUpdate(where.id, attempt);
        const row = ingredients.get(where.id);
        if (!row) return { count: 0 };
        if (where.version !== undefined && row.version !== where.version) return { count: 0 };
        if (where.stock && row.stock < where.stock.gte) return { count: 0 };
        row.stock += (data.stock.increment ?? 0) - (data.stock.decrement ?? 0);
        row.version += data.version.increment;
        writes++;
        return { count: 1 };
      },
    },
    orderIngredientHold: {
      deleteMany: async ({ where }: { where: { orderId: string } }) => {
        writes++;
        const before = holds.length;
        for (let i = holds.length - 1; i >= 0; i--) {
          if (holds[i].orderId === where.orderId) holds.splice(i, 1);
        }
        return { count: before - holds.length };
      },
      createMany: async ({ data }: { data: FakeHold[] }) => {
        writes++;
        for (const item of data) holds.push({ ...item });
        return { count: data.length };
      },
      findMany: async ({ where }: { where: { orderId: string } }) =>
        holds
          .filter(h => h.orderId === where.orderId)
          .map(h => ({ ...h }))
          .sort((a, b) => (a.ingredientId < b.ingredientId ? -1 : a.ingredientId > b.ingredientId ? 1 : 0)),
    },
    order: {
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; reservationStatus: { in: ReservationStatus[] } };
        data: { reservationStatus: ReservationStatus };
      }) => {
        if (where.id !== order.id || !where.reservationStatus.in.includes(order.reservationStatus)) {
          return { count: 0 };
        }
        order.reservationStatus = data.reservationStatus;
        writes++;
        return { count: 1 };
      },
    },
  };

  return {
    tx: tx as unknown as Tx,
    products,
    ingredients,
    productIngredients,
    toppingIngredients,
    holds,
    order,
    visited,
    hooks,
    reads: () => reads,
    writes: () => writes,
  };
}

const storedOrder = (id: string = ORDER) => ({ id, items: [] }) as unknown as StoredOrder;

async function expectCode(promise: Promise<unknown>, status: number, code: string) {
  await expect(promise).rejects.toBeInstanceOf(ApiError);
  await promise.catch((error: ApiError) => {
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({ code });
  });
}

describe('loadRecipeBook', () => {
  it('tải công thức món và topping kèm đơn vị nguyên liệu từ DB', async () => {
    const db = fakeDb({
      ingredients: {
        [ING_1]: { unit: 'GRAM', stock: 500 },
        [ING_2]: { unit: 'ML', stock: 1000 },
        [ING_3]: { unit: 'PIECE', stock: 10 },
        [ING_4]: { unit: 'GRAM', stock: 300 },
      },
    });
    const book = await loadRecipeBook(db.tx, [PROD_A, PROD_B], [TOP_PEARL]);
    expect(book.products.get(PROD_A)).toEqual([
      { ingredientId: ING_1, amount: 25, unit: 'GRAM' },
      { ingredientId: ING_2, amount: 100, unit: 'ML' },
    ]);
    expect(book.products.get(PROD_B)).toEqual([
      { ingredientId: ING_1, amount: 18, unit: 'GRAM' },
      { ingredientId: ING_3, amount: 1, unit: 'PIECE' },
    ]);
    expect(book.toppings.get(TOP_PEARL)).toEqual([{ ingredientId: ING_4, amount: 50, unit: 'GRAM' }]);
  });
});

describe('InventoryService.check (chỉ đọc cho quote)', () => {
  const service = new InventoryService();

  it('kiểm tra đủ nguyên liệu mà không ghi gì vào DB', async () => {
    const db = fakeDb({
      ingredients: {
        [ING_1]: { unit: 'GRAM', stock: 100 },
        [ING_2]: { unit: 'ML', stock: 500 },
      },
    });
    await service.check(db.tx, [{ productId: PROD_A, size: 'M', qty: 2 }]);
    expect(db.writes()).toBe(0);
    expect(db.holds).toHaveLength(0);
    expect(db.ingredients.get(ING_1)).toMatchObject({ stock: 100, version: 0 });
    expect(db.ingredients.get(ING_2)).toMatchObject({ stock: 500, version: 0 });
  });

  it('trả 409 OUT_OF_STOCK khi thiếu nguyên liệu và không ghi gì vào DB', async () => {
    const db = fakeDb({
      ingredients: {
        [ING_1]: { unit: 'GRAM', stock: 30 }, // Size M cần ceil(25 * 1.25) = 32g
        [ING_2]: { unit: 'ML', stock: 500 },
      },
    });
    await expectCode(service.check(db.tx, [{ productId: PROD_A, size: 'M', qty: 1 }]), 409, 'OUT_OF_STOCK');
    expect(db.writes()).toBe(0);
  });

  it('trả 409 OUT_OF_STOCK khi món hoặc topping không có công thức', async () => {
    const db = fakeDb({
      ingredients: { [ING_1]: { unit: 'GRAM', stock: 500 }, [ING_2]: { unit: 'ML', stock: 500 } },
    });
    await expectCode(service.check(db.tx, [{ productId: PROD_NO_RECIPE, size: 'S', qty: 1 }]), 409, 'OUT_OF_STOCK');
    await expectCode(
      service.check(db.tx, [{ productId: PROD_A, size: 'S', toppingIds: [TOP_NO_RECIPE], qty: 1 }]),
      409,
      'OUT_OF_STOCK',
    );
    expect(db.writes()).toBe(0);
  });
});

describe('InventoryService.reserve (trừ kho theo nguyên liệu + ghi OrderIngredientHold)', () => {
  const service = new InventoryService();

  it('trừ đúng lượng nguyên liệu và ghi OrderIngredientHold khớp với requiredIngredients', async () => {
    const db = fakeDb({
      ingredients: {
        [ING_1]: { unit: 'GRAM', stock: 200 },
        [ING_2]: { unit: 'ML', stock: 500 },
        [ING_3]: { unit: 'PIECE', stock: 10 },
        [ING_4]: { unit: 'GRAM', stock: 300 },
      },
    });
    const items: Api.CartItem[] = [
      // PROD_A size M qty 2: ING_1 = ceil(25*1.25)*2 = 32*2 = 64; ING_2 = ceil(100*1.25)*2 = 125*2 = 250
      // + TOP_KEM qty 2: ING_2 += 30*2 = 60 -> ING_2 = 310
      // + TOP_PEARL qty 2: ING_4 = 50*2 = 100
      { productId: PROD_A, size: 'M', toppingIds: [TOP_KEM, TOP_PEARL], qty: 2 },
      // PROD_B size L qty 1: ING_1 += ceil(18*1.5) = 27 -> ING_1 = 91; ING_3 (PIECE) = 1*1 = 1
      { productId: PROD_B, size: 'L', qty: 1 },
    ];

    const book = await loadRecipeBook(db.tx, [PROD_A, PROD_B], [TOP_KEM, TOP_PEARL]);
    const expected = requiredIngredients(book, items);
    expect(expected).toEqual([
      [ING_1, 91],
      [ING_2, 310],
      [ING_3, 1],
      [ING_4, 100],
    ]);

    await service.reserve(db.tx, ORDER, items);

    expect(db.ingredients.get(ING_1)).toMatchObject({ stock: 200 - 91, version: 1 });
    expect(db.ingredients.get(ING_2)).toMatchObject({ stock: 500 - 310, version: 1 });
    expect(db.ingredients.get(ING_3)).toMatchObject({ stock: 10 - 1, version: 1 });
    expect(db.ingredients.get(ING_4)).toMatchObject({ stock: 300 - 100, version: 1 });
    expect(db.holds).toEqual(
      expected.map(([ingredientId, amount]) => ({ orderId: ORDER, ingredientId, amount })),
    );
  });

  it('gộp lượng nguyên liệu dùng chung giữa món và topping trước khi kiểm tra kho', async () => {
    // PROD_A (size S) cần 100ml ING_2; TOP_KEM cần 30ml ING_2 -> tổng 130ml. Kho có 120ml -> phải báo OUT_OF_STOCK.
    const db = fakeDb({
      ingredients: {
        [ING_1]: { unit: 'GRAM', stock: 100 },
        [ING_2]: { unit: 'ML', stock: 120 },
      },
    });
    await expectCode(
      service.reserve(db.tx, ORDER, [{ productId: PROD_A, size: 'S', toppingIds: [TOP_KEM], qty: 1 }]),
      409,
      'OUT_OF_STOCK',
    );
    expect(db.holds).toHaveLength(0);
  });

  it('thiếu nguyên liệu của topping → OUT_OF_STOCK, không nguyên liệu nào bị trừ', async () => {
    // Topping dùng ING_1 (id nhỏ nhất) thiếu hàng, món dùng ING_2 đủ hàng -> dừng ngay ở ING_1, không nguyên liệu nào bị trừ.
    const db = fakeDb({
      ingredients: {
        [ING_1]: { unit: 'GRAM', stock: 20 },
        [ING_2]: { unit: 'ML', stock: 500 },
      },
      productIngredients: [{ productId: PROD_A, ingredientId: ING_2, amount: 100 }],
      toppingIngredients: [{ toppingId: TOP_PEARL, ingredientId: ING_1, amount: 50 }],
    });

    await expectCode(
      service.reserve(db.tx, ORDER, [{ productId: PROD_A, size: 'S', toppingIds: [TOP_PEARL], qty: 1 }]),
      409,
      'OUT_OF_STOCK',
    );
    expect(db.ingredients.get(ING_1)).toMatchObject({ stock: 20, version: 0 });
    expect(db.ingredients.get(ING_2)).toMatchObject({ stock: 500, version: 0 });
    expect(db.holds).toHaveLength(0);
  });

  it('truy cập nguyên liệu theo id tăng dần bất kể thứ tự món và topping trong giỏ', async () => {
    const db = fakeDb({
      ingredients: {
        [ING_1]: { unit: 'GRAM', stock: 500 },
        [ING_2]: { unit: 'ML', stock: 500 },
        [ING_3]: { unit: 'PIECE', stock: 50 },
        [ING_4]: { unit: 'GRAM', stock: 500 },
      },
      // Đảo thứ tự trong bảng công thức: ING_4, ING_3 trước ING_2, ING_1
      productIngredients: [
        { productId: PROD_B, ingredientId: ING_3, amount: 1 },
        { productId: PROD_A, ingredientId: ING_2, amount: 100 },
        { productId: PROD_A, ingredientId: ING_1, amount: 25 },
      ],
      toppingIngredients: [{ toppingId: TOP_PEARL, ingredientId: ING_4, amount: 50 }],
    });

    await service.reserve(db.tx, ORDER, [
      { productId: PROD_B, size: 'S', toppingIds: [TOP_PEARL], qty: 1 },
      { productId: PROD_A, size: 'S', qty: 1 },
    ]);

    expect(db.visited).toEqual([ING_1, ING_2, ING_3, ING_4]);
  });

  it('món hoặc topping không có công thức → 409 OUT_OF_STOCK', async () => {
    const db = fakeDb({
      ingredients: {
        [ING_1]: { unit: 'GRAM', stock: 500 },
        [ING_2]: { unit: 'ML', stock: 500 },
      },
    });
    await expectCode(
      service.reserve(db.tx, ORDER, [{ productId: PROD_NO_RECIPE, size: 'S', qty: 1 }]),
      409,
      'OUT_OF_STOCK',
    );
    await expectCode(
      service.reserve(db.tx, ORDER, [{ productId: PROD_A, size: 'S', toppingIds: [TOP_NO_RECIPE], qty: 1 }]),
      409,
      'OUT_OF_STOCK',
    );
    expect(db.visited).toHaveLength(0);
    expect(db.holds).toHaveLength(0);
  });

  it('món không tồn tại hoặc không active → 404 PRODUCT_NOT_FOUND', async () => {
    const db = fakeDb({
      products: { [PROD_A]: { active: false } },
      ingredients: { [ING_1]: { unit: 'GRAM', stock: 500 }, [ING_2]: { unit: 'ML', stock: 500 } },
    });
    await expectCode(service.reserve(db.tx, ORDER, [{ productId: PROD_A, size: 'S', qty: 1 }]), 404, 'PRODUCT_NOT_FOUND');
    await expectCode(
      service.reserve(db.tx, ORDER, [{ productId: '99999999-9999-4999-8999-999999999999', size: 'S', qty: 1 }]),
      404,
      'PRODUCT_NOT_FOUND',
    );
  });

  it('đọc lại và thử lại khi version thay đổi, sau đó trừ kho đúng 1 lần', async () => {
    const db = fakeDb({
      ingredients: { [ING_1]: { unit: 'GRAM', stock: 100 } },
      productIngredients: [{ productId: PROD_A, ingredientId: ING_1, amount: 25 }],
    });
    db.hooks.beforeUpdate = (id, attempt) => {
      if (attempt === 1) db.ingredients.get(id)!.version += 1;
    };
    await service.reserve(db.tx, ORDER, [{ productId: PROD_A, size: 'S', qty: 2 }]);
    expect(db.reads()).toBe(2);
    expect(db.ingredients.get(ING_1)).toMatchObject({ stock: 50, version: 2 });
  });

  it('báo OUT_OF_STOCK (không phải STOCK_CONFLICT) khi giao dịch khác đã lấy hết hàng trong lúc retry', async () => {
    const db = fakeDb({
      ingredients: { [ING_1]: { unit: 'GRAM', stock: 25 } },
      productIngredients: [{ productId: PROD_A, ingredientId: ING_1, amount: 25 }],
    });
    db.hooks.beforeUpdate = (id, attempt) => {
      if (attempt === 1) {
        const row = db.ingredients.get(id)!;
        row.stock = 10;
        row.version += 1;
      }
    };
    await expectCode(service.reserve(db.tx, ORDER, [{ productId: PROD_A, size: 'S', qty: 1 }]), 409, 'OUT_OF_STOCK');
    expect(db.ingredients.get(ING_1)?.stock).toBe(10);
    expect(db.holds).toHaveLength(0);
  });

  it(`xung đột version ${MAX_STOCK_ATTEMPTS} lần liên tiếp → 409 STOCK_CONFLICT`, async () => {
    const db = fakeDb({
      ingredients: { [ING_1]: { unit: 'GRAM', stock: 100 } },
      productIngredients: [{ productId: PROD_A, ingredientId: ING_1, amount: 25 }],
    });
    db.hooks.beforeUpdate = id => {
      db.ingredients.get(id)!.version += 1;
    };
    await expectCode(service.reserve(db.tx, ORDER, [{ productId: PROD_A, size: 'S', qty: 1 }]), 409, 'STOCK_CONFLICT');
    expect(db.reads()).toBe(MAX_STOCK_ATTEMPTS);
    expect(db.ingredients.get(ING_1)?.stock).toBe(100);
    expect(db.holds).toHaveLength(0);
  });

  it('xóa các dòng hold cũ của đơn trước khi ghi hold mới (phục vụ prepareRetry)', async () => {
    const db = fakeDb({
      ingredients: {
        [ING_1]: { unit: 'GRAM', stock: 100 },
        [ING_2]: { unit: 'ML', stock: 500 },
      },
      holds: [{ orderId: ORDER, ingredientId: ING_1, amount: 999 }],
    });
    await service.reserve(db.tx, ORDER, [{ productId: PROD_A, size: 'S', qty: 1 }]);
    expect(db.holds).toEqual([
      { orderId: ORDER, ingredientId: ING_1, amount: 25 },
      { orderId: ORDER, ingredientId: ING_2, amount: 100 },
    ]);
  });
});

describe('InventoryService.release (hoàn kho đúng một lần từ OrderIngredientHold)', () => {
  const service = new InventoryService();

  it('từ chối hoàn kho khi đơn còn giữ hàng nhưng không có snapshot nguyên liệu', async () => {
    const db = fakeDb({
      ingredients: { [ING_1]: { unit: 'GRAM', stock: 75, version: 1 } },
      holds: [],
      reservationStatus: 'HELD',
    });
    await expectCode(service.release(db.tx, storedOrder()), 409, 'STOCK_CONFLICT');
    expect(db.ingredients.get(ING_1)).toMatchObject({ stock: 75, version: 1 });
  });

  it('hoàn kho cho đơn HELD và chuyển reservationStatus sang RELEASED', async () => {
    const db = fakeDb({
      ingredients: {
        [ING_1]: { unit: 'GRAM', stock: 50, version: 1 },
        [ING_2]: { unit: 'ML', stock: 300, version: 1 },
      },
      holds: [
        { orderId: ORDER, ingredientId: ING_2, amount: 200 },
        { orderId: ORDER, ingredientId: ING_1, amount: 50 },
      ],
      reservationStatus: 'HELD',
    });

    await service.release(db.tx, storedOrder());
    expect(db.order.reservationStatus).toBe('RELEASED');
    expect(db.ingredients.get(ING_1)).toMatchObject({ stock: 100, version: 2 });
    expect(db.ingredients.get(ING_2)).toMatchObject({ stock: 500, version: 2 });
  });

  it('hoàn kho cho cả đơn CONSUMED (hủy sau khi đã PAID)', async () => {
    const db = fakeDb({
      ingredients: { [ING_1]: { unit: 'GRAM', stock: 75, version: 1 } },
      holds: [{ orderId: ORDER, ingredientId: ING_1, amount: 25 }],
      reservationStatus: 'CONSUMED',
    });
    await service.release(db.tx, storedOrder());
    expect(db.order.reservationStatus).toBe('RELEASED');
    expect(db.ingredients.get(ING_1)).toMatchObject({ stock: 100, version: 2 });
  });

  it('gọi release hai lần chỉ cộng kho đúng một lần', async () => {
    const db = fakeDb({
      ingredients: { [ING_1]: { unit: 'GRAM', stock: 75, version: 1 } },
      holds: [{ orderId: ORDER, ingredientId: ING_1, amount: 25 }],
      reservationStatus: 'HELD',
    });
    await service.release(db.tx, storedOrder());
    await service.release(db.tx, storedOrder());
    expect(db.ingredients.get(ING_1)).toMatchObject({ stock: 100, version: 2 });
  });

  it('không cộng kho nếu đơn đã ở trạng thái RELEASED', async () => {
    const db = fakeDb({
      ingredients: { [ING_1]: { unit: 'GRAM', stock: 75, version: 1 } },
      holds: [{ orderId: ORDER, ingredientId: ING_1, amount: 25 }],
      reservationStatus: 'RELEASED',
    });
    await service.release(db.tx, storedOrder());
    expect(db.ingredients.get(ING_1)).toMatchObject({ stock: 75, version: 1 });
  });

  it('(Review 2) sửa công thức sau khi reserve, release vẫn trả đúng lượng đã ghi trong hold', async () => {
    const db = fakeDb({
      ingredients: {
        [ING_1]: { unit: 'GRAM', stock: 100 },
        [ING_2]: { unit: 'ML', stock: 500 },
      },
      reservationStatus: 'HELD',
    });

    // Lúc đặt đơn: công thức PROD_A cần 25g ING_1 và 100ml ING_2
    await service.reserve(db.tx, ORDER, [{ productId: PROD_A, size: 'S', qty: 1 }]);
    expect(db.ingredients.get(ING_1)?.stock).toBe(75);
    expect(db.ingredients.get(ING_2)?.stock).toBe(400);

    // Sau đó công thức bị đổi (seed lại): tăng lên 40g ING_1 và 250ml ING_2
    db.productIngredients.splice(
      0,
      db.productIngredients.length,
      { productId: PROD_A, ingredientId: ING_1, amount: 40 },
      { productId: PROD_A, ingredientId: ING_2, amount: 250 },
    );

    // Khi hoàn kho: phải trả đúng 25g ING_1 và 100ml ING_2 từ OrderIngredientHold, về lại đúng 100g và 500ml
    await service.release(db.tx, storedOrder());
    expect(db.ingredients.get(ING_1)?.stock).toBe(100);
    expect(db.ingredients.get(ING_2)?.stock).toBe(500);
  });
});

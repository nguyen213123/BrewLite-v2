import { OrdersService } from '../src/modules/orders/orders.service';
import { buildQuote, generateOrderCode, normalizeCartItems } from '../src/modules/orders/domain/order-pricing';
import { ApiError } from '../src/common/errors/api-error';
import type * as Api from '../src/common/contracts/api.generated';
import type { PromotionSnapshot, Tx } from '../src/common/contracts/ports';

const PRODUCT = '11111111-1111-4111-8111-111111111111';
const KEM = '22222222-2222-4222-8222-222222222222';
const TRAN_CHAU = '33333333-3333-4333-8333-333333333333';
const USER = '99999999-9999-4999-8999-999999999999';
const KEY = '88888888-8888-4888-8888-888888888888';
const NO_PROMO: PromotionSnapshot = { promotionId: null, promotionCode: null, discount: 0 };

const cappuccinoM = (overrides: Partial<Api.QuoteItem> = {}): Api.QuoteItem => ({
  productId: PRODUCT,
  productName: 'Cappuccino',
  size: 'M',
  sizePrice: 50000,
  toppings: [{ id: KEM, name: 'Kem', price: 10000 }],
  qty: 2,
  unitPrice: 60000,
  lineTotal: 120000,
  ...overrides,
});

async function expectApiError(promise: Promise<unknown> | (() => unknown), status: number, code: string) {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).getStatus()).toBe(status);
    expect((error as ApiError).getResponse()).toMatchObject({ code });
    return;
  }
  throw new Error('Expected ApiError but nothing was thrown');
}

describe('normalizeCartItems', () => {
  it('merges identical lines and sorts topping IDs, regardless of input order', () => {
    const a = normalizeCartItems([
      { productId: PRODUCT, size: 'M', toppingIds: [TRAN_CHAU, KEM], qty: 1 },
      { productId: PRODUCT, size: 'M', toppingIds: [KEM, TRAN_CHAU], qty: 2 },
    ]);
    const b = normalizeCartItems([{ productId: PRODUCT, size: 'M', toppingIds: [KEM, TRAN_CHAU], qty: 3 }]);
    expect(a).toEqual(b);
    expect(a).toEqual([{ productId: PRODUCT, size: 'M', toppingIds: [KEM, TRAN_CHAU], qty: 3 }]);
  });

  it('keeps different sizes or topping sets as separate lines', () => {
    const lines = normalizeCartItems([
      { productId: PRODUCT, size: 'S', qty: 1 },
      { productId: PRODUCT, size: 'M', qty: 1 },
      { productId: PRODUCT, size: 'M', toppingIds: [KEM], qty: 1 },
    ]);
    expect(lines).toHaveLength(3);
  });

  it('rejects a merged line above 99 cups', async () => {
    await expectApiError(
      () => normalizeCartItems([{ productId: PRODUCT, size: 'M', qty: 60 }, { productId: PRODUCT, size: 'M', qty: 40 }]),
      400,
      'VALIDATION_ERROR',
    );
  });
});

describe('buildQuote (server-side pricing)', () => {
  it('matches the acceptance case: Cappuccino M + Kem x2 with SAVE10 = 108000', () => {
    const quote = buildQuote([cappuccinoM()], { promotionId: 'p1', promotionCode: 'SAVE10', discount: 12000 });
    expect(quote).toMatchObject({ subtotal: 120000, discount: 12000, total: 108000, currency: 'VND', promotionCode: 'SAVE10' });
  });

  it('recomputes unitPrice/lineTotal from size and topping prices instead of trusting incoming totals', () => {
    const quote = buildQuote([cappuccinoM({ unitPrice: 1, lineTotal: 1 })], NO_PROMO);
    expect(quote.items[0]).toMatchObject({ unitPrice: 60000, lineTotal: 120000 });
    expect(quote.subtotal).toBe(120000);
  });

  it('never lets the discount exceed the subtotal or go negative', () => {
    expect(buildQuote([cappuccinoM()], { ...NO_PROMO, discount: 999999 }).total).toBe(0);
    expect(buildQuote([cappuccinoM()], { ...NO_PROMO, discount: -5 }).total).toBe(120000);
  });

  it('rejects a subtotal above 2,000,000,000 VND', async () => {
    await expectApiError(
      () => buildQuote([cappuccinoM({ sizePrice: 1_000_000_000, toppings: [], qty: 3 })], NO_PROMO),
      400,
      'VALIDATION_ERROR',
    );
  });
});

describe('generateOrderCode', () => {
  it('follows the contract format BL-YYYYMMDD-XXXXXXXX (20 chars) and is not repeated', () => {
    const code = generateOrderCode(new Date('2026-10-22T12:00:00Z'));
    expect(code).toMatch(/^BL-20261022-[0-9A-F]{8}$/);
    expect(code).toHaveLength(20);
    expect(new Set(Array.from({ length: 200 }, () => generateOrderCode())).size).toBe(200);
  });
});

// ---- OrdersService with fake ports: no database needed ----
type FakeItemData = {
  productId: string; productName: string; size: Api.Size; sizePrice: number; unitPrice: number; qty: number; lineTotal: number;
  toppings: { create: Array<{ toppingId: string; name: string; price: number }> };
};
type FakeOrderData = {
  code: string; userId: string; promotionId: string | null; promotionCode: string | null; subtotal: number; discount: number; total: number;
  status: Api.OrderStatus; reservationStatus: 'HELD' | 'CONSUMED' | 'RELEASED'; version: number; items: { create: FakeItemData[] };
};
type ServiceDeps = ConstructorParameters<typeof OrdersService>;

function setup(options: { resolveError?: Error; promo?: PromotionSnapshot; promoError?: Error; stockError?: Error } = {}) {
  const created: FakeOrderData[] = [];
  const events: unknown[] = [];
  const tx = {
    order: {
      create: jest.fn(async ({ data }: { data: FakeOrderData }) => {
        created.push(data);
        return {
          id: '44444444-4444-4444-8444-444444444444',
          code: data.code,
          userId: data.userId,
          promotionId: data.promotionId,
          promotionCode: data.promotionCode,
          subtotal: data.subtotal,
          discount: data.discount,
          total: data.total,
          status: data.status,
          reservationStatus: data.reservationStatus,
          version: data.version,
          createdAt: new Date('2026-10-22T12:00:00Z'),
          updatedAt: new Date('2026-10-22T12:00:00Z'),
          items: data.items.create.map((item, index) => ({
            id: `55555555-5555-4555-8555-55555555555${index}`,
            orderId: 'o',
            ...item,
            toppings: item.toppings.create.map(t => ({ orderItemId: 'x', ...t })),
          })),
        };
      }),
    },
    orderEvent: { create: jest.fn(async ({ data }: { data: unknown }) => { events.push(data); }) },
  };
  const catalog = {
    resolve: jest.fn(async () => {
      if (options.resolveError) throw options.resolveError;
      return [cappuccinoM()];
    }),
  };
  const promotions = {
    price: jest.fn(async () => {
      if (options.promoError) throw options.promoError;
      return options.promo ?? NO_PROMO;
    }),
    reserve: jest.fn(async () => undefined),
    release: jest.fn(),
  };
  const inventory = {
    reserve: jest.fn(async () => {
      if (options.stockError) throw options.stockError;
    }),
    release: jest.fn(),
  };
  const unitOfWork = { run: jest.fn(async (work: (t: Tx) => Promise<unknown>) => work(tx as unknown as Tx)) };
  // Same contract as IdempotencyPort: run work inside the transaction callback.
  const idempotency = {
    execute: jest.fn(async (_input: unknown, work: (t: Tx) => Promise<unknown>) => ({ data: await work(tx as unknown as Tx), replayed: false })),
  };
  const service = new OrdersService(
    unitOfWork as unknown as ServiceDeps[0],
    catalog as unknown as ServiceDeps[1],
    promotions as unknown as ServiceDeps[2],
    idempotency as unknown as ServiceDeps[3],
    {} as ServiceDeps[4], // OrderTransactionsPort: not used by quote/create
    {} as ServiceDeps[5], // LoyaltyTransactionsPort: not used by quote/create
    inventory as unknown as ServiceDeps[6],
  );
  return { service, tx, catalog, promotions, idempotency, inventory, created, events };
}

const REQUEST: Api.OrderRequest = {
  items: [{ productId: PRODUCT, size: 'M', toppingIds: [KEM], qty: 2 }],
  promotionCode: 'SAVE10',
};

describe('OrdersService.create (Issue #7)', () => {
  it('creates exactly one PENDING order with a server-calculated total and a snapshot', async () => {
    const { service, created, events, promotions } = setup({ promo: { promotionId: 'p1', promotionCode: 'SAVE10', discount: 12000 } });
    const { data, replayed } = await service.create(USER, KEY, REQUEST);

    expect(replayed).toBe(false);
    expect(created).toHaveLength(1);
    expect(data).toMatchObject({
      status: 'PENDING',
      reservationStatus: 'HELD',
      version: 0,
      subtotal: 120000,
      discount: 12000,
      total: 108000,
      currency: 'VND',
      promotionCode: 'SAVE10',
    });
    expect(data.code).toMatch(/^BL-\d{8}-[0-9A-F]{8}$/);
    expect(data.items[0]).toMatchObject({
      productName: 'Cappuccino', size: 'M', sizePrice: 50000, unitPrice: 60000, qty: 2, lineTotal: 120000,
      toppings: [{ id: KEM, name: 'Kem', price: 10000 }],
    });
    expect(promotions.reserve).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ orderId: data.id, actorUserId: USER, fromStatus: null, toStatus: 'PENDING', orderVersion: 0 }]);
  });

  it('takes the owner from the JWT user id argument and sends a normalized payload to idempotency', async () => {
    const { service, created, idempotency } = setup();
    await service.create(USER, KEY, { items: [{ productId: PRODUCT, size: 'M', toppingIds: [TRAN_CHAU, KEM], qty: 1 }, { productId: PRODUCT, size: 'M', toppingIds: [KEM, TRAN_CHAU], qty: 1 }] });
    expect(created[0].userId).toBe(USER);
    expect(idempotency.execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, scope: 'CREATE_ORDER', key: KEY, httpStatus: 201, payload: { items: [{ productId: PRODUCT, size: 'M', toppingIds: [KEM, TRAN_CHAU], qty: 2 }], promotionCode: null } }),
      expect.any(Function),
    );
  });

  it('does not reserve a promotion when no code was applied', async () => {
    const { service, promotions } = setup();
    await service.create(USER, KEY, { items: REQUEST.items });
    expect(promotions.reserve).not.toHaveBeenCalled();
  });

  it('stores nothing when the catalog rejects the selection (wrong topping / inactive product)', async () => {
    const { service, created, events, promotions } = setup({ resolveError: new ApiError(404, 'PRODUCT_NOT_FOUND', 'Sản phẩm không tồn tại') });
    await expectApiError(service.create(USER, KEY, REQUEST), 404, 'PRODUCT_NOT_FOUND');
    expect(created).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(promotions.reserve).not.toHaveBeenCalled();
  });

  it('stores nothing and reserves nothing when the promotion is invalid', async () => {
    const { service, created, promotions } = setup({ promoError: new ApiError(409, 'PROMOTION_EXHAUSTED', 'Mã đã hết lượt') });
    await expectApiError(service.create(USER, KEY, REQUEST), 409, 'PROMOTION_EXHAUSTED');
    expect(created).toHaveLength(0);
    expect(promotions.reserve).not.toHaveBeenCalled();
  });

  it('propagates a failure from the order write so the surrounding transaction rolls back', async () => {
    const { service, tx } = setup();
    tx.orderEvent.create.mockRejectedValueOnce(new Error('db down'));
    await expect(service.create(USER, KEY, REQUEST)).rejects.toThrow('db down');
  });
});

describe('OrdersService.create holds stock (Issue #9)', () => {
  it('reserves the merged cart lines in the same transaction, before the order is written', async () => {
    const { service, inventory, tx } = setup();
    const order: string[] = [];
    inventory.reserve.mockImplementation(async () => { order.push('reserve'); });
    tx.order.create.mockImplementationOnce(async () => { order.push('order.create'); throw new Error('stop after order.create'); });
    await expect(
      service.create(USER, KEY, { items: [{ productId: PRODUCT, size: 'M', toppingIds: [TRAN_CHAU, KEM], qty: 1 }, { productId: PRODUCT, size: 'M', toppingIds: [KEM, TRAN_CHAU], qty: 1 }] }),
    ).rejects.toThrow('stop after order.create');
    expect(order).toEqual(['reserve', 'order.create']);
    expect(inventory.reserve).toHaveBeenCalledTimes(1);
    expect(inventory.reserve).toHaveBeenCalledWith(tx, [{ productId: PRODUCT, size: 'M', toppingIds: [KEM, TRAN_CHAU], qty: 2 }]);
  });

  it('stores nothing when stock is short (OUT_OF_STOCK)', async () => {
    const { service, created, events } = setup({ stockError: new ApiError(409, 'OUT_OF_STOCK', 'Sản phẩm không đủ tồn kho') });
    await expectApiError(service.create(USER, KEY, REQUEST), 409, 'OUT_OF_STOCK');
    expect(created).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('stores nothing when stock conflicts (STOCK_CONFLICT)', async () => {
    const { service, created } = setup({ stockError: new ApiError(409, 'STOCK_CONFLICT', 'Tồn kho đang thay đổi, vui lòng thử lại') });
    await expectApiError(service.create(USER, KEY, REQUEST), 409, 'STOCK_CONFLICT');
    expect(created).toHaveLength(0);
  });

  it('never holds stock for a price preview', async () => {
    const { service, inventory } = setup();
    await service.quote(USER, REQUEST);
    expect(inventory.reserve).not.toHaveBeenCalled();
  });
});

describe('OrdersService.quote (Issue #7)', () => {
  it('returns the server price and writes nothing', async () => {
    const { service, tx, promotions } = setup({ promo: { promotionId: 'p1', promotionCode: 'SAVE10', discount: 12000 } });
    const quote = await service.quote(USER, REQUEST);
    expect(quote).toMatchObject({ subtotal: 120000, discount: 12000, total: 108000 });
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(promotions.reserve).not.toHaveBeenCalled();
  });
});

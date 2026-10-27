import { OrderTransactionsService } from '../src/modules/orders/order-transactions.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { ORDER_TRANSITIONS } from '../src/modules/orders/domain/order-state-machine';
import { ApiError } from '../src/common/errors/api-error';
import type * as Api from '../src/common/contracts/api.generated';
import type { StoredOrder, Tx } from '../src/common/contracts/ports';

type Reservation = 'HELD' | 'CONSUMED' | 'RELEASED';
type Row = {
  id: string; code: string; userId: string; promotionId: string | null; promotionCode: string | null;
  subtotal: number; discount: number; total: number; status: Api.OrderStatus; reservationStatus: Reservation;
  version: number; createdAt: Date; updatedAt: Date;
  items: Array<{ id: string; orderId: string; productId: string; productName: string; size: Api.Size; sizePrice: number; unitPrice: number; qty: number; lineTotal: number; toppings: Array<{ orderItemId: string; toppingId: string; name: string; price: number }> }>;
};

const ORDER = '44444444-4444-4444-8444-444444444444';
const OWNER = '99999999-9999-4999-8999-999999999999';
const STAFF = '77777777-7777-4777-8777-777777777777';
const PRODUCT = '11111111-1111-4111-8111-111111111111';
const STATUSES = Object.keys(ORDER_TRANSITIONS) as Api.OrderStatus[];
const reservationFor = (status: Api.OrderStatus): Reservation =>
  status === 'PENDING' ? 'HELD' : status === 'PAYMENT_FAILED' || status === 'CANCELLED' ? 'RELEASED' : 'CONSUMED';

// In-memory Order/OrderEvent/Payment with the same "where" semantics as the real conditional UPDATE.
function fakeDb(overrides: Partial<Row> = {}) {
  const status = overrides.status ?? 'PENDING';
  const row: Row = {
    id: ORDER, code: 'BL-20261022-A1B2C3D4', userId: OWNER, promotionId: 'p1', promotionCode: 'SAVE10',
    subtotal: 120000, discount: 12000, total: 108000, status, reservationStatus: reservationFor(status), version: 0,
    createdAt: new Date('2026-10-22T12:00:00Z'), updatedAt: new Date('2026-10-22T12:00:00Z'),
    items: [{ id: 'i1', orderId: ORDER, productId: PRODUCT, productName: 'Cappuccino', size: 'M', sizePrice: 50000, unitPrice: 60000, qty: 2, lineTotal: 120000, toppings: [] }],
    ...overrides,
  };
  const events: Array<{ orderId: string; actorUserId: string; fromStatus: string | null; toStatus: string; orderVersion: number }> = [];
  const payments = [{ orderId: ORDER, status: 'SUCCEEDED' }];
  const hooks = { beforeUpdate: (): void => undefined };
  const snapshot = () => ({ ...row, items: row.items.map(item => ({ ...item })) });

  const tx = {
    order: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === row.id ? snapshot() : null),
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        if (where.id !== row.id) throw new Error('not found');
        return snapshot();
      },
      findFirst: async ({ where }: { where: { id: string; userId: string } }) => (where.id === row.id && where.userId === row.userId ? snapshot() : null),
      updateMany: async ({ where, data }: {
        where: { id: string; version?: number; status?: Api.OrderStatus; reservationStatus?: Reservation };
        data: { status?: Api.OrderStatus; reservationStatus?: Reservation; version?: { increment: number } };
      }) => {
        hooks.beforeUpdate();
        if (where.id !== row.id) return { count: 0 };
        if (where.version !== undefined && row.version !== where.version) return { count: 0 };
        if (where.status !== undefined && row.status !== where.status) return { count: 0 };
        if (where.reservationStatus !== undefined && row.reservationStatus !== where.reservationStatus) return { count: 0 };
        if (data.status) row.status = data.status;
        if (data.reservationStatus) row.reservationStatus = data.reservationStatus;
        if (data.version) row.version += data.version.increment;
        return { count: 1 };
      },
    },
    orderEvent: {
      create: async ({ data }: { data: (typeof events)[number] }) => {
        if (events.some(e => e.orderId === data.orderId && e.orderVersion === data.orderVersion)) throw new Error('unique (orderId, orderVersion)');
        events.push(data);
      },
    },
    payment: {
      updateMany: async ({ where, data }: { where: { orderId: string; status: string }; data: { status: string } }) => {
        const hit = payments.filter(p => p.orderId === where.orderId && p.status === where.status);
        hit.forEach(p => { p.status = data.status; });
        return { count: hit.length };
      },
    },
  };

  const inventory = {
    check: jest.fn(async () => undefined),
    reserve: jest.fn(async () => undefined),
    release: jest.fn(async () => { row.reservationStatus = 'RELEASED'; }),
  };
  const promotions = {
    price: jest.fn(async () => ({ promotionId: 'p1', promotionCode: 'SAVE10', discount: 12000 })),
    reserve: jest.fn(async () => undefined),
    release: jest.fn(async () => undefined),
  };
  const loyalty = { earn: jest.fn(), reverse: jest.fn(async () => undefined) };
  const transitions = new OrderTransactionsService(inventory as never, promotions as never);
  const uow = { run: async <T>(work: (t: Tx) => Promise<T>) => work(tx as unknown as Tx) };
  const orders = new OrdersService(uow as never, {} as never, {} as never, {} as never, transitions, loyalty as never, inventory as never);
  return { row, events, payments, hooks, inventory, promotions, loyalty, transitions, orders, snapshot, tx: tx as unknown as Tx };
}

async function expectCode(promise: Promise<unknown>, status: number, code: string) {
  await expect(promise).rejects.toBeInstanceOf(ApiError);
  await promise.catch((error: ApiError) => {
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({ code });
  });
}

describe('OrderTransactionsService.transition: every edge of the state table', () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const allowed = ORDER_TRANSITIONS[from].includes(to) && to !== 'PENDING'; // PENDING only via prepareRetry
      it(`${from} -> ${to}: ${allowed ? 'applied' : 'rejected'}`, async () => {
        const db = fakeDb({ status: from, version: 3 });
        const run = db.transitions.transition(db.tx, { orderId: ORDER, actorUserId: STAFF, expectedVersion: 3, toStatus: to });
        if (allowed) {
          const result = await run;
          expect(result).toMatchObject({ status: to, version: 4 });
          expect(db.events).toEqual([{ orderId: ORDER, actorUserId: STAFF, fromStatus: from, toStatus: to, orderVersion: 4 }]);
        } else {
          await expectCode(run, 409, 'INVALID_ORDER_TRANSITION');
          expect(db.row).toMatchObject({ status: from, version: 3 });
          expect(db.events).toHaveLength(0);
          expect(db.inventory.release).not.toHaveBeenCalled();
        }
      });
    }
  }
});

describe('OrderTransactionsService.transition: versioning and effects', () => {
  it('rejects a stale expectedVersion with ORDER_VERSION_CONFLICT and changes nothing', async () => {
    const db = fakeDb({ status: 'PAID', version: 2 });
    await expectCode(db.transitions.transition(db.tx, { orderId: ORDER, actorUserId: STAFF, expectedVersion: 1, toStatus: 'PREPARING' }), 409, 'ORDER_VERSION_CONFLICT');
    expect(db.row).toMatchObject({ status: 'PAID', version: 2 });
    expect(db.events).toHaveLength(0);
  });

  it('returns 404 ORDER_NOT_FOUND for an unknown order', async () => {
    const db = fakeDb();
    await expectCode(db.transitions.transition(db.tx, { orderId: 'missing', actorUserId: STAFF, expectedVersion: 0, toStatus: 'PAID' }), 404, 'ORDER_NOT_FOUND');
  });

  it('a late failure request cannot turn a PAID order into PAYMENT_FAILED (stale or current version)', async () => {
    const db = fakeDb({ status: 'PAID', version: 1 });
    await expectCode(db.transitions.transition(db.tx, { orderId: ORDER, actorUserId: OWNER, expectedVersion: 0, toStatus: 'PAYMENT_FAILED' }), 409, 'ORDER_VERSION_CONFLICT');
    await expectCode(db.transitions.transition(db.tx, { orderId: ORDER, actorUserId: OWNER, expectedVersion: 1, toStatus: 'PAYMENT_FAILED' }), 409, 'INVALID_ORDER_TRANSITION');
    expect(db.row).toMatchObject({ status: 'PAID', version: 1, reservationStatus: 'CONSUMED' });
    expect(db.inventory.release).not.toHaveBeenCalled();
  });

  it('the loser of a race gets a conflict and none of the winner-only effects run', async () => {
    const db = fakeDb({ status: 'PAID', version: 1 });
    // Another transaction commits PAID -> PREPARING after we read version 1 but before our UPDATE.
    db.hooks.beforeUpdate = () => { db.row.status = 'PREPARING'; db.row.version = 2; };
    await expectCode(db.transitions.transition(db.tx, { orderId: ORDER, actorUserId: OWNER, expectedVersion: 1, toStatus: 'CANCELLED' }), 409, 'ORDER_VERSION_CONFLICT');
    expect(db.row.status).toBe('PREPARING');
    expect(db.inventory.release).not.toHaveBeenCalled();
    expect(db.promotions.release).not.toHaveBeenCalled();
    expect(db.events).toHaveLength(0);
  });

  it('two requests with the same expectedVersion: only the first applies', async () => {
    const db = fakeDb({ status: 'PAID', version: 1 });
    await db.transitions.transition(db.tx, { orderId: ORDER, actorUserId: STAFF, expectedVersion: 1, toStatus: 'PREPARING' });
    await expectCode(db.transitions.transition(db.tx, { orderId: ORDER, actorUserId: OWNER, expectedVersion: 1, toStatus: 'CANCELLED' }), 409, 'ORDER_VERSION_CONFLICT');
    expect(db.row.status).toBe('PREPARING');
    expect(db.events).toHaveLength(1);
  });

  it('PENDING -> PAID consumes the reservation without touching stock or promotion counters', async () => {
    const db = fakeDb({ status: 'PENDING', version: 0 });
    const result = await db.transitions.transition(db.tx, { orderId: ORDER, actorUserId: OWNER, expectedVersion: 0, toStatus: 'PAID' });
    expect(result.reservationStatus).toBe('CONSUMED');
    expect(db.inventory.release).not.toHaveBeenCalled();
    expect(db.promotions.release).not.toHaveBeenCalled();
  });

  it('PENDING -> PAYMENT_FAILED releases stock and the promotion once', async () => {
    const db = fakeDb({ status: 'PENDING', version: 0 });
    const result = await db.transitions.transition(db.tx, { orderId: ORDER, actorUserId: OWNER, expectedVersion: 0, toStatus: 'PAYMENT_FAILED' });
    expect(result.reservationStatus).toBe('RELEASED');
    expect(db.inventory.release).toHaveBeenCalledTimes(1);
    expect(db.promotions.release).toHaveBeenCalledTimes(1);
    expect(db.promotions.release).toHaveBeenCalledWith(expect.anything(), 'p1');
  });

  it('skips the promotion release when the order has no promotion', async () => {
    const db = fakeDb({ status: 'PENDING', promotionId: null, promotionCode: null });
    await db.transitions.transition(db.tx, { orderId: ORDER, actorUserId: OWNER, expectedVersion: 0, toStatus: 'CANCELLED' });
    expect(db.inventory.release).toHaveBeenCalledTimes(1);
    expect(db.promotions.release).not.toHaveBeenCalled();
  });

  it('PAYMENT_FAILED -> CANCELLED returns nothing a second time', async () => {
    const db = fakeDb({ status: 'PAYMENT_FAILED', version: 2 });
    await db.transitions.transition(db.tx, { orderId: ORDER, actorUserId: OWNER, expectedVersion: 2, toStatus: 'CANCELLED' });
    expect(db.inventory.release).not.toHaveBeenCalled();
    expect(db.promotions.release).not.toHaveBeenCalled();
  });

  it('PAID -> CANCELLED releases the consumed reservation', async () => {
    const db = fakeDb({ status: 'PAID', version: 1 });
    const result = await db.transitions.transition(db.tx, { orderId: ORDER, actorUserId: OWNER, expectedVersion: 1, toStatus: 'CANCELLED' });
    expect(result.reservationStatus).toBe('RELEASED');
    expect(db.inventory.release).toHaveBeenCalledTimes(1);
  });
});

describe('OrderTransactionsService.prepareRetry (PAYMENT_FAILED -> PENDING)', () => {
  it('re-holds stock and the promotion, keeps prices, bumps version and writes an event', async () => {
    const db = fakeDb({ status: 'PAYMENT_FAILED', version: 2 });
    const result = await db.transitions.prepareRetry(db.tx, db.snapshot() as unknown as StoredOrder);
    expect(result).toMatchObject({ status: 'PENDING', reservationStatus: 'HELD', version: 3, subtotal: 120000, discount: 12000, total: 108000 });
    expect(db.inventory.reserve).toHaveBeenCalledWith(db.tx, ORDER, [{ productId: PRODUCT, size: 'M', qty: 2, toppingIds: [] }]);
    expect(db.promotions.price).toHaveBeenCalledWith(db.tx, 'SAVE10', 120000);
    expect(db.promotions.reserve).toHaveBeenCalledWith(db.tx, 'p1');
    expect(db.events).toEqual([{ orderId: ORDER, actorUserId: OWNER, fromStatus: 'PAYMENT_FAILED', toStatus: 'PENDING', orderVersion: 3 }]);
  });

  it('(Review 1) prepareRetry forwards toppingIds from item.toppings to inventory.reserve', async () => {
    const KEM = '22222222-2222-4222-8222-222222222201';
    const PEARL = '22222222-2222-4222-8222-222222222202';
    const db = fakeDb({
      status: 'PAYMENT_FAILED',
      version: 2,
      items: [
        {
          id: 'i1',
          orderId: ORDER,
          productId: PRODUCT,
          productName: 'Cappuccino',
          size: 'L',
          sizePrice: 55000,
          unitPrice: 75000,
          qty: 2,
          lineTotal: 150000,
          toppings: [
            { orderItemId: 'i1', toppingId: KEM, name: 'Kem', price: 10000 },
            { orderItemId: 'i1', toppingId: PEARL, name: 'Trân châu', price: 10000 },
          ],
        },
      ],
    });
    await db.transitions.prepareRetry(db.tx, db.snapshot() as unknown as StoredOrder);
    expect(db.inventory.reserve).toHaveBeenCalledWith(db.tx, ORDER, [
      { productId: PRODUCT, size: 'L', qty: 2, toppingIds: [KEM, PEARL] },
    ]);
  });

  it('propagates OUT_OF_STOCK so the caller rolls back; no event is written', async () => {
    const db = fakeDb({ status: 'PAYMENT_FAILED', version: 2 });
    db.inventory.reserve.mockRejectedValueOnce(new ApiError(409, 'OUT_OF_STOCK', 'Sản phẩm không đủ tồn kho'));
    await expectCode(db.transitions.prepareRetry(db.tx, db.snapshot() as unknown as StoredOrder), 409, 'OUT_OF_STOCK');
    expect(db.events).toHaveLength(0);
  });

  it('propagates an invalid promotion before any stock is held', async () => {
    const db = fakeDb({ status: 'PAYMENT_FAILED', version: 2 });
    db.promotions.price.mockRejectedValueOnce(new ApiError(422, 'PROMOTION_INVALID', 'Mã không hợp lệ'));
    await expectCode(db.transitions.prepareRetry(db.tx, db.snapshot() as unknown as StoredOrder), 422, 'PROMOTION_INVALID');
    expect(db.inventory.reserve).not.toHaveBeenCalled();
    expect(db.events).toHaveLength(0);
  });

  it('refuses any order that is not PAYMENT_FAILED', async () => {
    for (const status of STATUSES.filter(s => s !== 'PAYMENT_FAILED')) {
      const db = fakeDb({ status, version: 2 });
      await expectCode(db.transitions.prepareRetry(db.tx, db.snapshot() as unknown as StoredOrder), 409, 'INVALID_ORDER_TRANSITION');
      expect(db.inventory.reserve).not.toHaveBeenCalled();
    }
  });

  it('a second concurrent retry on the same snapshot conflicts and holds nothing extra', async () => {
    const db = fakeDb({ status: 'PAYMENT_FAILED', version: 2 });
    const stale = db.snapshot() as unknown as StoredOrder;
    await db.transitions.prepareRetry(db.tx, stale);
    await expectCode(db.transitions.prepareRetry(db.tx, stale), 409, 'ORDER_VERSION_CONFLICT');
    expect(db.inventory.reserve).toHaveBeenCalledTimes(1);
    expect(db.promotions.reserve).toHaveBeenCalledTimes(1);
  });
});

describe('OrderTransactionsService.loadOwned', () => {
  it('returns the owner\'s order and hides other people\'s orders behind the same 404', async () => {
    const db = fakeDb();
    await expect(db.transitions.loadOwned(db.tx, OWNER, ORDER)).resolves.toMatchObject({ id: ORDER });
    await expectCode(db.transitions.loadOwned(db.tx, STAFF, ORDER), 404, 'ORDER_NOT_FOUND');
    await expectCode(db.transitions.loadOwned(db.tx, OWNER, 'missing'), 404, 'ORDER_NOT_FOUND');
  });
});

describe('OrdersService.cancel', () => {
  it('cancels a PENDING order: releases stock/promo, no refund, no point reversal', async () => {
    const db = fakeDb({ status: 'PENDING', version: 0 });
    const order = await db.orders.cancel(OWNER, ORDER, 0);
    expect(order).toMatchObject({ status: 'CANCELLED', reservationStatus: 'RELEASED', version: 1 });
    expect(db.inventory.release).toHaveBeenCalledTimes(1);
    expect(db.payments[0].status).toBe('SUCCEEDED');
    expect(db.loyalty.reverse).not.toHaveBeenCalled();
  });

  it('cancels a PAID order: mock refund, release and point reversal together', async () => {
    const db = fakeDb({ status: 'PAID', version: 1 });
    const order = await db.orders.cancel(OWNER, ORDER, 1);
    expect(order).toMatchObject({ status: 'CANCELLED', reservationStatus: 'RELEASED', version: 2 });
    expect(db.payments[0].status).toBe('REFUNDED');
    expect(db.inventory.release).toHaveBeenCalledTimes(1);
    expect(db.loyalty.reverse).toHaveBeenCalledTimes(1);
  });

  it('cancels a PAYMENT_FAILED order without returning stock a second time', async () => {
    const db = fakeDb({ status: 'PAYMENT_FAILED', version: 2 });
    const order = await db.orders.cancel(OWNER, ORDER, 2);
    expect(order.status).toBe('CANCELLED');
    expect(db.inventory.release).not.toHaveBeenCalled();
    expect(db.loyalty.reverse).not.toHaveBeenCalled();
  });

  it('refuses PREPARING, READY and COMPLETED orders', async () => {
    for (const status of ['PREPARING', 'READY', 'COMPLETED'] as const) {
      const db = fakeDb({ status, version: 4 });
      await expectCode(db.orders.cancel(OWNER, ORDER, 4), 409, 'INVALID_ORDER_TRANSITION');
      expect(db.row.status).toBe(status);
      expect(db.inventory.release).not.toHaveBeenCalled();
    }
  });

  it('cancelling an already CANCELLED order with the current version is a 200 with no new effects', async () => {
    const db = fakeDb({ status: 'CANCELLED', version: 1 });
    const order = await db.orders.cancel(OWNER, ORDER, 1);
    expect(order).toMatchObject({ status: 'CANCELLED', version: 1 });
    expect(db.events).toHaveLength(0);
    expect(db.inventory.release).not.toHaveBeenCalled();
    expect(db.loyalty.reverse).not.toHaveBeenCalled();
  });

  it('cancelling a CANCELLED order with an old version is 409 ORDER_VERSION_CONFLICT', async () => {
    const db = fakeDb({ status: 'CANCELLED', version: 2 });
    await expectCode(db.orders.cancel(OWNER, ORDER, 1), 409, 'ORDER_VERSION_CONFLICT');
  });

  it('cancelling twice in a row refunds and reverses points once', async () => {
    const db = fakeDb({ status: 'PAID', version: 1 });
    await db.orders.cancel(OWNER, ORDER, 1);
    await db.orders.cancel(OWNER, ORDER, 2);
    expect(db.loyalty.reverse).toHaveBeenCalledTimes(1);
    expect(db.inventory.release).toHaveBeenCalledTimes(1);
  });

  it('hides another customer\'s order behind 404 and changes nothing', async () => {
    const db = fakeDb({ status: 'PENDING' });
    await expectCode(db.orders.cancel(STAFF, ORDER, 0), 404, 'ORDER_NOT_FOUND');
    expect(db.row.status).toBe('PENDING');
  });
});

describe('OrdersService.transition (STAFF)', () => {
  it('walks PAID -> PREPARING -> READY -> COMPLETED, records each step, and earns loyalty points only on COMPLETED', async () => {
    const db = fakeDb({ status: 'PAID', version: 1 });
    await db.orders.transition(STAFF, ORDER, { status: 'PREPARING', expectedVersion: 1 });
    expect(db.loyalty.earn).not.toHaveBeenCalled();
    await db.orders.transition(STAFF, ORDER, { status: 'READY', expectedVersion: 2 });
    expect(db.loyalty.earn).not.toHaveBeenCalled();
    const done = await db.orders.transition(STAFF, ORDER, { status: 'COMPLETED', expectedVersion: 3 });
    expect(done).toMatchObject({ status: 'COMPLETED', version: 4 });
    expect(db.loyalty.earn).toHaveBeenCalledTimes(1);
    expect(db.loyalty.earn).toHaveBeenCalledWith(db.tx, expect.objectContaining({ id: ORDER, status: 'COMPLETED', version: 4 }));
    expect(db.events.map(e => e.toStatus)).toEqual(['PREPARING', 'READY', 'COMPLETED']);
    expect(db.events.every(e => e.actorUserId === STAFF)).toBe(true);
  });

  it('does not allow skipping a step', async () => {
    const db = fakeDb({ status: 'PAID', version: 1 });
    await expectCode(db.orders.transition(STAFF, ORDER, { status: 'COMPLETED', expectedVersion: 1 }), 409, 'INVALID_ORDER_TRANSITION');
    expect(db.row.status).toBe('PAID');
  });

  it('does not accept payment or cancel statuses on the STAFF endpoint', async () => {
    const db = fakeDb({ status: 'PENDING' });
    for (const status of ['PAID', 'CANCELLED', 'PAYMENT_FAILED', 'PENDING'] as const) {
      await expectCode(db.orders.transition(STAFF, ORDER, { status: status as Api.StatusRequest['status'], expectedVersion: 0 }), 409, 'INVALID_ORDER_TRANSITION');
    }
    expect(db.row.status).toBe('PENDING');
  });

  it('stale expectedVersion is 409 ORDER_VERSION_CONFLICT', async () => {
    const db = fakeDb({ status: 'PAID', version: 2 });
    await expectCode(db.orders.transition(STAFF, ORDER, { status: 'PREPARING', expectedVersion: 1 }), 409, 'ORDER_VERSION_CONFLICT');
  });
});

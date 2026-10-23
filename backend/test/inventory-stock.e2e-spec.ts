import { InventoryService, MAX_STOCK_ATTEMPTS, requiredByProduct } from '../src/modules/inventory/inventory.service';
import { ApiError } from '../src/common/errors/api-error';
import type { StoredOrder, Tx } from '../src/common/contracts/ports';

type FakeProduct = { stock: number; version: number; active: boolean };
type ReservationStatus = 'HELD' | 'CONSUMED' | 'RELEASED';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const ORDER = '44444444-4444-4444-8444-444444444444';

// In-memory stand-in for the two tables InventoryService touches. updateMany applies the same
// "where" semantics the real UPDATE has (id + version + stock >= qty), so optimistic locking is exercised.
function fakeDb(products: Record<string, Partial<FakeProduct>>, reservationStatus: ReservationStatus = 'HELD') {
  const table = new Map<string, FakeProduct>(
    Object.entries(products).map(([id, p]) => [id, { stock: 0, version: 0, active: true, ...p }]),
  );
  const order = { id: ORDER, reservationStatus };
  const visited: string[] = [];
  const hooks = { beforeUpdate: (_productId: string, _attempt: number): void => undefined };
  let reads = 0;
  const attempts = new Map<string, number>();

  const tx = {
    product: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        reads++;
        visited.push(where.id);
        const row = table.get(where.id);
        return row ? { ...row } : null;
      },
      updateMany: async ({ where, data }: {
        where: { id: string; version?: number; stock?: { gte: number } };
        data: { stock: { decrement?: number; increment?: number }; version: { increment: number } };
      }) => {
        const attempt = (attempts.get(where.id) ?? 0) + 1;
        attempts.set(where.id, attempt);
        hooks.beforeUpdate(where.id, attempt);
        const row = table.get(where.id);
        if (!row) return { count: 0 };
        if (where.version !== undefined && row.version !== where.version) return { count: 0 };
        if (where.stock && row.stock < where.stock.gte) return { count: 0 };
        row.stock += (data.stock.increment ?? 0) - (data.stock.decrement ?? 0);
        row.version += data.version.increment;
        return { count: 1 };
      },
    },
    order: {
      updateMany: async ({ where, data }: { where: { id: string; reservationStatus: { in: ReservationStatus[] } }; data: { reservationStatus: ReservationStatus } }) => {
        if (where.id !== order.id || !where.reservationStatus.in.includes(order.reservationStatus)) return { count: 0 };
        order.reservationStatus = data.reservationStatus;
        return { count: 1 };
      },
    },
  };
  return { tx: tx as unknown as Tx, table, order, visited, hooks, reads: () => reads };
}

const cart = (...lines: Array<[string, number]>) => lines.map(([productId, qty]) => ({ productId, size: 'M' as const, qty }));
const storedOrder = (...lines: Array<[string, number]>) =>
  ({ id: ORDER, items: lines.map(([productId, qty]) => ({ productId, qty })) }) as unknown as StoredOrder;

async function expectCode(promise: Promise<unknown>, status: number, code: string) {
  await expect(promise).rejects.toBeInstanceOf(ApiError);
  await promise.catch((error: ApiError) => {
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({ code });
  });
}

describe('requiredByProduct', () => {
  it('sums qty per product and sorts by product id', () => {
    expect(requiredByProduct([{ productId: B, qty: 1 }, { productId: A, qty: 2 }, { productId: B, qty: 4 }])).toEqual([[A, 2], [B, 5]]);
  });
});

describe('InventoryService.reserve (optimistic locking)', () => {
  const service = new InventoryService();

  it('decrements stock and bumps version in one conditional update', async () => {
    const db = fakeDb({ [A]: { stock: 10 } });
    await service.reserve(db.tx, cart([A, 3]));
    expect(db.table.get(A)).toMatchObject({ stock: 7, version: 1 });
  });

  it('adds qty of duplicate product lines before checking stock', async () => {
    // 2 + 3 = 5 cups needed but only 4 exist: each line alone would pass, the total must not.
    const db = fakeDb({ [A]: { stock: 4 } });
    await expectCode(service.reserve(db.tx, cart([A, 2], [A, 3])), 409, 'OUT_OF_STOCK');
    expect(db.table.get(A)).toMatchObject({ stock: 4, version: 0 });
  });

  it('rejects with OUT_OF_STOCK and leaves stock untouched when stock is short', async () => {
    const db = fakeDb({ [A]: { stock: 1 } });
    await expectCode(service.reserve(db.tx, cart([A, 2])), 409, 'OUT_OF_STOCK');
    expect(db.table.get(A)).toMatchObject({ stock: 1, version: 0 });
  });

  it('can take the last cup exactly, never below zero', async () => {
    const db = fakeDb({ [A]: { stock: 2 } });
    await service.reserve(db.tx, cart([A, 2]));
    expect(db.table.get(A)?.stock).toBe(0);
    await expectCode(service.reserve(db.tx, cart([A, 1])), 409, 'OUT_OF_STOCK');
    expect(db.table.get(A)?.stock).toBe(0);
  });

  it('re-reads and retries when another writer changed the version, then succeeds once', async () => {
    const db = fakeDb({ [A]: { stock: 10 } });
    db.hooks.beforeUpdate = (id, attempt) => {
      if (attempt === 1) db.table.get(id)!.version += 1; // concurrent writer commits first (stock still enough)
    };
    await service.reserve(db.tx, cart([A, 3]));
    expect(db.reads()).toBe(2);
    expect(db.table.get(A)).toMatchObject({ stock: 7, version: 2 }); // decremented exactly once
  });

  it('reports a real shortage (not a conflict) when the concurrent writer took the stock', async () => {
    const db = fakeDb({ [A]: { stock: 1 } });
    db.hooks.beforeUpdate = (id, attempt) => {
      if (attempt === 1) { const row = db.table.get(id)!; row.stock = 0; row.version += 1; }
    };
    await expectCode(service.reserve(db.tx, cart([A, 1])), 409, 'OUT_OF_STOCK');
    expect(db.table.get(A)?.stock).toBe(0);
  });

  it(`gives up with STOCK_CONFLICT after ${MAX_STOCK_ATTEMPTS} conflicting attempts`, async () => {
    const db = fakeDb({ [A]: { stock: 10 } });
    db.hooks.beforeUpdate = id => { db.table.get(id)!.version += 1; }; // always loses the race
    await expectCode(service.reserve(db.tx, cart([A, 1])), 409, 'STOCK_CONFLICT');
    expect(db.reads()).toBe(MAX_STOCK_ATTEMPTS);
    expect(db.table.get(A)?.stock).toBe(10);
  });

  it('visits products in ascending id order regardless of cart order', async () => {
    const db = fakeDb({ [A]: { stock: 5 }, [B]: { stock: 5 } });
    await service.reserve(db.tx, cart([B, 1], [A, 1]));
    expect(db.visited).toEqual([A, B]);
  });

  it('treats a missing or inactive product as PRODUCT_NOT_FOUND', async () => {
    const db = fakeDb({ [A]: { stock: 5, active: false } });
    await expectCode(service.reserve(db.tx, cart([A, 1])), 404, 'PRODUCT_NOT_FOUND');
    await expectCode(service.reserve(db.tx, cart([B, 1])), 404, 'PRODUCT_NOT_FOUND');
  });
});

describe('InventoryService.release (exactly once)', () => {
  const service = new InventoryService();

  it('restores stock for a HELD order and marks it RELEASED', async () => {
    const db = fakeDb({ [A]: { stock: 7, version: 1 }, [B]: { stock: 0 } }, 'HELD');
    await service.release(db.tx, storedOrder([A, 3], [B, 1]));
    expect(db.order.reservationStatus).toBe('RELEASED');
    expect(db.table.get(A)).toMatchObject({ stock: 10, version: 2 });
    expect(db.table.get(B)).toMatchObject({ stock: 1, version: 1 });
  });

  it('also releases a CONSUMED order (cancel after PAID)', async () => {
    const db = fakeDb({ [A]: { stock: 7 } }, 'CONSUMED');
    await service.release(db.tx, storedOrder([A, 3]));
    expect(db.table.get(A)?.stock).toBe(10);
  });

  it('does not return stock a second time', async () => {
    const db = fakeDb({ [A]: { stock: 7 } }, 'HELD');
    await service.release(db.tx, storedOrder([A, 3]));
    await service.release(db.tx, storedOrder([A, 3]));
    expect(db.table.get(A)?.stock).toBe(10);
  });

  it('does nothing for an order that is already RELEASED', async () => {
    const db = fakeDb({ [A]: { stock: 7 } }, 'RELEASED');
    await service.release(db.tx, storedOrder([A, 3]));
    expect(db.table.get(A)).toMatchObject({ stock: 7, version: 0 });
  });

  it('adds up duplicate lines of the same product when returning stock', async () => {
    const db = fakeDb({ [A]: { stock: 0 } }, 'HELD');
    await service.release(db.tx, storedOrder([A, 2], [A, 3]));
    expect(db.table.get(A)?.stock).toBe(5);
  });
});

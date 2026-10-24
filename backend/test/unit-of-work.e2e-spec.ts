import { MAX_TRANSACTION_ATTEMPTS, UnitOfWork, isTransientTransactionError } from '../src/common/database/unit-of-work';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { ApiError } from '../src/common/errors/api-error';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { Tx } from '../src/common/contracts/ports';

type FakeProduct = { stock: number; version: number; active: boolean };

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const cart = (...lines: Array<[string, number]>) => lines.map(([productId, qty]) => ({ productId, size: 'M' as const, qty }));

const deadlock = () => Object.assign(new Error('deadlock detected'), { code: 'P2034' });

// Fake PrismaClient whose $transaction really rolls back: if the callback throws, every product and key row written
// during that attempt is restored, exactly like PostgreSQL does when it aborts a transaction.
function fakePrisma(products: Record<string, Partial<FakeProduct>>) {
  const table = new Map<string, FakeProduct>(Object.entries(products).map(([id, p]) => [id, { stock: 0, version: 0, active: true, ...p }]));
  const keyRows: string[] = [];
  const state = { transactions: 0, failNextUpdates: [] as Array<{ productId: string; error: unknown }> };
  const seenTx: unknown[] = [];

  const prisma = {
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>) => {
      state.transactions++;
      const before = new Map([...table].map(([id, row]) => [id, { ...row }]));
      const keysBefore = [...keyRows];
      const tx = {
        $executeRaw: async () => 0,
        keyRows,
        product: {
          findUnique: async ({ where }: { where: { id: string } }) => {
            const row = table.get(where.id);
            return row ? { ...row } : null;
          },
          updateMany: async ({ where, data }: {
            where: { id: string; version: number; stock: { gte: number } };
            data: { stock: { decrement: number }; version: { increment: number } };
          }) => {
            const failure = state.failNextUpdates.find(f => f.productId === where.id);
            if (failure) {
              state.failNextUpdates.splice(state.failNextUpdates.indexOf(failure), 1);
              throw failure.error;
            }
            const row = table.get(where.id);
            if (!row || row.version !== where.version || row.stock < where.stock.gte) return { count: 0 };
            row.stock -= data.stock.decrement;
            row.version += data.version.increment;
            return { count: 1 };
          },
        },
      };
      seenTx.push(tx);
      try {
        return await callback(tx);
      } catch (error) {
        table.clear();
        before.forEach((row, id) => table.set(id, row));
        keyRows.splice(0, keyRows.length, ...keysBefore);
        throw error;
      }
    },
  };
  return { prisma: prisma as unknown as PrismaService, table, keyRows, state, seenTx };
}

async function expectCode(promise: Promise<unknown>, status: number, code: string) {
  await expect(promise).rejects.toBeInstanceOf(ApiError);
  await promise.catch((error: ApiError) => {
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({ code });
  });
}

describe('isTransientTransactionError', () => {
  it.each([
    ['Prisma P2034 (write conflict / deadlock)', { code: 'P2034' }],
    ['raw SQLSTATE 40P01 (deadlock_detected)', { code: '40P01' }],
    ['raw SQLSTATE 40001 (serialization_failure)', { code: '40001' }],
    ['raw query error P2010 carrying 40P01', { code: 'P2010', meta: { code: '40P01' } }],
    ['driver error wrapped in cause', { message: 'wrapped', cause: { code: '40001' } }],
    ['a driver error that only keeps PostgreSQL\'s deadlock message', new Error('ERROR: deadlock detected')],
    ['a driver error that only keeps the serialization message', new Error('could not serialize access due to concurrent update')],
  ])('retries %s', (_name, error) => {
    expect(isTransientTransactionError(error)).toBe(true);
  });

  it.each([
    ['a business ApiError', new ApiError(409, 'OUT_OF_STOCK', 'Hết hàng')],
    ['lock_timeout (55P03)', { code: '55P03' }],
    ['transaction timeout (P2028)', { code: 'P2028' }],
    ['unique violation (P2002)', { code: 'P2002' }],
    ['a plain Error', new Error('boom')],
    ['null', null],
    ['a string', 'deadlock'],
  ])('does not retry %s', (_name, error) => {
    expect(isTransientTransactionError(error)).toBe(false);
  });
});

describe('UnitOfWork.run: retry of the whole transaction', () => {
  const inventory = new InventoryService();

  it('runs once and returns the result when nothing fails', async () => {
    const db = fakePrisma({ [A]: { stock: 10 } });
    const result = await new UnitOfWork(db.prisma).run(async tx => { await inventory.reserve(tx, cart([A, 3])); return 'ok'; });
    expect(result).toBe('ok');
    expect(db.state.transactions).toBe(1);
    expect(db.table.get(A)?.stock).toBe(7);
  });

  it('transient error after a write, then success: the failed attempt is rolled back and re-read', async () => {
    const db = fakePrisma({ [A]: { stock: 10 } });
    let attempts = 0;
    const result = await new UnitOfWork(db.prisma).run(async tx => {
      attempts++;
      await inventory.reserve(tx, cart([A, 3]));
      if (attempts === 1) throw deadlock(); // database aborts us after A was already decremented
      return 'done';
    });
    expect(result).toBe('done');
    expect(attempts).toBe(2);
    expect(db.state.transactions).toBe(2);
    expect(db.seenTx[0]).not.toBe(db.seenTx[1]); // a fresh transaction, not the aborted one
    expect(db.table.get(A)).toMatchObject({ stock: 7, version: 1 }); // taken exactly once, not twice
  });

  it('deadlock on the second product: the first product held earlier is rolled back, retry takes both once', async () => {
    const db = fakePrisma({ [A]: { stock: 10 }, [B]: { stock: 10 } });
    db.state.failNextUpdates.push({ productId: B, error: Object.assign(new Error('deadlock detected'), { code: '40P01' }) });
    await new UnitOfWork(db.prisma).run(tx => inventory.reserve(tx, cart([B, 2], [A, 1])));
    expect(db.state.transactions).toBe(2);
    expect(db.table.get(A)?.stock).toBe(9);
    expect(db.table.get(B)?.stock).toBe(8);
  });

  it(`gives up after ${MAX_TRANSACTION_ATTEMPTS} attempts with 409 STOCK_CONFLICT and leaves nothing held`, async () => {
    const db = fakePrisma({ [A]: { stock: 10 }, [B]: { stock: 10 } });
    for (let i = 0; i < MAX_TRANSACTION_ATTEMPTS + 2; i++) {
      db.state.failNextUpdates.push({ productId: B, error: Object.assign(new Error('serialization failure'), { code: '40001' }) });
    }
    await expectCode(new UnitOfWork(db.prisma).run(tx => inventory.reserve(tx, cart([A, 4], [B, 4]))), 409, 'STOCK_CONFLICT');
    expect(db.state.transactions).toBe(MAX_TRANSACTION_ATTEMPTS);
    expect(db.table.get(A)).toMatchObject({ stock: 10, version: 0 }); // A was decremented in every attempt, all rolled back
    expect(db.table.get(B)).toMatchObject({ stock: 10, version: 0 });
  });

  it('does not retry a genuine OUT_OF_STOCK and rolls back the product taken before it', async () => {
    const db = fakePrisma({ [A]: { stock: 10 }, [B]: { stock: 1 } });
    await expectCode(new UnitOfWork(db.prisma).run(tx => inventory.reserve(tx, cart([A, 2], [B, 5]))), 409, 'OUT_OF_STOCK');
    expect(db.state.transactions).toBe(1);
    expect(db.table.get(A)).toMatchObject({ stock: 10, version: 0 });
  });

  it.each([
    ['a plain Error', new Error('boom')],
    ['lock_timeout', Object.assign(new Error('lock timeout'), { code: '55P03' })],
    ['transaction timeout', Object.assign(new Error('timeout'), { code: 'P2028' })],
  ])('does not retry %s', async (_name, error) => {
    const db = fakePrisma({ [A]: { stock: 10 } });
    let attempts = 0;
    await expect(new UnitOfWork(db.prisma).run(async () => { attempts++; throw error; })).rejects.toBe(error);
    expect(attempts).toBe(1);
    expect(db.state.transactions).toBe(1);
  });

  it('a key row claimed inside the transaction is rolled back with a failed attempt, so effects happen once', async () => {
    // Stand-in for the idempotency layer: it claims the key INSIDE tx, then the order work runs.
    const db = fakePrisma({ [A]: { stock: 10 } });
    let attempts = 0;
    await new UnitOfWork(db.prisma).run(async tx => {
      attempts++;
      (tx as unknown as { keyRows: string[] }).keyRows.push('Idempotency-Key: abc');
      await inventory.reserve(tx as Tx, cart([A, 2]));
      if (attempts === 1) throw deadlock();
    });
    expect(attempts).toBe(2);
    expect(db.keyRows).toEqual(['Idempotency-Key: abc']); // one claim, not two
    expect(db.table.get(A)?.stock).toBe(8); // one hold, not two
  });
});

import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { UnitOfWork } from '../src/common/database/unit-of-work';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { ApiError } from '../src/common/errors/api-error';
import type { StoredOrder } from '../src/common/contracts/ports';
import { createTempDatabase, type TempDatabase } from './support/temp-database';

// Real PostgreSQL concurrency test for Issue #9. Opt-in like the schema test:
//   $env:DATABASE_URL = "<server in backend/.env>"; $env:RUN_DB_TESTS = "1"; npm --prefix backend test -- inventory.integration
// It creates its own temporary database (migrations applied), writes every fixture there and drops it afterwards,
// so nothing is written to the development database. See test/support/temp-database.ts.
const integration = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

integration('Inventory on PostgreSQL: transaction + optimistic locking', () => {
  let prisma: PrismaService;
  let unitOfWork: UnitOfWork;
  const inventory = new InventoryService();

  let tempDatabase: TempDatabase | undefined;
  const serverUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    tempDatabase = await createTempDatabase(serverUrl);
    process.env.DATABASE_URL = tempDatabase.url; // PrismaService reads it when constructed
    prisma = new PrismaService();
    unitOfWork = new UnitOfWork(prisma);
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    if (serverUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = serverUrl;
    await tempDatabase?.drop();
  }, 60_000);

  const newProduct = (stock: number, id: string = randomUUID()) =>
    prisma.product.create({
      data: { id, name: `Inventory test ${id.slice(0, 8)}`, description: 'Concurrency fixture', price: 45000, imageUrl: 'http://localhost/test.jpg', stock },
    });
  const stockOf = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id } })).stock;
  const reserve = (lines: Array<[string, number]>) =>
    unitOfWork.run(tx => inventory.reserve(tx, lines.map(([productId, qty]) => ({ productId, size: 'M' as const, qty }))));
  async function expectApiCode(promise: Promise<unknown>, code: string) {
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await promise.catch((error: ApiError) => expect(error.getResponse()).toMatchObject({ code }));
  }

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
});

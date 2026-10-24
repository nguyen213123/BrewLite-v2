import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { UnitOfWork } from '../src/common/database/unit-of-work';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { OrderTransactionsService } from '../src/modules/orders/order-transactions.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { ApiError } from '../src/common/errors/api-error';
import type * as Api from '../src/common/contracts/api.generated';
import type { Tx } from '../src/common/contracts/ports';
import { createTempDatabase, type TempDatabase } from './support/temp-database';

// Order creation + stock holding on real PostgreSQL (Issues #7 and #9): many POST /orders racing for the last cups.
// Real OrdersService, InventoryService, OrderTransactionsService and UnitOfWork. Only catalog pricing, promotions and the
// idempotency layer (other members' modules) are replaced by minimal stand-ins. Opt-in:
//   $env:DATABASE_URL = "<server in backend/.env>"; $env:RUN_DB_TESTS = "1"; npm --prefix backend test -- orders-create.integration
// Uses its own temporary database, dropped afterwards (see test/support/temp-database.ts).
const integration = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

integration('POST /orders holds stock on PostgreSQL', () => {
  let prisma: PrismaService;
  let unitOfWork: UnitOfWork;
  let orders: OrdersService;
  let tempDatabase: TempDatabase | undefined;
  const serverUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    tempDatabase = await createTempDatabase(serverUrl);
    process.env.DATABASE_URL = tempDatabase.url;
    prisma = new PrismaService();
    unitOfWork = new UnitOfWork(prisma);

    const catalog = {
      resolve: async (_tx: Tx, items: Api.CartItem[]): Promise<Api.QuoteItem[]> =>
        items.map(item => ({
          productId: item.productId, productName: 'Fixture', size: item.size, sizePrice: 45000, toppings: [],
          qty: item.qty, unitPrice: 45000, lineTotal: 45000 * item.qty,
        })),
    };
    const promotions = {
      price: async () => ({ promotionId: null, promotionCode: null, discount: 0 }),
      reserve: async () => undefined,
      release: async () => undefined,
    };
    // Stand-in for TV5's layer: same contract, runs the work in one UnitOfWork transaction.
    const idempotency = { execute: async (_input: unknown, work: (tx: Tx) => Promise<Api.Order>) => ({ data: await unitOfWork.run(work), replayed: false }) };
    const loyalty = { earn: async () => undefined, reverse: async () => undefined };
    const inventory = new InventoryService();
    const transitions = new OrderTransactionsService(inventory, promotions as never);
    orders = new OrdersService(unitOfWork, catalog as never, promotions as never, idempotency as never, transitions, loyalty as never, inventory);
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    if (serverUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = serverUrl;
    await tempDatabase?.drop();
  }, 60_000);

  const newProduct = (stock: number, id: string = randomUUID()) =>
    prisma.product.create({
      data: { id, name: `Create test ${id.slice(0, 8)}`, description: 'Order creation fixture', price: 45000, imageUrl: 'http://localhost/test.jpg', stock },
    });
  const newUser = () => prisma.user.create({ data: { email: `${randomUUID()}@example.com`, passwordHash: 'test-only-not-an-auth-account' } });
  const stockOf = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id } })).stock;
  const place = (userId: string, lines: Array<[string, number]>) =>
    orders.create(userId, randomUUID(), { items: lines.map(([productId, qty]) => ({ productId, size: 'M' as const, qty })) });
  const codeOf = (result: PromiseRejectedResult) => ((result.reason as ApiError).getResponse() as { code: string }).code;
  const fulfilled = (results: PromiseSettledResult<unknown>[]) => results.filter(r => r.status === 'fulfilled');
  const rejected = (results: PromiseSettledResult<unknown>[]) => results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

  it('stock=1 with 10 concurrent orders: exactly one order is created, the rest hold nothing', async () => {
    const product = await newProduct(1);
    const user = await newUser();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => place(user.id, [[product.id, 1]])));

    expect(fulfilled(results)).toHaveLength(1);
    for (const failure of rejected(results)) expect(['OUT_OF_STOCK', 'STOCK_CONFLICT']).toContain(codeOf(failure));
    expect(await stockOf(product.id)).toBe(0);
    expect(await prisma.order.count({ where: { userId: user.id } })).toBe(1); // rejected orders left no row
    expect(await prisma.order.findFirstOrThrow({ where: { userId: user.id } })).toMatchObject({ status: 'PENDING', reservationStatus: 'HELD' });
  });

  it('stock=5 with 20 concurrent orders of 1 cup: held cups never exceed the starting stock, never negative', async () => {
    const product = await newProduct(5);
    const user = await newUser();
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => place(user.id, [[product.id, 1]])));

    const created = fulfilled(results).length;
    expect(created).toBeGreaterThanOrEqual(1);
    expect(created).toBeLessThanOrEqual(5);
    // STOCK_CONFLICT after 3 lost races is allowed (the client resends); the accounting must still be exact.
    expect(await prisma.order.count({ where: { userId: user.id } })).toBe(created);
    expect(await stockOf(product.id)).toBe(5 - created);
  });

  it('stock=3 with an order of 2 cups racing another order of 2 cups: only one fits', async () => {
    const product = await newProduct(3);
    const user = await newUser();
    const results = await Promise.allSettled([place(user.id, [[product.id, 2]]), place(user.id, [[product.id, 2]])]);
    expect(fulfilled(results)).toHaveLength(1);
    expect(await stockOf(product.id)).toBe(1);
  });

  it('a rejected order holds nothing: the product taken first is rolled back and no order row remains', async () => {
    const [first, second] = [randomUUID(), randomUUID()].sort(); // reserve() visits ids in ascending order
    await newProduct(1, first);
    await newProduct(0, second);
    const user = await newUser();
    await expect(place(user.id, [[first, 1], [second, 1]])).rejects.toBeInstanceOf(ApiError);
    expect(await stockOf(first)).toBe(1);
    expect(await prisma.order.count({ where: { userId: user.id } })).toBe(0);
  });

  it('create then cancel returns exactly the cups that were held', async () => {
    const product = await newProduct(5);
    const user = await newUser();
    const { data: order } = await place(user.id, [[product.id, 2]]);
    expect(order).toMatchObject({ status: 'PENDING', reservationStatus: 'HELD' });
    expect(await stockOf(product.id)).toBe(3);

    const cancelled = await orders.cancel(user.id, order.id, order.version);
    expect(cancelled).toMatchObject({ status: 'CANCELLED', reservationStatus: 'RELEASED' });
    expect(await stockOf(product.id)).toBe(5);
  });
});

import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { UnitOfWork } from '../src/common/database/unit-of-work';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { OrderTransactionsService } from '../src/modules/orders/order-transactions.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { ApiError } from '../src/common/errors/api-error';
import { createTempDatabase, type TempDatabase } from './support/temp-database';

// Real PostgreSQL test for Issue #8 (competing transitions, duplicate cancel/retry, rollback). Opt-in like the others:
//   $env:DATABASE_URL = "<value from backend/.env>"; $env:RUN_DB_TESTS = "1"
//   npm --prefix backend test -- order-transitions.integration
// Every fixture is written to a migrated temporary database, dropped after the suite even if a test fails.
const integration = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

type Status = 'PENDING' | 'PAID' | 'PAYMENT_FAILED';
type Reservation = 'HELD' | 'CONSUMED' | 'RELEASED';
const QTY = 2;

integration('Order state machine on PostgreSQL', () => {
  let prisma: PrismaService;
  let unitOfWork: UnitOfWork;
  let transitions: OrderTransactionsService;
  let orders: OrdersService;
  const promotions = { price: jest.fn(), reserve: jest.fn(), release: jest.fn() }; // fixtures have no promotion
  const loyalty = { earn: jest.fn(), reverse: jest.fn(async () => undefined) };
  let tempDatabase: TempDatabase | undefined;
  const serverUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    tempDatabase = await createTempDatabase(serverUrl);
    process.env.DATABASE_URL = tempDatabase.url;
    prisma = new PrismaService();
    unitOfWork = new UnitOfWork(prisma);
    const inventory = new InventoryService();
    transitions = new OrderTransactionsService(inventory, promotions as never);
    orders = new OrdersService(unitOfWork, {} as never, {} as never, {} as never, transitions, loyalty as never, inventory);
  }, 120_000);
  afterAll(async () => {
    try {
      await prisma?.$disconnect();
    } finally {
      if (serverUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = serverUrl;
      await tempDatabase?.drop();
    }
  }, 60_000);

  // `stock` is what is left AFTER this order's QTY cups were taken (a HELD/CONSUMED order already holds them).
  async function newOrder(options: { status: Status; reservation: Reservation; stock: number; version?: number }) {
    const product = await prisma.product.create({
      data: { name: `Order test ${randomUUID().slice(0, 8)}`, description: 'State machine fixture', price: 45000, imageUrl: 'http://localhost/test.jpg', stock: options.stock },
    });
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, passwordHash: 'test-only-not-an-auth-account' } });
    const order = await prisma.order.create({
      data: {
        code: `BL-20261022-${randomBytes(4).toString('hex').toUpperCase()}`,
        userId: user.id, subtotal: 90000, total: 90000, status: options.status, reservationStatus: options.reservation, version: options.version ?? 0,
        items: { create: [{ productId: product.id, productName: 'Fixture', size: 'M', sizePrice: 45000, unitPrice: 45000, qty: QTY, lineTotal: 90000 }] },
      },
    });
    return { product, user, order };
  }
  const stockOf = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id } })).stock;
  const reload = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
  const eventCount = (orderId: string) => prisma.orderEvent.count({ where: { orderId } });
  const codeOf = (result: PromiseRejectedResult) => ((result.reason as ApiError).getResponse() as { code: string }).code;
  const rejected = (results: PromiseSettledResult<unknown>[]) => results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  const fulfilled = (results: PromiseSettledResult<unknown>[]) => results.filter(r => r.status === 'fulfilled');

  it('10 concurrent PENDING -> PAID with the same version: exactly one applies, one event', async () => {
    const { order } = await newOrder({ status: 'PENDING', reservation: 'HELD', stock: 5 });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => unitOfWork.run(tx => transitions.transition(tx, { orderId: order.id, actorUserId: order.userId, expectedVersion: 0, toStatus: 'PAID' }))),
    );
    expect(fulfilled(results)).toHaveLength(1);
    for (const failure of rejected(results)) expect(codeOf(failure)).toBe('ORDER_VERSION_CONFLICT');
    expect(await reload(order.id)).toMatchObject({ status: 'PAID', reservationStatus: 'CONSUMED', version: 1 });
    expect(await eventCount(order.id)).toBe(1);
  });

  it('PAID -> PREPARING racing PAID -> CANCELLED: one winner; stock returns only if cancel won', async () => {
    const { order, product, user } = await newOrder({ status: 'PAID', reservation: 'CONSUMED', stock: 5, version: 1 });
    const results = await Promise.allSettled([
      orders.transition(user.id, order.id, { status: 'PREPARING', expectedVersion: 1 }),
      orders.cancel(user.id, order.id, 1),
    ]);
    expect(fulfilled(results)).toHaveLength(1);
    const final = await reload(order.id);
    expect(final.version).toBe(2);
    expect(await eventCount(order.id)).toBe(1);
    if (final.status === 'CANCELLED') {
      expect(final.reservationStatus).toBe('RELEASED');
      expect(await stockOf(product.id)).toBe(5 + QTY);
    } else {
      expect(final).toMatchObject({ status: 'PREPARING', reservationStatus: 'CONSUMED' });
      expect(await stockOf(product.id)).toBe(5);
    }
  });

  it('5 concurrent cancels of a PENDING order: stock is returned exactly once', async () => {
    const { order, product, user } = await newOrder({ status: 'PENDING', reservation: 'HELD', stock: 5 });
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => orders.cancel(user.id, order.id, 0)));
    expect(fulfilled(results)).toHaveLength(1);
    for (const failure of rejected(results)) expect(codeOf(failure)).toBe('ORDER_VERSION_CONFLICT');
    expect(await reload(order.id)).toMatchObject({ status: 'CANCELLED', reservationStatus: 'RELEASED', version: 1 });
    expect(await stockOf(product.id)).toBe(5 + QTY);
    expect(await eventCount(order.id)).toBe(1);
  });

  it('repeating cancel with the new version afterwards is a 200 that changes nothing', async () => {
    const { order, product, user } = await newOrder({ status: 'PENDING', reservation: 'HELD', stock: 5 });
    await orders.cancel(user.id, order.id, 0);
    const again = await orders.cancel(user.id, order.id, 1);
    expect(again).toMatchObject({ status: 'CANCELLED', version: 1 });
    expect(await stockOf(product.id)).toBe(5 + QTY);
    expect(await eventCount(order.id)).toBe(1);
  });

  it('5 concurrent PENDING -> PAYMENT_FAILED: stock returns once', async () => {
    const { order, product } = await newOrder({ status: 'PENDING', reservation: 'HELD', stock: 5 });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => unitOfWork.run(tx => transitions.transition(tx, { orderId: order.id, actorUserId: order.userId, expectedVersion: 0, toStatus: 'PAYMENT_FAILED' }))),
    );
    expect(fulfilled(results)).toHaveLength(1);
    expect(await stockOf(product.id)).toBe(5 + QTY);
    expect(await reload(order.id)).toMatchObject({ status: 'PAYMENT_FAILED', reservationStatus: 'RELEASED', version: 1 });
  });

  it('3 concurrent retries of a PAYMENT_FAILED order: stock is held once', async () => {
    const { order, product, user } = await newOrder({ status: 'PAYMENT_FAILED', reservation: 'RELEASED', stock: 10, version: 1 });
    const results = await Promise.allSettled(
      Array.from({ length: 3 }, () => unitOfWork.run(async tx => transitions.prepareRetry(tx, await transitions.loadOwned(tx, user.id, order.id)))),
    );
    expect(fulfilled(results)).toHaveLength(1);
    for (const failure of rejected(results)) expect(['ORDER_VERSION_CONFLICT', 'INVALID_ORDER_TRANSITION']).toContain(codeOf(failure));
    expect(await reload(order.id)).toMatchObject({ status: 'PENDING', reservationStatus: 'HELD', version: 2 });
    expect(await stockOf(product.id)).toBe(10 - QTY);
    expect(await eventCount(order.id)).toBe(1);
  });

  it('a retry that cannot re-hold stock rolls back: still PAYMENT_FAILED/RELEASED, nothing held', async () => {
    const { order, product, user } = await newOrder({ status: 'PAYMENT_FAILED', reservation: 'RELEASED', stock: 1, version: 1 });
    const outcome = await Promise.allSettled([
      unitOfWork.run(async tx => transitions.prepareRetry(tx, await transitions.loadOwned(tx, user.id, order.id))),
    ]);
    expect(codeOf(rejected(outcome)[0])).toBe('OUT_OF_STOCK');
    expect(await reload(order.id)).toMatchObject({ status: 'PAYMENT_FAILED', reservationStatus: 'RELEASED', version: 1 });
    expect(await stockOf(product.id)).toBe(1);
    expect(await eventCount(order.id)).toBe(0);
  });
});

import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { UnitOfWork } from '../src/common/database/unit-of-work';

// Run only on an explicitly selected integration database with migrations applied.
const integration = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
integration('Shared schema/migration on PostgreSQL', () => {
  let prisma: PrismaService;
  beforeAll(() => {
    if (!process.env.DATABASE_URL) throw new Error('RUN_DB_TESTS requires DATABASE_URL');
    prisma = new PrismaService();
  });
  afterAll(async () => { await prisma.$disconnect(); });
  const productData = { name: 'Schema test', description: 'Integration fixture', price: 45000, imageUrl: 'http://localhost/test.jpg' };
  const userData = () => ({ email: `${randomUUID()}@example.com`, passwordHash: 'test-only-not-an-auth-account' });
  const code = () => `BL-20261022-${randomBytes(4).toString('hex').toUpperCase()}`;

  it('has every baseline table without removing SystemCheck', async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    const tables = rows.map(x => x.table_name);
    for (const table of ['SystemCheck', 'User', 'Product', 'ProductSize', 'Topping', 'ProductTopping', 'Promotion', 'Order', 'OrderItem', 'OrderItemTopping', 'Payment', 'LoyaltyEntry', 'OrderEvent', 'IdempotencyRecord']) {
      expect(tables).toContain(table);
    }
  });
  it('rejects negative product stock at database level', async () => {
    await expect(prisma.product.create({ data: { ...productData, stock: -1 } })).rejects.toThrow();
  });
  it('sets local lock timeout and rolls back all callback writes on failure', async () => {
    const id = randomUUID();
    const unitOfWork = new UnitOfWork(prisma);
    await expect(unitOfWork.run(async tx => {
      const settings = await tx.$queryRaw<Array<{ lock_timeout: string }>>`SHOW lock_timeout`;
      expect(settings[0].lock_timeout).toBe('3s');
      await tx.product.create({ data: { ...productData, id } });
      throw new Error('intentional transaction rollback');
    })).rejects.toThrow('intentional transaction rollback');
    expect(await prisma.product.findUnique({ where: { id } })).toBeNull();
  });
  it('rejects negative user points at database level', async () => {
    await expect(prisma.user.create({ data: { ...userData(), loyaltyPoints: -1 } })).rejects.toThrow();
  });
  it('rejects inconsistent order totals and rolls back the user fixture', async () => {
    await expect(prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: userData() });
      await tx.order.create({ data: { code: code(), userId: user.id, subtotal: 100, discount: 10, total: 100 } });
    })).rejects.toThrow();
  });
  it('enforces unique loyalty effects per order and kind', async () => {
    await expect(prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: userData() });
      const order = await tx.order.create({ data: { code: code(), userId: user.id, subtotal: 0, total: 0 } });
      const data = { userId: user.id, orderId: order.id, kind: 'EARN' as const, points: 0 };
      await tx.loyaltyEntry.create({ data });
      await tx.loyaltyEntry.create({ data });
    })).rejects.toMatchObject({ code: 'P2002' });
  });
  it('enforces one successful/refunded payment per order even across keys', async () => {
    await expect(prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: userData() });
      const order = await tx.order.create({ data: { code: code(), userId: user.id, subtotal: 0, total: 0, status: 'PAID', reservationStatus: 'CONSUMED' } });
      for (let attempt = 0; attempt < 2; attempt++) {
        const key = randomUUID();
        const record = await tx.idempotencyRecord.create({ data: { userId: user.id, scope: 'PAY_ORDER', key, requestHash: 'a'.repeat(64), status: 'COMPLETED', httpStatus: 200, response: {} } });
        await tx.payment.create({ data: { orderId: order.id, idempotencyRecordId: record.id, idempotencyKey: key, amount: 0, method: 'WALLET', status: attempt ? 'REFUNDED' : 'SUCCEEDED' } });
      }
    })).rejects.toMatchObject({ code: 'P2002' });
  });
});

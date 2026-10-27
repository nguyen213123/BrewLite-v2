import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Client } from 'pg';

const integration = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const migration = (name: string) => readFileSync(path.join(__dirname, '../prisma/migrations', name, 'migration.sql'), 'utf8');
const guard = migration('20261027025000_guard_legacy_stock_holds');
const dropStock = migration('20261027030000_drop_product_stock');

integration('Upgrade from product stock to ingredient holds without losing open orders', () => {
  const name = `brewlite_upgrade_${randomBytes(6).toString('hex')}`;
  let admin: Client | undefined, db: Client;
  let created = false;

  beforeAll(async () => {
    const server = new URL(process.env.DATABASE_URL ?? 'postgresql://brewlite:brewlite_dev@localhost:5432/brewlite');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(server.hostname)) throw new Error('Upgrade test requires a local database server');
    server.searchParams.delete('schema');
    admin = new Client({ connectionString: server.toString() }); await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    server.pathname = `/${name}`;
    db = new Client({ connectionString: server.toString() }); await db.connect();
    await db.query(migration('20261022000000_init'));
    await db.query(migration('20261022010000_api_baseline'));
    await db.query(migration('20261027020000_ingredient_recipes'));
  }, 30000);

  beforeEach(async () => { await db.query('BEGIN'); });
  afterEach(async () => { await db.query('ROLLBACK'); });
  afterAll(async () => {
    try { await db?.end(); }
    finally {
      try { if (created) await admin?.query(`DROP DATABASE "${name}" WITH (FORCE)`); }
      finally { await admin?.end(); }
    }
  });

  async function legacyOrder(status: string, reservation: string) {
    const userId = randomUUID(), productId = randomUUID(), orderId = randomUUID();
    await db.query('INSERT INTO "User" (id,email,"passwordHash") VALUES ($1,$2,$3)', [userId, `${userId}@example.com`, 'test-only']);
    await db.query('INSERT INTO "Product" (id,name,description,price,"imageUrl",stock) VALUES ($1,$2,$3,50000,$4,8)',
      [productId, 'Legacy drink', '10 original cups minus 2 held cups', 'http://localhost/fixture.jpg']);
    await db.query('INSERT INTO "Order" (id,code,"userId",subtotal,total,status,"reservationStatus","updatedAt") VALUES ($1,$2,$3,100000,100000,$4,$5,NOW())',
      [orderId, `BL-${randomBytes(4).toString('hex').toUpperCase()}`, userId, status, reservation]);
    await db.query('INSERT INTO "OrderItem" (id,"orderId","productId","productName",size,"sizePrice","unitPrice",qty,"lineTotal") VALUES ($1,$2,$3,$4,\'S\',50000,50000,2,100000)',
      [randomUUID(), orderId, productId, 'Legacy drink']);
    return { orderId, productId };
  }

  async function hasOldStock() {
    const rows = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Product' AND column_name = 'stock'");
    return rows.rowCount === 1;
  }

  it.each([
    ['PENDING', 'HELD'], ['PAID', 'CONSUMED'], ['PREPARING', 'CONSUMED'], ['READY', 'CONSUMED'],
  ])('blocks %s/%s without a snapshot before dropping old stock', async (status, reservation) => {
    const { orderId, productId } = await legacyOrder(status, reservation);
    await db.query('SAVEPOINT before_guard');
    await expect(db.query(guard)).rejects.toThrow('LEGACY_STOCK_HOLDS');
    await db.query('ROLLBACK TO SAVEPOINT before_guard');
    expect(await hasOldStock()).toBe(true);
    expect((await db.query('SELECT stock FROM "Product" WHERE id=$1', [productId])).rows[0].stock).toBe(8);
    expect((await db.query('SELECT status,"reservationStatus" FROM "Order" WHERE id=$1', [orderId])).rows[0])
      .toEqual({ status, reservationStatus: reservation });
  });

  it('allows upgrading after a legacy order is cancelled on the old version without deleting history', async () => {
    const { orderId, productId } = await legacyOrder('PENDING', 'HELD');
    // Model the old release while Product.stock still exists, before the upgrade.
    await db.query('UPDATE "Product" SET stock=stock+2 WHERE id=$1', [productId]);
    await db.query('UPDATE "Order" SET status=\'CANCELLED\',"reservationStatus"=\'RELEASED\' WHERE id=$1', [orderId]);
    await db.query(guard); await db.query(dropStock);
    expect(await hasOldStock()).toBe(false);
    expect((await db.query('SELECT status FROM "Order" WHERE id=$1', [orderId])).rows[0].status).toBe('CANCELLED');
    expect((await db.query('SELECT qty FROM "OrderItem" WHERE "orderId"=$1', [orderId])).rows[0].qty).toBe(2);
  });

  it.each([
    ['COMPLETED', 'CONSUMED'], ['PAYMENT_FAILED', 'RELEASED'], ['CANCELLED', 'RELEASED'],
  ])('does not block historical %s/%s orders', async (status, reservation) => {
    const { orderId } = await legacyOrder(status, reservation);
    await db.query(guard); await db.query(dropStock);
    expect(await hasOldStock()).toBe(false);
    expect((await db.query('SELECT status FROM "Order" WHERE id=$1', [orderId])).rows[0].status).toBe(status);
  });

  it('allows an active ingredient-based order with its original hold snapshot', async () => {
    const { orderId } = await legacyOrder('PAID', 'CONSUMED');
    const ingredientId = randomUUID();
    await db.query('INSERT INTO "Ingredient" (id,name,unit,stock,"packageSize","packageLabel") VALUES ($1,$2,\'PIECE\',8,1,\'unit\')', [ingredientId, 'Stock fixture']);
    await db.query('INSERT INTO "OrderIngredientHold" ("orderId","ingredientId",amount) VALUES ($1,$2,2)', [orderId, ingredientId]);
    await db.query(guard); await db.query(dropStock);
    expect(await hasOldStock()).toBe(false);
    expect((await db.query('SELECT amount FROM "OrderIngredientHold" WHERE "orderId"=$1', [orderId])).rows[0].amount).toBe(2);
  });

  it('also detects a legacy order on databases where the old drop migration already ran', async () => {
    const { orderId } = await legacyOrder('PAID', 'CONSUMED');
    await db.query(dropStock); await db.query('SAVEPOINT before_guard');
    await expect(db.query(guard)).rejects.toThrow('LEGACY_STOCK_HOLDS');
    await db.query('ROLLBACK TO SAVEPOINT before_guard');
    expect((await db.query('SELECT status,"reservationStatus" FROM "Order" WHERE id=$1', [orderId])).rows[0])
      .toEqual({ status: 'PAID', reservationStatus: 'CONSUMED' });
  });
});

import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { Client } from 'pg';

// RUN_DB_TESTS=1 opts in. The fixture lives in its own local database, which is dropped afterwards.
const integration = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const migration = (name: string) => readFileSync(path.join(__dirname, '../prisma/migrations', name, 'migration.sql'), 'utf8');

integration('Removal of reference-only recipe ingredients', () => {
  const databaseName = `brewlite_ref_remove_${randomBytes(6).toString('hex')}`;
  const productId = '11111111-1111-4111-8111-111111111111';
  const ingredientId = randomUUID(), userId = randomUUID(), orderId = randomUUID();
  let admin: Client | undefined, db: Client | undefined;
  let created = false;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('RUN_DB_TESTS requires DATABASE_URL');
    const server = new URL(process.env.DATABASE_URL);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(server.hostname)) throw new Error('Test requires local PostgreSQL');
    server.searchParams.delete('schema');
    admin = new Client({ connectionString: server.toString() });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    server.pathname = `/${databaseName}`;
    db = new Client({ connectionString: server.toString() });
    await db.connect();
    for (const name of ['20261022000000_init', '20261022010000_api_baseline', '20261027020000_ingredient_recipes', '20261027025000_guard_legacy_stock_holds', '20261027030000_drop_product_stock']) {
      await db.query(migration(name));
    }
    await db.query('INSERT INTO "Product" (id,name,description,price,"imageUrl") VALUES ($1,$2,$3,45000,$4)',
      [productId, 'Cappuccino', 'Test fixture', 'http://localhost/test.jpg']);
    await db.query('INSERT INTO "Ingredient" (id,name,unit,stock,"packageSize","packageLabel") VALUES ($1,$2,\'GRAM\',126,250,$3)',
      [ingredientId, 'Cà phê hạt', 'túi']);
    await db.query('INSERT INTO "ProductIngredient" ("productId","ingredientId",amount) VALUES ($1,$2,18)', [productId, ingredientId]);
    await db.query('INSERT INTO "User" (id,email,"passwordHash") VALUES ($1,$2,$3)', [userId, `${userId}@example.com`, 'test-only']);
    await db.query('INSERT INTO "Order" (id,code,"userId",subtotal,total,"updatedAt") VALUES ($1,$2,$3,45000,45000,NOW())',
      [orderId, `BL-${randomBytes(4).toString('hex').toUpperCase()}`, userId]);
    await db.query('INSERT INTO "OrderIngredientHold" ("orderId","ingredientId",amount) VALUES ($1,$2,18)', [orderId, ingredientId]);
    await db.query(migration('20261028010000_reference_recipe_components'));
  }, 120_000);

  afterAll(async () => {
    try { await db?.end(); }
    finally {
      try { if (created) await admin?.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`); }
      finally { await admin?.end(); }
    }
  }, 60_000);

  it('removes the reference table after its historical backfill while preserving orders, tracked recipe, stock and hold', async () => {
    const oldReference = await db!.query('SELECT name,unit,amount FROM "ProductReferenceIngredient" WHERE "productId"=$1', [productId]);
    expect(oldReference.rows).toEqual([{ name: 'Nước nóng', unit: 'ML', amount: 40 }]);
    const snapshot = async () => (await db!.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM "Product" p) AS products,
      (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM "Ingredient" i) AS ingredients,
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY r."productId", r."ingredientId") FROM "ProductIngredient" r) AS recipes,
      (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM "Order" o) AS orders,
      (SELECT jsonb_agg(to_jsonb(h) ORDER BY h."orderId", h."ingredientId") FROM "OrderIngredientHold" h) AS holds`)).rows[0];
    const before = await snapshot();

    await db!.query(migration('20261028020000_drop_reference_recipe_components'));

    expect(await snapshot()).toEqual(before);
    expect((await db!.query('SELECT to_regclass($1) AS name', ['"ProductReferenceIngredient"'])).rows[0].name).toBeNull();
    expect((await db!.query('SELECT stock FROM "Ingredient" WHERE id=$1', [ingredientId])).rows[0].stock).toBe(126);
    expect((await db!.query('SELECT amount FROM "OrderIngredientHold" WHERE "orderId"=$1', [orderId])).rows[0].amount).toBe(18);
  });
});

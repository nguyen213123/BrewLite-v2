import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { UnitOfWork } from '../src/common/database/unit-of-work';
import { createTempDatabase, type TempDatabase } from './support/temp-database';

// Real deadlock on PostgreSQL, the case the unit tests can only simulate (Issue #9 review). Opt-in:
//   $env:DATABASE_URL = "<server in backend/.env>"; $env:RUN_DB_TESTS = "1"; npm --prefix backend test -- unit-of-work.integration
// Uses its own temporary database, dropped afterwards (see test/support/temp-database.ts).
const integration = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

integration('UnitOfWork on PostgreSQL: deadlock victim is retried as a whole transaction', () => {
  let prisma: PrismaService;
  let unitOfWork: UnitOfWork;
  let tempDatabase: TempDatabase | undefined;
  const serverUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    tempDatabase = await createTempDatabase(serverUrl);
    process.env.DATABASE_URL = tempDatabase.url;
    prisma = new PrismaService();
    unitOfWork = new UnitOfWork(prisma);
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    if (serverUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = serverUrl;
    await tempDatabase?.drop();
  }, 60_000);

  const newIngredient = (stock: number) =>
    prisma.ingredient.create({
      data: {
        name: `Deadlock test ${randomUUID().slice(0, 8)}`,
        unit: 'GRAM',
        stock,
        packageSize: 250,
        packageLabel: 'túi',
      },
    });
  const stockOf = async (id: string) => (await prisma.ingredient.findUniqueOrThrow({ where: { id } })).stock;

  it('two transactions taking two products in opposite order: PostgreSQL aborts one, it is retried, both commit once', async () => {
    const [first, second] = await Promise.all([newIngredient(10), newIngredient(10)]);

    // Both transactions must hold their first row lock before either asks for the second one, which guarantees a deadlock.
    let arrivals = 0;
    let bothHoldFirstLock!: () => void;
    const gate = new Promise<void>(resolve => { bothHoldFirstLock = resolve; });
    const attempts = { x: 0, y: 0 };

    const worker = (name: 'x' | 'y', firstId: string, secondId: string) =>
      unitOfWork.run(async tx => {
        attempts[name]++;
        await tx.ingredient.update({ where: { id: firstId }, data: { stock: { decrement: 1 } } }); // takes the row lock
        if (++arrivals === 2) bothHoldFirstLock();
        await gate; // already open on a retry
        await tx.ingredient.update({ where: { id: secondId }, data: { stock: { decrement: 1 } } }); // opposite order: deadlock
      });

    const results = await Promise.allSettled([worker('x', first.id, second.id), worker('y', second.id, first.id)]);

    expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(attempts.x + attempts.y).toBeGreaterThanOrEqual(3); // at least one attempt was aborted by the database and re-run
    // Each product was decremented once per worker: the aborted attempt left no trace.
    expect(await stockOf(first.id)).toBe(8);
    expect(await stockOf(second.id)).toBe(8);
  }, 30_000);
});

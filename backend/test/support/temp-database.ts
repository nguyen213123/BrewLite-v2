import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import { Client } from 'pg';

// Throwaway PostgreSQL database for integration tests. The server in DATABASE_URL is only used to run
// CREATE/DROP DATABASE; every fixture is written to a brand-new database (brewlite_test_<random>) that has the real
// migrations applied and is dropped in afterAll, so nothing is left behind in the development database, even when the
// tests fail. Needs a role with CREATEDB (the docker compose and CI `brewlite` role has it) and PostgreSQL 13+.
export type TempDatabase = { name: string; url: string; drop: () => Promise<void> };

const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function adminConnectionString(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.searchParams.delete('schema'); // a Prisma-only parameter
  return url.toString();
}

async function withAdmin(serverUrl: string, run: (client: Client) => Promise<unknown>): Promise<void> {
  const client = new Client({ connectionString: adminConnectionString(serverUrl) });
  await client.connect();
  try {
    await run(client);
  } finally {
    await client.end();
  }
}

export async function createTempDatabase(serverUrl: string | undefined = process.env.DATABASE_URL): Promise<TempDatabase> {
  if (!serverUrl) throw new Error('RUN_DB_TESTS requires DATABASE_URL (the server used to create the temporary database)');
  const server = new URL(serverUrl);
  if (!LOCAL_HOSTS.has(server.hostname)) {
    throw new Error(`Refusing to create a test database on non-local host "${server.hostname}"`);
  }

  const name = `brewlite_test_${randomBytes(6).toString('hex')}`;
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const testUrl = url.toString();

  await withAdmin(serverUrl, client => client.query(`CREATE DATABASE "${name}"`));
  const drop = () => withAdmin(serverUrl, client => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));

  // Same command as `npm run prisma:deploy`, pointed at the temporary database through the environment.
  const migrate = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DATABASE_URL: testUrl },
    encoding: 'utf8',
  });
  if (migrate.status !== 0) {
    await drop();
    throw new Error(`prisma migrate deploy failed on temporary database ${name}:\n${migrate.stdout}\n${migrate.stderr}`);
  }
  return { name, url: testUrl, drop };
}

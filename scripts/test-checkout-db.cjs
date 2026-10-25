// Run the complete suite against a disposable local database, never the development database.
const { randomBytes } = require('node:crypto');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const backendRequire = createRequire(path.resolve(__dirname, '../backend/package.json'));
const { Client } = backendRequire('pg');
const root = path.resolve(__dirname, '..');
const server = new URL(process.env.DATABASE_URL ?? 'postgresql://brewlite:brewlite_dev@localhost:5432/brewlite');
if (!['localhost', '127.0.0.1', '[::1]'].includes(server.hostname)) throw new Error('Test database must be on localhost.');
server.searchParams.delete('schema');
const name = `brewlite_checkout_${randomBytes(6).toString('hex')}`;
async function main() {
  const admin = new Client({ connectionString: server.toString(), connectionTimeoutMillis: 5000 });
  await admin.connect();
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    const target = new URL(server); target.pathname = `/${name}`;
    const env = { ...process.env, DATABASE_URL: target.toString(), RUN_DB_TESTS: '1' };
    function run(args, cwd) {
      const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
      if (result.status !== 0) throw new Error(`Test command failed (${result.status ?? result.error?.message})`);
    }
    run([backendRequire.resolve('prisma/build/index.js'), 'migrate', 'deploy'], path.join(root, 'backend'));
    run([process.env.npm_execpath, 'test'], root);
  } finally {
    if (created) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

// Disposable QA stack: no published database port, no development volume/env file.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const id = createHash('sha256').update(root).digest('hex').slice(0, 8);
const configPath = path.join(os.tmpdir(), `brewlite-qa-${id}.json`);
const command = process.argv[2];
function compose(args, input) {
  const result = spawnSync('docker', ['compose', '-f', configPath, ...args], {
    cwd: root, ...(input === undefined ? { stdio: 'inherit' } : { input, encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'] }),
  });
  if (result.status !== 0) throw new Error(`Docker QA failed: ${result.error?.message ?? result.status}`);
}
async function ready() {
  for (let n = 0; n < 40; n++) {
    try {
      const response = await fetch('http://localhost:3401/api/health/ready', { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch { /* Wait for container startup/migrations. */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('QA API was not ready after startup. Check qa:status/container logs.');
}
function writeConfig() {
  if (fs.existsSync(configPath)) return;
  const config = {
    name: `brewlite-qa-${id}`,
    services: {
      db: {
        image: 'postgres:17-bookworm',
        environment: { POSTGRES_USER: 'brewlite', POSTGRES_PASSWORD: 'brewlite_dev', POSTGRES_DB: 'brewlite' },
        tmpfs: ['/var/lib/postgresql/data'],
        healthcheck: { test: ['CMD-SHELL', 'pg_isready -U brewlite -d brewlite'], interval: '3s', timeout: '3s', retries: 20 },
      },
      backend: {
        build: { context: path.join(root, 'backend') },
        environment: { PORT: '3001', JWT_SECRET: randomBytes(32).toString('hex'), FRONTEND_URL: 'http://localhost:3400',
          DATABASE_URL: 'postgresql://brewlite:brewlite_dev@db:5432/brewlite?schema=public' },
        ports: ['127.0.0.1:3401:3001'], depends_on: { db: { condition: 'service_healthy' } },
      },
      frontend: {
        build: { context: path.join(root, 'frontend'), args: { NEXT_PUBLIC_API_URL: 'http://localhost:3401/api' } },
        ports: ['127.0.0.1:3400:3000'], depends_on: ['backend'],
      },
    },
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}
async function main() {
  const allowed = ['up', 'down', 'seed', 'status', 'sql', 'stop-api', 'start-api'];
  if (!allowed.includes(command)) throw new Error(`Usage: node scripts/qa-stack.cjs ${allowed.join('|')}`);
  if (command === 'up') writeConfig();
  if (!fs.existsSync(configPath)) {
    if (command === 'down') { console.log('No QA stack configured.'); return; }
    throw new Error('Run npm run qa:up first.');
  }
  if (command === 'up') {
    compose(['up', '--build', '-d']); await ready();
    compose(['exec', '-T', 'backend', 'npm', 'run', 'build:seed']);
    compose(['exec', '-T', 'backend', 'npm', 'run', 'seed']);
    console.log('QA ready: http://localhost:3400 (API 3401). Database is disposable; no development data changed.');
  } else if (command === 'down') {
    compose(['down', '--remove-orphans']); fs.unlinkSync(configPath);
  } else if (command === 'seed') {
    compose(['exec', '-T', 'backend', 'npm', 'run', 'build:seed']);
    compose(['exec', '-T', 'backend', 'npm', 'run', 'seed']);
  } else if (command === 'status') compose(['ps', '-a']);
  else if (command === 'sql') compose(['exec', '-T', 'db', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'brewlite', '-d', 'brewlite'], fs.readFileSync(0, 'utf8'));
  else if (command === 'stop-api') compose(['stop', 'backend']);
  else { compose(['start', 'backend']); await ready(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

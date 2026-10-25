// Measure the disposable QA API only. Run `npm run qa:up` first.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const base = 'http://localhost:3401/api';
const root = path.resolve(__dirname, '..');
const samples = new Map();
async function call(method, endpoint, body, token, metric, key) {
  const start = performance.now();
  const response = await fetch(base + endpoint, {
    method, signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${method} ${endpoint}: ${response.status} ${data.code ?? ''}`);
  if (metric) { const values = samples.get(metric) ?? []; values.push(performance.now() - start); samples.set(metric, values); }
  return data;
}
async function main() {
  const email = `benchmark-${randomUUID()}@example.com`, password = 'QaOnlyBenchmark2026!';
  const auth = await call('POST', '/auth/register', { email, password });
  const token = auth.accessToken;
  const page = await call('GET', '/products?page=1&limit=50');
  assert.equal(page.meta.total, 17, 'Use the freshly seeded QA dataset.');
  const product = await call('GET', '/products/11111111-1111-4111-8111-111111111111');
  const topping = product.toppings.find(t => t.name === 'Kem');
  assert(topping);
  const request = { items: [{ productId: product.id, size: 'M', toppingIds: [topping.id], qty: 2 }], promotionCode: 'SAVE10' };
  const quoted = await call('POST', '/orders/quote', request, token);
  assert.equal(quoted.total, 108000, 'Reset disposable QA seed before benchmarking.');
  const order = await call('POST', '/orders', request, token, null, randomUUID());
  const endpoints = [
    ['GET', '/products?page=1&limit=12'], ['GET', `/products/${product.id}`],
    ['GET', '/auth/me'], ['GET', '/orders/me?page=1&limit=10'], ['GET', `/orders/${order.id}`],
    ['GET', '/loyalty/me'], ['GET', '/loyalty/me/entries'],
    ['POST', '/orders/quote', request], ['POST', '/promotions/validate', { code: 'SAVE10', items: request.items }],
  ];
  for (const concurrency of [1, 5]) {
    for (const [method, endpoint, body] of endpoints) {
      await call(method, endpoint, body, token); // Warm-up excluded from measurements.
      const label = `${method} ${endpoint.replace(product.id, ':productId').replace(order.id, ':orderId')} c=${concurrency}`;
      let sent = 0;
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (sent < 50) { sent++; await call(method, endpoint, body, token, label); }
      }));
    }
  }
  await call('POST', `/orders/${order.id}/cancel`, { expectedVersion: order.version }, token);
  for (let i = 0; i < 10; i++) await call('POST', '/auth/login', { email, password }, null, 'POST /auth/login c=1');
  for (let i = 0; i < 20; i++) {
    const created = await call('POST', '/orders', request, token, 'POST /orders c=1', randomUUID());
    const paid = await call('POST', '/payments', { orderId: created.id, method: 'CARD', mockOutcome: 'SUCCESS' }, token, 'POST /payments c=1', randomUUID());
    assert.equal(paid.order.status, 'PAID');
    await call('POST', `/orders/${created.id}/cancel`, { expectedVersion: paid.order.version }, token, 'POST /orders/:id/cancel c=1');
  }
  const metrics = [...samples].map(([endpoint, values]) => {
    values.sort((a, b) => a - b);
    const percentile = p => +values[Math.ceil(values.length * p) - 1].toFixed(2);
    return { endpoint, n: values.length, p50: percentile(.5), p95: percentile(.95), max: percentile(1) };
  });
  const result = {
    measuredAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    environment: { node: process.version, platform: os.platform(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, ramGiB: Math.round(os.totalmem() / 2 ** 30),
      backend: 'NestJS production Docker', database: 'PostgreSQL 17 Docker tmpfs', api: base },
    dataset: '17 products, 51 sizes, 5 toppings, 85 links, 3 promotions; isolated benchmark account/orders',
    method: 'HTTP round trip through body parse; warm-up excluded; 50 samples per read/quote/promo endpoint at c=1 and c=5; login 10, create/pay/cancel 20 each at c=1',
    limits: 'Local small dataset, not a public deployment/load guarantee. Register/STAFF/lock timeouts excluded. Artifacts contain no token/password.',
    metrics, p95Under500ms: metrics.every(row => row.p95 < 500),
  };
  const output = path.join(root, 'docs/qa/final/latency.json'); fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.table(metrics); console.log(`p95 < 500ms for measured endpoints: ${result.p95Under500ms}. Saved ${output}`);
  if (!result.p95Under500ms) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

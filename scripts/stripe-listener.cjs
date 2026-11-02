// Local Test Mode only. Never log the API key, listener output, or webhook signing secret.
const { spawnSync } = require('node:child_process');
const { createHash, createHmac } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let listenerApiKey = '';
const redact = text => String(text).replaceAll(listenerApiKey || '__no_key__', '[redacted]')
  .replace(/(?:whsec|sk_test|sk_live|rk_test|rk_live)_[A-Za-z0-9]+/g, '[redacted]');
function docker(args, env = process.env) {
  const result = spawnSync('docker', args, { cwd: root, env, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(redact(result.stderr || result.error?.message || 'Docker command failed'));
  return result.stdout.trim();
}
async function main() {
  listenerApiKey = docker(['compose', 'exec', '-T', 'backend', 'node', '-e', 'process.stdout.write(process.env.STRIPE_SECRET_KEY || "")']);
  if (!/^(sk_test_|rk_test_)/.test(listenerApiKey)) throw new Error('Listener requires a Stripe Test Mode key; live keys are refused.');
  const env = { ...process.env, STRIPE_LISTENER_API_KEY: listenerApiKey };
  console.log('Starting official Stripe CLI listener in Docker (Test Mode only)...');
  docker(['compose', '--profile', 'stripe-webhook', 'up', '-d', '--no-deps', 'stripe-listener'], env);
  const containerId = docker(['compose', '--profile', 'stripe-webhook', 'ps', '-a', '-q', 'stripe-listener'], env);
  const startedAt = docker(['inspect', '--format', '{{.State.StartedAt}}', containerId]);
  let signingSecret;
  for (let attempt = 0; attempt < 60; attempt++) {
    const logs = docker(['compose', '--profile', 'stripe-webhook', 'logs', '--since', startedAt, '--no-color', '--tail', '100', 'stripe-listener'], env);
    signingSecret = [...logs.matchAll(/whsec_[A-Za-z0-9]+/g)].at(-1)?.[0];
    if (signingSecret) break;
    const id = docker(['compose', '--profile', 'stripe-webhook', 'ps', '-a', '-q', 'stripe-listener'], env);
    if (id && docker(['inspect', '--format', '{{.State.Running}}', id]) !== 'true') {
      throw new Error(`Stripe listener exited: ${redact(logs)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!signingSecret) throw new Error('Stripe listener is not ready. Check Docker connectivity to Stripe and run this command again.');
  const envPath = path.join(root, 'backend', '.env');
  const original = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const assignment = `STRIPE_WEBHOOK_SECRET=${signingSecret}`;
  const updated = /^STRIPE_WEBHOOK_SECRET\s*=/m.test(original)
    ? original.replace(/^STRIPE_WEBHOOK_SECRET\s*=.*$/m, assignment)
    : `${original}${original.endsWith('\n') || !original ? '' : newline}${assignment}${newline}`;
  if (updated !== original) fs.writeFileSync(envPath, updated, 'utf8');
  console.log('Signing secret saved to ignored backend/.env; recreating backend...');
  docker(['compose', 'up', '-d', '--no-deps', '--force-recreate', '--wait', 'backend'], env);
  const actualHash = docker(['compose', 'exec', '-T', 'backend', 'node', '-e',
    'process.stdout.write(require("node:crypto").createHash("sha256").update(process.env.STRIPE_WEBHOOK_SECRET || "").digest("hex"))']);
  if (actualHash !== createHash('sha256').update(signingSecret).digest('hex')) throw new Error('Backend signing secret was not updated.');
  const raw = JSON.stringify({ type: 'brewlite.webhook_probe', data: { object: {} } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', signingSecret).update(`${timestamp}.${raw}`).digest('hex');
  const response = await fetch('http://127.0.0.1:3001/api/payments/stripe/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${signature}` },
    body: raw, signal: AbortSignal.timeout(10000),
  });
  if (response.status !== 200) throw new Error(`Signed local probe failed: HTTP ${response.status}`);
  console.log('Stripe Test listener connected; signed probe HTTP 200. No payment was created.');
  console.log('Keep the listener running. After restarting Docker, run npm run stripe:listen again.');
}
main().catch(error => { console.error(redact(error.message)); process.exitCode = 1; });

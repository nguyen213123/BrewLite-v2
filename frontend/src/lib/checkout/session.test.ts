import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createCheckoutSession, type CheckoutDependencies } from './session.ts';
import type { Order, OrderRequest, PaymentResult } from '../contracts/api.generated';

const request: OrderRequest = { items: [{ productId: 'product', size: 'M', qty: 2 }] };
const purchased = [{ id: 'original-line', key: 'product|M', qty: 2 }];
const pending: Order = { id: 'order', code: 'BL-ORDER', status: 'PENDING', reservationStatus: 'HELD',
  version: 0, subtotal: 120000, discount: 0, total: 120000, currency: 'VND', promotionCode: null,
  createdAt: '', updatedAt: '', items: [] };
function setup() {
  let storage: string | null = null, key = 0, active = true;
  let current = { ...pending };
  const creates: unknown[][] = [], pays: unknown[][] = [], settled: unknown[][] = [];
  const deps: CheckoutDependencies = {
    read: () => storage, write: s => { storage = s; }, key: () => `key-${++key}`, active: () => active,
    quote: async () => ({ ...pending, items: [] }),
    create: async (...args) => { creates.push(args); return pending; },
    pay: async (...args) => { pays.push(args); return {} as PaymentResult; },
    find: async () => current, settle: (...args) => { settled.push(args); },
  };
  return { deps, creates, pays, settled, make: () => createCheckoutSession('user', deps),
    status: (status: Order['status']) => { current = { ...current, status }; },
    logout: () => { active = false; }, login: () => { active = true; } };
}
it('keeps an unresolved committed create through timeout, 401, reload and re-login', async () => {
  const h = setup();
  const committed = new Map<string, Order>();
  let calls = 0;
  h.deps.create = async (key, body) => {
    h.creates.push([key, body]);
    if (++calls === 1) {
      committed.set(key, pending);
      throw new Error('Order committed but the response timed out');
    }
    if (calls === 2) {
      h.logout();
      throw Object.assign(new Error('Expired JWT'), { statusCode: 401, code: 'UNAUTHORIZED' });
    }
    return committed.get(key)!;
  };
  const first = h.make();
  await assert.rejects(first.create(request, purchased));
  await assert.rejects(first.create(request, purchased));
  h.login();
  const restored = h.make();
  assert.equal(restored.snapshot().createUncertain, true);
  assert.throws(() => restored.startOver());
  await restored.create({ items: [{ productId: 'different-cart', size: 'S', qty: 1 }] }, []);
  assert.deepEqual(h.creates[0], h.creates[1]);
  assert.deepEqual(h.creates[0], h.creates[2]);
  assert.equal(restored.snapshot().orderId, pending.id);
  assert.deepEqual(restored.snapshot().purchased, purchased);
  assert.equal(committed.size, 1);
});
it('does not reinterpret later 4xx as proof that an earlier timed-out create rolled back', async () => {
  for (const statusCode of [400, 401, 403, 404, 408, 409, 422, 429]) {
    const h = setup();
    h.deps.create = async () => { throw new Error('Unknown create result'); };
    await assert.rejects(h.make().create(request, purchased));
    h.deps.create = async () => { throw Object.assign(new Error('Retry rejected'), { statusCode, code: 'HTTP_ERROR' }); };
    const restored = h.make();
    await assert.rejects(restored.create(request, purchased));
    assert.equal(h.make().snapshot().createUncertain, true, `status ${statusCode}`);
    assert.throws(() => h.make().startOver());
  }
});
it('a definitely rejected first create can be corrected without blocking checkout forever', async () => {
  for (const [statusCode, code] of [[400, 'VALIDATION_ERROR'], [401, 'UNAUTHORIZED'], [409, 'OUT_OF_STOCK']] as const) {
    const h = setup();
    h.deps.create = async () => { throw Object.assign(new Error('Initial request rejected'), { statusCode, code }); };
    await assert.rejects(h.make().create(request, purchased));
    const restored = h.make();
    assert.equal(restored.snapshot().createUncertain, false);
    assert.doesNotThrow(() => restored.startOver());
  }
});
it('create timeout + reload retries the original key, payload and cart snapshot', async () => {
  const h = setup();
  h.deps.create = async (...args) => { h.creates.push(args); throw new Error('timeout'); };
  const first = h.make(); await assert.rejects(first.create(request, purchased));
  const restored = h.make();
  h.deps.create = async (...args) => { h.creates.push(args); return pending; };
  await restored.create({ items: [{ productId: 'other', size: 'S', qty: 1 }] }, []);
  assert.deepEqual(h.creates[0], h.creates[1]);
  assert.deepEqual(restored.snapshot().purchased, purchased);
});
it('payment timeout keeps the same key, method and outcome even if controls change', async () => {
  const h = setup(), session = h.make(); await session.create(request, purchased);
  h.deps.pay = async (...args) => { h.pays.push(args); throw new Error('timeout'); };
  await assert.rejects(session.pay('WALLET', 'SUCCESS'));
  await assert.rejects(session.pay('CARD', 'FAIL'), /xác minh/);
  const restored = h.make(); await restored.verify();
  await assert.rejects(restored.pay('CARD', 'FAIL'));
  assert.deepEqual(h.pays[0], h.pays[1]); assert.equal(h.settled.length, 0);
});
it('a successful POST with failed fresh GET does not clear the cart', async () => {
  const h = setup(), session = h.make(); await session.create(request, purchased);
  h.deps.find = async () => { throw new Error('GET timeout'); };
  await assert.rejects(session.pay('WALLET', 'SUCCESS'));
  assert.equal(h.settled.length, 0); assert.equal(session.snapshot().verified, false);
});
it('replayed paid snapshot cannot clear cart after the current order was cancelled', async () => {
  const h = setup(), session = h.make(); await session.create(request, purchased);
  h.status('CANCELLED'); await session.pay('WALLET', 'SUCCESS');
  assert.equal(session.snapshot().order?.status, 'CANCELLED'); assert.equal(h.settled.length, 0);
});
it('verified failed attempt can retry on the same order with a new key', async () => {
  const h = setup(), session = h.make(); await session.create(request, purchased);
  h.status('PAYMENT_FAILED'); await session.pay('WALLET', 'FAIL');
  assert.equal(h.settled.length, 0);
  h.status('PAID'); await session.pay('CARD', 'SUCCESS', true);
  assert.notEqual(h.pays[0][0], h.pays[1][0]);
  assert.equal(h.settled.length, 1); assert.deepEqual(h.settled[0], ['order', purchased]);
});
it('logout during a request suppresses late cart side effects', async () => {
  const h = setup(), session = h.make(); await session.create(request, purchased);
  h.deps.pay = async () => { h.logout(); h.status('PAID'); return {} as PaymentResult; };
  await assert.rejects(session.pay('CARD', 'SUCCESS'));
  assert.equal(h.settled.length, 0);
});
it('double click sends one POST and cannot abandon an uncertain create', async () => {
  const h = setup(), session = h.make();
  let finish!: (value: Order) => void;
  h.deps.create = (...args) => { h.creates.push(args); return new Promise(resolve => { finish = resolve; }); };
  const first = session.create(request, purchased);
  await assert.rejects(session.create(request, purchased), /đang xử lý/);
  assert.throws(() => session.startOver());
  finish(pending); await first; assert.equal(h.creates.length, 1);
});
it('resumes an existing order from history without clearing unrelated cart items', async () => {
  const h = setup(), session = h.make(); await session.resume(pending.id);
  h.status('PAID'); await session.pay('CARD', 'SUCCESS');
  assert.equal(h.creates.length, 0);
  assert.deepEqual(h.settled, [['order', []]]);
  assert.equal(session.snapshot().order?.status, 'PAID');
});
it('cannot replace an open order with another historical order', async () => {
  const h = setup(), session = h.make(); await session.create(request, purchased);
  await assert.rejects(session.resume('another-order'), /hoàn tất hoặc hủy/);
  assert.equal(session.snapshot().orderId, pending.id);
});
it('a foreign or missing historical order does not replace the current intent', async () => {
  const h = setup(), session = h.make();
  h.deps.find = async () => { throw new Error('ORDER_NOT_FOUND'); };
  await assert.rejects(session.resume('foreign-order'));
  assert.equal(session.snapshot().orderId, undefined);
});

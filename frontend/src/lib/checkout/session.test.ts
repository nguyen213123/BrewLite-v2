import assert from 'node:assert/strict';
import { it } from 'node:test';
// @ts-expect-error TS5097: Node native TypeScript test resolution
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
    logout: () => { active = false; } };
}
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

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
it('[P1] FAIL -> retry SUCCESS but timeout -> verify: confirms PAID or PAYMENT_FAILED or keeps cart on error', async () => {
  const h = setup(), session = h.make(); await session.create(request, purchased);
  // 1. FAIL
  h.status('PAYMENT_FAILED'); await session.pay('WALLET', 'FAIL');
  assert.equal(session.snapshot().verified, true);
  assert.equal(session.snapshot().order?.status, 'PAYMENT_FAILED');
  assert.equal(h.settled.length, 0);

  // 2. retry SUCCESS nhưng timeout
  h.deps.pay = async () => { throw new Error('GATEWAY_TIMEOUT'); };
  await assert.rejects(session.pay('CARD', 'SUCCESS', true), /GATEWAY_TIMEOUT/);
  // Khi chưa xác minh, session có verified = false, lưu attempt mới, chặn gọi pay() mới
  assert.equal(session.snapshot().verified, false);
  assert.equal(session.snapshot().order?.status, 'PAYMENT_FAILED');
  assert.equal(session.snapshot().attempt?.request.method, 'CARD');
  assert.equal(session.snapshot().attempt?.request.mockOutcome, 'SUCCESS');
  await assert.rejects(session.pay('CARD', 'SUCCESS', true), /xác minh trạng thái đơn/);

  // 3. Nếu GET lỗi khi xác minh thì tiếp tục cho xác minh, giữ giỏ hàng
  h.deps.find = async () => { throw new Error('GET_ERROR'); };
  await assert.rejects(session.verify(), /GET_ERROR/);
  assert.equal(session.snapshot().verified, false);
  assert.equal(h.settled.length, 0);

  // 4. Nếu GET trả PAID thì hiện thành công và trừ giỏ hàng
  h.deps.find = async (id: string) => {
    return { ...pending, id, status: 'PAID', reservationStatus: 'CONSUMED' };
  };
  const fresh = await session.verify();
  assert.equal(fresh?.status, 'PAID');
  assert.equal(session.snapshot().verified, true);
  assert.equal(session.snapshot().order?.status, 'PAID');
  assert.equal(h.settled.length, 1);
});
it('[P1] FAIL -> retry timeout -> verify confirms PAYMENT_FAILED allows retry with new key', async () => {
  const h = setup(), session = h.make(); await session.create(request, purchased);
  h.status('PAYMENT_FAILED'); await session.pay('WALLET', 'FAIL');

  // Retry timeout
  h.deps.pay = async () => { throw new Error('TIMEOUT'); };
  await assert.rejects(session.pay('CARD', 'SUCCESS', true), /TIMEOUT/);
  assert.equal(session.snapshot().verified, false);

  // Verify xác nhận PAYMENT_FAILED
  h.status('PAYMENT_FAILED');
  await session.verify();
  assert.equal(session.snapshot().verified, true);
  assert.equal(session.snapshot().order?.status, 'PAYMENT_FAILED');

  // Cho thử lại bằng khóa mới
  h.status('PAID');
  h.deps.pay = async (key, req) => { h.pays.push([key, req]); return { payment: {} as never, order: { ...pending, status: 'PAID' }, loyaltyPointsEarned: 0 }; };
  await session.pay('WALLET', 'SUCCESS', true);
  assert.equal(session.snapshot().verified, true);
  assert.equal(session.snapshot().order?.status, 'PAID');
  assert.equal(h.settled.length, 1);
});
it('[Issue 1] restores CANCELLED order: GET error keeps session and allows verify; recovered GET confirms CANCELLED and allows startOver', async () => {
  const h = setup(), session = h.make();
  await session.create(request, purchased);
  h.status('CANCELLED');
  await session.verify();
  assert.equal(session.snapshot().verified, true);
  assert.equal(session.snapshot().order?.status, 'CANCELLED');

  // Khởi tạo lại session từ storage (như khi mở lại checkout / reload)
  const reloaded = h.make();
  assert.equal(reloaded.snapshot().verified, false);
  assert.equal(reloaded.snapshot().order?.status, 'CANCELLED');
  // Khi chưa xác minh, không cho bắt đầu đơn mới
  assert.throws(() => reloaded.startOver(), /Cần xác minh hoặc hủy đơn/);

  // GET xác minh gặp lỗi mạng
  h.deps.find = async () => { throw new Error('NETWORK_TIMEOUT'); };
  await assert.rejects(reloaded.verify(), /NETWORK_TIMEOUT/);
  // Giữ session và verified vẫn là false
  assert.equal(reloaded.snapshot().verified, false);
  assert.equal(reloaded.snapshot().orderId, pending.id);
  assert.equal(reloaded.snapshot().order?.status, 'CANCELLED');
  assert.throws(() => reloaded.startOver(), /Cần xác minh hoặc hủy đơn/);

  // Mạng phục hồi, GET trả CANCELLED
  h.deps.find = async (id: string) => ({ ...pending, id, status: 'CANCELLED', reservationStatus: 'RELEASED' });
  const fresh = await reloaded.verify();
  assert.equal(fresh?.status, 'CANCELLED');
  assert.equal(reloaded.snapshot().verified, true);
  assert.equal(reloaded.snapshot().order?.status, 'CANCELLED');

  // Bắt đầu đơn mới thành công
  reloaded.startOver();
  assert.equal(reloaded.snapshot().orderId, undefined);
  assert.equal(reloaded.snapshot().order, undefined);
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
it('requires explicit confirmation before paying when the created total differs from the quote', async () => {
  const h = setup(), session = h.make();
  await session.create(request, purchased, 100000); // quote 100.000đ nhưng đơn thật 120.000đ
  assert.equal(session.needsPriceConfirmation(), true);
  await assert.rejects(session.pay('WALLET', 'SUCCESS'), /xác nhận tổng mới/);
  assert.equal(h.pays.length, 0);
  session.acknowledgePrice();
  assert.equal(session.needsPriceConfirmation(), false);
  h.status('PAID'); await session.pay('WALLET', 'SUCCESS');
  assert.equal(h.pays.length, 1); assert.equal(h.settled.length, 1);
});
it('does not ask for confirmation when the order total equals the quote', async () => {
  const h = setup(), session = h.make();
  await session.create(request, purchased, pending.total);
  assert.equal(session.needsPriceConfirmation(), false);
  await session.pay('WALLET', 'SUCCESS'); assert.equal(h.pays.length, 1);
});
it('keeps the price confirmation after reload and replay uses the same order', async () => {
  const h = setup(); const first = h.make();
  await first.create(request, purchased, 90000);
  const reloaded = h.make(); await reloaded.verify();
  assert.equal(reloaded.snapshot().quotedTotal, 90000);
  assert.equal(reloaded.needsPriceConfirmation(), true);
  await assert.rejects(reloaded.pay('CARD', 'SUCCESS'));
  reloaded.acknowledgePrice();
  assert.equal(h.make().needsPriceConfirmation(), false); // xác nhận cũng được lưu qua reload
  assert.equal(h.creates.length, 1);
});
it('cannot acknowledge a price before the order state is verified', async () => {
  const h = setup(), session = h.make();
  assert.throws(() => session.acknowledgePrice());
  h.deps.find = async () => { throw new Error('GET timeout'); };
  await assert.rejects(session.create(request, purchased, 90000));
  assert.throws(() => session.acknowledgePrice(), /xác minh/);
});
it('API 501 on create never fabricates an order and keeps the cart', async () => {
  const h = setup(), session = h.make();
  h.deps.create = async () => { throw Object.assign(new Error('Chưa triển khai'), { statusCode: 501, code: 'FEATURE_NOT_IMPLEMENTED' }); };
  await assert.rejects(session.create(request, purchased, 120000), /Chưa triển khai/);
  const s = session.snapshot();
  assert.equal(s.orderId, undefined); assert.equal(s.order, undefined); assert.equal(h.settled.length, 0);
});
it('API 501 on payment never reports PAID or clears the cart, even for a SUCCESS scenario', async () => {
  const h = setup(), session = h.make(); await session.create(request, purchased, 120000);
  h.deps.pay = async () => { throw Object.assign(new Error('Chưa triển khai'), { statusCode: 501, code: 'FEATURE_NOT_IMPLEMENTED' }); };
  await assert.rejects(session.pay('WALLET', 'SUCCESS'));
  assert.equal(session.snapshot().order?.status, 'PENDING'); assert.equal(h.settled.length, 0);
});
it('going back after a price change cannot skip confirmation, even from a fresh session instance', async () => {
  const h = setup(); await h.make().create(request, purchased, 90000); // quote 90.000đ, đơn 120.000đ
  const afterBack = h.make(); await afterBack.verify();
  await assert.rejects(afterBack.pay('WALLET', 'SUCCESS'), /xác nhận tổng mới/);
  assert.equal(h.pays.length, 0);
});

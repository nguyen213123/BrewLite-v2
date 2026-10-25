import assert from 'node:assert/strict';
import { it } from 'node:test';
import { describeCheckoutError, comparePrice } from './errors.ts';

const api = (statusCode: number, code: string, message = 'server') => Object.assign(new Error(message), { statusCode, code });

it('maps stock, selection, promotion and order errors to actionable messages', () => {
  assert.equal(describeCheckoutError(api(409, 'OUT_OF_STOCK')).kind, 'stock');
  assert.equal(describeCheckoutError(api(409, 'STOCK_CONFLICT')).kind, 'stock');
  assert.equal(describeCheckoutError(api(422, 'INVALID_SELECTION')).kind, 'selection');
  assert.equal(describeCheckoutError(api(404, 'PRODUCT_NOT_FOUND')).kind, 'selection');
  assert.equal(describeCheckoutError(api(422, 'PROMOTION_INVALID')).kind, 'promotion');
  assert.equal(describeCheckoutError(api(409, 'PROMOTION_EXHAUSTED')).kind, 'promotion');
  assert.equal(describeCheckoutError(api(409, 'ORDER_NOT_PAYABLE')).kind, 'order');
  assert.equal(describeCheckoutError(api(401, 'UNAUTHORIZED')).kind, 'auth');
  assert.match(describeCheckoutError(api(409, 'OUT_OF_STOCK')).message, /hết hàng/);
  assert.equal(describeCheckoutError(api(409, 'OUT_OF_STOCK')).uncertain, false);
});
it('treats network failures and timeouts as uncertain, never as success', () => {
  for (const name of ['TypeError', 'AbortError', 'TimeoutError']) {
    const info = describeCheckoutError(Object.assign(new Error('boom'), { name }));
    assert.equal(info.kind, 'network'); assert.equal(info.uncertain, true);
    assert.match(info.message, /chưa xác nhận/);
  }
});
it('keeps client-side guidance messages and falls back for unknown input', () => {
  assert.equal(describeCheckoutError(new Error('Hãy xác minh trạng thái đơn trước khi thanh toán.')).message, 'Hãy xác minh trạng thái đơn trước khi thanh toán.');
  assert.equal(describeCheckoutError(undefined).kind, 'unknown');
  assert.equal(describeCheckoutError(api(500, 'INTERNAL')).uncertain, true);
});
it('compares quoted total with the created order total', () => {
  assert.deepEqual(comparePrice(undefined, 100000), { changed: false, orderTotal: 100000, difference: 0 });
  assert.equal(comparePrice(108000, 108000).changed, false);
  const diff = comparePrice(108000, 120000);
  assert.equal(diff.changed, true); assert.equal(diff.difference, 12000);
});

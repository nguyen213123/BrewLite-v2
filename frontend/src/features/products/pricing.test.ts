import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProductDetail } from '@/lib/contracts/api.generated';
import {
  priceSelection,
  toAddItemInput,
  validateSelection,
} from './pricing.ts';

const kem = { id: '22222222-2222-4222-8222-222222222222', name: 'Kem', price: 10000 };
const tranChau = { id: '22222222-2222-4222-8222-222222222223', name: 'Trân châu', price: 8000 };

const cappuccino: ProductDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Cappuccino',
  description: 'Cà phê espresso và sữa',
  price: 45000,
  imageUrl: 'http://localhost:3000/images/cappuccino.jpg',
  stock: 200,
  sizes: [
    { size: 'S', price: 45000 },
    { size: 'M', price: 50000 },
    { size: 'L', price: 55000 },
  ],
  toppings: [kem, tranChau],
};

describe('Issue #3 — giá tạm tính theo cấu hình', () => {
  it('Cappuccino M + Kem x2 = 60.000/ly, 120.000 tổng', () => {
    assert.deepEqual(priceSelection(cappuccino, { size: 'M', toppingIds: [kem.id], qty: 2 }), { unitPrice: 60000, lineTotal: 120000 });
  });
  it('đổi size S → M → L đổi giá đúng', () => {
    const unit = (size: 'S' | 'M' | 'L') => priceSelection(cappuccino, { size, toppingIds: [], qty: 1 })?.unitPrice;
    assert.deepEqual([unit('S'), unit('M'), unit('L')], [45000, 50000, 55000]);
  });
  it('thêm và bỏ topping cập nhật giá đúng', () => {
    const price = (toppingIds: string[]) => priceSelection(cappuccino, { size: 'S', toppingIds, qty: 1 })?.unitPrice;
    assert.equal(price([]), 45000);
    assert.equal(price([kem.id]), 55000);
    assert.equal(price([kem.id, tranChau.id]), 63000);
  });
  it('không có size thì không tính được giá', () => {
    const noSize = { ...cappuccino, sizes: [] };
    assert.equal(priceSelection(noSize, { size: null, toppingIds: [], qty: 1 }), null);
    assert.equal(validateSelection(noSize, { size: null, toppingIds: [], qty: 1 }), 'Vui lòng chọn kích cỡ');
  });
});

describe('Issue #3 — validate cấu hình trước khi thêm vào giỏ', () => {
  const ok = { size: 'M' as const, toppingIds: [kem.id], qty: 1 };
  it('cấu hình hợp lệ trả null', () => {
    assert.equal(validateSelection(cappuccino, ok), null);
  });
  it('hết hàng bị chặn', () => {
    assert.equal(validateSelection({ ...cappuccino, stock: 0 }, ok), 'Sản phẩm đã hết hàng');
  });
  it('topping không thuộc món hoặc bị trùng id bị chặn', () => {
    assert.match(validateSelection(cappuccino, { ...ok, toppingIds: ['khong-co'] }) ?? '', /Topping/);
    assert.match(validateSelection(cappuccino, { ...ok, toppingIds: [kem.id, kem.id] }) ?? '', /Topping/);
  });
  it('qty 0, 100, thập phân hoặc vượt tồn kho bị chặn; qty 99 hợp lệ', () => {
    for (const qty of [0, 100, 2.5, -1]) assert.notEqual(validateSelection(cappuccino, { ...ok, qty }), null);
    assert.notEqual(validateSelection({ ...cappuccino, stock: 5 }, { ...ok, qty: 6 }), null);
    assert.equal(validateSelection(cappuccino, { ...ok, qty: 99 }), null);
  });
});

describe('Issue #3 — dữ liệu đưa vào cart store', () => {
  it('giữ productId, size, sizePrice, topping đã chọn và số lượng; cấu hình khác nhau cho dữ liệu khác nhau', () => {
    const a = toAddItemInput(cappuccino, { size: 'M', toppingIds: [kem.id], qty: 2 });
    assert.deepEqual(a, {
      productId: cappuccino.id,
      productName: 'Cappuccino',
      imageUrl: cappuccino.imageUrl,
      size: 'M',
      sizePrice: 50000,
      toppings: [kem],
      qty: 2,
    });
    const b = toAddItemInput(cappuccino, { size: 'L', toppingIds: [kem.id, tranChau.id], qty: 1 });
    assert.equal(b?.size, 'L');
    assert.equal(b?.sizePrice, 55000);
    assert.equal(b?.toppings.length, 2);
  });
  it('cấu hình không hợp lệ không tạo được dữ liệu', () => {
    assert.equal(toAddItemInput(cappuccino, { size: 'M', toppingIds: [], qty: 0 }), null);
  });
});
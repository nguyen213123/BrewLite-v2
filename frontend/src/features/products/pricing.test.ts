import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProductDetail } from '@/lib/contracts/api.generated';
import {
  maxQtyFor,
  priceSelection,
  toAddItemInput,
  validateSelection,
} from './pricing.ts';

const kem = { id: '22222222-2222-4222-8222-222222222222', name: 'Kem', price: 10000, stock: 33 };
const tranChau = { id: '22222222-2222-4222-8222-222222222223', name: 'Trân châu', price: 8000, stock: 20 };

const cappuccino: ProductDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Cappuccino',
  description: 'Cà phê espresso và sữa',
  price: 45000,
  imageUrl: 'http://localhost:3000/images/cappuccino.jpg',
  stock: 200,
  sizes: [
    { size: 'S', price: 45000, stock: 20 },
    { size: 'M', price: 50000, stock: 16 },
    { size: 'L', price: 55000, stock: 13 },
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
  it('qty 0, 100, thập phân hoặc vượt tồn kho bị chặn; qty 99 hợp lệ khi còn đủ hàng', () => {
    for (const qty of [0, 100, 2.5, -1]) assert.notEqual(validateSelection(cappuccino, { ...ok, qty }), null);
    assert.notEqual(validateSelection(cappuccino, { ...ok, qty: 17 }), null);
    assert.notEqual(
      validateSelection(
        { ...cappuccino, sizes: cappuccino.sizes.map((s) => ({ ...s, stock: 5 })) },
        { ...ok, qty: 6 },
      ),
      null,
    );
    const doiDao: ProductDetail = {
      ...cappuccino,
      sizes: cappuccino.sizes.map((s) => ({ ...s, stock: 100 })),
      toppings: cappuccino.toppings.map((t) => ({ ...t, stock: 100 })),
    };
    assert.equal(validateSelection(doiDao, { ...ok, qty: 99 }), null);
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
      toppings: [{ id: kem.id, name: kem.name, price: kem.price }],
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

describe('Task 7 — tồn kho theo size, topping và giới hạn số lượng', () => {
  it('size L có stock 0 dù size S còn hàng -> validateSelection trả về "Size này đã hết"', () => {
    const product: ProductDetail = {
      ...cappuccino,
      stock: 20,
      sizes: [
        { size: 'S', price: 45000, stock: 20 },
        { size: 'M', price: 50000, stock: 16 },
        { size: 'L', price: 55000, stock: 0 },
      ],
    };
    assert.equal(
      validateSelection(product, { size: 'L', toppingIds: [], qty: 1 }),
      'Size này đã hết',
    );
    assert.equal(
      validateSelection(product, { size: 'S', toppingIds: [], qty: 1 }),
      null,
    );
  });

  it('topping đã chọn có stock 0 -> validateSelection trả về "Topping <tên> đã hết"', () => {
    const toppingHet = { id: '22222222-2222-4222-8222-222222222224', name: 'Thạch cà phê', price: 10000, stock: 0 };
    const product: ProductDetail = {
      ...cappuccino,
      toppings: [...cappuccino.toppings, toppingHet],
    };
    assert.equal(
      validateSelection(product, { size: 'S', toppingIds: [toppingHet.id], qty: 1 }),
      'Topping Thạch cà phê đã hết',
    );
  });

  it('maxQtyFor trả về min(99, size stock, toppings stock)', () => {
    const toppingA = { id: 'top-a', name: 'A', price: 5000, stock: 25 };
    const toppingB = { id: 'top-b', name: 'B', price: 5000, stock: 8 };
    const product: ProductDetail = {
      ...cappuccino,
      stock: 50,
      sizes: [
        { size: 'S', price: 45000, stock: 20 },
        { size: 'M', price: 50000, stock: 15 },
        { size: 'L', price: 55000, stock: 120 },
      ],
      toppings: [toppingA, toppingB],
    };

    assert.equal(maxQtyFor(product, 'S', []), 20);
    assert.equal(maxQtyFor(product, 'M', []), 15);
    assert.equal(maxQtyFor(product, 'L', []), 99);

    assert.equal(maxQtyFor(product, 'S', [toppingA.id]), 20);
    assert.equal(maxQtyFor(product, 'S', [toppingB.id]), 8);
    assert.equal(maxQtyFor(product, 'S', [toppingA.id, toppingB.id]), 8);

    assert.equal(maxQtyFor(product, null, []), 50);

    const outOfStockSize: ProductDetail = {
      ...product,
      sizes: [{ size: 'S', price: 45000, stock: 0 }],
    };
    assert.equal(maxQtyFor(outOfStockSize, 'S', []), 0);

    const outOfStockTop = { id: 'top-c', name: 'C', price: 5000, stock: 0 };
    const productWithZeroTop: ProductDetail = {
      ...product,
      toppings: [outOfStockTop],
    };
    assert.equal(maxQtyFor(productWithZeroTop, 'S', [outOfStockTop.id]), 0);
  });
});

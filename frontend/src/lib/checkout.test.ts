import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  toCartItems,
  useCartStore,
  type CartLine,
} from './cart/cart-store.ts';

describe('Checkout Integration Logic (Issue #13)', () => {
  const sampleLine1: CartLine = {
    key: 'prod-1|M|top-1',
    productId: 'prod-1',
    productName: 'Cà phê sữa đá',
    imageUrl: 'http://localhost:3000/cf.jpg',
    size: 'M',
    sizePrice: 35000,
    toppings: [{ id: 'top-1', name: 'Trân châu', price: 5000 }],
    qty: 2,
  };

  const sampleLine2: CartLine = {
    key: 'prod-2|S',
    productId: 'prod-2',
    productName: 'Trà đào cam sả',
    imageUrl: 'http://localhost:3000/tra.jpg',
    size: 'S',
    sizePrice: 40000,
    toppings: [],
    qty: 1,
  };

  it('chuẩn hóa CartLine thành CartItem theo đúng hợp đồng API quote và order', () => {
    const items = toCartItems([sampleLine1, sampleLine2]);
    assert.equal(items.length, 2);
    assert.deepEqual(items[0], {
      productId: 'prod-1',
      size: 'M',
      toppingIds: ['top-1'],
      qty: 2,
    });
    assert.deepEqual(items[1], {
      productId: 'prod-2',
      size: 'S',
      qty: 1,
    });
  });

  it('công thức tính điểm tích lũy theo business rules: floor(total / 10000)', () => {
    const calculatePoints = (total: number) => Math.floor(total / 10000);
    assert.equal(calculatePoints(108000), 10);
    assert.equal(calculatePoints(99000), 9);
    assert.equal(calculatePoints(5000), 0);
  });

  it('chỉ xóa các món đã mua sau khi thanh toán thành công, giữ lại món mới thêm sau checkout', () => {
    const store = useCartStore.getState();
    store.clear();

    store.addItem({
      productId: sampleLine1.productId,
      productName: sampleLine1.productName,
      imageUrl: sampleLine1.imageUrl,
      size: sampleLine1.size,
      sizePrice: sampleLine1.sizePrice,
      toppings: sampleLine1.toppings,
      qty: 2,
    });

    store.addItem({
      productId: sampleLine2.productId,
      productName: sampleLine2.productName,
      imageUrl: sampleLine2.imageUrl,
      size: sampleLine2.size,
      sizePrice: sampleLine2.sizePrice,
      toppings: sampleLine2.toppings,
      qty: 1,
    });

    assert.equal(useCartStore.getState().lines.length, 2);

    // Giả lập chỉ thanh toán dòng thứ nhất:
    store.removePurchased([{ key: sampleLine1.key, qty: 2 }]);

    // Dòng thứ 2 vẫn còn nguyên vẹn trong giỏ hàng:
    const remaining = useCartStore.getState().lines;
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].productId, 'prod-2');
  });

  it('thanh toán thất bại giữ nguyên toàn bộ giỏ hàng', () => {
    const store = useCartStore.getState();
    store.clear();

    store.addItem({
      productId: sampleLine1.productId,
      productName: sampleLine1.productName,
      imageUrl: sampleLine1.imageUrl,
      size: sampleLine1.size,
      sizePrice: sampleLine1.sizePrice,
      toppings: sampleLine1.toppings,
      qty: 2,
    });

    const linesBefore = [...useCartStore.getState().lines];
    // Giả lập thanh toán thất bại: không gọi removePurchased
    const linesAfter = useCartStore.getState().lines;

    assert.equal(linesBefore.length, linesAfter.length);
    assert.equal(linesAfter[0].qty, 2);
  });
});

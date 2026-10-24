import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  MAX_QTY,
  lineKey,
  lineTotal,
  lineUnitPrice,
  toCartItems,
  totalQty,
  useCartStore,
  type AddItemInput,
  type PurchasedLine,
} from './cart-store.ts';

describe('Cart Store - Issue 5', () => {
  const sampleProduct: AddItemInput = {
    productId: 'prod-tra-sua',
    productName: 'Trà sữa Trân châu Đường đen',
    imageUrl: 'http://localhost:3000/ts.jpg',
    size: 'M',
    sizePrice: 35000,
    toppings: [{ id: 'top-tc', name: 'Trân châu đen', price: 5000 }],
  };

  const sampleCoffee: AddItemInput = {
    productId: 'prod-cf-sua',
    productName: 'Cà phê sữa đá',
    imageUrl: 'http://localhost:3000/cf.jpg',
    size: 'S',
    sizePrice: 29000,
    toppings: [],
  };

  const store = () => useCartStore.getState();
  const getLines = () => useCartStore.getState().lines;

  /** Giả lập snapshot cũ chỉ có { key, qty } (thiếu id). */
  const legacySnapshot = () =>
    store()
      .getSnapshot()
      .map(({ key, qty }) => ({ key, qty })) as unknown as PurchasedLine[];

  beforeEach(() => {
    store().clear();
  });

  describe('Giới hạn MAX_QTY (99) và cờ capped', () => {
    it('thêm dòng mới vượt giới hạn (qty: 150) trên giỏ rỗng: store lưu 99 ly, trả capped: true và có thông báo', () => {
      const res = store().addItem({ ...sampleProduct, qty: 150 });

      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.capped, true, 'Phải trả về capped: true khi số lượng thêm mới vượt 99');
        assert.ok(res.message, 'Cần có thông báo phản ánh việc đã giới hạn số lượng');
        assert.match(res.message, /99/);
      }

      const lines = getLines();
      assert.equal(lines.length, 1);
      assert.equal(lines[0].qty, MAX_QTY);
    });

    it('thêm dòng mới với số lượng hợp lệ (qty: 2): trả capped: false, store lưu đúng 2 ly', () => {
      const res = store().addItem({ ...sampleProduct, qty: 2 });

      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.capped, false);
      }
      assert.equal(getLines().length, 1);
      assert.equal(getLines()[0].qty, 2);
    });

    it('gộp vào dòng đã có vượt giới hạn (60 + 50): trả capped: true, store lưu 99 ly', () => {
      store().addItem({ ...sampleProduct, qty: 60 });

      const res = store().addItem({ ...sampleProduct, qty: 50 });
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.capped, true);
        assert.ok(res.message);
      }
      assert.equal(getLines().length, 1);
      assert.equal(getLines()[0].qty, MAX_QTY);
    });

    it('gộp vào dòng đã có với số lượng hợp lệ (10 + 5): trả capped: false, store lưu 15 ly', () => {
      store().addItem({ ...sampleProduct, qty: 10 });

      const res = store().addItem({ ...sampleProduct, qty: 5 });
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.capped, false);
      }
      assert.equal(getLines()[0].qty, 15);
    });

    it('gộp vào dòng đã đạt 99 ly: trả capped: true, store vẫn giữ 99 ly', () => {
      store().addItem({ ...sampleProduct, qty: 99 });

      const res = store().addItem({ ...sampleProduct, qty: 1 });
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.capped, true);
      }
      assert.equal(getLines()[0].qty, MAX_QTY);
    });

    it('từ chối số lượng không hợp lệ khi thêm (âm, 0, thập phân, NaN, Infinity)', () => {
      const resNegative = store().addItem({ ...sampleProduct, qty: -5 });
      assert.equal(resNegative.ok, false);
      if (!resNegative.ok) {
        assert.equal(resNegative.reason, 'INVALID');
      }

      for (const qty of [0, 2.5, NaN, Infinity]) {
        assert.equal(store().addItem({ ...sampleProduct, qty }).ok, false, `qty ${qty} phải bị từ chối`);
      }
      assert.equal(getLines().length, 0);
    });
  });

  describe('setQty: chỉ nhận số nguyên dương trong giới hạn', () => {
    it('cập nhật số lượng hợp lệ theo id hoặc key', () => {
      store().addItem({ ...sampleProduct, qty: 5 });
      const line = getLines()[0];

      store().setQty(line.id, 20);
      assert.equal(getLines()[0].qty, 20);

      store().setQty(line.key, 7);
      assert.equal(getLines()[0].qty, 7);
    });

    it('từ chối qty > MAX_QTY thay vì cắt âm thầm, giữ nguyên số lượng cũ', () => {
      store().addItem({ ...sampleProduct, qty: 5 });
      const key = getLines()[0].key;

      assert.throws(() => store().setQty(key, MAX_QTY + 1));
      assert.throws(() => store().setQty(key, 150));
      assert.equal(getLines()[0].qty, 5);
    });

    for (const qty of [0, -1, 1.5, NaN, Infinity]) {
      it(`từ chối qty không hợp lệ: ${qty}`, () => {
        store().addItem({ ...sampleProduct, qty: 3 });
        assert.throws(() => store().setQty(getLines()[0].key, qty));
        assert.equal(getLines()[0].qty, 3);
      });
    }
  });

  describe('removePurchased: snapshot bắt buộc có id', () => {
    it('xóa rồi thêm lại: snapshot có id không trừ nhầm ly mới', () => {
      store().addItem({ ...sampleProduct, qty: 2 });
      const linesBefore = getLines();

      const checkoutSnapshot = store().getSnapshot();
      assert.equal(checkoutSnapshot.length, 1);
      assert.equal(checkoutSnapshot[0].qty, 2);
      assert.ok(checkoutSnapshot[0].id, 'Snapshot phải chứa định danh phiên bản dòng (id)');

      store().removeItem(linesBefore[0].key);
      assert.equal(getLines().length, 0);

      store().addItem({ ...sampleProduct, qty: 1 });
      const linesReadded = getLines();
      assert.equal(linesReadded.length, 1);
      assert.notEqual(
        linesReadded[0].id,
        checkoutSnapshot[0].id,
        'Dòng mới tạo lại phải có id mới, khác với dòng đã đưa vào snapshot',
      );

      assert.deepEqual(store().removePurchased(checkoutSnapshot), { applied: 0, skipped: 1 });

      const linesAfter = getLines();
      assert.equal(linesAfter.length, 1, 'Ly mới thêm sau không được phép bị xóa');
      assert.equal(linesAfter[0].qty, 1);
      assert.equal(linesAfter[0].productId, sampleProduct.productId);
    });

    it('clear rồi thêm lại: snapshot có id không xóa món mới', () => {
      store().addItem({ ...sampleProduct, qty: 2 });
      const checkoutSnapshot = store().getSnapshot();

      store().clear();
      assert.equal(getLines().length, 0);
      store().addItem({ ...sampleProduct, qty: 1 });

      store().removePurchased(checkoutSnapshot);

      const remaining = getLines();
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].qty, 1);
    });

    it('snapshot thiếu id + xóa rồi thêm lại: bỏ qua an toàn, món mới được giữ nguyên', () => {
      store().addItem({ ...sampleProduct, qty: 2 });
      const legacy = legacySnapshot();

      store().removeItem(getLines()[0].key);
      store().addItem({ ...sampleProduct, qty: 1 });

      assert.deepEqual(store().removePurchased(legacy), { applied: 0, skipped: 1 });
      assert.equal(getLines().length, 1);
      assert.equal(getLines()[0].qty, 1);
    });

    it('snapshot thiếu id + clear rồi thêm lại: bỏ qua an toàn, món mới được giữ nguyên', () => {
      store().addItem({ ...sampleProduct, qty: 2 });
      const legacy = legacySnapshot();

      store().clear();
      store().addItem({ ...sampleProduct, qty: 1 });

      assert.deepEqual(store().removePurchased(legacy), { applied: 0, skipped: 1 });
      assert.equal(getLines().length, 1);
      assert.equal(getLines()[0].qty, 1);
    });

    it('snapshot thiếu id khi dòng vẫn còn nguyên: không trừ theo key (không đoán)', () => {
      store().addItem({ ...sampleProduct, qty: 3 });
      const line = getLines()[0];

      const result = store().removePurchased([{ key: line.key, qty: 2 }] as unknown as PurchasedLine[]);

      assert.deepEqual(result, { applied: 0, skipped: 1 });
      assert.equal(getLines()[0].qty, 3);
    });

    it('thêm tiếp vào dòng cũ: snapshot 2 ly, giỏ thành 3 ly -> chỉ trừ 2 ly, giữ lại 1 ly', () => {
      store().addItem({ ...sampleProduct, qty: 2 });
      const checkoutSnapshot = store().createSnapshot();

      store().addItem({ ...sampleProduct, qty: 1 });
      assert.equal(getLines()[0].qty, 3);

      assert.deepEqual(store().removePurchased(checkoutSnapshot), { applied: 1, skipped: 0 });

      const remaining = getLines();
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].qty, 1);
    });

    it('nhiều món: món đã mua được trừ đúng, món mới thêm sau vẫn giữ nguyên', () => {
      store().addItem({ ...sampleProduct, qty: 2 });
      store().addItem({ ...sampleCoffee, qty: 1 });
      const snapshot = store().createSnapshot();

      store().addItem({ ...sampleCoffee, qty: 2 }); // cà phê thành 3 ly

      store().removePurchased(snapshot);

      // Trà sữa mua hết 2 ly -> bị xóa; cà phê 3 ly, mua 1 ly -> còn 2 ly
      const remaining = getLines();
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].productId, sampleCoffee.productId);
      assert.equal(remaining[0].qty, 2);
    });

    it('getSnapshot và createSnapshot tương đương, mỗi mục đều có id', () => {
      store().addItem({ ...sampleProduct, qty: 2 });
      assert.deepEqual(store().createSnapshot(), store().getSnapshot());
      for (const entry of store().getSnapshot()) {
        assert.ok(entry.id);
      }
    });

    it('snapshot rỗng hoặc qty sai không làm thay đổi giỏ', () => {
      store().addItem({ ...sampleProduct, qty: 2 });
      const [entry] = store().getSnapshot();

      assert.deepEqual(store().removePurchased([]), { applied: 0, skipped: 0 });
      const bad = store().removePurchased([
        { ...entry, qty: 0 },
        { ...entry, qty: -1 },
        { ...entry, qty: 1.5 },
      ]);
      assert.equal(bad.applied, 0);
      assert.equal(getLines()[0].qty, 2);
    });
  });

  describe('Nghiệp vụ cốt lõi giỏ hàng', () => {
    it('cùng cấu hình được gộp số lượng; khác size hoặc khác topping được tách dòng', () => {
      store().addItem({ ...sampleProduct, size: 'M', qty: 1 });
      store().addItem({ ...sampleProduct, size: 'M', qty: 2 });
      assert.equal(getLines().length, 1);
      assert.equal(getLines()[0].qty, 3);

      store().addItem({ ...sampleProduct, size: 'L', qty: 1 });
      assert.equal(getLines().length, 2);

      store().addItem({ ...sampleProduct, size: 'M', toppings: [], qty: 1 });
      assert.equal(getLines().length, 3);
    });

    it('gộp dòng không phụ thuộc thứ tự topping', () => {
      const a = { id: 'top-a', name: 'A', price: 5000 };
      const b = { id: 'top-b', name: 'B', price: 7000 };
      store().addItem({ ...sampleProduct, toppings: [a, b], qty: 1 });
      store().addItem({ ...sampleProduct, toppings: [b, a], qty: 2 });
      assert.equal(getLines().length, 1);
      assert.equal(getLines()[0].qty, 3);
    });

    it('badge giỏ hàng (totalQty) tính đúng và cập nhật khi sửa/xóa', () => {
      store().addItem({ ...sampleProduct, qty: 3 });
      store().addItem({ ...sampleCoffee, qty: 2 });
      assert.equal(totalQty(getLines()), 5);

      store().setQty(getLines()[0].key, 1);
      assert.equal(totalQty(getLines()), 3);

      store().removeItem(getLines()[0].key);
      assert.equal(totalQty(getLines()), 2);
    });

    it('lineUnitPrice và lineTotal tính toán chính xác', () => {
      const line = {
        id: '1',
        key: 'k',
        productId: 'p',
        productName: 'Tra',
        imageUrl: '',
        size: 'M' as const,
        sizePrice: 30000,
        toppings: [
          { id: 't1', name: 'Topping 1', price: 5000 },
          { id: 't2', name: 'Topping 2', price: 7000 },
        ],
        qty: 3,
      };

      assert.equal(lineUnitPrice(line), 42000); // 30000 + 5000 + 7000
      assert.equal(lineTotal(line), 126000); // 42000 * 3
    });

    it('tổng tiền đúng với nhiều size/topping', () => {
      store().addItem({ ...sampleCoffee, qty: 1 }); // 29.000
      store().addItem({ ...sampleProduct, size: 'L', sizePrice: 45000, qty: 2 }); // (45.000 + 5.000) * 2
      const total = getLines().reduce((sum, l) => sum + lineTotal(l), 0);
      assert.equal(total, 29000 + 100000);
    });

    it('toCartItems chuẩn hóa theo hợp đồng CartItem (không giá, không userId)', () => {
      store().addItem({
        ...sampleProduct,
        toppings: [
          { id: 'top-b', name: 'B', price: 5000 },
          { id: 'top-a', name: 'A', price: 5000 },
        ],
        qty: 2,
      });

      const items = toCartItems(getLines());
      assert.equal(items.length, 1);
      assert.deepEqual(items[0], {
        productId: sampleProduct.productId,
        size: sampleProduct.size,
        toppingIds: ['top-a', 'top-b'],
        qty: 2,
      });
      assert.equal('price' in items[0], false);
      assert.equal('userId' in items[0], false);
    });

    it('từ chối vượt quá 10 toppings', () => {
      const toppings = Array.from({ length: 11 }, (_, i) => ({
        id: `top-${i}`,
        name: `Topping ${i}`,
        price: 5000,
      }));

      const res = store().addItem({ ...sampleProduct, toppings, qty: 1 });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.reason, 'MAX_TOPPINGS');
      }
    });

    it('lineKey tạo ra chuỗi duy nhất dựa trên productId, size và toppings đã sắp xếp', () => {
      const key1 = lineKey('prod-1', 'M', ['top-2', 'top-1']);
      const key2 = lineKey('prod-1', 'M', ['top-1', 'top-2']);
      assert.equal(key1, key2);
      assert.equal(key1, 'prod-1|M|top-1|top-2');
    });

    it('removeItem xóa đúng dòng sản phẩm theo key hoặc id', () => {
      store().addItem({ ...sampleProduct, qty: 2 });
      store().addItem({ ...sampleCoffee, qty: 1 });
      assert.equal(getLines().length, 2);

      store().removeItem(getLines()[0].id);
      assert.equal(getLines().length, 1);
      assert.equal(getLines()[0].productId, sampleCoffee.productId);

      store().removeItem(getLines()[0].key);
      assert.equal(getLines().length, 0);
    });

    it('clear làm trống toàn bộ giỏ hàng', () => {
      store().addItem({ ...sampleProduct, qty: 2 });
      store().addItem({ ...sampleCoffee, qty: 3 });
      assert.equal(getLines().length, 2);

      store().clear();
      assert.equal(getLines().length, 0);
    });

    it('lưu giỏ vào storage để khôi phục sau reload', () => {
      store().addItem({ ...sampleProduct, qty: 2 });
      const stored = useCartStore.persist.getOptions().storage!.getItem('brewlite-cart') as unknown as {
        state: { lines: { qty: number }[] };
      };
      assert.equal(stored.state.lines[0].qty, 2);
    });
  });
});
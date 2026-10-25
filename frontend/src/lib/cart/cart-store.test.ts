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
} from './cart-store.ts';

describe('Cart Store - Issue 5 & Issue Fixes', () => {
  it('settles a verified order once while preserving added quantities and re-added lines', () => {
    useCartStore.setState({ lines: [], settledOrders: [] });
    const item = { productId: 'settlement-product', productName: 'Coffee', imageUrl: '', size: 'M' as const, sizePrice: 50000, toppings: [], qty: 2 };
    useCartStore.getState().addItem(item);
    const snapshot = useCartStore.getState().getSnapshot();
    useCartStore.getState().addItem({ ...item, qty: 1 });
    useCartStore.getState().settleOrder('paid-order', snapshot);
    useCartStore.getState().settleOrder('paid-order', snapshot);
    assert.equal(useCartStore.getState().lines[0].qty, 1);
    useCartStore.getState().removeItem(useCartStore.getState().lines[0].id);
    useCartStore.getState().addItem({ ...item, qty: 1 });
    useCartStore.getState().settleOrder('another-old-order', snapshot);
    assert.equal(useCartStore.getState().lines[0].qty, 1);
  });
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

  const getLines = () => useCartStore.getState().lines;

  beforeEach(() => {
    useCartStore.getState().clear();
  });

  describe('Issue 2: Xử lý giới hạn MAX_QTY (99) và cờ capped', () => {
    it('thêm dòng mới vượt giới hạn (qty: 150) trên giỏ rỗng: store lưu 99 ly, trả capped: true và có thông báo', () => {
      const res = useCartStore.getState().addItem({ ...sampleProduct, qty: 150 });

      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.capped, true, 'Phải trả về capped: true khi số lượng thêm mới vượt 99');
        assert.ok(res.message, 'Cần có thông báo phản ánh việc đã giới hạn số lượng');
        assert.match(res.message, /99/);
      }

      const lines = getLines();
      assert.equal(lines.length, 1);
      assert.equal(lines[0].qty, MAX_QTY, 'Số lượng được lưu trong store phải được giới hạn đúng 99 ly');
    });

    it('thêm dòng mới với số lượng hợp lệ (qty: 2): trả capped: false, store lưu đúng 2 ly', () => {
      const res = useCartStore.getState().addItem({ ...sampleProduct, qty: 2 });

      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.capped, false);
      }

      const lines = getLines();
      assert.equal(lines.length, 1);
      assert.equal(lines[0].qty, 2);
    });

    it('gộp vào dòng đã có vượt giới hạn (đang có 60 ly, thêm 50 ly): tổng 110 > 99, trả capped: true, store lưu 99 ly', () => {
      useCartStore.getState().addItem({ ...sampleProduct, qty: 60 });

      const res = useCartStore.getState().addItem({ ...sampleProduct, qty: 50 });
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.capped, true, 'Phải trả về capped: true khi tổng số lượng sau gộp vượt 99');
        assert.ok(res.message);
      }

      const lines = getLines();
      assert.equal(lines.length, 1);
      assert.equal(lines[0].qty, MAX_QTY);
    });

    it('gộp vào dòng đã có với số lượng hợp lệ (đang có 10 ly, thêm 5 ly): trả capped: false, store lưu 15 ly', () => {
      useCartStore.getState().addItem({ ...sampleProduct, qty: 10 });

      const res = useCartStore.getState().addItem({ ...sampleProduct, qty: 5 });
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.capped, false);
      }

      const lines = getLines();
      assert.equal(lines.length, 1);
      assert.equal(lines[0].qty, 15);
    });

    it('gộp vào dòng đã đạt 99 ly: trả capped: true, store vẫn giữ 99 ly', () => {
      useCartStore.getState().addItem({ ...sampleProduct, qty: 99 });

      const res = useCartStore.getState().addItem({ ...sampleProduct, qty: 1 });
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.capped, true);
      }

      const lines = getLines();
      assert.equal(lines[0].qty, MAX_QTY);
    });

    it('từ chối số lượng không hợp lệ (số âm, 0, thập phân)', () => {
      const resNegative = useCartStore.getState().addItem({ ...sampleProduct, qty: -5 });
      assert.equal(resNegative.ok, false);
      if (!resNegative.ok) {
        assert.equal(resNegative.reason, 'INVALID');
      }

      const resZero = useCartStore.getState().addItem({ ...sampleProduct, qty: 0 });
      assert.equal(resZero.ok, false);

      const resFloat = useCartStore.getState().addItem({ ...sampleProduct, qty: 2.5 });
      assert.equal(resFloat.ok, false);

      assert.equal(getLines().length, 0);
    });
  });

  describe('Issue 1: Snapshot và removePurchased an toàn (không xóa nhầm món thêm sau)', () => {
    it('trường hợp xóa rồi thêm lại: xóa dòng cũ đã checkout, thêm lại 1 ly cùng cấu hình -> thanh toán đơn cũ thành công không xóa ly mới', () => {
      // 1. Giỏ có 2 ly
      useCartStore.getState().addItem({ ...sampleProduct, qty: 2 });
      const linesBefore = getLines();
      assert.equal(linesBefore.length, 1);
      assert.equal(linesBefore[0].qty, 2);

      // 2. Lưu snapshot checkout
      const checkoutSnapshot = useCartStore.getState().getSnapshot();
      assert.equal(checkoutSnapshot.length, 1);
      assert.equal(checkoutSnapshot[0].qty, 2);
      assert.ok(checkoutSnapshot[0].id, 'Snapshot phải chứa định danh phiên bản dòng (id)');

      // 3. Xóa dòng đó khỏi giỏ
      useCartStore.getState().removeItem(linesBefore[0].key);
      assert.equal(getLines().length, 0);

      // 4. Thêm lại 1 ly cùng sản phẩm/size/topping
      useCartStore.getState().addItem({ ...sampleProduct, qty: 1 });
      const linesReadded = getLines();
      assert.equal(linesReadded.length, 1);
      assert.equal(linesReadded[0].qty, 1);
      assert.notEqual(
        linesReadded[0].id,
        checkoutSnapshot[0].id,
        'Dòng mới tạo lại phải có id phiên bản mới, khác với dòng đã đưa vào snapshot'
      );

      // 5. Thanh toán đơn cũ thành công và gọi removePurchased
      useCartStore.getState().removePurchased(checkoutSnapshot);

      // Kết quả mong đợi: Ly mới KHÔNG bị xóa, vẫn còn 1 ly trong giỏ
      const linesAfter = getLines();
      assert.equal(linesAfter.length, 1, 'Ly mới thêm sau không được phép bị xóa');
      assert.equal(linesAfter[0].qty, 1);
      assert.equal(linesAfter[0].productId, sampleProduct.productId);
    });

    it('trường hợp thêm tiếp vào dòng cũ: giỏ có 2 ly, snapshot 2 ly, thêm tiếp 1 ly (tổng 3) -> chỉ trừ 2 ly, giữ lại 1 ly', () => {
      // Giỏ có 2 ly
      useCartStore.getState().addItem({ ...sampleProduct, qty: 2 });
      const checkoutSnapshot = useCartStore.getState().createSnapshot();

      // Trong lúc thanh toán đang xử lý, khách thêm tiếp 1 ly vào cùng dòng đó
      useCartStore.getState().addItem({ ...sampleProduct, qty: 1 });
      assert.equal(getLines()[0].qty, 3, 'Giỏ hiện tại đã tăng lên 3 ly');

      // Thanh toán đơn cũ thành công (đơn cũ chỉ mua 2 ly)
      useCartStore.getState().removePurchased(checkoutSnapshot);

      // Kết quả mong đợi: Chỉ trừ 2 ly của đơn cũ, còn lại 1 ly vừa thêm sau
      const remaining = getLines();
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].qty, 1, 'Phải còn lại 1 ly được thêm sau khi bắt đầu thanh toán');
    });

    it('trường hợp clear giỏ rồi thêm lại trong lúc thanh toán đang xử lý: món mới thêm sau không bị xóa', () => {
      // Giỏ có 2 ly
      useCartStore.getState().addItem({ ...sampleProduct, qty: 2 });
      const checkoutSnapshot = useCartStore.getState().getSnapshot();

      // Clear giỏ hàng trong lúc thanh toán
      useCartStore.getState().clear();
      assert.equal(getLines().length, 0);

      // Thêm lại 1 ly cùng cấu hình
      useCartStore.getState().addItem({ ...sampleProduct, qty: 1 });
      assert.equal(getLines().length, 1);
      assert.equal(getLines()[0].qty, 1);

      // Thanh toán đơn cũ hoàn tất và gọi removePurchased
      useCartStore.getState().removePurchased(checkoutSnapshot);

      // Kết quả mong đợi: Dòng mới thêm không bị xóa
      const remaining = getLines();
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].qty, 1);
    });

    it('thanh toán đơn có nhiều món: món nào đã mua được trừ đúng, món mới thêm sau vẫn giữ nguyên', () => {
      useCartStore.getState().addItem({ ...sampleProduct, qty: 2 });
      useCartStore.getState().addItem({ ...sampleCoffee, qty: 1 });
      const snapshot = useCartStore.getState().createSnapshot();

      // Thêm tiếp cà phê 2 ly nữa (thành 3 ly cà phê)
      useCartStore.getState().addItem({ ...sampleCoffee, qty: 2 });

      // Gọi removePurchased cho đơn cũ (mua 2 trà sữa, 1 cà phê)
      useCartStore.getState().removePurchased(snapshot);

      // Trà sữa mua hết 2 ly -> bị xóa khỏi giỏ
      // Cà phê có 3 ly, mua 1 ly -> còn lại 2 ly
      const remaining = getLines();
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].productId, sampleCoffee.productId);
      assert.equal(remaining[0].qty, 2);
    });

    it('ignores legacy key-only snapshots that cannot identify the purchased line', () => {
      useCartStore.getState().addItem({ ...sampleProduct, qty: 3 });

      const line = getLines()[0];
      // Gọi dạng legacy: { key, qty } không truyền id
      useCartStore.getState().removePurchased([{ key: line.key, qty: 2 }]);

      assert.equal(getLines().length, 1);
      assert.equal(getLines()[0].qty, 3);
    });
  });

  describe('Nghiệp vụ cốt lõi giỏ hàng (Issue 5 - My task)', () => {
    it('cùng cấu hình được gộp số lượng; khác size hoặc khác topping được tách dòng', () => {
      // Thêm size M, topping tc
      useCartStore.getState().addItem({ ...sampleProduct, size: 'M', qty: 1 });

      // Thêm cùng sản phẩm, size M, cùng topping tc nhưng thứ tự mảng đảo ngược (nếu có)
      useCartStore.getState().addItem({ ...sampleProduct, size: 'M', qty: 2 });

      // Phải gộp lại thành 1 dòng duy nhất với qty = 3
      assert.equal(getLines().length, 1);
      assert.equal(getLines()[0].qty, 3);

      // Thêm cùng sản phẩm nhưng size L -> tách dòng
      useCartStore.getState().addItem({ ...sampleProduct, size: 'L', qty: 1 });
      assert.equal(getLines().length, 2);

      // Thêm cùng sản phẩm size M nhưng không có topping -> tách dòng
      useCartStore.getState().addItem({ ...sampleProduct, size: 'M', toppings: [], qty: 1 });
      assert.equal(getLines().length, 3);
    });

    it('badge giỏ hàng (totalQty) tính đúng tổng số lượng', () => {
      useCartStore.getState().addItem({ ...sampleProduct, qty: 3 });
      useCartStore.getState().addItem({ ...sampleCoffee, qty: 2 });

      assert.equal(totalQty(getLines()), 5);
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

    it('toCartItems chuẩn hóa theo đúng hợp đồng CartItem (không có giá, không userId)', () => {
      useCartStore.getState().addItem({
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
        toppingIds: ['top-a', 'top-b'], // toppingIds được sắp xếp chuẩn hóa
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

      const res = useCartStore.getState().addItem({ ...sampleProduct, toppings, qty: 1 });
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

    it('setQty cập nhật số lượng và tự động clamp nếu vượt quá 99', () => {
      useCartStore.getState().addItem({ ...sampleProduct, qty: 5 });
      const line = getLines()[0];

      // Đổi số lượng thành 20
      useCartStore.getState().setQty(line.id, 20);
      assert.equal(getLines()[0].qty, 20);

      // Đổi số lượng vượt 99 (150) -> tự động clamp về 99
      useCartStore.getState().setQty(line.key, 150);
      assert.equal(getLines()[0].qty, 99);
    });

    it('removeItem xóa đúng dòng sản phẩm theo key hoặc id', () => {
      useCartStore.getState().addItem({ ...sampleProduct, qty: 2 });
      useCartStore.getState().addItem({ ...sampleCoffee, qty: 1 });
      assert.equal(getLines().length, 2);

      // Xóa dòng đầu tiên theo id
      useCartStore.getState().removeItem(getLines()[0].id);
      assert.equal(getLines().length, 1);
      assert.equal(getLines()[0].productId, sampleCoffee.productId);

      // Xóa dòng còn lại theo key
      useCartStore.getState().removeItem(getLines()[0].key);
      assert.equal(getLines().length, 0);
    });

    it('clear làm trống toàn bộ giỏ hàng', () => {
      useCartStore.getState().addItem({ ...sampleProduct, qty: 2 });
      useCartStore.getState().addItem({ ...sampleCoffee, qty: 3 });
      assert.equal(getLines().length, 2);

      useCartStore.getState().clear();
      assert.equal(getLines().length, 0);
    });
  });
});

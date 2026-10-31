import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { useCartStore } from '../cart/cart-store.ts';
import { reconcileVnPayReturnOrder, type VnPayReturnReconcileDeps } from './vnpay-return.ts';
import type { Order, OrderStatus } from '../contracts/api.generated';

function makeOrder(id: string, status: OrderStatus, total = 90000): Order {
  return {
    id,
    code: 'BL-20261028-TEST01',
    status,
    reservationStatus: status === 'CANCELLED' ? 'RELEASED' : status === 'PAID' ? 'CONSUMED' : 'HELD',
    version: 1,
    subtotal: total,
    discount: 0,
    total,
    currency: 'VND',
    promotionCode: null,
    createdAt: '2026-10-28T10:00:00.000Z',
    updatedAt: '2026-10-28T10:05:00.000Z',
    items: [],
  };
}

describe('reconcileVnPayReturnOrder — Quản lý giỏ hàng tại trang kết quả VNPay (#7)', () => {
  beforeEach(() => {
    useCartStore.setState({ lines: [], settledOrders: [] });
  });

  it('chỉ loại bỏ đúng các dòng đã chọn mua thuộc đơn PAID; giữ nguyên món không chọn mua và món thêm sau khi chuyển sang VNPay', async () => {
    // 1. Thêm 2 món vào giỏ ban đầu:
    // - Món 1 (Cappuccino, qty: 2, selected: true) -> khách chọn mua
    // - Món 2 (Americano, qty: 1, selected: false) -> khách KHÔNG chọn mua
    useCartStore.getState().addItem({
      productId: 'prod-cap',
      productName: 'Cappuccino',
      imageUrl: '/cap.jpg',
      size: 'M',
      sizePrice: 45000,
      toppings: [],
      qty: 2,
    });
    useCartStore.getState().addItem({
      productId: 'prod-ame',
      productName: 'Americano',
      imageUrl: '/ame.jpg',
      size: 'S',
      sizePrice: 35000,
      toppings: [],
      qty: 1,
    });

    const initialLines = useCartStore.getState().lines;
    const capLine = initialLines.find((l) => l.productId === 'prod-cap')!;
    const ameLine = initialLines.find((l) => l.productId === 'prod-ame')!;

    // Bỏ chọn món Americano
    useCartStore.getState().toggleSelect(ameLine.id);

    // Snapshot các dòng được chọn mua khi tạo đơn order-paid-1
    const purchasedSnapshot = [{ id: capLine.id, key: capLine.key, qty: 2 }];
    const sessionMap = new Map<string, string>();
    sessionMap.set(
      'brewlite-checkout:user-1',
      JSON.stringify({
        userId: 'user-1',
        orderId: 'order-paid-1',
        purchased: purchasedSnapshot,
      }),
    );

    // 2. Sau khi chuyển sang VNPay, khách thêm mới Món 3 (Matcha Latte, qty: 1) vào giỏ
    useCartStore.getState().addItem({
      productId: 'prod-matcha',
      productName: 'Matcha Latte',
      imageUrl: '/matcha.jpg',
      size: 'L',
      sizePrice: 55000,
      toppings: [],
      qty: 1,
    });

    // 3. Trang vnpay-return nhận kết quả và đối chiếu trạng thái đơn PAID
    const res = await reconcileVnPayReturnOrder(
      {
        success: true,
        message: 'Thanh toán VNPay thành công',
        orderCode: 'BL-20261028-TEST01',
        orderId: 'order-paid-1',
      },
      {
        userId: 'user-1',
        readSession: (k) => sessionMap.get(k) ?? null,
        writeSession: (k, v) => sessionMap.set(k, v),
        findOrder: async (id) => makeOrder(id, 'PAID'),
        settleOrder: (orderId, purchased) =>
          useCartStore.getState().settleOrder(orderId, purchased),
      },
    );

    assert.equal(res.settled, true);

    // Kiểm tra giỏ hàng:
    // - Cappuccino (đã mua) bị loại bỏ
    // - Americano (không chọn mua) vẫn còn nguyên
    // - Matcha Latte (thêm sau khi sang VNPay) vẫn còn nguyên
    const remaining = useCartStore.getState().lines;
    assert.equal(remaining.length, 2);
    assert.equal(
      remaining.some((l) => l.productId === 'prod-cap'),
      false,
    );
    assert.equal(
      remaining.find((l) => l.productId === 'prod-ame')?.qty,
      1,
    );
    assert.equal(
      remaining.find((l) => l.productId === 'prod-matcha')?.qty,
      1,
    );
  });

  it('bấm F5 tải lại trang kết quả nhiều lần không trừ giỏ hàng lần thứ hai', async () => {
    // Khách có 3 ly Cappuccino khi tạo đơn mua 2 ly, sau đó tăng lên 3 ly trước khi về trang return
    useCartStore.getState().addItem({
      productId: 'prod-cap',
      productName: 'Cappuccino',
      imageUrl: '/cap.jpg',
      size: 'M',
      sizePrice: 45000,
      toppings: [],
      qty: 2,
    });
    const capLine = useCartStore.getState().lines[0]!;
    const purchasedSnapshot = [{ id: capLine.id, key: capLine.key, qty: 2 }];

    // Khách tăng số lượng lên 3 ly trong giỏ sau khi đã tạo đơn 2 ly
    useCartStore.getState().setQty(capLine.id, 3);

    const sessionMap = new Map<string, string>();
    sessionMap.set(
      'brewlite-checkout:user-1',
      JSON.stringify({
        userId: 'user-1',
        orderId: 'order-f5-test',
        purchased: purchasedSnapshot,
      }),
    );

    const deps: VnPayReturnReconcileDeps = {
      userId: 'user-1',
      readSession: (k: string) => sessionMap.get(k) ?? null,
      writeSession: (k: string, v: string) => {
        sessionMap.set(k, v);
      },
      findOrder: async (id: string) => makeOrder(id, 'PAID'),
      settleOrder: (orderId, purchased) =>
        useCartStore.getState().settleOrder(orderId, purchased),
    };

    const verifyPayload = {
      success: true,
      message: 'Thanh toán VNPay thành công',
      orderCode: 'BL-20261028-F5',
      orderId: 'order-f5-test',
    };

    // Lần 1: trừ 2 ly, còn lại 1 ly
    await reconcileVnPayReturnOrder(verifyPayload, deps);
    assert.equal(useCartStore.getState().lines[0]?.qty, 1);

    // Lần 2 & Lần 3 (F5 reload): không trừ thêm lần nào nữa, vẫn giữ nguyên 1 ly
    await reconcileVnPayReturnOrder(verifyPayload, deps);
    await reconcileVnPayReturnOrder(verifyPayload, deps);
    assert.equal(useCartStore.getState().lines[0]?.qty, 1);
  });

  it('mở lại URL callback cũ của đơn hàng khác không xóa hay trừ giỏ hàng hiện tại', async () => {
    useCartStore.getState().addItem({
      productId: 'prod-new',
      productName: 'Trà đào cam sả',
      imageUrl: '/tea.jpg',
      size: 'M',
      sizePrice: 45000,
      toppings: [],
      qty: 2,
    });
    const currentLine = useCartStore.getState().lines[0]!;

    // Phiên checkout hiện tại đang là của đơn mới (order-current-999) hoặc trống
    const sessionMap = new Map<string, string>();
    sessionMap.set(
      'brewlite-checkout:user-1',
      JSON.stringify({
        userId: 'user-1',
        orderId: 'order-current-999',
        purchased: [{ id: currentLine.id, key: currentLine.key, qty: 2 }],
      }),
    );

    // Người dùng vô tình mở lại link callback cũ của đơn order-old-111 đã PAID trước đó
    const res = await reconcileVnPayReturnOrder(
      {
        success: true,
        message: 'Thanh toán VNPay thành công',
        orderCode: 'BL-OLD-111',
        orderId: 'order-old-111',
      },
      {
        userId: 'user-1',
        readSession: (k) => sessionMap.get(k) ?? null,
        writeSession: (k, v) => sessionMap.set(k, v),
        findOrder: async (id) => makeOrder(id, 'PAID'),
        settleOrder: (orderId, purchased) =>
          useCartStore.getState().settleOrder(orderId, purchased),
      },
    );

    assert.equal(res.settled, false);
    assert.equal(useCartStore.getState().lines.length, 1);
    assert.equal(useCartStore.getState().lines[0]?.qty, 2);
  });

  it('không trừ giỏ hàng nếu đơn hàng đã bị hủy hoặc hoàn tiền (CANCELLED) hoặc chưa thanh toán (PENDING / PAYMENT_FAILED)', async () => {
    useCartStore.getState().addItem({
      productId: 'prod-cap',
      productName: 'Cappuccino',
      imageUrl: '/cap.jpg',
      size: 'M',
      sizePrice: 45000,
      toppings: [],
      qty: 2,
    });
    const line = useCartStore.getState().lines[0]!;

    const sessionMap = new Map<string, string>();
    sessionMap.set(
      'brewlite-checkout:user-1',
      JSON.stringify({
        userId: 'user-1',
        orderId: 'order-cancelled-1',
        purchased: [{ id: line.id, key: line.key, qty: 2 }],
      }),
    );

    for (const nonPaidStatus of ['CANCELLED', 'PENDING', 'PAYMENT_FAILED'] as const) {
      const res = await reconcileVnPayReturnOrder(
        {
          success: true,
          message: 'Callback cũ',
          orderCode: 'BL-CANCELLED-1',
          orderId: 'order-cancelled-1',
        },
        {
          userId: 'user-1',
          readSession: (k) => sessionMap.get(k) ?? null,
          writeSession: (k, v) => sessionMap.set(k, v),
          findOrder: async (id) => makeOrder(id, nonPaidStatus),
          settleOrder: (orderId, purchased) =>
            useCartStore.getState().settleOrder(orderId, purchased),
        },
      );

      assert.equal(res.settled, false);
      assert.equal(useCartStore.getState().lines.length, 1);
      assert.equal(useCartStore.getState().lines[0]?.qty, 2);
    }
  });
});

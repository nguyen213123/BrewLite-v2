// Owner: TV3 — #8. The ONLY place that changes Order.status. Payment (TV5), cancel and STAFF updates all go through here.
import { Injectable } from '@nestjs/common';
import { InventoryPort, OrderTransactionsPort, PromotionRulesPort } from '../../common/contracts/ports';
import type { StoredOrder, Tx } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { ApiError } from '../../common/errors/api-error';
import { assertTransition } from './domain/order-state-machine';

const WITH_ITEMS = { items: { include: { toppings: true } } } as const;

const versionConflict = () => new ApiError(409, 'ORDER_VERSION_CONFLICT', 'Đơn hàng đã thay đổi, vui lòng tải lại');

@Injectable()
export class OrderTransactionsService implements OrderTransactionsPort {
  constructor(
    private readonly inventory: InventoryPort,
    private readonly promotions: PromotionRulesPort,
  ) {}

  // Not found and "someone else's order" are deliberately the same 404 (business-rules §3).
  async loadOwned(tx: Tx, userId: string, orderId: string): Promise<StoredOrder> {
    const order = await tx.order.findFirst({ where: { id: orderId, userId }, include: WITH_ITEMS });
    if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Đơn hàng không tồn tại');
    return order;
  }

  // One status change = one conditional UPDATE (id + version + current status) + its resource effects + one OrderEvent,
  // all inside the caller's transaction. Two competing transitions both read the same version, but only the first UPDATE
  // matches; the other waits for its commit, re-checks the condition, matches 0 rows and gets ORDER_VERSION_CONFLICT
  // BEFORE any effect (release stock, promo, event) runs. A late request therefore can never overwrite a PAID order.
  async transition(
    tx: Tx,
    input: { orderId: string; actorUserId: string; expectedVersion: number; toStatus: Api.OrderStatus },
  ): Promise<StoredOrder> {
    const { orderId, actorUserId, expectedVersion, toStatus } = input;
    if (toStatus === 'PENDING') {
      // PAYMENT_FAILED -> PENDING must re-hold stock and promo atomically: only prepareRetry may do it.
      throw new ApiError(409, 'INVALID_ORDER_TRANSITION', 'Thử lại thanh toán phải đi qua prepareRetry');
    }
    const order = await tx.order.findUnique({ where: { id: orderId }, include: WITH_ITEMS });
    if (!order) throw new ApiError(404, 'ORDER_NOT_FOUND', 'Đơn hàng không tồn tại');
    if (order.version !== expectedVersion) throw versionConflict();
    assertTransition(order.status, toStatus);

    const changed = await tx.order.updateMany({
      where: { id: orderId, version: expectedVersion, status: order.status },
      data: {
        status: toStatus,
        version: { increment: 1 },
        ...(toStatus === 'PAID' ? { reservationStatus: 'CONSUMED' as const } : {}),
      },
    });
    if (changed.count !== 1) throw versionConflict();

    // Stock/promo go back only if still held. PAYMENT_FAILED -> CANCELLED finds RELEASED and returns nothing a second time.
    if ((toStatus === 'PAYMENT_FAILED' || toStatus === 'CANCELLED') && order.reservationStatus !== 'RELEASED') {
      await this.inventory.release(tx, order);
      if (order.promotionId) await this.promotions.release(tx, order.promotionId);
    }
    await tx.orderEvent.create({
      data: { orderId, actorUserId, fromStatus: order.status, toStatus, orderVersion: expectedVersion + 1 },
    });
    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: WITH_ITEMS });
  }

  // PAYMENT_FAILED -> PENDING with a fresh hold, atomically. The conditional UPDATE comes first so concurrent retries
  // serialize on the order row (only one holds stock). If stock or promo cannot be held again, the error rolls the whole
  // transaction back: the order stays PAYMENT_FAILED/RELEASED and nothing stays held. Prices are never recalculated.
  async prepareRetry(tx: Tx, order: StoredOrder): Promise<StoredOrder> {
    assertTransition(order.status, 'PENDING');
    const changed = await tx.order.updateMany({
      where: { id: order.id, version: order.version, status: 'PAYMENT_FAILED', reservationStatus: 'RELEASED' },
      data: { status: 'PENDING', reservationStatus: 'HELD', version: { increment: 1 } },
    });
    if (changed.count !== 1) throw versionConflict();

    if (order.promotionId) {
      // Re-validate the code (active window, minSubtotal, uses left) but keep the stored discount and total.
      await this.promotions.price(tx, order.promotionCode ?? undefined, order.subtotal);
      await this.promotions.reserve(tx, order.promotionId);
    }
    await this.inventory.reserve(
      tx,
      order.items.map(item => ({ productId: item.productId, size: item.size, qty: item.qty })),
    );
    await tx.orderEvent.create({
      data: { orderId: order.id, actorUserId: order.userId, fromStatus: 'PAYMENT_FAILED', toStatus: 'PENDING', orderVersion: order.version + 1 },
    });
    return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: WITH_ITEMS });
  }
}

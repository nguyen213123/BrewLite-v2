// Owner: TV3 — #9. Product.stock is a shared pool of cups per product (size/topping do not have their own stock).
import { Injectable } from '@nestjs/common';
import { InventoryPort } from '../../common/contracts/ports';
import type { StoredOrder, Tx } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { ApiError } from '../../common/errors/api-error';

export const MAX_STOCK_ATTEMPTS = 3;

// business-rules §5: add up qty per productId over every line BEFORE touching stock, and visit
// products in ascending id order so concurrent orders take row locks in the same order (no deadlock).
export function requiredByProduct(lines: Array<{ productId: string; qty: number }>): Array<[string, number]> {
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.qty);
  return [...totals.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

@Injectable()
export class InventoryService implements InventoryPort {
  // Holds stock for a new PENDING order. Must run inside the caller's transaction (create order / payment retry):
  // any thrown error rolls back every product already decremented by this call, so a rejected order holds nothing.
  async reserve(tx: Tx, items: Api.CartItem[]): Promise<void> {
    for (const [productId, qty] of requiredByProduct(items)) {
      await this.holdProduct(tx, productId, qty);
    }
  }

  // Gives stock back exactly once. The order's reservationStatus is flipped HELD/CONSUMED -> RELEASED with a
  // conditional update first; if another request already released it, count is 0 and nothing is returned twice.
  async release(tx: Tx, order: StoredOrder): Promise<void> {
    const flipped = await tx.order.updateMany({
      where: { id: order.id, reservationStatus: { in: ['HELD', 'CONSUMED'] } },
      data: { reservationStatus: 'RELEASED' },
    });
    if (flipped.count === 0) return;
    for (const [productId, qty] of requiredByProduct(order.items)) {
      const restored = await tx.product.updateMany({
        where: { id: productId },
        data: { stock: { increment: qty }, version: { increment: 1 } },
      });
      // Products are never deleted (FK Restrict); a miss means corrupt data, so abort and roll back.
      if (restored.count !== 1) throw new Error(`Cannot restore stock for product ${productId}`);
    }
  }

  // Optimistic locking on Product.version: read stock/version, then update only if the row is still unchanged
  // and still has enough stock. Under READ COMMITTED a concurrent winner makes our UPDATE match 0 rows (no DB error,
  // so the transaction stays usable) and we re-read and retry, at most MAX_STOCK_ATTEMPTS times.
  private async holdProduct(tx: Tx, productId: string, qty: number): Promise<void> {
    for (let attempt = 1; attempt <= MAX_STOCK_ATTEMPTS; attempt++) {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { stock: true, version: true, active: true },
      });
      if (!product || !product.active) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Sản phẩm không tồn tại');
      if (product.stock < qty) throw new ApiError(409, 'OUT_OF_STOCK', 'Sản phẩm không đủ tồn kho');
      const updated = await tx.product.updateMany({
        where: { id: productId, version: product.version, stock: { gte: qty } },
        data: { stock: { decrement: qty }, version: { increment: 1 } },
      });
      if (updated.count === 1) return;
    }
    throw new ApiError(409, 'STOCK_CONFLICT', 'Tồn kho đang thay đổi, vui lòng thử lại');
  }
}

import { randomBytes } from 'node:crypto';
import type * as Api from '../../../common/contracts/api.generated';
import { ApiError } from '../../../common/errors/api-error';
import type { PromotionSnapshot } from '../../../common/contracts/ports';

export const MAX_ORDER_TOTAL = 2_000_000_000;
export const MAX_QTY_PER_LINE = 99;

function validationError(field: string, message: string): ApiError {
  return new ApiError(400, 'VALIDATION_ERROR', 'Dữ liệu không hợp lệ', [{ field, message }]);
}

// business-rules §2.3: merge identical (product, size, topping set) lines, sort topping IDs,
// and keep the merged qty within 1..99. The result is also the canonical payload for idempotency.
export function normalizeCartItems(items: Api.CartItem[]): Api.CartItem[] {
  const lines = new Map<string, Api.CartItem>();
  for (const item of items) {
    const toppingIds = [...new Set(item.toppingIds ?? [])].sort();
    const key = [item.productId, item.size, ...toppingIds].join('|');
    const qty = (lines.get(key)?.qty ?? 0) + item.qty;
    if (qty > MAX_QTY_PER_LINE) {
      throw validationError('items', `Tổng số lượng của một dòng không vượt quá ${MAX_QTY_PER_LINE}`);
    }
    lines.set(key, { productId: item.productId, size: item.size, toppingIds, qty });
  }
  return [...lines.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, line]) => line);
}

// business-rules §2.5: unitPrice = sizePrice + sum(toppingPrice); lineTotal = unitPrice * qty.
// Recomputed here so the formula holds even if the catalog service returned stale totals.
export function priceLine(item: Api.QuoteItem): Api.QuoteItem {
  const unitPrice = item.sizePrice + item.toppings.reduce((sum, topping) => sum + topping.price, 0);
  return { ...item, unitPrice, lineTotal: unitPrice * item.qty };
}

// subtotal - discount = total; never negative and never above the 2,000,000,000 VND cap.
export function buildQuote(resolved: Api.QuoteItem[], promo: PromotionSnapshot): Api.Quote {
  const items = resolved.map(priceLine);
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  if (subtotal > MAX_ORDER_TOTAL) {
    throw validationError('items', 'Tổng đơn hàng vượt giới hạn cho phép');
  }
  const discount = Math.min(Math.max(promo.discount, 0), subtotal);
  return {
    items,
    subtotal,
    discount,
    total: subtotal - discount,
    currency: 'VND',
    promotionCode: promo.promotionCode,
  };
}

// Matches the contract example BL-20261022-A1B2C3D4 (20 chars = Order.code VarChar(20)).
export function generateOrderCode(now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `BL-${day}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

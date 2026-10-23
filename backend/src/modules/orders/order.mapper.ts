import type { StoredOrder } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';

const byKey = <T>(key: (value: T) => string) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

// Always built from the order snapshot (OrderItem/OrderItemTopping), never from the live catalog.
export function toApiOrder(order: StoredOrder): Api.Order {
  const items: Api.OrderItem[] = order.items.map(item => ({
    id: item.id,
    productId: item.productId,
    productName: item.productName,
    size: item.size,
    sizePrice: item.sizePrice,
    toppings: item.toppings
      .map(topping => ({ id: topping.toppingId, name: topping.name, price: topping.price }))
      .sort(byKey(topping => topping.id)),
    qty: item.qty,
    unitPrice: item.unitPrice,
    lineTotal: item.lineTotal,
  }));
  items.sort(byKey(item => `${item.productId}|${item.size}|${item.toppings.map(t => t.id).join(',')}`));
  return {
    id: order.id,
    code: order.code,
    status: order.status,
    reservationStatus: order.reservationStatus,
    version: order.version,
    subtotal: order.subtotal,
    discount: order.discount,
    total: order.total,
    currency: 'VND',
    promotionCode: order.promotionCode,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items,
  };
}

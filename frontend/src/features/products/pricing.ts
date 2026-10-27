// Owner: TV1 — #3. Hàm thuần: giá tạm tính + validate cấu hình (không import giá trị nào để test được bằng node --test).
import type { AddItemInput } from '@/lib/cart/cart-store';
import type { ProductDetail, Size } from '@/lib/contracts/api.generated';

export const MAX_QTY_PER_LINE = 99; // trùng MAX_QTY của cart-store (business-rules §2.3)

export type Selection = { size: Size | null; toppingIds: string[]; qty: number };

/** Tính số lượng tối đa có thể mua cho một cấu hình (dựa trên size và các topping đã chọn). */
export function maxQtyFor(product: ProductDetail, size: Size | null, toppingIds: string[] = []): number {
  const sizeObj = size ? product.sizes.find(s => s.size === size) : undefined;
  const sizeStock = sizeObj ? sizeObj.stock : product.stock;
  const toppingStocks = toppingIds.map(id => {
    const topping = product.toppings.find(t => t.id === id);
    return topping ? topping.stock : 0;
  });
  return Math.max(0, Math.min(MAX_QTY_PER_LINE, sizeStock, ...toppingStocks));
}

/** Trả về thông báo lỗi tiếng Việt, hoặc null nếu cấu hình hợp lệ. */
export function validateSelection(product: ProductDetail, sel: Selection): string | null {
  if (product.stock <= 0) return 'Sản phẩm đã hết hàng';
  if (!sel.size) return 'Vui lòng chọn kích cỡ';
  const sizeObj = product.sizes.find(s => s.size === sel.size);
  if (!sizeObj) return 'Vui lòng chọn kích cỡ';
  if (sizeObj.stock <= 0) return 'Size này đã hết';

  const valid = new Set(product.toppings.map(t => t.id));
  if (new Set(sel.toppingIds).size !== sel.toppingIds.length || sel.toppingIds.some(id => !valid.has(id))) {
    return 'Topping đã chọn không còn hợp lệ';
  }
  for (const id of sel.toppingIds) {
    const topping = product.toppings.find(t => t.id === id);
    if (topping && topping.stock <= 0) {
      return `Topping ${topping.name} đã hết`;
    }
  }

  const max = maxQtyFor(product, sel.size, sel.toppingIds);
  if (max <= 0) return 'Đã hết hàng';
  if (!Number.isInteger(sel.qty) || sel.qty < 1 || sel.qty > max) return `Số lượng phải từ 1 đến ${max}`;
  return null;
}

/** unitPrice = giá size + tổng topping; lineTotal = unitPrice * qty (business-rules §2.5). Chỉ để hiển thị. */
export function priceSelection(product: ProductDetail, sel: Selection): { unitPrice: number; lineTotal: number } | null {
  const size = product.sizes.find(s => s.size === sel.size);
  if (!size) return null;
  const toppingTotal = product.toppings.filter(t => sel.toppingIds.includes(t.id)).reduce((sum, t) => sum + t.price, 0);
  const unitPrice = size.price + toppingTotal;
  return { unitPrice, lineTotal: unitPrice * sel.qty };
}

/** Chuyển lựa chọn thành đầu vào cho cart store (addItem). Trả null nếu cấu hình không hợp lệ. */
export function toAddItemInput(product: ProductDetail, sel: Selection): AddItemInput | null {
  if (validateSelection(product, sel)) return null;
  const size = product.sizes.find(s => s.size === sel.size);
  if (!size) return null;
  const chosen = new Set(sel.toppingIds);
  return {
    productId: product.id,
    productName: product.name,
    imageUrl: product.imageUrl,
    size: size.size,
    sizePrice: size.price,
    toppings: product.toppings.filter(t => chosen.has(t.id)).map(t => ({ id: t.id, name: t.name, price: t.price })),
    qty: sel.qty,
  };
}
// Owner: TV1 — #2/#3. Replace stubs here; keep public DTO/port contracts.
import { Injectable } from '@nestjs/common';
import { CatalogPricingPort } from '../../common/contracts/ports';
import type { Tx } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { ApiError } from '../../common/errors/api-error';

@Injectable()
export class CatalogPricingService implements CatalogPricingPort {
  async resolve(tx: Tx, items: Api.CartItem[]): Promise<Api.QuoteItem[]> {
    const products = await tx.product.findMany({
      where: { id: { in: [...new Set(items.map(item => item.productId))] }, active: true },
      include: { sizes: true, toppings: { include: { topping: true } } },
    });
    return items.map(item => {
      const product = products.find(p => p.id === item.productId);
      if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Sản phẩm không tồn tại hoặc đã ngừng bán');
      const size = product.sizes.find(s => s.size === item.size);
      const allowed = product.toppings.filter(t => t.topping.active).map(t => t.topping);
      const selected = (item.toppingIds ?? []).map(id => allowed.find(t => t.id === id));
      if (!size || selected.some(t => !t)) {
        throw new ApiError(422, 'INVALID_SELECTION', 'Size hoặc topping không còn hợp lệ');
      }
      const toppings = selected.map(t => ({ id: t!.id, name: t!.name, price: t!.price }));
      const unitPrice = size.price + toppings.reduce((sum, t) => sum + t.price, 0);
      return { productId: product.id, productName: product.name, size: item.size,
        sizePrice: size.price, toppings, qty: item.qty, unitPrice, lineTotal: unitPrice * item.qty };
    });
  }
}

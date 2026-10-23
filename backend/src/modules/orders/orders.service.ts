// Owner: TV3 — #7/#8. quote/create: Issue #7. cancel/transition: Issue #8 (still stubs).
import { Injectable } from '@nestjs/common';
import { CatalogPricingPort, IdempotencyPort, OrdersPort, PromotionRulesPort } from '../../common/contracts/ports';
import type { IdempotentResult, PromotionSnapshot, Tx } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { UnitOfWork } from '../../common/database/unit-of-work';
import { notImplemented } from '../../common/errors/api-error';
import { buildQuote, generateOrderCode, normalizeCartItems } from './domain/order-pricing';
import { toApiOrder } from './order.mapper';

@Injectable()
export class OrdersService implements OrdersPort {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly catalog: CatalogPricingPort,
    private readonly promotions: PromotionRulesPort,
    private readonly idempotency: IdempotencyPort,
  ) {}

  // Preview only: no order, no stock hold and no promotion counter change (business-rules §2.7).
  async quote(_userId: string, input: Api.OrderRequest): Promise<Api.Quote> {
    const items = normalizeCartItems(input.items);
    return this.unitOfWork.run(async tx => (await this.priceCart(tx, items, input.promotionCode)).quote);
  }

  // userId always comes from the JWT; prices always come from the catalog, never from the client.
  create(userId: string, key: string, input: Api.OrderRequest): Promise<IdempotentResult<Api.Order>> {
    const items = normalizeCartItems(input.items);
    return this.idempotency.execute(
      {
        userId,
        scope: 'CREATE_ORDER',
        key,
        payload: { items, promotionCode: input.promotionCode ?? null },
        httpStatus: 201,
      },
      async tx => {
        const { quote, promo } = await this.priceCart(tx, items, input.promotionCode);
        if (promo.promotionId) await this.promotions.reserve(tx, promo.promotionId);
        // TODO(#9): await this.inventory.reserve(tx, items) goes here, in the same transaction.
        const order = await tx.order.create({
          data: {
            code: generateOrderCode(),
            userId,
            promotionId: promo.promotionId,
            promotionCode: quote.promotionCode,
            subtotal: quote.subtotal,
            discount: quote.discount,
            total: quote.total,
            status: 'PENDING',
            reservationStatus: 'HELD',
            version: 0,
            items: {
              create: quote.items.map(item => ({
                productId: item.productId,
                productName: item.productName,
                size: item.size,
                sizePrice: item.sizePrice,
                unitPrice: item.unitPrice,
                qty: item.qty,
                lineTotal: item.lineTotal,
                toppings: {
                  create: item.toppings.map(topping => ({ toppingId: topping.id, name: topping.name, price: topping.price })),
                },
              })),
            },
          },
          include: { items: { include: { toppings: true } } },
        });
        await tx.orderEvent.create({
          data: { orderId: order.id, actorUserId: userId, fromStatus: null, toStatus: 'PENDING', orderVersion: order.version },
        });
        return toApiOrder(order);
      },
    );
  }

  cancel(_userId: string, _orderId: string, _expectedVersion: number): Promise<Api.Order> {
    return notImplemented('orders.cancel');
  }
  transition(_staffId: string, _orderId: string, _input: Api.StatusRequest): Promise<Api.Order> {
    return notImplemented('orders.transition');
  }

  // Shared by quote and create so both use the same formula: catalog price -> subtotal -> promotion -> total.
  private async priceCart(
    tx: Tx,
    items: Api.CartItem[],
    promotionCode: string | undefined,
  ): Promise<{ quote: Api.Quote; promo: PromotionSnapshot }> {
    const resolved = await this.catalog.resolve(tx, items);
    const subtotal = buildQuote(resolved, { promotionId: null, promotionCode: null, discount: 0 }).subtotal;
    const promo = await this.promotions.price(tx, promotionCode, subtotal);
    return { quote: buildQuote(resolved, promo), promo };
  }
}

// Owner: TV3 — #7/#8. quote/create: Issue #7. cancel/transition: Issue #8.
import { Injectable } from '@nestjs/common';
import {
  CatalogPricingPort,
  IdempotencyPort,
  InventoryPort,
  LoyaltyTransactionsPort,
  OrderTransactionsPort,
  OrdersPort,
  PromotionRulesPort,
} from '../../common/contracts/ports';
import type { IdempotentResult, PromotionSnapshot, Tx } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { UnitOfWork } from '../../common/database/unit-of-work';
import { ApiError } from '../../common/errors/api-error';
import { buildQuote, generateOrderCode, normalizeCartItems } from './domain/order-pricing';
import { toApiOrder } from './order.mapper';

const STAFF_STATUSES: readonly Api.OrderStatus[] = ['PREPARING', 'READY', 'COMPLETED'];

@Injectable()
export class OrdersService implements OrdersPort {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly catalog: CatalogPricingPort,
    private readonly promotions: PromotionRulesPort,
    private readonly idempotency: IdempotencyPort,
    private readonly transitions: OrderTransactionsPort,
    private readonly loyalty: LoyaltyTransactionsPort,
    private readonly inventory: InventoryPort,
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
        await this.inventory.reserve(tx, items);
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

  // Customer cancel (PENDING / PAYMENT_FAILED / PAID). expectedVersion is required: a stale one is 409, and cancelling an
  // already CANCELLED order with its current version is a 200 that changes nothing (no second release/refund/reverse).
  cancel(userId: string, orderId: string, expectedVersion: number): Promise<Api.Order> {
    return this.unitOfWork.run(async tx => {
      const order = await this.transitions.loadOwned(tx, userId, orderId);
      if (order.status === 'CANCELLED' && order.version === expectedVersion) return toApiOrder(order);
      const cancelled = await this.transitions.transition(tx, { orderId, actorUserId: userId, expectedVersion, toStatus: 'CANCELLED' });
      if (order.status === 'PAID') {
        // Mock refund + point reversal commit or roll back together with the cancellation and the stock/promo release.
        await tx.payment.updateMany({ where: { orderId, status: 'SUCCEEDED' }, data: { status: 'REFUNDED' } });
        await this.loyalty.reverse(tx, order);
      }
      return toApiOrder(cancelled);
    });
  }

  // STAFF only (guard on the controller): PAID -> PREPARING -> READY -> COMPLETED, no skipped steps.
  async transition(staffId: string, orderId: string, input: Api.StatusRequest): Promise<Api.Order> {
    if (!STAFF_STATUSES.includes(input.status)) {
      throw new ApiError(409, 'INVALID_ORDER_TRANSITION', `Không thể chuyển sang ${input.status} bằng endpoint này`);
    }
    return this.unitOfWork.run(async tx =>
      toApiOrder(await this.transitions.transition(tx, { orderId, actorUserId: staffId, expectedVersion: input.expectedVersion, toStatus: input.status })),
    );
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

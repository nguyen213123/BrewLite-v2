// Owner: TV3 — #7/#8. quote/create: Issue #7. cancel/transition: Issue #8.
import { Injectable, Optional } from '@nestjs/common';
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
import { PrismaService } from '../../prisma/prisma.service';
import { formatVnPayDate, VnPayService } from '../payments/vnpay.service';
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
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly vnpay?: VnPayService,
  ) {}

  // Preview only: no order, no stock hold and no promotion counter change (business-rules §2.7).
  async quote(_userId: string, input: Api.OrderRequest): Promise<Api.Quote> {
    const items = normalizeCartItems(input.items);
    return this.unitOfWork.run(async tx => {
      const { quote } = await this.priceCart(tx, items, input.promotionCode);
      await this.inventory.check(tx, items);
      return quote;
    });
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
        await this.inventory.reserve(tx, order.id, items);
        await tx.orderEvent.create({
          data: { orderId: order.id, actorUserId: userId, fromStatus: null, toStatus: 'PENDING', orderVersion: order.version },
        });
        return toApiOrder(order);
      },
    );
  }

  // Customer cancel (PENDING / PAYMENT_FAILED / PAID). expectedVersion is required: a stale one is 409, and cancelling an
  // already CANCELLED order with its current version is a 200 that changes nothing (no second release/refund/reverse).
  // Đối với đơn PAID đã thanh toán qua VNPay, bắt buộc đi qua quy trình hoàn tiền VNPay và xác minh chữ ký trước khi hủy đơn.
  async cancel(userId: string, orderId: string, expectedVersion: number): Promise<Api.Order> {
    if (this.prisma && typeof this.prisma.order?.findFirst === 'function' && this.vnpay) {
      const existingOrder = await this.prisma.order.findFirst({
        where: { id: orderId, userId },
        include: {
          user: true,
          items: { include: { toppings: true } },
          payments: {
            where: { status: { in: ['SUCCEEDED', 'REFUNDED'] } },
            include: { idempotency: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      const vnpayPayment = existingOrder?.payments[0];
      const vnpayMeta = (vnpayPayment?.idempotency?.response ?? {}) as Record<string, unknown>;
      const isVnPayOrder =
        Boolean(existingOrder && vnpayPayment) &&
        (vnpayMeta.provider === 'VNPAY' ||
          vnpayPayment!.idempotencyKey.startsWith(`${existingOrder!.code}_`));

      if (existingOrder && vnpayPayment && isVnPayOrder) {
        if (existingOrder.status === 'CANCELLED') {
          if (existingOrder.version === expectedVersion) {
            return toApiOrder(existingOrder);
          }
          throw new ApiError(409, 'ORDER_VERSION_CONFLICT', 'Đơn hàng đã thay đổi, vui lòng tải lại');
        }

        if (existingOrder.status === 'PAID') {
          if (existingOrder.version !== expectedVersion) {
            throw new ApiError(409, 'ORDER_VERSION_CONFLICT', 'Đơn hàng đã thay đổi, vui lòng tải lại');
          }

          if (vnpayMeta.refundStatus === 'PENDING_RECONCILIATION') {
            throw new ApiError(
              409,
              'REFUND_PENDING_RECONCILIATION',
              'Yêu cầu hoàn tiền VNPay trước đó chưa rõ kết quả và đang chờ đối soát. Không gửi hoàn tiền lặp.',
            );
          }

          if (vnpayPayment.status === 'REFUNDED') {
            throw new ApiError(409, 'PAYMENT_ALREADY_REFUNDED', 'Giao dịch này đã được hoàn tiền trước đó');
          }

          const lock = await this.prisma.idempotencyRecord.updateMany({
            where: {
              id: vnpayPayment.idempotencyRecordId,
              status: 'COMPLETED',
              httpStatus: 200,
            },
            data: {
              httpStatus: 201,
            },
          });

          if (lock.count !== 1) {
            throw new ApiError(
              409,
              'REFUND_IN_PROGRESS',
              'Giao dịch đang trong quá trình xử lý hoàn tiền hoặc chờ đối soát, không gửi hoàn tiền trùng lặp',
            );
          }

          const txnRef =
            typeof vnpayMeta.txnRef === 'string' && vnpayMeta.txnRef.length > 0
              ? vnpayMeta.txnRef
              : vnpayPayment.idempotencyKey;
          const transactionNo =
            typeof vnpayMeta.transactionNo === 'string' && vnpayMeta.transactionNo.length > 0
              ? vnpayMeta.transactionNo
              : vnpayPayment.id.slice(0, 8);
          const payDate =
            typeof vnpayMeta.payDate === 'string' && vnpayMeta.payDate.length > 0
              ? vnpayMeta.payDate
              : formatVnPayDate(vnpayPayment.createdAt);

          const gatewayResult = await this.vnpay.refundTransaction({
            txnRef,
            transactionDate: payDate,
            orderCode: existingOrder.code,
            amount: vnpayPayment.amount,
            transactionNo,
            createBy: existingOrder.user.email,
            ipAddr: '127.0.0.1',
          });

          if (gatewayResult.outcome === 'UNCERTAIN') {
            await this.prisma.idempotencyRecord.update({
              where: { id: vnpayPayment.idempotencyRecordId },
              data: {
                status: 'COMPLETED',
                httpStatus: 201,
                response: {
                  ...vnpayMeta,
                  refundStatus: 'PENDING_RECONCILIATION',
                  lastRefundResponseCode: gatewayResult.vnp_ResponseCode,
                  lastRefundMessage: gatewayResult.vnp_Message,
                },
              },
            });

            throw new ApiError(
              502,
              'VNPAY_REFUND_UNCERTAIN',
              'Chưa xác nhận được kết quả hoàn tiền từ cổng VNPay. Giao dịch được giữ ở trạng thái chờ đối soát, không hủy đơn và không gửi hoàn tiền lặp.',
            );
          }

          if (gatewayResult.outcome === 'REJECTED') {
            await this.prisma.idempotencyRecord.update({
              where: { id: vnpayPayment.idempotencyRecordId },
              data: {
                status: 'COMPLETED',
                httpStatus: 200,
                response: {
                  ...vnpayMeta,
                  refundStatus: 'FAILED',
                  lastRefundResponseCode: gatewayResult.vnp_ResponseCode,
                  lastRefundMessage: gatewayResult.vnp_Message,
                },
              },
            });

            throw new ApiError(
              502,
              'VNPAY_REFUND_FAILED',
              `Cổng VNPay từ chối hoàn tiền: ${gatewayResult.vnp_Message} (Mã: ${gatewayResult.vnp_ResponseCode})`,
            );
          }

          try {
            return await this.unitOfWork.run(async (tx) => {
              const order = await this.transitions.loadOwned(tx, userId, orderId);
              const cancelled = await this.transitions.transition(tx, {
                orderId,
                actorUserId: userId,
                expectedVersion,
                toStatus: 'CANCELLED',
              });
              await tx.payment.update({
                where: { id: vnpayPayment.id },
                data: { status: 'REFUNDED' },
              });
              await this.loyalty.reverse(tx, order);
              await tx.idempotencyRecord.update({
                where: { id: vnpayPayment.idempotencyRecordId },
                data: {
                  status: 'COMPLETED',
                  httpStatus: 200,
                  response: {
                    ...vnpayMeta,
                    refundStatus: 'REFUNDED',
                    refundTransactionNo: gatewayResult.vnp_TransactionNo,
                    refundResponseCode: gatewayResult.vnp_ResponseCode,
                  },
                },
              });
              return toApiOrder(cancelled);
            });
          } catch (error) {
            await this.prisma.idempotencyRecord.update({
              where: { id: vnpayPayment.idempotencyRecordId },
              data: {
                status: 'COMPLETED',
                httpStatus: 201,
                response: {
                  ...vnpayMeta,
                  refundStatus: 'PENDING_RECONCILIATION',
                },
              },
            });
            throw error;
          }
        }
      }
    }

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
    return this.unitOfWork.run(async tx => {
      const updated = await this.transitions.transition(tx, {
        orderId,
        actorUserId: staffId,
        expectedVersion: input.expectedVersion,
        toStatus: input.status,
      });
      if (input.status === 'COMPLETED') {
        await this.loyalty.earn(tx, updated);
      }
      return toApiOrder(updated);
    });
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

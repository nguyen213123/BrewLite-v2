// Owner: TV5 — #10. Replace stubs here; keep public DTO/port contracts.
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  IdempotencyPort,
  LoyaltyTransactionsPort,
  MockPaymentGatewayPort,
  OrderTransactionsPort,
  PaymentsPort,
} from '../../common/contracts/ports';
import type { IdempotentResult, StoredOrder, Tx } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { ApiError } from '../../common/errors/api-error';
import { isUniqueConstraintError } from '../idempotency/idempotency.service';

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toApiOrder(order: StoredOrder): Api.Order {
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
    createdAt: toIsoString(order.createdAt),
    updatedAt: toIsoString(order.updatedAt),
    items: order.items.map(item => ({
      productId: item.productId,
      productName: item.productName,
      size: item.size,
      sizePrice: item.sizePrice,
      toppings: item.toppings.map(topping => ({
        id: topping.toppingId,
        name: topping.name,
        price: topping.price,
      })),
      qty: item.qty,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      id: item.id,
    })),
  };
}

@Injectable()
export class PaymentsService implements PaymentsPort {
  constructor(
    private readonly idempotency: IdempotencyPort,
    private readonly orderTransactions: OrderTransactionsPort,
    private readonly loyaltyTransactions: LoyaltyTransactionsPort,
    private readonly gateway: MockPaymentGatewayPort,
  ) {}

  async pay(userId: string, key: string, input: Api.PaymentRequest): Promise<IdempotentResult<Api.PaymentResult>> {
    const normalizedKey = key.trim().toLowerCase();
    const normalizedOrderId = input.orderId.trim().toLowerCase();
    const mockOutcome: 'SUCCESS' | 'FAIL' = input.mockOutcome ?? 'SUCCESS';
    const canonicalPayload = {
      orderId: normalizedOrderId,
      method: input.method,
      mockOutcome,
    };

    return this.idempotency.execute<Api.PaymentResult>(
      {
        userId,
        scope: 'PAY_ORDER',
        key: normalizedKey,
        payload: canonicalPayload,
        httpStatus: 200,
      },
      async (tx: Tx) => {
        let order = await this.orderTransactions.loadOwned(tx, userId, normalizedOrderId);
        if (!order || order.userId !== userId) {
          throw new ApiError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng');
        }

        if (order.status === 'PAYMENT_FAILED') {
          order = await this.orderTransactions.prepareRetry(tx, order);
        } else if (order.status !== 'PENDING') {
          throw new ApiError(409, 'ORDER_NOT_PAYABLE', 'Đơn hàng không còn ở trạng thái có thể thanh toán');
        }

        if (order.status !== 'PENDING') {
          throw new ApiError(409, 'ORDER_NOT_PAYABLE', 'Đơn hàng không còn ở trạng thái có thể thanh toán');
        }

        const gatewayResult = await this.gateway.charge({
          orderId: order.id,
          amount: order.total,
          method: input.method,
          mockOutcome,
        });

        const loyaltyPointsEarned = 0;
        if (gatewayResult.status === 'SUCCEEDED') {
          order = await this.orderTransactions.transition(tx, {
            orderId: order.id,
            actorUserId: userId,
            expectedVersion: order.version,
            toStatus: 'PAID',
          });
        } else {
          order = await this.orderTransactions.transition(tx, {
            orderId: order.id,
            actorUserId: userId,
            expectedVersion: order.version,
            toStatus: 'PAYMENT_FAILED',
          });
        }

        const idempotencyRecordId = await this.resolveIdempotencyRecordId(tx, userId, normalizedKey, canonicalPayload);

        let payment;
        try {
          payment = await tx.payment.create({
            data: {
              orderId: order.id,
              idempotencyRecordId,
              idempotencyKey: normalizedKey,
              amount: order.total,
              method: input.method,
              status: gatewayResult.status,
            },
          });
        } catch (error: unknown) {
          if (isUniqueConstraintError(error)) {
            throw new ApiError(409, 'ORDER_NOT_PAYABLE', 'Đơn hàng đã có giao dịch thanh toán thành công');
          }
          throw error;
        }

        return {
          payment: {
            id: payment.id,
            orderId: payment.orderId,
            idempotencyKey: payment.idempotencyKey,
            amount: payment.amount,
            method: payment.method,
            status: payment.status,
            createdAt: toIsoString(payment.createdAt),
            updatedAt: toIsoString(payment.updatedAt),
          },
          order: toApiOrder(order),
          loyaltyPointsEarned,
        };
      },
    );
  }

  private async resolveIdempotencyRecordId(
    tx: Tx,
    userId: string,
    key: string,
    canonicalPayload: { orderId: string; method: Api.PaymentMethod; mockOutcome: 'SUCCESS' | 'FAIL' },
  ): Promise<string> {
    const existing = await tx.idempotencyRecord.findUnique({
      where: {
        userId_scope_key: {
          userId,
          scope: 'PAY_ORDER',
          key,
        },
      },
      select: { id: true },
    });
    if (existing) {
      return existing.id;
    }

    const requestHash = createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex');
    const created = await tx.idempotencyRecord.create({
      data: {
        userId,
        scope: 'PAY_ORDER',
        key,
        requestHash,
        status: 'PROCESSING',
      },
      select: { id: true },
    });
    return created.id;
  }
}

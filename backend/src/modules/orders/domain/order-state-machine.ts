import type { OrderStatus } from '../../../common/contracts/api.generated';
import { ApiError } from '../../../common/errors/api-error';

export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING: ['PAID', 'PAYMENT_FAILED', 'CANCELLED'],
  PAID: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY'],
  READY: ['COMPLETED'],
  COMPLETED: [],
  PAYMENT_FAILED: ['PENDING', 'CANCELLED'],
  CANCELLED: [],
};

// The owner still needs conditional writes/version, audit and side effects in one transaction.
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!ORDER_TRANSITIONS[from]?.includes(to)) {
    throw new ApiError(409, 'INVALID_ORDER_TRANSITION', `Không thể chuyển ${from} sang ${to}`);
  }
}

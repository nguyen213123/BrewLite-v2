// Shared interfaces: change via a contract PR, not inside a feature branch alone.
import type { Prisma } from '../../generated/prisma/client';
import type * as Api from './api.generated';
import type { CurrentUserData } from '../security/security';

export type Tx = Prisma.TransactionClient;
export type PageQuery = { page: number; limit: number };
export type IdempotentResult<T> = { data: T; replayed: boolean };
export type StoredOrder = Prisma.OrderGetPayload<{ include: { items: { include: { toppings: true } } } }>;
export type PromotionSnapshot = { promotionId: string | null; promotionCode: string | null; discount: number };
export type ActivePromotion = {
  id: string;
  code: string;
  type: 'FIXED' | 'PERCENT';
  value: number;
  minSubtotal: number;
  maxDiscount: number | null;
  maxUses: number | null;
  usedCount: number;
  startsAt: string;
  endsAt: string;
};

export abstract class ProductsPort {
  abstract list(query: PageQuery): Promise<Api.ProductPage>;
  abstract detail(id: string): Promise<Api.ProductDetail>;
}
export abstract class CatalogPricingPort {
  abstract resolve(tx: Tx, items: Api.CartItem[]): Promise<Api.QuoteItem[]>;
}
export abstract class AuthPort {
  abstract register(input: Api.AuthRequest): Promise<Api.AuthResponse>;
  abstract login(input: Api.LoginRequest): Promise<Api.AuthResponse>;
  abstract me(user: CurrentUserData): Promise<Api.User>;
}
export abstract class OrdersPort {
  abstract quote(userId: string, input: Api.OrderRequest): Promise<Api.Quote>;
  abstract create(userId: string, key: string, input: Api.OrderRequest): Promise<IdempotentResult<Api.Order>>;
  abstract cancel(userId: string, orderId: string, expectedVersion: number): Promise<Api.Order>;
  abstract transition(staffId: string, orderId: string, input: Api.StatusRequest): Promise<Api.Order>;
}
export abstract class OrderReadPort {
  abstract listMine(userId: string, query: PageQuery): Promise<Api.OrderPage>;
  abstract findMine(userId: string, orderId: string): Promise<Api.Order>;
}
export abstract class OrderTransactionsPort {
  abstract loadOwned(tx: Tx, userId: string, orderId: string): Promise<StoredOrder>;
  abstract transition(tx: Tx, input: { orderId: string; actorUserId: string; expectedVersion: number; toStatus: Api.OrderStatus }): Promise<StoredOrder>;
  abstract prepareRetry(tx: Tx, order: StoredOrder): Promise<StoredOrder>;
}
export abstract class InventoryPort {
  abstract reserve(tx: Tx, items: Api.CartItem[]): Promise<void>;
  abstract release(tx: Tx, order: StoredOrder): Promise<void>;
}
export abstract class PromotionsPort {
  abstract validate(userId: string, input: Api.PromotionValidationRequest): Promise<Api.PromotionValidation>;
  listActive?(): Promise<ActivePromotion[]>;
}
export abstract class PromotionRulesPort {
  abstract price(tx: Tx, code: string | undefined, subtotal: number): Promise<PromotionSnapshot>;
  abstract reserve(tx: Tx, promotionId: string): Promise<void>;
  abstract release(tx: Tx, promotionId: string): Promise<void>;
}
export abstract class LoyaltyPort {
  abstract balance(userId: string): Promise<Api.LoyaltyBalance>;
  abstract entries(userId: string, query: PageQuery): Promise<Api.LoyaltyPage>;
}
export abstract class LoyaltyTransactionsPort {
  abstract earn(tx: Tx, order: StoredOrder): Promise<number>;
  abstract reverse(tx: Tx, order: StoredOrder): Promise<void>;
}
export abstract class PaymentsPort {
  abstract pay(userId: string, key: string, input: Api.PaymentRequest): Promise<IdempotentResult<Api.PaymentResult>>;
}
export abstract class MockPaymentGatewayPort {
  abstract charge(input: { orderId: string; amount: number; method: Api.PaymentMethod; mockOutcome: 'SUCCESS' | 'FAIL' }): Promise<{ status: 'SUCCEEDED' | 'FAILED' }>;
}
export abstract class IdempotencyPort {
  abstract execute<T>(input: { userId: string; scope: 'CREATE_ORDER' | 'PAY_ORDER'; key: string; payload: unknown; httpStatus: 200 | 201 }, work: (tx: Tx) => Promise<T>): Promise<IdempotentResult<T>>;
}

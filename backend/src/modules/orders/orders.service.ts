// Owner: TV3 — #7/#8. Replace stubs here; keep public DTO/port contracts.
import { Injectable } from '@nestjs/common';
import { OrdersPort } from '../../common/contracts/ports';
import type { IdempotentResult } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { notImplemented } from '../../common/errors/api-error';

@Injectable()
export class OrdersService implements OrdersPort {
  quote(_userId: string, _input: Api.OrderRequest): Promise<Api.Quote> {
    return notImplemented('orders.quote');
  }
  create(_userId: string, _key: string, _input: Api.OrderRequest): Promise<IdempotentResult<Api.Order>> {
    return notImplemented('orders.create');
  }
  cancel(_userId: string, _orderId: string, _expectedVersion: number): Promise<Api.Order> {
    return notImplemented('orders.cancel');
  }
  transition(_staffId: string, _orderId: string, _input: Api.StatusRequest): Promise<Api.Order> {
    return notImplemented('orders.transition');
  }
}

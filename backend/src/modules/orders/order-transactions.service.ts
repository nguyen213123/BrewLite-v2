// Owner: TV3 — #7/#8. Replace stubs here; keep public DTO/port contracts.
import { Injectable } from '@nestjs/common';
import { OrderTransactionsPort } from '../../common/contracts/ports';
import type { Tx, StoredOrder } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { notImplemented } from '../../common/errors/api-error';

@Injectable()
export class OrderTransactionsService implements OrderTransactionsPort {
  loadOwned(_tx: Tx, _userId: string, _orderId: string): Promise<StoredOrder> {
    return notImplemented('orders.loadOwned');
  }
  transition(_tx: Tx, _input: { orderId: string; actorUserId: string; expectedVersion: number; toStatus: Api.OrderStatus }): Promise<StoredOrder> {
    return notImplemented('orders.transition');
  }
  prepareRetry(_tx: Tx, _order: StoredOrder): Promise<StoredOrder> {
    return notImplemented('orders.prepareRetry');
  }
}

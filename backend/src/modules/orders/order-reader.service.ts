// Owner: TV3 — #7/#8. Replace stubs here; keep public DTO/port contracts.
import { Injectable } from '@nestjs/common';
import { OrderReadPort } from '../../common/contracts/ports';
import type { PageQuery } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { notImplemented } from '../../common/errors/api-error';

@Injectable()
export class OrderReaderService implements OrderReadPort {
  listMine(_userId: string, _query: PageQuery): Promise<Api.OrderPage> {
    return notImplemented('orders.listMine');
  }
  findMine(_userId: string, _orderId: string): Promise<Api.Order> {
    return notImplemented('orders.findMine');
  }
}

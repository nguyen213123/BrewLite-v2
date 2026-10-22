// Owner: TV4 — #15. Replace stubs here; keep public DTO/port contracts.
import { Injectable } from '@nestjs/common';
import { LoyaltyPort, LoyaltyTransactionsPort } from '../../common/contracts/ports';
import type { PageQuery, Tx, StoredOrder } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { notImplemented } from '../../common/errors/api-error';

@Injectable()
export class LoyaltyService implements LoyaltyPort, LoyaltyTransactionsPort {
  balance(_userId: string): Promise<Api.LoyaltyBalance> {
    return notImplemented('loyalty.balance');
  }
  entries(_userId: string, _query: PageQuery): Promise<Api.LoyaltyPage> {
    return notImplemented('loyalty.entries');
  }
  earn(_tx: Tx, _order: StoredOrder): Promise<number> {
    return notImplemented('loyalty.earn');
  }
  reverse(_tx: Tx, _order: StoredOrder): Promise<void> {
    return notImplemented('loyalty.reverse');
  }
}

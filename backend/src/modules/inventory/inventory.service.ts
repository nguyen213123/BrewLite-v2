// Owner: TV3 — #9. Replace stubs here; keep public DTO/port contracts.
import { Injectable } from '@nestjs/common';
import { InventoryPort } from '../../common/contracts/ports';
import type { Tx, StoredOrder } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { notImplemented } from '../../common/errors/api-error';

@Injectable()
export class InventoryService implements InventoryPort {
  reserve(_tx: Tx, _items: Api.CartItem[]): Promise<void> {
    return notImplemented('inventory.reserve');
  }
  release(_tx: Tx, _order: StoredOrder): Promise<void> {
    return notImplemented('inventory.release');
  }
}

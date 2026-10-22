// Owner: TV1 — #2/#3. Replace stubs here; keep public DTO/port contracts.
import { Injectable } from '@nestjs/common';
import { CatalogPricingPort } from '../../common/contracts/ports';
import type { Tx } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { notImplemented } from '../../common/errors/api-error';

@Injectable()
export class CatalogPricingService implements CatalogPricingPort {
  resolve(_tx: Tx, _items: Api.CartItem[]): Promise<Api.QuoteItem[]> {
    return notImplemented('products.resolve');
  }
}

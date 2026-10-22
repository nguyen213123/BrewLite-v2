// Owner: TV1 — #2/#3. Replace stubs here; keep public DTO/port contracts.
import { Injectable } from '@nestjs/common';
import { ProductsPort } from '../../common/contracts/ports';
import type { PageQuery } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { notImplemented } from '../../common/errors/api-error';

@Injectable()
export class ProductsService implements ProductsPort {
  list(_query: PageQuery): Promise<Api.ProductPage> {
    return notImplemented('products.list');
  }
  detail(_id: string): Promise<Api.ProductDetail> {
    return notImplemented('products.detail');
  }
}

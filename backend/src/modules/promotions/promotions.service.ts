// Owner: TV1 — #14. Replace stubs here; keep public DTO/port contracts.
import { Injectable } from '@nestjs/common';
import { PromotionsPort, PromotionRulesPort } from '../../common/contracts/ports';
import type { Tx, PromotionSnapshot } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { notImplemented } from '../../common/errors/api-error';

@Injectable()
export class PromotionsService implements PromotionsPort, PromotionRulesPort {
  validate(_userId: string, _input: Api.PromotionValidationRequest): Promise<Api.PromotionValidation> {
    return notImplemented('promotions.validate');
  }
  price(_tx: Tx, _code: string | undefined, _subtotal: number): Promise<PromotionSnapshot> {
    return notImplemented('promotions.price');
  }
  reserve(_tx: Tx, _promotionId: string): Promise<void> {
    return notImplemented('promotions.reserve');
  }
  release(_tx: Tx, _promotionId: string): Promise<void> {
    return notImplemented('promotions.release');
  }
}

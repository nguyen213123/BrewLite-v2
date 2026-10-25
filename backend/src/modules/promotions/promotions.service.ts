// Owner: TV1 — #14. Validate/tính giảm giá; reserve/release nhận transaction từ caller (TV3/TV5).
import { Injectable } from '@nestjs/common';
import { CatalogPricingPort, PromotionsPort, PromotionRulesPort } from '../../common/contracts/ports';
import type { Tx, PromotionSnapshot } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { ApiError } from '../../common/errors/api-error';
import { UnitOfWork } from '../../common/database/unit-of-work';
import { evaluatePromotion, normalizeCode } from './promotion-rules';
import { buildQuote, normalizeCartItems } from '../orders/domain/order-pricing';


const invalidPromotion = () => new ApiError(422, 'PROMOTION_INVALID', 'Mã không hợp lệ hoặc không đủ điều kiện');
const exhaustedPromotion = () => new ApiError(409, 'PROMOTION_EXHAUSTED', 'Mã khuyến mãi đã hết lượt sử dụng');

@Injectable()
export class PromotionsService implements PromotionsPort, PromotionRulesPort {
  constructor(private readonly catalog: CatalogPricingPort, private readonly unitOfWork: UnitOfWork) {}

  /** POST /promotions/validate — không giữ lượt, subtotal luôn tính từ catalog. */
  validate(_userId: string, input: Api.PromotionValidationRequest): Promise<Api.PromotionValidation> {
    return this.unitOfWork.run(async tx => {

      const items = await this.catalog.resolve(tx, normalizeCartItems(input.items));
      const subtotal = buildQuote(items, { promotionId: null, promotionCode: null, discount: 0 }).subtotal;
      const snapshot = await this.price(tx, input.code, subtotal);
      return {
        code: snapshot.promotionCode ?? normalizeCode(input.code),
        subtotal,
        discount: snapshot.discount,
        total: subtotal - snapshot.discount,
        currency: 'VND' as const,
      };
    });
  }

  /** Dùng chung cho quote/create/retry (TV3). Không tăng counter. */
  async price(tx: Tx, code: string | undefined, subtotal: number): Promise<PromotionSnapshot> {
    if (!code) return { promotionId: null, promotionCode: null, discount: 0 };
    const promotion = await tx.promotion.findUnique({ where: { code: normalizeCode(code) } });
    if (!promotion) throw invalidPromotion();
    const result = evaluatePromotion(promotion, subtotal, new Date());
    if (!result.ok) throw result.reason === 'EXHAUSTED' ? exhaustedPromotion() : invalidPromotion();
    return { promotionId: promotion.id, promotionCode: promotion.code, discount: result.discount };
  }

  /** Giữ 1 lượt bằng UPDATE có điều kiện (an toàn khi đồng thời, ReadCommitted). */
  async reserve(tx: Tx, promotionId: string): Promise<void> {
    const updated = await tx.$executeRaw`
      UPDATE "Promotion"
      SET "usedCount" = "usedCount" + 1, "version" = "version" + 1
      WHERE "id" = ${promotionId}::uuid AND "active" = true
        AND "startsAt" <= NOW() AND NOW() < "endsAt"
        AND ("maxUses" IS NULL OR "usedCount" < "maxUses")`;
    if (updated !== 1) throw exhaustedPromotion();
  }

  /** Trả đúng 1 lượt; caller (TV3/TV5) chỉ gọi khi reservation đang HELD/CONSUMED. */
  async release(tx: Tx, promotionId: string): Promise<void> {
    const updated = await tx.$executeRaw`
      UPDATE "Promotion"
      SET "usedCount" = "usedCount" - 1, "version" = "version" + 1
      WHERE "id" = ${promotionId}::uuid AND "usedCount" > 0`;
    if (updated !== 1) throw new Error(`Không thể trả lượt khuyến mãi ${promotionId}: usedCount đã bằng 0`);
  }
}

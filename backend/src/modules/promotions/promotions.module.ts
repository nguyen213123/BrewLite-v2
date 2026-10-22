import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { PromotionsController } from './promotions.controller';
import { PromotionsService } from './promotions.service';
import { PromotionsPort } from '../../common/contracts/ports';
import { PromotionRulesPort } from '../../common/contracts/ports';

@Module({
  imports: [ProductsModule],
  controllers: [PromotionsController],
  providers: [PromotionsService, { provide: PromotionsPort, useExisting: PromotionsService }, { provide: PromotionRulesPort, useExisting: PromotionsService }],
  exports: [PromotionsPort, PromotionRulesPort]
})
export class PromotionsModule {}

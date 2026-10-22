import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsPort } from '../../common/contracts/ports';
import { CatalogPricingService } from './catalog-pricing.service';
import { CatalogPricingPort } from '../../common/contracts/ports';

@Module({
  imports: [],
  controllers: [ProductsController],
  providers: [ProductsService, { provide: ProductsPort, useExisting: ProductsService }, CatalogPricingService, { provide: CatalogPricingPort, useExisting: CatalogPricingService }],
  exports: [ProductsPort, CatalogPricingPort]
})
export class ProductsModule {}

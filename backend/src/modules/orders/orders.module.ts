import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProductsModule } from '../products/products.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { VnPayService } from '../payments/vnpay.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersPort } from '../../common/contracts/ports';
import { OrderReaderService } from './order-reader.service';
import { OrderReadPort } from '../../common/contracts/ports';
import { OrderTransactionsService } from './order-transactions.service';
import { OrderTransactionsPort } from '../../common/contracts/ports';

@Module({
  imports: [PrismaModule, ProductsModule, PromotionsModule, InventoryModule, LoyaltyModule, IdempotencyModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    { provide: OrdersPort, useExisting: OrdersService },
    OrderReaderService,
    { provide: OrderReadPort, useExisting: OrderReaderService },
    OrderTransactionsService,
    { provide: OrderTransactionsPort, useExisting: OrderTransactionsService },
    VnPayService,
  ],
  exports: [OrdersPort, OrderReadPort, OrderTransactionsPort, VnPayService],
})
export class OrdersModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsPort, MockPaymentGatewayPort } from '../../common/contracts/ports';
import { MockPaymentGatewayService } from './mock-payment-gateway.service';
import { VnPayService } from './vnpay.service';

@Module({
  imports: [
    PrismaModule,
    OrdersModule,
    LoyaltyModule,
    IdempotencyModule,
    InventoryModule,
    PromotionsModule,
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    { provide: PaymentsPort, useExisting: PaymentsService },
    MockPaymentGatewayService,
    { provide: MockPaymentGatewayPort, useExisting: MockPaymentGatewayService },
    VnPayService,
  ],
  exports: [PaymentsPort, MockPaymentGatewayPort, VnPayService],
})
export class PaymentsModule {}

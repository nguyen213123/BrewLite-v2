import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { DatabaseModule } from './common/database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProductsModule } from './modules/products/products.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { OrdersModule } from './modules/orders/orders.module';
import { OrderHistoryModule } from './modules/order-history/order-history.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), PrismaModule, DatabaseModule, AuthModule,
    ProductsModule, PromotionsModule, OrderHistoryModule, OrdersModule, PaymentsModule, LoyaltyModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { OrderHistoryController } from './order-history.controller';

@Module({
  imports: [OrdersModule],
  controllers: [OrderHistoryController],
  providers: [],
  exports: []
})
export class OrderHistoryModule {}

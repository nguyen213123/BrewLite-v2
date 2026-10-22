import { Module } from '@nestjs/common';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyPort } from '../../common/contracts/ports';
import { LoyaltyTransactionsPort } from '../../common/contracts/ports';

@Module({
  imports: [],
  controllers: [LoyaltyController],
  providers: [LoyaltyService, { provide: LoyaltyPort, useExisting: LoyaltyService }, { provide: LoyaltyTransactionsPort, useExisting: LoyaltyService }],
  exports: [LoyaltyPort, LoyaltyTransactionsPort]
})
export class LoyaltyModule {}

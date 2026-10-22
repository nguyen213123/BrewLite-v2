import { Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyPort } from '../../common/contracts/ports';

@Module({
  imports: [],
  controllers: [],
  providers: [IdempotencyService, { provide: IdempotencyPort, useExisting: IdempotencyService }],
  exports: [IdempotencyPort]
})
export class IdempotencyModule {}

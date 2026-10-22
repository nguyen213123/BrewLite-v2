import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryPort } from '../../common/contracts/ports';

@Module({
  imports: [],
  controllers: [],
  providers: [InventoryService, { provide: InventoryPort, useExisting: InventoryService }],
  exports: [InventoryPort]
})
export class InventoryModule {}

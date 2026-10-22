import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Tx } from '../contracts/ports';

@Injectable()
export class UnitOfWork {
  constructor(private readonly prisma: PrismaService) {}

  // Business retries belong around the entire work callback, not an individual write.
  run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
      return work(tx);
    }, { maxWait: 3000, timeout: 5000, isolationLevel: 'ReadCommitted' });
  }
}

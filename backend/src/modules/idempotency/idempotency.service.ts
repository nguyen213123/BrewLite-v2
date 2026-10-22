// Owner: TV5 — #11. Replace stubs here; keep public DTO/port contracts.
import { Injectable } from '@nestjs/common';
import { IdempotencyPort } from '../../common/contracts/ports';
import type { Tx, IdempotentResult } from '../../common/contracts/ports';
import { notImplemented } from '../../common/errors/api-error';

@Injectable()
export class IdempotencyService implements IdempotencyPort {
  execute<T>(_input: { userId: string; scope: 'CREATE_ORDER' | 'PAY_ORDER'; key: string; payload: unknown; httpStatus: 200 | 201 }, _work: (tx: Tx) => Promise<T>): Promise<IdempotentResult<T>> {
    return notImplemented('idempotency.execute');
  }
}

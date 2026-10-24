import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Tx } from '../contracts/ports';
import { ApiError } from '../errors/api-error';

// business-rules §5: retry the WHOLE transaction at most 3 times for deadlock / serialization failures.
export const MAX_TRANSACTION_ATTEMPTS = 3;

// PostgreSQL SQLSTATE 40P01 (deadlock_detected) and 40001 (serialization_failure). With the pg driver adapter Prisma
// reports both as P2034 ("write conflict or a deadlock"); raw queries surface the SQLSTATE in P2010 meta or as `code`.
const TRANSIENT_SQLSTATES = new Set(['40P01', '40001']);

type ErrorLike = { code?: unknown; message?: unknown; meta?: { code?: unknown } | null; cause?: unknown };

// Last-resort match on PostgreSQL's own wording, in case a driver layer drops the code but keeps the message.
const TRANSIENT_MESSAGE = /deadlock detected|could not serialize access/i;

export function isTransientTransactionError(error: unknown, depth = 0): boolean {
  if (typeof error !== 'object' || error === null || depth > 2) return false;
  const { code, message, meta, cause } = error as ErrorLike;
  if (typeof code === 'string' && (code === 'P2034' || TRANSIENT_SQLSTATES.has(code))) return true;
  if (typeof meta?.code === 'string' && TRANSIENT_SQLSTATES.has(meta.code)) return true;
  if (error instanceof Error && typeof message === 'string' && TRANSIENT_MESSAGE.test(message)) return true;
  return isTransientTransactionError(cause, depth + 1);
}

const pause = (attempt: number) => new Promise<void>(resolve => setTimeout(resolve, attempt * 10 + Math.random() * 20));

@Injectable()
export class UnitOfWork {
  constructor(private readonly prisma: PrismaService) {}

  // Once PostgreSQL aborts a transaction (deadlock victim, serialization failure) nothing inside it can be retried:
  // the whole transaction has to start again. So the retry lives here, around the entire `work` callback, and every
  // attempt is a brand-new transaction that re-reads all data. Consequences for callers:
  //   - `work` can run up to MAX_TRANSACTION_ATTEMPTS times, so it must only touch the database through `tx`
  //     (no emails, no external calls, no in-memory state that survives an attempt);
  //   - the idempotency-key claim must be taken inside `work` (inside `tx`): a rolled-back attempt then leaves no key
  //     row and no side effect behind, and the next attempt claims it again from scratch;
  //   - business errors (ApiError), lock_timeout and transaction timeout are NOT retried and surface immediately.
  // When the attempts run out the request fails with 409 STOCK_CONFLICT and the client may resend with the same key.
  async run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(async tx => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
          return work(tx);
        }, { maxWait: 3000, timeout: 5000, isolationLevel: 'ReadCommitted' });
      } catch (error) {
        if (!isTransientTransactionError(error)) throw error;
        if (attempt >= MAX_TRANSACTION_ATTEMPTS) {
          throw new ApiError(409, 'STOCK_CONFLICT', 'Tồn kho đang thay đổi, vui lòng thử lại');
        }
        await pause(attempt);
      }
    }
  }
}

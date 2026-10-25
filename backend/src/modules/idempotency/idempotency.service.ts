// Owner: TV5 — #11. Replace stubs here; keep public DTO/port contracts.
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UnitOfWork } from '../../common/database/unit-of-work';
import { IdempotencyPort } from '../../common/contracts/ports';
import type { Tx, IdempotentResult } from '../../common/contracts/ports';
import type { Prisma } from '../../generated/prisma/client';
import { ApiError } from '../../common/errors/api-error';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LOCK_OR_TX_TIMEOUT_CODES = new Set(['55P03', '57014', 'P2028', 'P1008']);
const LOCK_OR_TX_TIMEOUT_MSG_REGEX =
  /55P03|57014|lock[_\s-]?timeout|lock_not_available|canceling statement due to (?:lock|statement) timeout|transaction (?:already closed|timed out)|expired transaction/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export function isUniqueConstraintError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 5) {
    return false;
  }
  const errObj = error as Record<string, unknown>;
  if (errObj.code === 'P2002' || errObj.code === '23505' || errObj.originalCode === '23505') {
    return true;
  }
  if (errObj.cause && isUniqueConstraintError(errObj.cause, depth + 1)) {
    return true;
  }
  if (errObj.meta && typeof errObj.meta === 'object') {
    const meta = errObj.meta as Record<string, unknown>;
    if (isUniqueConstraintError(meta, depth + 1)) {
      return true;
    }
    if (meta.driverAdapterError && isUniqueConstraintError(meta.driverAdapterError, depth + 1)) {
      return true;
    }
  }
  return false;
}

/**
 * Detects PostgreSQL lock_timeout (55P03), statement_timeout (57014),
 * or Prisma interactive transaction timeout (P2028 / P1008), including
 * errors wrapped inside @prisma/adapter-pg DriverAdapterError (P2039 / P2010).
 */
export function isLockOrTransactionTimeoutError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== 'object' || depth > 5) {
    return false;
  }
  const errObj = error as Record<string, unknown>;

  if (typeof errObj.code === 'string' && LOCK_OR_TX_TIMEOUT_CODES.has(errObj.code.toUpperCase())) {
    return true;
  }
  if (
    typeof errObj.originalCode === 'string' &&
    LOCK_OR_TX_TIMEOUT_CODES.has(errObj.originalCode.toUpperCase())
  ) {
    return true;
  }
  if (typeof errObj.message === 'string' && LOCK_OR_TX_TIMEOUT_MSG_REGEX.test(errObj.message)) {
    return true;
  }
  if (
    typeof errObj.originalMessage === 'string' &&
    LOCK_OR_TX_TIMEOUT_MSG_REGEX.test(errObj.originalMessage)
  ) {
    return true;
  }
  if (errObj.cause && isLockOrTransactionTimeoutError(errObj.cause, depth + 1)) {
    return true;
  }
  if (errObj.meta && typeof errObj.meta === 'object') {
    const meta = errObj.meta as Record<string, unknown>;
    if (isLockOrTransactionTimeoutError(meta, depth + 1)) {
      return true;
    }
    if (
      meta.driverAdapterError &&
      isLockOrTransactionTimeoutError(meta.driverAdapterError, depth + 1)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Deterministically serialize any JSON-compatible value with sorted object keys
 * so that identical semantic payloads produce identical canonical strings.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJsonStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys
    .filter(key => obj[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${canonicalJsonStringify(obj[key])}`);
  return `{${entries.join(',')}}`;
}

export function computePayloadHash(payload: unknown): string {
  const canonical = canonicalJsonStringify(payload);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

@Injectable()
export class IdempotencyService implements IdempotencyPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
  ) {}

  async execute<T>(
    input: {
      userId: string;
      scope: 'CREATE_ORDER' | 'PAY_ORDER';
      key: string;
      payload: unknown;
      httpStatus: 200 | 201;
    },
    work: (tx: Tx) => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    const normalizedKey = input.key.trim().toLowerCase();
    if (!isValidUuid(normalizedKey)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Idempotency-Key phải có dạng UUID', [
        { field: 'Idempotency-Key', message: 'Header bắt buộc có dạng UUID' },
      ]);
    }

    const requestHash = computePayloadHash(input.payload);

    // Fast path: Pre-check outside transaction to return replays without touching business state
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        userId_scope_key: {
          userId: input.userId,
          scope: input.scope,
          key: normalizedKey,
        },
      },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ApiError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'Khóa idempotency đã được dùng cho yêu cầu khác trong cùng phạm vi',
        );
      }
      if (existing.status === 'COMPLETED') {
        return { data: existing.response as T, replayed: true };
      }
      if (existing.status === 'PROCESSING') {
        throw new ApiError(
          409,
          'IDEMPOTENCY_IN_PROGRESS',
          'Yêu cầu đang được xử lý, vui lòng không gửi lại liên tiếp',
        );
      }
    }

    // Execute within a database transaction with lock_timeout and isolation.
    // Any unique constraint or lock/transaction timeout rolls back the transaction first,
    // and is then handled cleanly outside uow.run.
    let recordCreated = false;
    try {
      return await this.uow.run(async (tx: Tx) => {
        const createdRecord = await tx.idempotencyRecord.create({
          data: {
            userId: input.userId,
            scope: input.scope,
            key: normalizedKey,
            requestHash,
            status: 'PROCESSING',
          },
          select: { id: true },
        });
        recordCreated = true;

        // Execute caller's business logic within the same transaction
        const resultData = await work(tx);

        // Transition record to COMPLETED and commit response
        await tx.idempotencyRecord.update({
          where: { id: createdRecord.id },
          data: {
            status: 'COMPLETED',
            httpStatus: input.httpStatus,
            response: resultData as Prisma.InputJsonValue,
          },
        });

        return { data: resultData, replayed: false };
      });
    } catch (error: unknown) {
      if (!recordCreated && isUniqueConstraintError(error)) {
        // Concurrent race: Another request inserted this key and our transaction rolled back.
        const raceRecord = await this.prisma.idempotencyRecord.findUnique({
          where: {
            userId_scope_key: {
              userId: input.userId,
              scope: input.scope,
              key: normalizedKey,
            },
          },
        });
        if (raceRecord) {
          if (raceRecord.requestHash !== requestHash) {
            throw new ApiError(
              409,
              'IDEMPOTENCY_KEY_REUSED',
              'Khóa idempotency đã được dùng cho yêu cầu khác trong cùng phạm vi',
            );
          }
          if (raceRecord.status === 'COMPLETED') {
            return { data: raceRecord.response as T, replayed: true };
          }
        }
        throw new ApiError(
          409,
          'IDEMPOTENCY_IN_PROGRESS',
          'Yêu cầu đang được xử lý, vui lòng không gửi lại liên tiếp',
        );
      }

      if (isLockOrTransactionTimeoutError(error)) {
        // Contending request hit PostgreSQL lock_timeout (55P03) or transaction timeout.
        // Transaction is now rolled back; return 409 IDEMPOTENCY_IN_PROGRESS (with Retry-After: 1).
        throw new ApiError(
          409,
          'IDEMPOTENCY_IN_PROGRESS',
          'Yêu cầu đang được xử lý, vui lòng không gửi lại liên tiếp',
        );
      }

      throw error;
    }
  }
}

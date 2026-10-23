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

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
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

    // Execute within a database transaction with lock_timeout and isolation
    return this.uow.run(async (tx: Tx) => {
      let recordId: string;
      try {
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
        recordId = createdRecord.id;
      } catch (error: unknown) {
        if (isUniqueConstraintError(error)) {
          // Concurrent race: Another request just inserted this record
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
        throw error;
      }

      // Execute caller's business logic within the same transaction
      const resultData = await work(tx);

      // Transition record to COMPLETED and commit response
      await tx.idempotencyRecord.update({
        where: { id: recordId },
        data: {
          status: 'COMPLETED',
          httpStatus: input.httpStatus,
          response: resultData as Prisma.InputJsonValue,
        },
      });

      return { data: resultData, replayed: false };
    });
  }
}

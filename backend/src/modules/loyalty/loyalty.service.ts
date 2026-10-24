import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LoyaltyPort, LoyaltyTransactionsPort } from '../../common/contracts/ports';
import type { PageQuery, Tx, StoredOrder } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';

const EARN_RATE_VND = 10000;

@Injectable()
export class LoyaltyService implements LoyaltyPort, LoyaltyTransactionsPort {
  constructor(private readonly prisma: PrismaService) {}

  async balance(userId: string): Promise<Api.LoyaltyBalance> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { loyaltyPoints: true },
    });

    return {
      points: user?.loyaltyPoints ?? 0,
      earnRateVnd: EARN_RATE_VND,
    };
  }

  async entries(userId: string, query: PageQuery): Promise<Api.LoyaltyPage> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.max(1, Math.min(50, query.limit ?? 12));
    const skip = (page - 1) * limit;

    const [total, items] = await Promise.all([
      this.prisma.loyaltyEntry.count({ where: { userId } }),
      this.prisma.loyaltyEntry.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: items.map(entry => ({
        id: entry.id,
        orderId: entry.orderId,
        kind: entry.kind,
        points: entry.points,
        createdAt: entry.createdAt.toISOString(),
      })),
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async earn(tx: Tx, order: StoredOrder): Promise<number> {
    const points = Math.floor(order.total / EARN_RATE_VND);

    // Prevent duplicate earn on the same order
    const existing = await tx.loyaltyEntry.findUnique({
      where: {
        orderId_kind: {
          orderId: order.id,
          kind: 'EARN',
        },
      },
    });
    if (existing) {
      return existing.points;
    }

    await tx.loyaltyEntry.create({
      data: {
        userId: order.userId,
        orderId: order.id,
        kind: 'EARN',
        points,
      },
    });

    if (points > 0) {
      await tx.user.update({
        where: { id: order.userId },
        data: {
          loyaltyPoints: {
            increment: points,
          },
        },
      });
    }

    return points;
  }

  async reverse(tx: Tx, order: StoredOrder): Promise<void> {
    // Prevent duplicate reverse on the same order
    const existingReverse = await tx.loyaltyEntry.findUnique({
      where: {
        orderId_kind: {
          orderId: order.id,
          kind: 'REVERSE',
        },
      },
    });
    if (existingReverse) {
      return;
    }

    // Find the original EARN entry to determine how many points were earned
    const earnEntry = await tx.loyaltyEntry.findUnique({
      where: {
        orderId_kind: {
          orderId: order.id,
          kind: 'EARN',
        },
      },
    });
    if (!earnEntry) {
      return;
    }

    const pointsToReverse = Math.abs(earnEntry.points);
    const reversePoints = -pointsToReverse;

    await tx.loyaltyEntry.create({
      data: {
        userId: order.userId,
        orderId: order.id,
        kind: 'REVERSE',
        points: reversePoints,
      },
    });

    if (pointsToReverse > 0) {
      await tx.user.update({
        where: { id: order.userId },
        data: {
          loyaltyPoints: {
            decrement: pointsToReverse,
          },
        },
      });
    }
  }
}

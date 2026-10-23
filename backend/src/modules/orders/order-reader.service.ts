import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderReadPort } from '../../common/contracts/ports';
import type { PageQuery } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { ApiError } from '../../common/errors/api-error';

@Injectable()
export class OrderReaderService implements OrderReadPort {
  constructor(private readonly prisma: PrismaService) {}

  async listMine(userId: string, query: PageQuery): Promise<Api.OrderPage> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.max(1, Math.min(50, query.limit ?? 12));
    const skip = (page - 1) * limit;

    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where: { userId } }),
      this.prisma.order.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: orders.map(order => ({
        id: order.id,
        code: order.code,
        status: order.status,
        reservationStatus: order.reservationStatus,
        version: order.version,
        subtotal: order.subtotal,
        discount: order.discount,
        total: order.total,
        currency: 'VND',
        promotionCode: order.promotionCode,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
      })),
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async findMine(userId: string, orderId: string): Promise<Api.Order> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            toppings: true,
          },
        },
      },
    });

    if (!order || order.userId !== userId) {
      throw new ApiError(404, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng');
    }

    return {
      id: order.id,
      code: order.code,
      status: order.status,
      reservationStatus: order.reservationStatus,
      version: order.version,
      subtotal: order.subtotal,
      discount: order.discount,
      total: order.total,
      currency: 'VND',
      promotionCode: order.promotionCode,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      items: order.items.map(item => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        size: item.size,
        sizePrice: item.sizePrice,
        qty: item.qty,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        toppings: item.toppings.map(t => ({
          id: t.toppingId,
          name: t.name,
          price: t.price,
        })),
      })),
    };
  }
}

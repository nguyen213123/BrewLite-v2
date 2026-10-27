// Owner: TV1 — #2. API danh sách / chi tiết sản phẩm (công khai).
import { Injectable } from '@nestjs/common';
import { ProductsPort } from '../../common/contracts/ports';
import type { PageQuery } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { ApiError } from '../../common/errors/api-error';
import { PrismaService } from '../../prisma/prisma.service';
import { availableCups } from '../inventory/domain/recipe';
import { loadRecipeBook } from '../inventory/recipe.repository';

const SIZE_ORDER: Record<Api.Size, number> = { S: 0, M: 1, L: 2 };

@Injectable()
export class ProductsService implements ProductsPort {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PageQuery): Promise<Api.ProductPage> {
    const { page, limit } = query;
    const where = { active: true };
    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: { id: true, name: true, description: true, price: true, imageUrl: true },
      }),
    ]);
    const book = await loadRecipeBook(
      this.prisma,
      rows.map(r => r.id),
      [],
    );
    const data = rows.map(row => ({
      ...row,
      stock: availableCups(book.products.get(row.id) ?? [], 'S', book.stockById),
    }));
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async detail(id: string): Promise<Api.ProductDetail> {
    const product = await this.prisma.product.findFirst({
      where: { id, active: true },
      include: { sizes: true, toppings: { include: { topping: true } } },
    });
    if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Không tìm thấy sản phẩm');

    const activeToppings = product.toppings.filter(pt => pt.topping.active).map(pt => pt.topping);
    const book = await loadRecipeBook(
      this.prisma,
      [product.id],
      activeToppings.map(t => t.id),
    );
    const productLines = book.products.get(product.id) ?? [];

    return {
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price,
      imageUrl: product.imageUrl,
      stock: availableCups(productLines, 'S', book.stockById),
      sizes: product.sizes
        .map(s => ({
          size: s.size,
          price: s.price,
          stock: availableCups(productLines, s.size, book.stockById),
        }))
        .sort((a, b) => SIZE_ORDER[a.size] - SIZE_ORDER[b.size]),
      toppings: activeToppings
        .map(t => ({
          id: t.id,
          name: t.name,
          price: t.price,
          stock: availableCups(book.toppings.get(t.id) ?? [], null, book.stockById),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'vi') || a.id.localeCompare(b.id)),
    };
  }
}

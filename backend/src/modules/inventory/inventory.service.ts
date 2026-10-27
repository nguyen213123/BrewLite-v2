// Owner: TV3 — #9. Giữ kho, kiểm tra kho và hoàn kho theo nguyên liệu + công thức (spec A3, A4).
import { Injectable } from '@nestjs/common';
import { InventoryPort } from '../../common/contracts/ports';
import type { StoredOrder, Tx } from '../../common/contracts/ports';
import type * as Api from '../../common/contracts/api.generated';
import { ApiError } from '../../common/errors/api-error';
import { requiredIngredients } from './domain/recipe';
import { loadRecipeBook } from './recipe.repository';

export const MAX_STOCK_ATTEMPTS = 3;

@Injectable()
export class InventoryService implements InventoryPort {
  // Chỉ đọc để kiểm tra tồn kho nguyên liệu cho báo giá (quote). Không trừ kho và không ghi hold.
  async check(tx: Tx, items: Api.CartItem[]): Promise<void> {
    const required = await this.prepareRequired(tx, items);
    for (const [ingredientId, amount] of required) {
      const ingredient = await tx.ingredient.findUnique({
        where: { id: ingredientId },
        select: { stock: true },
      });
      if (!ingredient || ingredient.stock < amount) {
        throw new ApiError(409, 'OUT_OF_STOCK', 'Không đủ nguyên liệu cho món đã chọn');
      }
    }
  }

  // Trừ tồn kho nguyên liệu theo thứ tự ingredientId tăng dần và lưu OrderIngredientHold cho đơn hàng.
  // Chạy trong transaction của người gọi (tạo đơn / prepareRetry); bất kỳ lỗi nào cũng rollback toàn bộ.
  async reserve(tx: Tx, orderId: string, items: Api.CartItem[]): Promise<void> {
    const required = await this.prepareRequired(tx, items);
    for (const [ingredientId, amount] of required) {
      await this.holdIngredient(tx, ingredientId, amount);
    }
    await tx.orderIngredientHold.deleteMany({ where: { orderId } });
    if (required.length > 0) {
      await tx.orderIngredientHold.createMany({
        data: required.map(([ingredientId, amount]) => ({ orderId, ingredientId, amount })),
      });
    }
  }

  // Hoàn kho đúng một lần dựa trên OrderIngredientHold đã ghi khi reserve.
  // Chuyển reservationStatus sang RELEASED bằng câu cập nhật có điều kiện trước; nếu đã RELEASED thì bỏ qua.
  async release(tx: Tx, order: StoredOrder): Promise<void> {
    const flipped = await tx.order.updateMany({
      where: { id: order.id, reservationStatus: { in: ['HELD', 'CONSUMED'] } },
      data: { reservationStatus: 'RELEASED' },
    });
    if (flipped.count === 0) return;

    const holds = await tx.orderIngredientHold.findMany({
      where: { orderId: order.id },
      orderBy: { ingredientId: 'asc' },
    });
    const sortedHolds = [...holds].sort((a, b) =>
      a.ingredientId < b.ingredientId ? -1 : a.ingredientId > b.ingredientId ? 1 : 0,
    );

    for (const hold of sortedHolds) {
      const restored = await tx.ingredient.updateMany({
        where: { id: hold.ingredientId },
        data: { stock: { increment: hold.amount }, version: { increment: 1 } },
      });
      if (restored.count !== 1) {
        throw new Error(`Cannot restore stock for ingredient ${hold.ingredientId}`);
      }
    }
  }

  // Xác thực sản phẩm đang hoạt động, tải công thức, kiểm tra món/topping đều có công thức, rồi tính lượng nguyên liệu cần.
  private async prepareRequired(
    tx: Tx,
    items: Api.CartItem[],
  ): Promise<Array<[ingredientId: string, amount: number]>> {
    const productIds = [...new Set(items.map(item => item.productId))].sort();
    const toppingIds = [...new Set(items.flatMap(item => item.toppingIds ?? []))].sort();

    if (tx.product) {
      for (const productId of productIds) {
        const product = await tx.product.findUnique({
          where: { id: productId },
          select: { active: true },
        });
        if (!product || !product.active) {
          throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Sản phẩm không tồn tại');
        }
      }
    }

    const book = await loadRecipeBook(tx, productIds, toppingIds);

    for (const productId of productIds) {
      if ((book.products.get(productId) ?? []).length === 0) {
        throw new ApiError(409, 'OUT_OF_STOCK', 'Không đủ nguyên liệu cho món đã chọn');
      }
    }
    for (const toppingId of toppingIds) {
      if ((book.toppings.get(toppingId) ?? []).length === 0) {
        throw new ApiError(409, 'OUT_OF_STOCK', 'Không đủ nguyên liệu cho món đã chọn');
      }
    }

    return requiredIngredients(book, items);
  }

  // Optimistic locking trên Ingredient.version: đọc stock/version rồi cập nhật có điều kiện, thử tối đa MAX_STOCK_ATTEMPTS lần.
  private async holdIngredient(tx: Tx, ingredientId: string, amount: number): Promise<void> {
    for (let attempt = 1; attempt <= MAX_STOCK_ATTEMPTS; attempt++) {
      const ingredient = await tx.ingredient.findUnique({
        where: { id: ingredientId },
        select: { stock: true, version: true },
      });
      if (!ingredient || ingredient.stock < amount) {
        throw new ApiError(409, 'OUT_OF_STOCK', 'Không đủ nguyên liệu cho món đã chọn');
      }
      const updated = await tx.ingredient.updateMany({
        where: { id: ingredientId, version: ingredient.version, stock: { gte: amount } },
        data: { stock: { decrement: amount }, version: { increment: 1 } },
      });
      if (updated.count === 1) return;
    }
    throw new ApiError(409, 'STOCK_CONFLICT', 'Tồn kho đang thay đổi, vui lòng thử lại');
  }
}

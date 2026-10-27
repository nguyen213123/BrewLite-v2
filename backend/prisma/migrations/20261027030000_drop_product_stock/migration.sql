-- Migration 20261027030000_drop_product_stock
-- Bỏ cột Product.stock và cập nhật ràng buộc CHECK

ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_money_stock_version";
ALTER TABLE "Product" DROP COLUMN "stock";
ALTER TABLE "Product" ADD CONSTRAINT "Product_money_version" CHECK ("price" BETWEEN 0 AND 2000000000 AND "version" >= 0);

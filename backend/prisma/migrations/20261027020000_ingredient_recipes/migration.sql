-- Migration 20261027020000_ingredient_recipes
-- Thêm các bảng nguyên liệu và công thức món / topping / giữ kho

CREATE TYPE "IngredientUnit" AS ENUM ('GRAM', 'ML', 'PIECE');

CREATE TABLE "Ingredient" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "unit" "IngredientUnit" NOT NULL,
  "stock" INTEGER NOT NULL DEFAULT 0,
  "packageSize" INTEGER NOT NULL,
  "packageLabel" VARCHAR(20) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductIngredient" (
  "productId" UUID NOT NULL,
  "ingredientId" UUID NOT NULL,
  "amount" INTEGER NOT NULL,
  CONSTRAINT "ProductIngredient_pkey" PRIMARY KEY ("productId", "ingredientId")
);

CREATE TABLE "ToppingIngredient" (
  "toppingId" UUID NOT NULL,
  "ingredientId" UUID NOT NULL,
  "amount" INTEGER NOT NULL,
  CONSTRAINT "ToppingIngredient_pkey" PRIMARY KEY ("toppingId", "ingredientId")
);

CREATE TABLE "OrderIngredientHold" (
  "orderId" UUID NOT NULL,
  "ingredientId" UUID NOT NULL,
  "amount" INTEGER NOT NULL,
  CONSTRAINT "OrderIngredientHold_pkey" PRIMARY KEY ("orderId", "ingredientId")
);

ALTER TABLE "ProductIngredient" ADD CONSTRAINT "ProductIngredient_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductIngredient" ADD CONSTRAINT "ProductIngredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ToppingIngredient" ADD CONSTRAINT "ToppingIngredient_toppingId_fkey" FOREIGN KEY ("toppingId") REFERENCES "Topping"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ToppingIngredient" ADD CONSTRAINT "ToppingIngredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderIngredientHold" ADD CONSTRAINT "OrderIngredientHold_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderIngredientHold" ADD CONSTRAINT "OrderIngredientHold_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants
ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_stock_version_package" CHECK ("stock" >= 0 AND "version" >= 0 AND "packageSize" > 0);
ALTER TABLE "ProductIngredient" ADD CONSTRAINT "ProductIngredient_amount" CHECK ("amount" > 0);
ALTER TABLE "ToppingIngredient" ADD CONSTRAINT "ToppingIngredient_amount" CHECK ("amount" > 0);
ALTER TABLE "OrderIngredientHold" ADD CONSTRAINT "OrderIngredientHold_amount" CHECK ("amount" > 0);

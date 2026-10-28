-- Supplemental reference-only size-S preparation components. They do not reserve stock.
CREATE TABLE "ProductReferenceIngredient" (
  "productId" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "unit" "IngredientUnit" NOT NULL,
  "amount" INTEGER NOT NULL,
  "note" VARCHAR(500) NOT NULL,
  CONSTRAINT "ProductReferenceIngredient_pkey" PRIMARY KEY ("productId", "name"),
  CONSTRAINT "ProductReferenceIngredient_amount" CHECK ("amount" > 0),
  CONSTRAINT "ProductReferenceIngredient_productId_fkey" FOREIGN KEY ("productId")
    REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Fill only known unrenamed sample products. Do not alter any existing recipes or stock.
-- Keep the sample rows in sync with src/seed/reference-recipes.ts.
INSERT INTO "ProductReferenceIngredient" ("productId", "name", "unit", "amount", "note")
SELECT p.id, sample.name, sample.unit::"IngredientUnit", sample.amount, sample.note
FROM (VALUES
  ('11111111-1111-4111-8111-111111111111', 'Cappuccino', 'Nước nóng', 'ML', 40, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111112', 'Cà phê sữa', 'Nước nóng', 'ML', 80, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111112', 'Cà phê sữa', 'Đá viên', 'GRAM', 100, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111113', 'Americano', 'Nước nóng', 'ML', 150, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111114', 'Trà đào', 'Nước nóng', 'ML', 150, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111114', 'Trà đào', 'Đá viên', 'GRAM', 100, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111114', 'Trà đào', 'Sả', 'GRAM', 10, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111115', 'Bạc xỉu', 'Nước nóng', 'ML', 40, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111115', 'Bạc xỉu', 'Đá viên', 'GRAM', 100, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111116', 'Latte', 'Nước nóng', 'ML', 40, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111117', 'Espresso', 'Nước nóng', 'ML', 40, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111118', 'Mocha', 'Nước nóng', 'ML', 40, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111119', 'Cà phê muối', 'Nước nóng', 'ML', 80, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111119', 'Cà phê muối', 'Đá viên', 'GRAM', 100, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111120', 'Caramel Macchiato', 'Nước nóng', 'ML', 40, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111121', 'Trà vải', 'Nước nóng', 'ML', 150, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111121', 'Trà vải', 'Đá viên', 'GRAM', 100, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111122', 'Trà chanh', 'Nước nóng', 'ML', 150, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111122', 'Trà chanh', 'Đá viên', 'GRAM', 100, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111122', 'Trà chanh', 'Đường', 'GRAM', 15, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111123', 'Trà sữa trân châu', 'Nước nóng', 'ML', 120, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111123', 'Trà sữa trân châu', 'Đá viên', 'GRAM', 100, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111124', 'Trà oolong sữa', 'Nước nóng', 'ML', 120, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111124', 'Trà oolong sữa', 'Đá viên', 'GRAM', 100, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111125', 'Trà hoa cúc mật ong', 'Nước nóng', 'ML', 160, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111126', 'Matcha latte', 'Nước nóng', 'ML', 30, 'Định lượng tham khảo cho size S; không trừ kho.'),
  ('11111111-1111-4111-8111-111111111127', 'Sô cô la đá xay', 'Đá viên', 'GRAM', 150, 'Định lượng tham khảo cho size S; không trừ kho.')
) AS sample(product_id, product_name, name, unit, amount, note)
JOIN "Product" p ON p.id = sample.product_id::uuid AND p.name = sample.product_name
ON CONFLICT ("productId", "name") DO NOTHING;

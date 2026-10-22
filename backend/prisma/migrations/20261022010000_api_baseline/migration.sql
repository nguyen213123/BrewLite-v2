-- Shared API baseline: matches docs/diagrams/schema.prisma.

-- Existing SystemCheck and the original migration are preserved.

CREATE TYPE "Role" AS ENUM ('CUSTOMER', 'STAFF');

CREATE TYPE "Size" AS ENUM ('S', 'M', 'L');

CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'PREPARING', 'READY', 'COMPLETED', 'PAYMENT_FAILED', 'CANCELLED');

CREATE TYPE "ReservationStatus" AS ENUM ('HELD', 'CONSUMED', 'RELEASED');

CREATE TYPE "PromotionType" AS ENUM ('FIXED', 'PERCENT');

CREATE TYPE "PaymentMethod" AS ENUM ('WALLET', 'CARD');

CREATE TYPE "PaymentStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'REFUNDED');

CREATE TYPE "LoyaltyKind" AS ENUM ('EARN', 'REVERSE');

CREATE TYPE "IdempotencyScope" AS ENUM ('CREATE_ORDER', 'PAY_ORDER');

CREATE TYPE "IdempotencyStatus" AS ENUM ('PROCESSING', 'COMPLETED');

CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "passwordHash" VARCHAR(60) NOT NULL,
  "role" "Role" NOT NULL DEFAULT 'CUSTOMER',
  "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Product" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(1000) NOT NULL,
  "price" INTEGER NOT NULL,
  "imageUrl" VARCHAR(2048) NOT NULL,
  "stock" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductSize" (
  "id" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "size" "Size" NOT NULL,
  "price" INTEGER NOT NULL,
  CONSTRAINT "ProductSize_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Topping" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "price" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Topping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductTopping" (
  "productId" UUID NOT NULL,
  "toppingId" UUID NOT NULL,
  CONSTRAINT "ProductTopping_pkey" PRIMARY KEY ("productId", "toppingId")
);

CREATE TABLE "Promotion" (
  "id" UUID NOT NULL,
  "code" VARCHAR(32) NOT NULL,
  "type" "PromotionType" NOT NULL,
  "value" INTEGER NOT NULL,
  "minSubtotal" INTEGER NOT NULL DEFAULT 0,
  "maxDiscount" INTEGER,
  "maxUses" INTEGER,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Order" (
  "id" UUID NOT NULL,
  "code" VARCHAR(20) NOT NULL,
  "userId" UUID NOT NULL,
  "promotionId" UUID,
  "promotionCode" VARCHAR(32),
  "subtotal" INTEGER NOT NULL,
  "discount" INTEGER NOT NULL DEFAULT 0,
  "total" INTEGER NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
  "reservationStatus" "ReservationStatus" NOT NULL DEFAULT 'HELD',
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderItem" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "productName" VARCHAR(120) NOT NULL,
  "size" "Size" NOT NULL,
  "sizePrice" INTEGER NOT NULL,
  "unitPrice" INTEGER NOT NULL,
  "qty" INTEGER NOT NULL,
  "lineTotal" INTEGER NOT NULL,
  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderItemTopping" (
  "orderItemId" UUID NOT NULL,
  "toppingId" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "price" INTEGER NOT NULL,
  CONSTRAINT "OrderItemTopping_pkey" PRIMARY KEY ("orderItemId", "toppingId")
);

CREATE TABLE "Payment" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "idempotencyRecordId" UUID NOT NULL,
  "idempotencyKey" VARCHAR(36) NOT NULL,
  "amount" INTEGER NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "status" "PaymentStatus" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LoyaltyEntry" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "kind" "LoyaltyKind" NOT NULL,
  "points" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderEvent" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "actorUserId" UUID,
  "fromStatus" "OrderStatus",
  "toStatus" "OrderStatus" NOT NULL,
  "orderVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IdempotencyRecord" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "scope" "IdempotencyScope" NOT NULL,
  "key" VARCHAR(36) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "status" "IdempotencyStatus" NOT NULL,
  "httpStatus" INTEGER,
  "response" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User" ("email");

CREATE UNIQUE INDEX "ProductSize_productId_size_key" ON "ProductSize" ("productId", "size");

CREATE UNIQUE INDEX "Promotion_code_key" ON "Promotion" ("code");

CREATE UNIQUE INDEX "Order_code_key" ON "Order" ("code");

CREATE INDEX "Order_userId_createdAt_id_idx" ON "Order" ("userId", "createdAt", "id");

CREATE INDEX "Order_status_createdAt_idx" ON "Order" ("status", "createdAt");

CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem" ("orderId");

CREATE UNIQUE INDEX "Payment_idempotencyRecordId_key" ON "Payment" ("idempotencyRecordId");

CREATE INDEX "Payment_orderId_idx" ON "Payment" ("orderId");

CREATE UNIQUE INDEX "LoyaltyEntry_orderId_kind_key" ON "LoyaltyEntry" ("orderId", "kind");

CREATE INDEX "LoyaltyEntry_userId_createdAt_id_idx" ON "LoyaltyEntry" ("userId", "createdAt", "id");

CREATE UNIQUE INDEX "OrderEvent_orderId_orderVersion_key" ON "OrderEvent" ("orderId", "orderVersion");

CREATE UNIQUE INDEX "IdempotencyRecord_userId_scope_key_key" ON "IdempotencyRecord" ("userId", "scope", "key");

ALTER TABLE "ProductSize" ADD CONSTRAINT "ProductSize_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductTopping" ADD CONSTRAINT "ProductTopping_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductTopping" ADD CONSTRAINT "ProductTopping_toppingId_fkey" FOREIGN KEY ("toppingId") REFERENCES "Topping"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Order" ADD CONSTRAINT "Order_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderItemTopping" ADD CONSTRAINT "OrderItemTopping_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderItemTopping" ADD CONSTRAINT "OrderItemTopping_toppingId_fkey" FOREIGN KEY ("toppingId") REFERENCES "Topping"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_idempotencyRecordId_fkey" FOREIGN KEY ("idempotencyRecordId") REFERENCES "IdempotencyRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LoyaltyEntry" ADD CONSTRAINT "LoyaltyEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LoyaltyEntry" ADD CONSTRAINT "LoyaltyEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants Prisma cannot represent with its model DSL.
ALTER TABLE "User" ADD CONSTRAINT "User_points_nonnegative" CHECK ("loyaltyPoints" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_money_stock_version" CHECK ("price" BETWEEN 0 AND 2000000000 AND "stock" >= 0 AND "version" >= 0);
ALTER TABLE "ProductSize" ADD CONSTRAINT "ProductSize_price_range" CHECK ("price" BETWEEN 0 AND 2000000000);
ALTER TABLE "Topping" ADD CONSTRAINT "Topping_price_range" CHECK ("price" BETWEEN 0 AND 2000000000);
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_limits" CHECK (
  "minSubtotal" BETWEEN 0 AND 2000000000 AND "usedCount" >= 0 AND "version" >= 0
  AND ("maxUses" IS NULL OR ("maxUses" > 0 AND "usedCount" <= "maxUses"))
  AND ("maxDiscount" IS NULL OR "maxDiscount" BETWEEN 0 AND 2000000000)
  AND "endsAt" > "startsAt"
  AND (("type" = 'PERCENT' AND "value" BETWEEN 1 AND 100)
    OR ("type" = 'FIXED' AND "value" BETWEEN 1 AND 2000000000 AND "maxDiscount" IS NULL))
);
ALTER TABLE "Order" ADD CONSTRAINT "Order_totals_version" CHECK (
  "subtotal" BETWEEN 0 AND 2000000000 AND "discount" BETWEEN 0 AND "subtotal"
  AND "total" = "subtotal" - "discount" AND "version" >= 0
);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_price_quantity" CHECK (
  "qty" BETWEEN 1 AND 99 AND "sizePrice" BETWEEN 0 AND 2000000000
  AND "unitPrice" BETWEEN "sizePrice" AND 2000000000 AND "lineTotal" BETWEEN 0 AND 2000000000
  AND "lineTotal"::bigint = "unitPrice"::bigint * "qty"
);
ALTER TABLE "OrderItemTopping" ADD CONSTRAINT "OrderItemTopping_price" CHECK ("price" BETWEEN 0 AND 2000000000);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount" CHECK ("amount" BETWEEN 0 AND 2000000000);
CREATE UNIQUE INDEX "Payment_one_success_per_order" ON "Payment" ("orderId") WHERE "status" IN ('SUCCEEDED', 'REFUNDED');
ALTER TABLE "LoyaltyEntry" ADD CONSTRAINT "LoyaltyEntry_sign" CHECK (("kind" = 'EARN' AND "points" >= 0) OR ("kind" = 'REVERSE' AND "points" <= 0));
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_version" CHECK ("orderVersion" >= 0);
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_completion" CHECK (
  length("requestHash") = 64
  AND (("status" = 'PROCESSING' AND "httpStatus" IS NULL AND "response" IS NULL)
    OR ("status" = 'COMPLETED' AND "httpStatus" IN (200, 201) AND "response" IS NOT NULL))
);

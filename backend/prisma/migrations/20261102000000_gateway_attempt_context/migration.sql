-- Preserve one primary successful payment per order, while recording extra gateway receipts for manual refund.
ALTER TABLE "Payment" ADD COLUMN "isDuplicate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "IdempotencyRecord" ADD COLUMN "context" JSONB;
DROP INDEX "Payment_one_success_per_order";
CREATE UNIQUE INDEX "Payment_one_success_per_order" ON "Payment" ("orderId")
  WHERE "status" IN ('SUCCEEDED', 'REFUNDED') AND "isDuplicate" = false;

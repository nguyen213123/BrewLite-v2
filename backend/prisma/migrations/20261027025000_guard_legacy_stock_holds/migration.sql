-- Run before removing Product.stock. Existing HELD/CONSUMED orders from the
-- product-stock implementation have no ingredient snapshot and cannot be
-- safely refunded by the new inventory service. Do not guess a recipe or reset
-- balances: stop the upgrade until these orders are settled on the old version.
-- This also detects incomplete upgrades where Product.stock was already removed.
DO $$
DECLARE
  legacy_holds BIGINT;
BEGIN
  SELECT COUNT(*) INTO legacy_holds
  FROM "Order" AS o
  WHERE o."status" IN ('PENDING', 'PAID', 'PREPARING', 'READY')
    AND o."reservationStatus" IN ('HELD', 'CONSUMED')
    AND NOT EXISTS (
      SELECT 1 FROM "OrderIngredientHold" AS h WHERE h."orderId" = o."id"
    );

  IF legacy_holds > 0 THEN
    RAISE EXCEPTION 'LEGACY_STOCK_HOLDS: % active order(s) have no ingredient hold snapshot', legacy_holds
      USING HINT = 'Stop checkout writes and settle/cancel legacy orders on the old version before upgrading. See docs/requirements/inventory-concurrency.md. Do not seed or mark orders released to bypass this check.';
  END IF;
END $$;

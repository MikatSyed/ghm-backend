-- Track condition at the purchase-line level so the resulting StockEntry
-- inherits whether that line was FRESH/AGING/DAMAGED at receiving time.
-- StockCondition enum already exists from a prior migration.
ALTER TABLE "purchase_lines"
  ADD COLUMN "condition" "StockCondition" NOT NULL DEFAULT 'FRESH';

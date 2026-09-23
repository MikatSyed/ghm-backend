-- Per-lot condition + sellPrice override on StockEntry. Lets damaged/aging
-- stock of the same product live alongside fresh stock at a different price,
-- which the distribution lot-picker UI will surface so staff never mix tiers.

CREATE TYPE "StockCondition" AS ENUM ('FRESH', 'AGING', 'DAMAGED', 'CUSTOM');

ALTER TABLE "stock_entries"
  ADD COLUMN "sellPrice" INTEGER,
  ADD COLUMN "condition" "StockCondition" NOT NULL DEFAULT 'FRESH';

CREATE INDEX "stock_entries_productId_condition_remainingQuantity_idx"
  ON "stock_entries"("productId", "condition", "remainingQuantity");

-- Pricing ladder: Base Price -> List Price -> Trade Price -> MRP
-- Uses RENAME COLUMN (not drop+add) so existing cost/price data carries over
-- automatically as the backfill for basePrice/tradePrice.

-- Product: buyPrice -> basePrice, sellPrice -> tradePrice, add listPrice/mrp + 9 recipe percents
ALTER TABLE "products" RENAME COLUMN "buyPrice" TO "basePrice";
ALTER TABLE "products" RENAME COLUMN "sellPrice" TO "tradePrice";
ALTER TABLE "products" ADD COLUMN "listPrice" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "products" ADD COLUMN "mrp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "products" ADD COLUMN "listTaxPercent" INTEGER;
ALTER TABLE "products" ADD COLUMN "listProfitPercent" INTEGER;
ALTER TABLE "products" ADD COLUMN "listOthersPercent" INTEGER;
ALTER TABLE "products" ADD COLUMN "tradeTaxPercent" INTEGER;
ALTER TABLE "products" ADD COLUMN "tradeProfitPercent" INTEGER;
ALTER TABLE "products" ADD COLUMN "tradeOthersPercent" INTEGER;
ALTER TABLE "products" ADD COLUMN "mrpTaxPercent" INTEGER;
ALTER TABLE "products" ADD COLUMN "mrpProfitPercent" INTEGER;
ALTER TABLE "products" ADD COLUMN "mrpOthersPercent" INTEGER;

-- StockEntry: buyingRate -> basePrice (stays required), sellPrice -> tradePrice (stays nullable),
-- add listPrice/mrp (nullable per-lot overrides) + 9 captured buildup inputs
ALTER TABLE "stock_entries" RENAME COLUMN "buyingRate" TO "basePrice";
ALTER TABLE "stock_entries" RENAME COLUMN "sellPrice" TO "tradePrice";
ALTER TABLE "stock_entries" ADD COLUMN "listPrice" INTEGER;
ALTER TABLE "stock_entries" ADD COLUMN "mrp" INTEGER;
ALTER TABLE "stock_entries" ADD COLUMN "listTaxPercent" INTEGER;
ALTER TABLE "stock_entries" ADD COLUMN "listProfitPercent" INTEGER;
ALTER TABLE "stock_entries" ADD COLUMN "listOthersPercent" INTEGER;
ALTER TABLE "stock_entries" ADD COLUMN "tradeTaxPercent" INTEGER;
ALTER TABLE "stock_entries" ADD COLUMN "tradeProfitPercent" INTEGER;
ALTER TABLE "stock_entries" ADD COLUMN "tradeOthersPercent" INTEGER;
ALTER TABLE "stock_entries" ADD COLUMN "mrpTaxPercent" INTEGER;
ALTER TABLE "stock_entries" ADD COLUMN "mrpProfitPercent" INTEGER;
ALTER TABLE "stock_entries" ADD COLUMN "mrpOthersPercent" INTEGER;

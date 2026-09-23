DROP INDEX IF EXISTS "distribution_lines_distributionId_productId_key";

CREATE INDEX IF NOT EXISTS "distribution_lines_distributionId_productId_idx"
  ON "distribution_lines"("distributionId", "productId");

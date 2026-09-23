-- CreateTable
CREATE TABLE "purchase_lines" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "basePrice" INTEGER NOT NULL,
    "transportCost" INTEGER NOT NULL DEFAULT 0,
    "labourCost" INTEGER NOT NULL DEFAULT 0,
    "otherCost" INTEGER NOT NULL DEFAULT 0,
    "effectiveBuyPrice" INTEGER NOT NULL,
    "sellPrice" INTEGER NOT NULL DEFAULT 0,
    "profitPercent" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_lines_purchaseId_idx" ON "purchase_lines"("purchaseId");

-- CreateIndex
CREATE INDEX "purchase_lines_productId_idx" ON "purchase_lines"("productId");

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddColumn (total) — backfill before dropping old columns
ALTER TABLE "purchases" ADD COLUMN "total" INTEGER NOT NULL DEFAULT 0;

-- Backfill PurchaseLine from existing single-product purchase rows
INSERT INTO "purchase_lines" (
    "id", "purchaseId", "productId", "quantity", "basePrice",
    "transportCost", "labourCost", "otherCost",
    "effectiveBuyPrice", "sellPrice", "profitPercent"
)
SELECT
    gen_random_uuid()::text,
    "id",
    "productId",
    "quantity",
    "basePrice",
    "transportCost",
    "labourCost",
    "otherCost",
    "effectiveBuyPrice",
    "sellPrice",
    "profitPercent"
FROM "purchases";

-- Backfill Purchase.total from the row's own per-product fields
UPDATE "purchases"
SET "total" = ("basePrice" * "quantity") + "transportCost" + "labourCost" + "otherCost";

-- Drop per-product columns and their FK/index on purchases
ALTER TABLE "purchases" DROP CONSTRAINT IF EXISTS "purchases_productId_fkey";
DROP INDEX IF EXISTS "purchases_productId_idx";
ALTER TABLE "purchases" DROP COLUMN "productId";
ALTER TABLE "purchases" DROP COLUMN "quantity";
ALTER TABLE "purchases" DROP COLUMN "basePrice";
ALTER TABLE "purchases" DROP COLUMN "transportCost";
ALTER TABLE "purchases" DROP COLUMN "labourCost";
ALTER TABLE "purchases" DROP COLUMN "otherCost";
ALTER TABLE "purchases" DROP COLUMN "effectiveBuyPrice";
ALTER TABLE "purchases" DROP COLUMN "sellPrice";
ALTER TABLE "purchases" DROP COLUMN "profitPercent";

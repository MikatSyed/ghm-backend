/*
  Warnings:

  - Added the required column `remainingQuantity` to the `stock_entries` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "StockLotConsumerType" AS ENUM ('DISTRIBUTION_LINE', 'SALE_ITEM', 'STOCK_ADJUSTMENT');

-- AlterTable
ALTER TABLE "stock_entries" ADD COLUMN     "expiryDate" DATE,
ADD COLUMN     "remainingQuantity" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "stock_lot_allocations" (
    "id" TEXT NOT NULL,
    "stockEntryId" TEXT NOT NULL,
    "parentAllocationId" TEXT,
    "consumerType" "StockLotConsumerType" NOT NULL,
    "consumerId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "remainingQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitCost" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_lot_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_lot_allocations_consumerType_consumerId_idx" ON "stock_lot_allocations"("consumerType", "consumerId");

-- CreateIndex
CREATE INDEX "stock_lot_allocations_parentAllocationId_idx" ON "stock_lot_allocations"("parentAllocationId");

-- CreateIndex
CREATE INDEX "stock_lot_allocations_stockEntryId_idx" ON "stock_lot_allocations"("stockEntryId");

-- CreateIndex
CREATE INDEX "stock_entries_productId_remainingQuantity_idx" ON "stock_entries"("productId", "remainingQuantity");

-- AddForeignKey
ALTER TABLE "stock_lot_allocations" ADD CONSTRAINT "stock_lot_allocations_stockEntryId_fkey" FOREIGN KEY ("stockEntryId") REFERENCES "stock_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lot_allocations" ADD CONSTRAINT "stock_lot_allocations_parentAllocationId_fkey" FOREIGN KEY ("parentAllocationId") REFERENCES "stock_lot_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

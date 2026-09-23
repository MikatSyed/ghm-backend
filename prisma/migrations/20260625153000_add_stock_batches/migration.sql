-- CreateTable
CREATE TABLE "stock_batches" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_batches_date_idx" ON "stock_batches"("date");

-- AlterTable
ALTER TABLE "stock_entries" ADD COLUMN "batchId" TEXT;

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN "batchId" TEXT;

-- AlterTable
ALTER TABLE "distribution_lines" ADD COLUMN "batchId" TEXT;

-- CreateIndex
CREATE INDEX "stock_entries_batchId_idx" ON "stock_entries"("batchId");

-- CreateIndex
CREATE INDEX "purchases_batchId_idx" ON "purchases"("batchId");

-- CreateIndex
CREATE INDEX "distribution_lines_batchId_idx" ON "distribution_lines"("batchId");

-- AddForeignKey
ALTER TABLE "stock_entries" ADD CONSTRAINT "stock_entries_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "stock_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "stock_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_lines" ADD CONSTRAINT "distribution_lines_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "stock_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

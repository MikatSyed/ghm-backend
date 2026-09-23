-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('RESTAURANT', 'SHOP', 'DIRECT', 'OTHER');

-- CreateEnum
CREATE TYPE "DistributionOrderStatus" AS ENUM ('issued', 'confirmed', 'cancelled');

-- CreateEnum
CREATE TYPE "SaleType" AS ENUM ('VAN', 'DISTRIBUTION_CONFIRMATION', 'DIRECT_CUSTOMER');

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_vanId_fkey";

-- DropForeignKey
ALTER TABLE "sales" DROP CONSTRAINT "sales_vanId_fkey";

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "customerId" TEXT,
ALTER COLUMN "vanId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "type" "SaleType" NOT NULL DEFAULT 'VAN',
ALTER COLUMN "vanId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'Active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distribution_orders" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "DistributionOrderStatus" NOT NULL DEFAULT 'issued',
    "confirmedAt" TIMESTAMP(3),
    "saleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "distribution_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distribution_order_lines" (
    "id" TEXT NOT NULL,
    "distributionOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "requestedQty" INTEGER NOT NULL,
    "confirmedQty" INTEGER,
    "price" INTEGER,

    CONSTRAINT "distribution_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE INDEX "customers_type_idx" ON "customers"("type");

-- CreateIndex
CREATE UNIQUE INDEX "distribution_orders_saleId_key" ON "distribution_orders"("saleId");

-- CreateIndex
CREATE INDEX "distribution_orders_customerId_date_idx" ON "distribution_orders"("customerId", "date");

-- CreateIndex
CREATE INDEX "distribution_orders_date_idx" ON "distribution_orders"("date");

-- CreateIndex
CREATE INDEX "distribution_orders_status_idx" ON "distribution_orders"("status");

-- CreateIndex
CREATE INDEX "distribution_order_lines_distributionOrderId_productId_idx" ON "distribution_order_lines"("distributionOrderId", "productId");

-- CreateIndex
CREATE INDEX "sales_customerId_date_idx" ON "sales"("customerId", "date");

-- AddForeignKey
ALTER TABLE "distribution_orders" ADD CONSTRAINT "distribution_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_orders" ADD CONSTRAINT "distribution_orders_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_order_lines" ADD CONSTRAINT "distribution_order_lines_distributionOrderId_fkey" FOREIGN KEY ("distributionOrderId") REFERENCES "distribution_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_order_lines" ADD CONSTRAINT "distribution_order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "vans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "vans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

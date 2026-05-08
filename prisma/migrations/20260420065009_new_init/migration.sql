-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProductCategory" ADD VALUE 'Dairy';
ALTER TYPE "ProductCategory" ADD VALUE 'Drinks';
ALTER TYPE "ProductCategory" ADD VALUE 'Bakery';
ALTER TYPE "ProductCategory" ADD VALUE 'Meat';
ALTER TYPE "ProductCategory" ADD VALUE 'Poultry';
ALTER TYPE "ProductCategory" ADD VALUE 'Fish';
ALTER TYPE "ProductCategory" ADD VALUE 'Other';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProductUnit" ADD VALUE 'pcs';
ALTER TYPE "ProductUnit" ADD VALUE 'litre';
ALTER TYPE "ProductUnit" ADD VALUE 'bundle';

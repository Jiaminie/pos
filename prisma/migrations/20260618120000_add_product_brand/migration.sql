-- AlterTable
ALTER TABLE "products" ADD COLUMN "brand" TEXT NOT NULL DEFAULT 'UNBRANDED';

-- CreateIndex
CREATE INDEX "products_brand_idx" ON "products"("brand");

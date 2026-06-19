-- AlterTable
ALTER TABLE "store_settings" ADD COLUMN "pos_lookup_mode" TEXT NOT NULL DEFAULT 'catalog';

-- AlterTable
ALTER TABLE "products" ADD COLUMN "barcode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "products_barcode_key" ON "products"("barcode");

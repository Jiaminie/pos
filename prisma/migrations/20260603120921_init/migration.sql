-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('SALE', 'PURCHASE', 'ADJUSTMENT', 'RETURN');

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "selling_price" DECIMAL(65,30) NOT NULL,
    "cost_price" DECIMAL(65,30) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(65,30),
    "device_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3),

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "last_sync_at" TIMESTAMP(3),

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Backfill: store_settings was originally created via `prisma db push` before
-- migrations were adopted, so no migration ever recorded its creation — later
-- migrations only ALTER it. That left the history un-replayable on a fresh /
-- shadow database (the first ALTER hit a non-existent table). This CREATE
-- restores the original (init-era) columns; the later migrations layer the
-- rest on. IF NOT EXISTS makes it a no-op on any DB that already has the table.
CREATE TABLE IF NOT EXISTS "store_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "company_name" TEXT NOT NULL DEFAULT 'My Business',
    "tagline" TEXT NOT NULL DEFAULT '',
    "logo_data_url" TEXT NOT NULL DEFAULT '',
    "primary_color" TEXT NOT NULL DEFAULT '#2563eb',
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "footer_text" TEXT NOT NULL DEFAULT 'Thank you for your business.',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

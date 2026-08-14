-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'MPESA', 'BANK');

-- CreateTable
CREATE TABLE "sale_payments" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "bank_name" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_payments_sale_id_idx" ON "sale_payments"("sale_id");

-- AddForeignKey
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_fkey"
  FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "store_settings" ADD COLUMN "bank_options" TEXT NOT NULL DEFAULT 'Cooperative Bank,Equity Bank';

-- AlterTable
ALTER TABLE "store_settings" ADD COLUMN "resend_api_key" TEXT NOT NULL DEFAULT '';
ALTER TABLE "store_settings" ADD COLUMN "report_email"   TEXT NOT NULL DEFAULT '';
ALTER TABLE "store_settings" ADD COLUMN "from_email"     TEXT NOT NULL DEFAULT '';

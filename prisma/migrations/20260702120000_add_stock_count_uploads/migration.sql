-- Stock count photo uploads (draft extraction state before ADJUSTMENT submit)

CREATE TYPE "StockCountUploadStatus" AS ENUM ('PENDING', 'EXTRACTED', 'ERROR', 'SUBMITTED', 'DISCARDED');

CREATE TABLE "stock_count_uploads" (
  "id"              TEXT                     NOT NULL,
  "branch_id"       TEXT                     NOT NULL,
  "uploaded_by_id"  TEXT                     NOT NULL,
  "image_url"       TEXT                     NOT NULL,
  "status"          "StockCountUploadStatus" NOT NULL DEFAULT 'PENDING',
  "extracted_rows"  JSONB,
  "error_message"   TEXT,
  "created_at"      TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_at"    TIMESTAMP(3),

  CONSTRAINT "stock_count_uploads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_count_uploads_branch_id_status_idx" ON "stock_count_uploads"("branch_id", "status");
CREATE INDEX "stock_count_uploads_uploaded_by_id_status_idx" ON "stock_count_uploads"("uploaded_by_id", "status");

ALTER TABLE "stock_count_uploads"
  ADD CONSTRAINT "stock_count_uploads_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_count_uploads"
  ADD CONSTRAINT "stock_count_uploads_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

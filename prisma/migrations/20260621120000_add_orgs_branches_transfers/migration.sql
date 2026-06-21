-- Phase 2: Organizations, Branches, and Stock Transfers
-- All existing data is backfilled to a seeded primary branch/org derived from StoreSettings.

-- 1. Organizations table
CREATE TABLE "organizations" (
  "id"         TEXT        NOT NULL,
  "name"       TEXT        NOT NULL,
  "country"    TEXT        NOT NULL DEFAULT 'KE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- 2. Branches table
CREATE TABLE "branches" (
  "id"              TEXT        NOT NULL,
  "organization_id" TEXT        NOT NULL,
  "name"            TEXT        NOT NULL,
  "code"            TEXT        NOT NULL,
  "is_primary"      BOOLEAN     NOT NULL DEFAULT false,
  "address"         TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branches_organization_id_code_key" UNIQUE ("organization_id", "code")
);

-- 3. Add TRANSFER_OUT to TransactionType enum
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';

-- 4. TransferStatus enum + StockTransfers table
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'IN_TRANSIT', 'RECEIVED', 'REJECTED', 'REVERSED');

CREATE TABLE "stock_transfers" (
  "id"             TEXT            NOT NULL,
  "from_branch_id" TEXT            NOT NULL,
  "to_branch_id"   TEXT            NOT NULL,
  "product_id"     TEXT            NOT NULL,
  "quantity"       DECIMAL(65,30)  NOT NULL,
  "status"         "TransferStatus" NOT NULL DEFAULT 'PENDING',
  "note"           TEXT,
  "from_device_id" TEXT            NOT NULL,
  "to_device_id"   TEXT,
  "created_at"     TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "received_at"    TIMESTAMP(3),
  CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- 5. Add new columns to existing tables (all nullable for safe backfill)
ALTER TABLE "products"               ADD COLUMN "organization_id" TEXT;
ALTER TABLE "inventory_transactions" ADD COLUMN "branch_id"       TEXT;
ALTER TABLE "devices"                ADD COLUMN "branch_id"        TEXT;
ALTER TABLE "store_settings"         ADD COLUMN "organization_id" TEXT;

-- 6. Seed: create org + primary branch from existing StoreSettings, then backfill all rows
DO $$
DECLARE
  v_org_id      TEXT;
  v_branch_id   TEXT;
  v_org_name    TEXT;
BEGIN
  SELECT COALESCE(company_name, 'My Business') INTO v_org_name
  FROM store_settings WHERE id = 'singleton';

  IF v_org_name IS NULL THEN
    v_org_name := 'My Business';
  END IF;

  v_org_id    := gen_random_uuid()::text;
  v_branch_id := gen_random_uuid()::text;

  INSERT INTO organizations (id, name, country)
  VALUES (v_org_id, v_org_name, 'KE');

  INSERT INTO branches (id, organization_id, name, code, is_primary)
  VALUES (v_branch_id, v_org_id, v_org_name, 'HQ', true);

  UPDATE products               SET organization_id = v_org_id;
  UPDATE inventory_transactions SET branch_id       = v_branch_id;
  UPDATE devices                SET branch_id        = v_branch_id;
  UPDATE store_settings         SET organization_id = v_org_id WHERE id = 'singleton';
END;
$$;

-- 7. Foreign key constraints (after backfill so no orphan rows)
ALTER TABLE "branches"
  ADD CONSTRAINT "branches_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_from_branch_id_fkey"
  FOREIGN KEY ("from_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_to_branch_id_fkey"
  FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "products"
  ADD CONSTRAINT "products_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_transactions"
  ADD CONSTRAINT "inventory_transactions_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "devices"
  ADD CONSTRAINT "devices_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "store_settings"
  ADD CONSTRAINT "store_settings_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "store_settings"
  ADD CONSTRAINT "store_settings_organization_id_key" UNIQUE ("organization_id");

-- 8. Indexes
CREATE INDEX "branches_organization_id_idx"             ON "branches"("organization_id");
CREATE INDEX "stock_transfers_from_branch_id_idx"       ON "stock_transfers"("from_branch_id");
CREATE INDEX "stock_transfers_to_branch_id_idx"         ON "stock_transfers"("to_branch_id");
CREATE INDEX "stock_transfers_status_idx"               ON "stock_transfers"("status");
CREATE INDEX "inventory_transactions_branch_id_idx"     ON "inventory_transactions"("branch_id");
CREATE INDEX "products_organization_id_idx"             ON "products"("organization_id");

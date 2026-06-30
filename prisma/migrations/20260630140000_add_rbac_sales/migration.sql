-- RBAC: users, sales grouping, discount fields

CREATE TYPE "Role" AS ENUM ('OWNER', 'MANAGER', 'CASHIER');

CREATE TABLE "users" (
  "id"              TEXT        NOT NULL,
  "name"            TEXT        NOT NULL,
  "pin_hash"        TEXT        NOT NULL,
  "role"            "Role"      NOT NULL,
  "organization_id" TEXT        NOT NULL,
  "branch_id"       TEXT,
  "active"          BOOLEAN     NOT NULL DEFAULT true,
  "created_by_id"   TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales" (
  "id"                   TEXT           NOT NULL,
  "organization_id"      TEXT           NOT NULL,
  "branch_id"            TEXT           NOT NULL,
  "device_id"            TEXT           NOT NULL,
  "cashier_id"           TEXT           NOT NULL,
  "subtotal"             DECIMAL(65,30) NOT NULL,
  "line_discount_total"  DECIMAL(65,30) NOT NULL DEFAULT 0,
  "sale_discount_amount" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "total"                DECIMAL(65,30) NOT NULL,
  "created_at"           TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "synced_at"            TIMESTAMP(3),
  CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "inventory_transactions"
  ADD COLUMN "sale_id"              TEXT,
  ADD COLUMN "original_unit_price"  DECIMAL(65,30),
  ADD COLUMN "line_discount_amount" DECIMAL(65,30);

CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");
CREATE INDEX "users_branch_id_idx" ON "users"("branch_id");
CREATE INDEX "sales_branch_id_idx" ON "sales"("branch_id");
CREATE INDEX "sales_cashier_id_idx" ON "sales"("cashier_id");
CREATE INDEX "sales_created_at_idx" ON "sales"("created_at");
CREATE INDEX "inventory_transactions_sale_id_idx" ON "inventory_transactions"("sale_id");

ALTER TABLE "users"
  ADD CONSTRAINT "users_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "users"
  ADD CONSTRAINT "users_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "users"
  ADD CONSTRAINT "users_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales"
  ADD CONSTRAINT "sales_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales"
  ADD CONSTRAINT "sales_cashier_id_fkey"
  FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_transactions"
  ADD CONSTRAINT "inventory_transactions_sale_id_fkey"
  FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One manager per branch (partial unique index)
CREATE UNIQUE INDEX "one_manager_per_branch"
  ON "users" ("branch_id") WHERE role = 'MANAGER';

-- Create units lookup table
CREATE TABLE "units" (
    "id"         TEXT        NOT NULL,
    "code"       TEXT        NOT NULL,
    "name"       TEXT        NOT NULL,
    "is_custom"  BOOLEAN     NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "units_code_key" ON "units"("code");

-- Seed standard units (is_custom = false)
INSERT INTO "units" ("id", "code", "name", "is_custom") VALUES
  -- Count
  (gen_random_uuid(), 'PCS',                  'Pieces',               false),
  (gen_random_uuid(), 'PAIR',                 'Pair',                 false),
  (gen_random_uuid(), 'SET',                  'Set',                  false),
  (gen_random_uuid(), 'DOZEN',                'Dozen (12)',            false),
  (gen_random_uuid(), 'GROSS',                'Gross (144)',           false),
  (gen_random_uuid(), 'PACK',                 'Pack',                 false),
  (gen_random_uuid(), 'BOX',                  'Box',                  false),
  (gen_random_uuid(), 'BUNDLE',               'Bundle',               false),
  (gen_random_uuid(), 'ROLL',                 'Roll',                 false),
  (gen_random_uuid(), 'SHEET',                'Sheet',                false),
  (gen_random_uuid(), 'BAG',                  'Bag',                  false),
  (gen_random_uuid(), 'SACK',                 'Sack',                 false),
  (gen_random_uuid(), 'DRUM',                 'Drum',                 false),
  (gen_random_uuid(), 'COIL',                 'Coil',                 false),
  (gen_random_uuid(), 'REEL',                 'Reel',                 false),
  (gen_random_uuid(), 'BOTTLE',               'Bottle',               false),
  (gen_random_uuid(), 'CAN',                  'Can',                  false),
  (gen_random_uuid(), 'TIN',                  'Tin',                  false),
  (gen_random_uuid(), 'TUBE',                 'Tube',                 false),
  -- Weight
  (gen_random_uuid(), 'KG',                   'Kilogram',             false),
  (gen_random_uuid(), 'G',                    'Gram',                 false),
  (gen_random_uuid(), 'TON',                  'Metric Ton',           false),
  (gen_random_uuid(), 'LB',                   'Pound',                false),
  -- Volume
  (gen_random_uuid(), 'L',                    'Litre',                false),
  (gen_random_uuid(), 'ML',                   'Millilitre',           false),
  (gen_random_uuid(), 'GAL',                  'Gallon',               false),
  -- Length / Area
  (gen_random_uuid(), 'M',                    'Metre',                false),
  (gen_random_uuid(), 'CM',                   'Centimetre',           false),
  (gen_random_uuid(), 'FT',                   'Foot',                 false),
  (gen_random_uuid(), 'YD',                   'Yard',                 false),
  (gen_random_uuid(), 'SQM',                  'Square Metre',         false),
  (gen_random_uuid(), 'SQFT',                 'Square Foot',          false),
  (gen_random_uuid(), 'RM',                   'Running Metre',        false),
  -- Fallback
  (gen_random_uuid(), 'UNKNOWN_NEEDS_REVIEW', 'Unknown — needs review', false);

-- Add unitId FK column to products
ALTER TABLE "products" ADD COLUMN "unit_id" TEXT;

-- Migrate existing stockUnit free-text → unit FK
-- Unrecognised values get UNKNOWN_NEEDS_REVIEW so they are visibly flagged
UPDATE "products" p
SET "unit_id" = u."id"
FROM "units" u
WHERE u."code" = CASE
    WHEN lower(trim(p."stock_unit")) IN ('pcs', '', 'pc', 'piece', 'pieces') THEN 'PCS'
    WHEN lower(trim(p."stock_unit")) IN ('dozen', 'doz')                      THEN 'DOZEN'
    WHEN lower(trim(p."stock_unit")) IN ('pair', 'pairs')                     THEN 'PAIR'
    WHEN lower(trim(p."stock_unit")) IN ('set', 'sets')                       THEN 'SET'
    ELSE 'UNKNOWN_NEEDS_REVIEW'
END;

-- Catch products where stock_unit IS NULL — default to PCS
UPDATE "products" p
SET "unit_id" = u."id"
FROM "units" u
WHERE p."unit_id" IS NULL
  AND u."code" = 'PCS';

-- Add index
CREATE INDEX "products_unit_id_idx" ON "products"("unit_id");

-- Add FK constraint
ALTER TABLE "products"
  ADD CONSTRAINT "products_unit_id_fkey"
  FOREIGN KEY ("unit_id") REFERENCES "units"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- TransactionSource enum
CREATE TYPE "TransactionSource" AS ENUM ('SUPPLIER', 'INTERBRANCH', 'CORRECTION');

-- Add source + sourceBranchId to inventory_transactions
ALTER TABLE "inventory_transactions"
  ADD COLUMN "source"           "TransactionSource",
  ADD COLUMN "source_branch_id" TEXT;

-- Change quantity from INTEGER to DECIMAL
-- Existing integer values are losslessly promoted
ALTER TABLE "inventory_transactions"
  ALTER COLUMN "quantity" TYPE DECIMAL USING "quantity"::DECIMAL;

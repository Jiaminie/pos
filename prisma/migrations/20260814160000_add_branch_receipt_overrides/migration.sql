-- Per-branch receipt overrides.
--
-- payment_details and bank_options previously lived only on the store_settings
-- singleton, so editing the till/paybill at one branch silently rerouted every
-- other branch's payments. These columns let each branch carry its own.
--
-- An empty string means "fall back to store_settings", so the columns are
-- backfilled from the current global values: every branch keeps printing
-- exactly what it prints today, and divergence only happens when someone
-- deliberately edits a branch.

ALTER TABLE "branches" ADD COLUMN "payment_details" TEXT NOT NULL DEFAULT '';
ALTER TABLE "branches" ADD COLUMN "bank_options"    TEXT NOT NULL DEFAULT '';

UPDATE "branches" b
SET    "payment_details" = COALESCE(s."payment_details", ''),
       "bank_options"    = COALESCE(s."bank_options", '')
FROM   "store_settings" s
WHERE  s."id" = 'singleton';

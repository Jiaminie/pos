-- Soft-delete support for branches
ALTER TABLE "branches" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

-- Shop-floor name for a product, as written on handwritten count sheets.
-- Nullable with no default: NULL means "no alias", which the matcher and search
-- both treat as absent rather than as an empty string to score against.
ALTER TABLE "products" ADD COLUMN "alias" TEXT;

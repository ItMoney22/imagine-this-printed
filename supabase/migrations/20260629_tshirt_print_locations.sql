-- Migration: T-shirt multi-select print-location options
-- Adds products.print_locations — the array of print placements a T-shirt
-- ('shirts' category) is offered with: front_image, back_image, pocket.
-- Mirrors the existing sizes/colors TEXT[] variant columns added in
-- 20251230_product_variants.sql. Stored as an array (queryable + GIN-indexed)
-- rather than a bitmask; the app layer (src/lib/tshirt-options.ts) provides a
-- bitmask encoding for callers that want a compact integer.
--
-- Validation enforced here:
--   (a) every value must be one of the known options, for ANY product;
--   (b) T-shirts must carry at least one option.
-- Idempotent: safe to re-run (IF NOT EXISTS / guarded constraint).

-- 1. Column: array of the selected options. Default empty; backfilled below.
ALTER TABLE products
ADD COLUMN IF NOT EXISTS print_locations TEXT[] DEFAULT '{}';

-- 2. Backfill existing T-shirts so the "at least one option" rule holds BEFORE
--    the constraint is added (otherwise validation of legacy rows would fail).
--    Front print is the universal default placement for a shirt.
UPDATE products
SET print_locations = ARRAY['front_image']
WHERE category = 'shirts'
  AND COALESCE(array_length(print_locations, 1), 0) = 0;

-- 3. GIN index for "products offered with placement X" queries (matches sizes/colors).
CREATE INDEX IF NOT EXISTS idx_products_print_locations
  ON products USING GIN (print_locations);

-- 4. CHECK constraint: known values only (all products), and >= 1 for shirts.
--    `<@` = "is contained by", so an empty array passes for non-shirts.
--    `category IS DISTINCT FROM 'shirts'` exempts null/other categories from the
--    minimum-one rule (metadata-classified shirts with a null category column
--    won't break inserts; the app layer validates those more thoroughly).
--    Guarded in a DO block because Postgres has no ADD CONSTRAINT IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_print_locations_valid'
  ) THEN
    ALTER TABLE products
    ADD CONSTRAINT products_print_locations_valid CHECK (
      print_locations <@ ARRAY['front_image', 'back_image', 'pocket']::text[]
      AND (
        category IS DISTINCT FROM 'shirts'
        OR COALESCE(array_length(print_locations, 1), 0) >= 1
      )
    );
  END IF;
END$$;

-- 5. Docs
COMMENT ON COLUMN products.print_locations IS
  'T-shirt multi-select print placements (subset of front_image|back_image|pocket). Shirts must have >= 1 option; enforced by the products_print_locations_valid CHECK constraint.';

-- Catalog structure (task 66d0f303): one shirts category, no NULL categories.
--
-- 'shirts' is the surviving slug: products_print_locations_valid already keys on
-- it, and src/lib/product-kind.ts canonicalises every shirt alias to it.
-- Rows that would violate that check (shirts need >=1 print location) are left
-- alone unless they are active - the storefront only reads active rows, and
-- canonicalCategoryOf still folds the leftover draft/rejected 't-shirts' values.

-- 1. 't-shirts' -> 'shirts' wherever the check allows it.
UPDATE products
   SET category = 'shirts'
 WHERE category = 't-shirts'
   AND COALESCE(array_length(print_locations, 1), 0) >= 1;

-- 2. Active shirt rows saved with NULL category (metadata.category = 'shirts').
--    Front print is where every one of them carries its design (flat-lay mockup).
UPDATE products
   SET category = 'shirts',
       print_locations = ARRAY['front_image']
 WHERE category IS NULL
   AND status = 'active'
   AND COALESCE(metadata->>'category', 'shirts') = 'shirts'
   AND COALESCE(array_length(print_locations, 1), 0) = 0;

-- 3. Legacy '3d-models' value -> the storefront's '3d-prints'.
UPDATE products SET category = '3d-prints' WHERE category = '3d-models';

-- 4. Keep it merged. The create paths (step flow, AI products, Mrs. Imagine)
--    still write 't-shirts' as a draft category; fold it to 'shirts' as soon as
--    the row has a print location (the check above needs one), so nothing that
--    reaches the storefront can reintroduce the second shirts category.
CREATE OR REPLACE FUNCTION normalize_product_category() RETURNS trigger AS $$
BEGIN
  IF NEW.category = 't-shirts' AND COALESCE(array_length(NEW.print_locations, 1), 0) >= 1 THEN
    NEW.category := 'shirts';
  ELSIF NEW.category = '3d-models' THEN
    NEW.category := '3d-prints';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS normalize_product_category_trigger ON products;
CREATE TRIGGER normalize_product_category_trigger
  BEFORE INSERT OR UPDATE OF category, print_locations ON products
  FOR EACH ROW EXECUTE FUNCTION normalize_product_category();

-- Migration: Sync product mockup URLs to products.images array
-- This ensures product images are accessible from the products table

-- Function to sync mockup URLs from product_assets to products.images
CREATE OR REPLACE FUNCTION sync_product_images(p_product_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE products
  SET images = (
    SELECT COALESCE(array_agg(url ORDER BY created_at), ARRAY[]::text[])
    FROM product_assets
    WHERE product_id = p_product_id
      AND kind IN ('mockup', 'source')
      AND url IS NOT NULL
  )
  WHERE id = p_product_id;
END;
$$ LANGUAGE plpgsql;

-- Sync all existing products
DO $$
DECLARE
  product_record RECORD;
BEGIN
  FOR product_record IN
    SELECT DISTINCT p.id
    FROM products p
    INNER JOIN product_assets pa ON p.id = pa.product_id
    WHERE p.images IS NULL OR array_length(p.images, 1) IS NULL
  LOOP
    PERFORM sync_product_images(product_record.id);
  END LOOP;
END $$;

-- Create trigger to auto-sync when product_assets are inserted
CREATE OR REPLACE FUNCTION trigger_sync_product_images()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM sync_product_images(NEW.product_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_sync_product_images ON product_assets;
CREATE TRIGGER auto_sync_product_images
AFTER INSERT OR UPDATE ON product_assets
FOR EACH ROW
EXECUTE FUNCTION trigger_sync_product_images();

-- Verify the sync worked
SELECT
  p.id,
  p.name,
  array_length(p.images, 1) as image_count,
  COUNT(pa.id) as asset_count
FROM products p
LEFT JOIN product_assets pa ON p.id = pa.product_id
WHERE p.status = 'active'
GROUP BY p.id, p.name
LIMIT 10;

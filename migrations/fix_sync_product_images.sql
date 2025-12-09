-- Migration: Fix product image sync to include all relevant asset kinds
-- This ensures DTF, nobg, and other asset types are included in products.images

-- Drop existing trigger first
DROP TRIGGER IF EXISTS auto_sync_product_images ON product_assets;

-- Update the sync function to include all image asset kinds
CREATE OR REPLACE FUNCTION sync_product_images(p_product_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE products
  SET images = (
    SELECT COALESCE(array_agg(url ORDER BY
      CASE kind
        WHEN 'mockup' THEN 1    -- Mockups first (final product)
        WHEN 'dtf' THEN 2       -- DTF optimized second
        WHEN 'source' THEN 3    -- Original source third
        WHEN 'nobg' THEN 4      -- No-background fourth
        WHEN 'upscaled' THEN 5  -- Upscaled fifth
        ELSE 6
      END,
      created_at DESC
    ), ARRAY[]::text[])
    FROM product_assets
    WHERE product_id = p_product_id
      AND kind IN ('mockup', 'source', 'dtf', 'nobg', 'upscaled')
      AND url IS NOT NULL
  )
  WHERE id = p_product_id;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger to auto-sync when product_assets are inserted/updated
CREATE OR REPLACE FUNCTION trigger_sync_product_images()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM sync_product_images(NEW.product_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_sync_product_images
AFTER INSERT OR UPDATE ON product_assets
FOR EACH ROW
EXECUTE FUNCTION trigger_sync_product_images();

-- Sync ALL existing products that have assets (not just those with empty images)
DO $$
DECLARE
  product_record RECORD;
  synced_count INT := 0;
BEGIN
  FOR product_record IN
    SELECT DISTINCT p.id
    FROM products p
    INNER JOIN product_assets pa ON p.id = pa.product_id
    WHERE pa.url IS NOT NULL
  LOOP
    PERFORM sync_product_images(product_record.id);
    synced_count := synced_count + 1;
  END LOOP;
  RAISE NOTICE 'Synced % products with assets', synced_count;
END $$;

-- Verify the sync worked
SELECT
  p.id,
  p.name,
  p.status,
  array_length(p.images, 1) as image_count,
  COUNT(pa.id) as asset_count
FROM products p
LEFT JOIN product_assets pa ON p.id = pa.product_id
GROUP BY p.id, p.name, p.status
ORDER BY p.created_at DESC
LIMIT 20;

-- ============================================
-- AI Product Builder - Asset Role Columns
-- Date: 2025-12-09
-- ============================================

-- Add asset_role column for explicit role tracking
ALTER TABLE product_assets
ADD COLUMN IF NOT EXISTS asset_role TEXT;

-- Add is_primary column to flag selected design
ALTER TABLE product_assets
ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT false;

-- Add display_order column for gallery ordering
ALTER TABLE product_assets
ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 99;

-- Create indexes for efficient filtering
CREATE INDEX IF NOT EXISTS idx_product_assets_asset_role ON product_assets(asset_role);
CREATE INDEX IF NOT EXISTS idx_product_assets_is_primary ON product_assets(is_primary) WHERE is_primary = true;
CREATE INDEX IF NOT EXISTS idx_product_assets_display_order ON product_assets(display_order);

-- Composite index for display queries
CREATE INDEX IF NOT EXISTS idx_product_assets_display
ON product_assets(product_id, is_primary, asset_role, display_order);

-- Add comments for documentation
COMMENT ON COLUMN product_assets.asset_role IS 'Explicit role: design, mockup_flat_lay, mockup_mr_imagine, auxiliary';
COMMENT ON COLUMN product_assets.is_primary IS 'True only for the user-selected design asset';
COMMENT ON COLUMN product_assets.display_order IS 'Gallery ordering: 1=design, 2=flat_lay, 3=mr_imagine, 99=default';

-- ============================================
-- Backfill existing data
-- ============================================

-- Set asset_role for existing mockups based on metadata.template
UPDATE product_assets
SET asset_role = CASE
  WHEN metadata->>'template' = 'flat_lay' THEN 'mockup_flat_lay'
  WHEN metadata->>'template' = 'mr_imagine' THEN 'mockup_mr_imagine'
  ELSE 'mockup_flat_lay'  -- Default for mockups without template
END,
display_order = CASE
  WHEN metadata->>'template' = 'flat_lay' THEN 2
  WHEN metadata->>'template' = 'mr_imagine' THEN 3
  ELSE 2
END
WHERE kind = 'mockup' AND asset_role IS NULL;

-- Set asset_role for existing source/dtf images
UPDATE product_assets
SET asset_role = 'design'
WHERE kind IN ('source', 'dtf') AND asset_role IS NULL;

-- Set is_primary and display_order for selected designs
UPDATE product_assets
SET is_primary = true,
    display_order = 1
WHERE (metadata->>'is_selected')::boolean = true
  AND kind IN ('source', 'dtf')
  AND is_primary = false;

-- Set auxiliary role for nobg and upscaled
UPDATE product_assets
SET asset_role = 'auxiliary'
WHERE kind IN ('nobg', 'upscaled') AND asset_role IS NULL;

-- Migration: Add sizes and colors columns to products table for variant support
-- Sizes are category-specific (S/M/L for apparel, oz for tumblers, dimensions for DTF)
-- Colors are hex values stored as array

-- Add sizes column
ALTER TABLE products
ADD COLUMN IF NOT EXISTS sizes TEXT[] DEFAULT '{}';

-- Add colors column
ALTER TABLE products
ADD COLUMN IF NOT EXISTS colors TEXT[] DEFAULT '{}';

-- Add indexes for querying products with specific sizes/colors
CREATE INDEX IF NOT EXISTS idx_products_sizes ON products USING GIN (sizes);
CREATE INDEX IF NOT EXISTS idx_products_colors ON products USING GIN (colors);

-- Comments
COMMENT ON COLUMN products.sizes IS 'Available sizes for this product (category-specific: S/M/L/XL for apparel, oz for tumblers, dimensions for DTF)';
COMMENT ON COLUMN products.colors IS 'Available colors as hex values (e.g., #000000, #FFFFFF)';

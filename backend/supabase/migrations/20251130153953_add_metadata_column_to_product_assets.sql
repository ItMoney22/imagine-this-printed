-- Add metadata column to product_assets table
-- This column will store AI model information and other metadata

ALTER TABLE product_assets
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Add a comment to document the column
COMMENT ON COLUMN product_assets.metadata IS 'Stores AI model information (model_id, model_name, generated_at) and other metadata';

-- Create an index on the metadata column for faster queries
CREATE INDEX IF NOT EXISTS idx_product_assets_metadata ON product_assets USING GIN (metadata);

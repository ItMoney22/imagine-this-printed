-- Add metadata column to product_assets table
-- This column will store AI model information and other metadata
--
-- NOTE: this canonical copy was found committed EMPTY (0 bytes) during the
-- 2026-07-28 migration audit (Watchtower task c5335439) -- a from-scratch
-- `supabase db reset` would silently skip adding this column. Content
-- restored from backend/supabase/migrations/20251130153953_add_metadata_column_to_product_assets.sql,
-- which matches what's already live (product_assets.metadata exists in
-- production, verified via information_schema). Idempotent, safe to re-run.

ALTER TABLE product_assets
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Add a comment to document the column
COMMENT ON COLUMN product_assets.metadata IS 'Stores AI model information (model_id, model_name, generated_at) and other metadata';

-- Create an index on the metadata column for faster queries
CREATE INDEX IF NOT EXISTS idx_product_assets_metadata ON product_assets USING GIN (metadata);

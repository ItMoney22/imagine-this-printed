-- Migration: Add purchased_licenses column for download licensing system
-- Personal use: 200 ITC, Commercial use: 500 ITC

-- Add purchased_licenses column to track download licenses purchased
ALTER TABLE user_3d_models
ADD COLUMN IF NOT EXISTS purchased_licenses TEXT[] DEFAULT '{}';

-- Add index for querying models with purchased licenses
CREATE INDEX IF NOT EXISTS idx_user_3d_models_licenses
ON user_3d_models USING GIN (purchased_licenses);

-- Add ITC pricing entries for download licenses
INSERT INTO imagination_pricing (feature_key, display_name, base_cost, current_cost, is_free_trial, free_trial_uses)
VALUES
  ('3d_download_personal', '3D Model Personal License', 200, 200, false, 0),
  ('3d_download_commercial', '3D Model Commercial License', 500, 500, false, 0)
ON CONFLICT (feature_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  base_cost = EXCLUDED.base_cost,
  current_cost = EXCLUDED.current_cost;

-- Comment describing the field
COMMENT ON COLUMN user_3d_models.purchased_licenses IS 'Array of license types purchased: personal (200 ITC) or commercial (500 ITC)';

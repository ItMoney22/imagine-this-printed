-- Imagination Station Tables
-- Migration: 20251211_imagination_station.sql

-- imagination_sheets: Stores user's sheet projects
CREATE TABLE IF NOT EXISTS imagination_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) DEFAULT 'Untitled Sheet',
  print_type VARCHAR(20) CHECK (print_type IN ('dtf', 'uv_dtf', 'sublimation')),
  sheet_width DECIMAL NOT NULL,
  sheet_height DECIMAL NOT NULL,
  canvas_state JSONB,
  thumbnail_url TEXT,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'printed')),
  itc_spent INTEGER DEFAULT 0,
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- imagination_layers: Individual elements on a sheet
CREATE TABLE IF NOT EXISTS imagination_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID REFERENCES imagination_sheets(id) ON DELETE CASCADE,
  layer_type VARCHAR(20) CHECK (layer_type IN ('image', 'ai_generated', 'text')),
  source_url TEXT,
  processed_url TEXT,
  position_x DECIMAL DEFAULT 0,
  position_y DECIMAL DEFAULT 0,
  width DECIMAL,
  height DECIMAL,
  rotation DECIMAL DEFAULT 0,
  scale_x DECIMAL DEFAULT 1,
  scale_y DECIMAL DEFAULT 1,
  z_index INTEGER DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- imagination_pricing: Admin-adjustable ITC costs
CREATE TABLE IF NOT EXISTS imagination_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key VARCHAR(50) UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  base_cost INTEGER NOT NULL,
  current_cost INTEGER NOT NULL,
  is_free_trial BOOLEAN DEFAULT FALSE,
  free_trial_uses INTEGER DEFAULT 0,
  promo_end_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- imagination_free_trials: Track user's free trial usage
CREATE TABLE IF NOT EXISTS imagination_free_trials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_key VARCHAR(50) NOT NULL,
  uses_remaining INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, feature_key)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_imagination_sheets_user ON imagination_sheets(user_id);
CREATE INDEX IF NOT EXISTS idx_imagination_sheets_status ON imagination_sheets(status);
CREATE INDEX IF NOT EXISTS idx_imagination_layers_sheet ON imagination_layers(sheet_id);
CREATE INDEX IF NOT EXISTS idx_imagination_free_trials_user ON imagination_free_trials(user_id);

-- Enable RLS
ALTER TABLE imagination_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE imagination_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE imagination_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE imagination_free_trials ENABLE ROW LEVEL SECURITY;

-- RLS Policies for imagination_sheets
CREATE POLICY "Users can view own sheets" ON imagination_sheets
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sheets" ON imagination_sheets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sheets" ON imagination_sheets
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own draft sheets" ON imagination_sheets
  FOR DELETE USING (auth.uid() = user_id AND status = 'draft');

-- RLS Policies for imagination_layers
CREATE POLICY "Users can manage own layers" ON imagination_layers
  FOR ALL USING (
    sheet_id IN (SELECT id FROM imagination_sheets WHERE user_id = auth.uid())
  );

-- RLS Policies for imagination_pricing (public read)
CREATE POLICY "Anyone can read pricing" ON imagination_pricing
  FOR SELECT USING (true);

-- RLS Policies for imagination_free_trials
CREATE POLICY "Users can view own trials" ON imagination_free_trials
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own trials" ON imagination_free_trials
  FOR UPDATE USING (auth.uid() = user_id);

-- Insert default pricing
INSERT INTO imagination_pricing (feature_key, display_name, base_cost, current_cost, is_free_trial, free_trial_uses) VALUES
  ('bg_remove', 'Background Removal', 5, 5, true, 3),
  ('upscale_2x', 'Upscale 2x', 5, 5, true, 2),
  ('upscale_4x', 'Upscale 4x', 10, 10, true, 1),
  ('enhance', 'Enhance Image', 5, 5, true, 2),
  ('generate', 'Mr. Imagine Generation', 15, 15, true, 2),
  ('auto_nest', 'Auto-Nest Layout', 2, 2, true, 5),
  ('smart_fill', 'Smart Fill', 3, 3, true, 3),
  ('export', 'Export Sheet', 0, 0, false, 0)
ON CONFLICT (feature_key) DO NOTHING;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_imagination_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for imagination_sheets
DROP TRIGGER IF EXISTS imagination_sheets_updated_at ON imagination_sheets;
CREATE TRIGGER imagination_sheets_updated_at
  BEFORE UPDATE ON imagination_sheets
  FOR EACH ROW
  EXECUTE FUNCTION update_imagination_updated_at();

-- Trigger for imagination_pricing
DROP TRIGGER IF EXISTS imagination_pricing_updated_at ON imagination_pricing;
CREATE TRIGGER imagination_pricing_updated_at
  BEFORE UPDATE ON imagination_pricing
  FOR EACH ROW
  EXECUTE FUNCTION update_imagination_updated_at();

-- Helper function for atomic free trial decrement
CREATE OR REPLACE FUNCTION decrement_free_trial(p_user_id UUID, p_feature_key VARCHAR)
RETURNS VOID AS $$
BEGIN
  UPDATE imagination_free_trials
  SET uses_remaining = uses_remaining - 1
  WHERE user_id = p_user_id
    AND feature_key = p_feature_key
    AND uses_remaining > 0;
END;
$$ LANGUAGE plpgsql;

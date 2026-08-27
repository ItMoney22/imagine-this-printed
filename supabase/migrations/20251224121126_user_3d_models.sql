-- Migration: Create user_3d_models table for 3D figurine generation feature
-- Pipeline: Text Prompt → NanoBanana Concept → Approval → Multi-View → TRELLIS 3D → GLB/STL

-- Create user_3d_models table
CREATE TABLE IF NOT EXISTS user_3d_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  style VARCHAR(20) NOT NULL DEFAULT 'realistic' CHECK (style IN ('realistic', 'cartoon', 'low_poly', 'anime')),
  status VARCHAR(30) NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued',
    'generating_concept',
    'awaiting_approval',
    'generating_angles',
    'generating_3d',
    'ready',
    'failed'
  )),
  concept_image_url TEXT,
  angle_images JSONB DEFAULT '{}'::jsonb,
  glb_url TEXT,
  stl_url TEXT,
  itc_charged INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  idempotency_key UUID DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_user_3d_models_user ON user_3d_models(user_id);
CREATE INDEX IF NOT EXISTS idx_user_3d_models_status ON user_3d_models(status);
CREATE INDEX IF NOT EXISTS idx_user_3d_models_created ON user_3d_models(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_3d_models_user_status ON user_3d_models(user_id, status);

-- Enable Row Level Security
ALTER TABLE user_3d_models ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own 3D models
CREATE POLICY "Users can view own 3d models" ON user_3d_models
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own 3d models" ON user_3d_models
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own 3d models" ON user_3d_models
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own 3d models" ON user_3d_models
  FOR DELETE USING (auth.uid() = user_id);

-- Service role bypass for backend operations
CREATE POLICY "Service role full access" ON user_3d_models
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Updated_at trigger (reuse existing function if available)
CREATE OR REPLACE FUNCTION update_user_3d_models_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_3d_models_updated_at
  BEFORE UPDATE ON user_3d_models
  FOR EACH ROW
  EXECUTE FUNCTION update_user_3d_models_updated_at();

-- Add ITC pricing entries for 3D model generation
INSERT INTO imagination_pricing (feature_key, display_name, base_cost, current_cost, is_free_trial, free_trial_uses, description, is_active)
VALUES
  ('3d_concept', '3D Concept Generation', 20, 20, true, 1, 'Generate initial 2D concept for 3D figurine', true),
  ('3d_angles', '3D Multi-View Generation', 30, 30, false, 0, 'Generate 4 angle views (front, back, left, right)', true),
  ('3d_convert', '3D Model Conversion', 50, 50, false, 0, 'Convert 2D views to 3D GLB/STL model via TRELLIS', true)
ON CONFLICT (feature_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description;

-- Grant permissions
GRANT ALL ON user_3d_models TO authenticated;
GRANT ALL ON user_3d_models TO service_role;

-- Marketing Campaigns table for AI-powered marketing content generation
-- Created: 2025-12-22

-- Create marketing_campaigns table
CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('google_ads', 'facebook_ads', 'instagram', 'email', 'social', 'twitter', 'linkedin')),
  status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  target_products TEXT[] DEFAULT '{}',
  generated_content JSONB DEFAULT '{}',
  budget DECIMAL(10,2) DEFAULT 0,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  metrics JSONB DEFAULT '{"impressions": 0, "clicks": 0, "conversions": 0, "spend": 0}',
  settings JSONB DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status ON marketing_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_type ON marketing_campaigns(type);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_created_by ON marketing_campaigns(created_by);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_created_at ON marketing_campaigns(created_at DESC);

-- Enable Row Level Security
ALTER TABLE marketing_campaigns ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Admins and managers can view all campaigns
CREATE POLICY "Admins and managers can view campaigns"
  ON marketing_campaigns
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'manager')
    )
  );

-- RLS Policy: Admins and managers can insert campaigns
CREATE POLICY "Admins and managers can create campaigns"
  ON marketing_campaigns
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'manager')
    )
  );

-- RLS Policy: Admins and managers can update campaigns
CREATE POLICY "Admins and managers can update campaigns"
  ON marketing_campaigns
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'manager')
    )
  );

-- RLS Policy: Only admins can delete campaigns
CREATE POLICY "Admins can delete campaigns"
  ON marketing_campaigns
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

-- Create updated_at trigger function if not exists
CREATE OR REPLACE FUNCTION update_marketing_campaigns_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS trigger_marketing_campaigns_updated_at ON marketing_campaigns;
CREATE TRIGGER trigger_marketing_campaigns_updated_at
  BEFORE UPDATE ON marketing_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_marketing_campaigns_updated_at();

-- Add comment for documentation
COMMENT ON TABLE marketing_campaigns IS 'Stores marketing campaign data with AI-generated content for various platforms';

-- Migration: Create admin_settings table for storing application configuration
-- This table stores key-value pairs for admin-configurable settings like voice synthesis parameters

CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default voice settings
INSERT INTO admin_settings (key, value) VALUES
('voice', '{
  "voiceId": "female_voice_1",
  "speed": 1.0,
  "emotion": "neutral"
}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_admin_settings_updated_at
  BEFORE UPDATE ON admin_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add RLS policies (admin-only access)
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

-- Policy: Only admins and managers can read settings
CREATE POLICY admin_settings_read_policy ON admin_settings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'manager')
    )
  );

-- Policy: Only admins and managers can update settings
CREATE POLICY admin_settings_update_policy ON admin_settings
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role IN ('admin', 'manager')
    )
  );

-- Add comments for documentation
COMMENT ON TABLE admin_settings IS 'Stores admin-configurable application settings as key-value pairs';
COMMENT ON COLUMN admin_settings.key IS 'Unique setting identifier (e.g., "voice", "email")';
COMMENT ON COLUMN admin_settings.value IS 'JSONB value containing setting configuration';
COMMENT ON COLUMN admin_settings.created_at IS 'Timestamp when setting was first created';
COMMENT ON COLUMN admin_settings.updated_at IS 'Timestamp when setting was last modified';

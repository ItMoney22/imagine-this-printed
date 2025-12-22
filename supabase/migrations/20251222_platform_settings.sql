-- Platform Settings for Admin Control Panel
-- Created: 2025-12-22
--
-- Note: Uses existing platform_settings table with key-value schema
-- Table structure: setting_key (PK), setting_value, description, category, last_updated
--
-- Settings stored:
-- - platform_fee_percentage (0.07) - Platform fee taken from each sale (7%)
-- - stripe_fee_percentage (0.035) - Stripe processing fee (3.5%)
-- - founder_earnings_percentage (0.35) - Percentage of platform fees for founder (35%)
-- - minimum_payout_amount (25.00) - Minimum amount for vendor payout
-- - payout_schedule (weekly) - Payout frequency (daily, weekly, monthly)
-- - auto_payout_enabled (true) - Whether automatic payouts are enabled

-- Insert default platform settings as key-value pairs (upsert)
INSERT INTO platform_settings (setting_key, setting_value, description, category, last_updated)
VALUES
  ('platform_fee_percentage', '0.07', 'Platform fee taken from each sale (7%)', 'fees', NOW()),
  ('stripe_fee_percentage', '0.035', 'Stripe processing fee (3.5%)', 'fees', NOW()),
  ('founder_earnings_percentage', '0.35', 'Percentage of platform fees for founder (35%)', 'fees', NOW()),
  ('minimum_payout_amount', '25.00', 'Minimum amount for vendor payout', 'payouts', NOW()),
  ('payout_schedule', 'weekly', 'Payout frequency (daily, weekly, monthly)', 'payouts', NOW()),
  ('auto_payout_enabled', 'true', 'Whether automatic payouts are enabled', 'payouts', NOW())
ON CONFLICT (setting_key) DO NOTHING;

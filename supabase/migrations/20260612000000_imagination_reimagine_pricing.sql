-- Migration: 20260612_imagination_reimagine_pricing.sql
-- Adds pricing rows for the Reimagine It feature (tiered: standard and premium).
-- Column shape matches 20251211_imagination_station.sql imagination_pricing inserts.
-- Uses ON CONFLICT DO NOTHING so re-running the migration is safe and any admin
-- overrides to current_cost that happened after initial seed are preserved.

INSERT INTO imagination_pricing (feature_key, display_name, base_cost, current_cost, is_free_trial, free_trial_uses) VALUES
  ('reimagine_standard', 'Reimagine (Standard)',  1,  1, false, 0),
  ('reimagine_premium',  'Reimagine (Premium)',   50, 50, false, 0)
ON CONFLICT (feature_key) DO NOTHING;

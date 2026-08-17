-- Migration: 20260816_virtual_tryon.sql
-- Watchtower task 3b362203-e296-4230-bd7e-5f40b489462a — buyer-side virtual
-- try-on behind the ITC token gate.
--
-- WHY THIS SHAPE
-- The feature calls FASHN tryon-v1.6, which bills 1 credit per successful
-- output ($0.075 on-demand / $0.0488 at commitment tier III, verified
-- 2026-07-26). That is ~2.5x a gpt-image-2 1K render, so the feature only
-- earns its keep if it moves add-to-cart. Three tables:
--
--   virtual_tryon_runs         every API call, what it cost in USD and ITC
--   virtual_tryon_daily_usage  the atomic one-free-per-user-per-day claim
--   virtual_tryon_events       the conversion funnel (the kill-switch data)
--
-- The daily cap lives in its own table rather than in imagination_free_trials
-- because that table is a LIFETIME counter (uses_remaining decrements and
-- never refills). A daily grant needs a (user_id, usage_date) unique key so
-- the claim itself is the concurrency control — see the ON CONFLICT insert in
-- backend/services/virtual-tryon.ts.
--
-- Pricing rows go into imagination_pricing so the existing admin pricing panel
-- (routes/admin/imagination-pricing.ts) can retune or zero them out without a
-- deploy, exactly like every other AI spend in the app.

BEGIN;

-- ---------------------------------------------------------------------------
-- Runs: one row per FASHN call, successful or not.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS virtual_tryon_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Not a FK: a product can be retired while a shopper still has the try-on in
  -- their history, and the analytics rollup wants the id either way.
  product_id        uuid,
  tier              text NOT NULL,                     -- imagination_pricing.feature_key
  mode              text NOT NULL,                     -- FASHN mode: performance|balanced|quality
  status            text NOT NULL DEFAULT 'pending',   -- pending|completed|failed
  prediction_id     text,                              -- FASHN prediction id (support tickets)
  -- GCS object path of the shopper's uploaded photo, kept so DELETE /api/tryon/:id
  -- can actually remove the bytes rather than just hiding the row.
  -- model_photo_url is deliberately ABSENT. A year-long signed URL to a
  -- customer's face sitting in a table is a liability; the path is stored and
  -- a 60-minute URL is minted only when FASHN needs to read it.
  model_photo_path  text,
  garment_image_url text,
  result_url        text,                              -- primary output (signed)
  result_urls       jsonb NOT NULL DEFAULT '[]'::jsonb, -- every pose
  result_paths      text[] NOT NULL DEFAULT '{}',       -- so DELETE removes the bytes
  itc_charged       integer NOT NULL DEFAULT 0,
  used_free_daily   boolean NOT NULL DEFAULT false,
  credits_used      integer NOT NULL DEFAULT 0,        -- FASHN credits (num_samples)
  cost_usd          numeric(10,5) NOT NULL DEFAULT 0,  -- what WE paid FASHN
  latency_ms        integer,
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tryon_runs_user       ON virtual_tryon_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tryon_runs_product    ON virtual_tryon_runs(product_id);
CREATE INDEX IF NOT EXISTS idx_tryon_runs_created    ON virtual_tryon_runs(created_at DESC);

-- ---------------------------------------------------------------------------
-- Daily usage: the hard cap of one free try-on per user per day.
--
-- usage_date is a DATE in the STORE's timezone (America/New_York), computed in
-- Node and passed in — not now()::date — so the free grant resets at local
-- midnight for the shopper rather than at 8pm ET (UTC midnight). The UNIQUE
-- constraint is what makes the claim atomic: two concurrent requests race on
-- INSERT ... ON CONFLICT DO NOTHING and exactly one gets a row back.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS virtual_tryon_daily_usage (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  free_used  boolean NOT NULL DEFAULT true,
  paid_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_tryon_daily_user_date ON virtual_tryon_daily_usage(user_id, usage_date DESC);

-- ---------------------------------------------------------------------------
-- Events: the conversion funnel.
--
-- `tryon_card_viewed` is the matched denominator. Only shoppers who actually
-- SAW the try-on card are compared against each other — cohort A used it,
-- cohort B did not. Comparing try-on users against the whole site would be a
-- selection-bias number, and this feature gets killed or kept on this figure.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS virtual_tryon_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id           text,
  product_id           uuid,
  event_type           text NOT NULL,
  tryon_id             uuid REFERENCES virtual_tryon_runs(id) ON DELETE SET NULL,
  attributed_to_tryon  boolean NOT NULL DEFAULT false,
  seconds_since_tryon  integer,
  cost_usd             numeric(10,5) NOT NULL DEFAULT 0,
  value_usd            numeric(12,2) NOT NULL DEFAULT 0,
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT virtual_tryon_events_type_check CHECK (event_type IN (
    'tryon_card_viewed',
    'tryon_started',
    'tryon_completed',
    'tryon_failed',
    'add_to_cart',
    'purchase'
  ))
);

CREATE INDEX IF NOT EXISTS idx_tryon_events_user_product ON virtual_tryon_events(user_id, product_id);
CREATE INDEX IF NOT EXISTS idx_tryon_events_type_created ON virtual_tryon_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tryon_events_created      ON virtual_tryon_events(created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS. Every write path runs through the backend on the service-role key
-- (which bypasses RLS), so the client gets read-own and nothing else. No
-- blanket `USING (true)` policies here — see 20260805_security_lockdown.sql
-- for why those got torn out of this database once already.
-- ---------------------------------------------------------------------------
ALTER TABLE virtual_tryon_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE virtual_tryon_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE virtual_tryon_events      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tryon_runs_select_own" ON virtual_tryon_runs;
CREATE POLICY "tryon_runs_select_own" ON virtual_tryon_runs
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "tryon_daily_select_own" ON virtual_tryon_daily_usage;
CREATE POLICY "tryon_daily_select_own" ON virtual_tryon_daily_usage
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "tryon_events_select_own" ON virtual_tryon_events;
CREATE POLICY "tryon_events_select_own" ON virtual_tryon_events
  FOR SELECT USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Pricing tiers, seeded into the existing admin-tunable pricing table.
--
-- 1 ITC = $0.01 (backend/config/itc-pricing.ts is authoritative). FASHN bills
-- $0.075/credit on-demand, so anything under 8 ITC loses money on every paid
-- run:
--   tryon_standard  balanced mode, 1 sample  -> 1 credit  = $0.075 cost, 10 ITC = $0.10 charged
--   tryon_premium   quality mode,  2 samples -> 2 credits = $0.150 cost, 25 ITC = $0.25 charged
--
-- is_free_trial stays FALSE on purpose: the free allowance for this feature is
-- the DAILY cap in virtual_tryon_daily_usage, and leaving the lifetime trial
-- counter on as well would hand out two different free grants for one feature.
-- ---------------------------------------------------------------------------
INSERT INTO imagination_pricing (feature_key, display_name, base_cost, current_cost, is_free_trial, free_trial_uses) VALUES
  ('tryon_standard', 'Virtual Try-On (Standard)', 10, 10, false, 0),
  ('tryon_premium',  'Virtual Try-On (Premium)',  25, 25, false, 0)
ON CONFLICT (feature_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- The kill-switch report, as a view, so it can be read straight from SQL as
-- well as from GET /api/tryon/analytics.
--
-- Cohorts are matched on "saw the try-on card on this product":
--   used     = saw the card AND completed at least one try-on on it
--   not_used = saw the card and never ran one
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW virtual_tryon_conversion AS
WITH viewers AS (
  SELECT DISTINCT user_id, product_id
  FROM virtual_tryon_events
  WHERE event_type = 'tryon_card_viewed' AND user_id IS NOT NULL AND product_id IS NOT NULL
),
users_of AS (
  SELECT DISTINCT user_id, product_id
  FROM virtual_tryon_events
  WHERE event_type = 'tryon_completed' AND user_id IS NOT NULL AND product_id IS NOT NULL
),
carts AS (
  SELECT DISTINCT user_id, product_id
  FROM virtual_tryon_events
  WHERE event_type = 'add_to_cart' AND user_id IS NOT NULL AND product_id IS NOT NULL
),
cohorts AS (
  SELECT
    v.user_id,
    v.product_id,
    (u.user_id IS NOT NULL)  AS used_tryon,
    (c.user_id IS NOT NULL)  AS added_to_cart
  FROM viewers v
  LEFT JOIN users_of u ON u.user_id = v.user_id AND u.product_id = v.product_id
  LEFT JOIN carts    c ON c.user_id = v.user_id AND c.product_id = v.product_id
)
SELECT
  used_tryon,
  count(*)                                                    AS shoppers,
  count(*) FILTER (WHERE added_to_cart)                       AS add_to_carts,
  ROUND(
    (count(*) FILTER (WHERE added_to_cart))::numeric
      / NULLIF(count(*), 0) * 100, 2)                         AS add_to_cart_rate_pct
FROM cohorts
GROUP BY used_tryon;

COMMIT;

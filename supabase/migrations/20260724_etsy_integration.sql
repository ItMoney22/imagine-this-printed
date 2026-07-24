-- Etsy product-posting integration (Watchtower task 0a675d4c-860a-40fa-b0fc-1149f031b095).
-- Additive only. NOT yet applied to the live DB — apply together with enabling
-- ETSY_ENABLED once David has created the Etsy shop + app (see
-- docs/plans/2026-07-24-etsy-integration-plan.md, Phase 1).
--
-- All three tables are backend/service-role only: RLS is enabled with NO
-- policies, so anon/authenticated clients get nothing while the backend's
-- service-role key (which bypasses RLS) has full access. OAuth tokens never
-- reach the browser.

-- 1) Short-lived OAuth handshake state: one row per initiated connect attempt.
--    Row is deleted on callback; stale rows (>1h) are garbage, cleaned
--    opportunistically by the service on each new connect.
CREATE TABLE IF NOT EXISTS public.etsy_oauth_states (
  state text PRIMARY KEY,
  code_verifier text NOT NULL,
  redirect_uri text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.etsy_oauth_states ENABLE ROW LEVEL SECURITY;

-- 2) The shop connection (tokens). Single-shop design: one row, upserted on
--    (re)connect and on every token refresh. Etsy rotates the refresh token on
--    every refresh, so both tokens are rewritten atomically each time.
CREATE TABLE IF NOT EXISTS public.etsy_connection (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  etsy_user_id bigint NOT NULL,
  shop_id bigint,
  shop_name text,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  access_token_expires_at timestamptz NOT NULL,
  scopes text NOT NULL DEFAULT '',
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.etsy_connection ENABLE ROW LEVEL SECURITY;

-- 3) Product ↔ Etsy listing sync state. One Etsy listing per ITP product.
CREATE TABLE IF NOT EXISTS public.etsy_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  listing_id bigint,
  shop_id bigint,
  state text NOT NULL DEFAULT 'pending',           -- pending | draft | active | error | removed
  etsy_url text,
  uploaded_image_count int NOT NULL DEFAULT 0,
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_etsy_listings_product ON public.etsy_listings (product_id);
CREATE INDEX IF NOT EXISTS idx_etsy_listings_state ON public.etsy_listings (state);
ALTER TABLE public.etsy_listings ENABLE ROW LEVEL SECURITY;

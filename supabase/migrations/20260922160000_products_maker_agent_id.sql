-- ============================================================================
-- Migration: products.maker_agent_id — record WHO MADE a product
-- Watchtower task b505062b-0ebd-4499-ba26-8928d8f4ca65
-- ============================================================================
--
-- PROBLEM (verified against the LIVE Stripe account 2026-09-22):
--   The Watchtower revenue sync (david-trinidad-com/src/app/api/revenue/sync,
--   via creditDecision() in src/lib/stripe-revenue.ts) credits a charge to
--   metadata.agent_id / metadata.watchtower_agent, and falls back to the
--   account's defaultAgentId when neither is present. For the ITP account
--   (acct_1SkRFuIK5lihoSZt) that default is `rico-fernandez`.
--
--   Nothing in ITP has ever written those keys. Live proof: the three most
--   recent ITP charges (ch_3UErazIK5lihoSZt0s1LLY9B, py_3UD9n0IK5lihoSZt…,
--   ch_3U1wrCIK5lihoSZt…) carry orderId / orderNumber / items / shipping* and
--   NO attribution key at all. So every ITP sale to date has paid Rico —
--   including the 2026-09-21 Gothic Ghost Face Candle Holder sales, which are
--   Amelia Chan's work. Credits book at 3x to the agent plus 1x to their
--   planet, so this is real Watts on the wrong ledger, not a display bug.
--
--   There was no column to record a maker in: `products` has vendor_id
--   (a Supabase auth user) and created_by_user_id, neither of which can name
--   a Watchtower agent.
--
-- WHAT THIS MIGRATION DOES:
--   1. Adds nullable `products.maker_agent_id text` — the Watchtower agent id
--      (e.g. 'amelia-chan') of whoever made the product. NULL = house goods,
--      which is the correct answer for most of the catalogue and is what the
--      checkout treats as "fall back to the account default".
--   2. Constrains it to a lowercase kebab slug. Roster membership is NOT
--      enforced here on purpose — the roster lives in another Supabase
--      project (yrjoblqqgrposgbvsbxm.agent_profiles) and a cross-project FK is
--      impossible; membership is enforced in backend/shared/maker-attribution.ts,
--      which both the admin UI and the checkout path go through.
--   3. Indexes the non-null rows so "everything Amelia made" is a cheap query.
--   4. Backfills the candle holders to amelia-chan — see the note at the end.
--
-- SAFETY: additive and nullable. Nothing reads this column until the code
-- that ships with this migration does, and a NULL behaves exactly like today.
-- ============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS maker_agent_id text;

COMMENT ON COLUMN public.products.maker_agent_id IS
  'Watchtower agent id of the maker/creator (e.g. amelia-chan). Stamped into '
  'Stripe checkout metadata as agent_id so revenue credits the maker instead '
  'of ITP''s default agent. NULL = house goods. Validated against the roster '
  'in backend/shared/maker-attribution.ts.';

-- Shape only. An id that is slug-shaped but not on the roster is rejected in
-- application code, because a stamp Watchtower does not recognise makes
-- creditDecision return `unknown_agent` and credits NOBODY — worse than NULL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.products'::regclass
      AND conname = 'products_maker_agent_id_slug'
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_maker_agent_id_slug
      CHECK (maker_agent_id IS NULL OR maker_agent_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_maker_agent_id
  ON public.products (maker_agent_id)
  WHERE maker_agent_id IS NOT NULL;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- The candle holders are Amelia Chan's, per the task brief that opened
-- b505062b. There is no provenance recorded anywhere in the product row or its
-- metadata to derive this from — product.metadata carries only marketing_hooks
-- and seo_pack_generated_at — so this is an assertion from the brief, applied
-- by name, not an inference. Every other product stays NULL (house) until
-- someone sets a maker in the admin UI; guessing the rest would put Watts on
-- ledgers on the strength of a product title, which is exactly the error this
-- whole change exists to stop.
UPDATE public.products
SET maker_agent_id = 'amelia-chan'
WHERE maker_agent_id IS NULL
  AND name ILIKE '%candle holder%';

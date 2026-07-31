-- Etsy selling tiers (David 2026-07-31: "so its a 3 tier shirt or transfer or download").
--
-- One ITP design can now be sold on Etsy three ways, and Etsy fixes BOTH the
-- listing `type` (physical vs download) and `taxonomy_id` at the listing level
-- — so the three tiers can never be variations of a single listing. Each tier
-- is its own Etsy listing, which means etsy_listings can no longer be unique on
-- product_id alone.
--
-- Additive and idempotent. Existing rows become tier='primary', which is
-- exactly what they are: the product's own listing (a tee or a metal panel).
-- Nothing that is already posted changes.

-- 1) The tier column. DEFAULT 'primary' backfills every existing row.
ALTER TABLE public.etsy_listings
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'primary';

-- 2) Constrain it to the tiers the code knows about (backend/shared/etsy-tiers.ts).
--    Guarded so a re-run does not error on the existing constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'etsy_listings_tier_valid'
  ) THEN
    ALTER TABLE public.etsy_listings
      ADD CONSTRAINT etsy_listings_tier_valid
      CHECK (tier IN ('primary', 'transfer', 'download'));
  END IF;
END$$;

-- 3) Re-key the uniqueness: one listing per (product, tier) instead of one per
--    product. The old index is what would otherwise reject the 2nd and 3rd tier.
--    Order matters — create the new one first so the table is never unguarded.
CREATE UNIQUE INDEX IF NOT EXISTS uq_etsy_listings_product_tier
  ON public.etsy_listings (product_id, tier);

DROP INDEX IF EXISTS public.uq_etsy_listings_product;

-- 4) The worker polls state='queued' and now carries the tier through to the
--    publish call; keep the state index and add a state+tier composite.
CREATE INDEX IF NOT EXISTS idx_etsy_listings_state_tier
  ON public.etsy_listings (state, tier);

COMMENT ON COLUMN public.etsy_listings.tier IS
  'Which Etsy listing this row tracks for the product: primary (the product itself — tee/metal panel), transfer (printed DTF film, taxonomy 6617), or download (digital design file, type=download, taxonomy 6844). See backend/shared/etsy-tiers.ts.';

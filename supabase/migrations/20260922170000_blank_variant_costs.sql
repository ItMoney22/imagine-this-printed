-- Variant-level blank costs (style x colour x size) from the supplier.
--
-- WHY (Watchtower 767f74d4, David: "20% markup on the exact blank cost"):
-- the catalogue priced every printed garment off ONE flat number per listing
-- plus a flat $2.50 plus-size rule. Jiffy's real upcharges are nothing like
-- flat -- a Gildan 5000 goes $2.99 (S-XL) -> $6.93 (2XL) -> $9.53 (5XL), and
-- a Gildan 18500 hoodie starts at $15.09 and ends at $23.71 -- so the bigger
-- the customer, the thinner (or negative) the margin. This table is the cost
-- truth the pricing engine marks up.
--
-- cost_usd  = what WE pay (Jiffy's selling price -- the same figure the public
--             PDP shows as the unit amount; no login needed, verified 2026-09-22).
-- list_usd  = Jiffy's struck-through retail/MSRP on the same page, kept for
--             context only. Nothing prices off it.
-- last_synced = when this row was last confirmed against the supplier. A stale
--             row is the whole reason this column exists: prices move and a
--             silently old cost sells at a loss.
--
-- Written by backend/scripts/sync-jiffy-costs.ts; read by
-- backend/scripts/reprice-catalog-variants.ts (which stamps retail prices onto
-- products.metadata.garment.variant_pricing) and by the admin margin API
-- (backend/routes/admin/margins.ts). Supplier costs never reach the browser --
-- only the derived retail table does.

CREATE TABLE IF NOT EXISTS public.blank_variant_costs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier TEXT NOT NULL DEFAULT 'jiffy',
  -- Supplier catalogue number exactly as the supplier prints it: G500, G640,
  -- 3001C, C1717, G185, G500B, G185B.
  style_code TEXT NOT NULL,
  brand TEXT NOT NULL,
  -- backend/shared/blank-line.ts tier id when this style backs one of the four
  -- house tiers ('standard' | 'soft' | 'premium' | 'heavyweight'), else NULL.
  tier_id TEXT,
  -- backend/shared/catalog-capability.ts garment id this style is the blank
  -- for ('tshirt' | 'hoodie' | 'youth-tshirt' | 'youth-hoodie'), else NULL.
  garment_id TEXT,
  -- Supplier colour NAME verbatim ("Sport Grey", not "heather-grey").
  color TEXT NOT NULL,
  color_slug TEXT NOT NULL,
  -- Supplier size token: XS, S, M, L, XL, 2XL, 3XL, 4XL, 5XL.
  size TEXT NOT NULL,
  cost_usd NUMERIC(10,2) NOT NULL CHECK (cost_usd >= 0),
  list_usd NUMERIC(10,2) CHECK (list_usd IS NULL OR list_usd >= 0),
  sku TEXT,
  in_stock BOOLEAN,
  supplier_url TEXT,
  -- 'jiffy-web'  — scraped from the live supplier PDP (authoritative)
  -- 'snapshot'   — seeded from the costs captured in backend/shared/blank-line.ts
  -- 'manual'     — typed in by an admin
  source TEXT NOT NULL DEFAULT 'jiffy-web' CHECK (source IN ('jiffy-web', 'snapshot', 'manual')),
  last_synced TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (supplier, style_code, color, size)
);

CREATE INDEX IF NOT EXISTS blank_variant_costs_style_idx
  ON public.blank_variant_costs (style_code, size);
CREATE INDEX IF NOT EXISTS blank_variant_costs_tier_idx
  ON public.blank_variant_costs (tier_id) WHERE tier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS blank_variant_costs_synced_idx
  ON public.blank_variant_costs (last_synced);

-- Keep updated_at honest without relying on the writer to remember.
CREATE OR REPLACE FUNCTION public.touch_blank_variant_costs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS blank_variant_costs_touch ON public.blank_variant_costs;
CREATE TRIGGER blank_variant_costs_touch
  BEFORE UPDATE ON public.blank_variant_costs
  FOR EACH ROW EXECUTE FUNCTION public.touch_blank_variant_costs();

-- Service-role only. Supplier cost is competitively sensitive and is never
-- read by the browser -- same posture as blank_inventory / print_materials.
-- No policies are created, so RLS denies every anon/authenticated request
-- while the service role (which bypasses RLS) keeps working.
ALTER TABLE public.blank_variant_costs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.blank_variant_costs FROM anon;
REVOKE ALL ON public.blank_variant_costs FROM authenticated;

COMMENT ON TABLE public.blank_variant_costs IS
  'Supplier blank cost per style x colour x size. Marked up 20% + decoration cost to make retail. Written by backend/scripts/sync-jiffy-costs.ts.';
COMMENT ON COLUMN public.blank_variant_costs.last_synced IS
  'When this cost was last confirmed against the supplier. Stale = selling on an old cost.';

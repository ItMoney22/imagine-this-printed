-- ============================================================================
-- Design performance: which designs get seen, clicked, carted and bought
-- ============================================================================
-- Watchtower task 47174caa (rhea-cassien, 2026-10-12). Ties the web store's
-- click-through, add-to-cart and paid orders to the AI prompt that drew each
-- design, so a prompt variant nobody clicks (or clicks and never carts) is
-- flagged to prune or refresh instead of sitting in the shop for weeks.
--
--   design_prompt_variants  one row per distinct prompt (+ model) that drew a
--                           live design, grouped under a design concept (the
--                           shopper's idea / Mrs. Imagine brief). Carries the
--                           prune/refresh flag the daily sweep writes.
--   design_artworks         product -> the artwork it sells now -> its variant.
--   design_events           impression / click / detail_view / add_to_cart
--                           rows from the store, stamped with the artwork and
--                           variant AT WRITE TIME (a redone design keeps its
--                           old numbers on its old variant).
--   design_order_events     VIEW: paid web-store order lines keyed the same
--                           way. Orders are read from orders/order_items, the
--                           source of truth, never copied (a refund or a
--                           cancel drops out on its own; no trigger touches
--                           the live payment path).
--   design_performance_counts(since, until)
--                           one row per (product, variant) with every count;
--                           backend/services/design-performance.ts turns it
--                           into rates + flags.
--
-- Server-only, like product_print_files: RLS on with no policies, every grant
-- revoked from anon/authenticated (the view is security_invoker AND revoked,
-- because a plain view would hand order data to anyone with the anon key).
-- The store writes events through POST /api/design-events (rate-limited, the
-- API stamps the ids); the admin page reads through /api/admin/design-performance.
--
-- Additive and idempotent. Rollback = drop function, view and the three tables.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.design_prompt_variants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- sha256 of the normalized prompt + model (backend/services/design-prompt.ts).
  variant_key   text NOT NULL UNIQUE,
  -- Groups variants of one idea: 'brief:<key>', 'idea:<hash>', 'design:<id>'.
  concept_key   text NOT NULL,
  concept_label text NOT NULL,
  -- NULL for a hand-made (library / creator) design with no AI prompt.
  prompt_text   text,
  model_id      text,
  source        text NOT NULL DEFAULT 'unknown',
  flag          text NOT NULL DEFAULT 'learning'
                CHECK (flag IN ('learning', 'healthy', 'refresh', 'prune')),
  flag_reason   text,
  flagged_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS design_prompt_variants_concept_idx
  ON public.design_prompt_variants (concept_key);

CREATE TABLE IF NOT EXISTS public.design_artworks (
  product_id        uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  -- product_assets id of the design source, else 'library:<design_id>', else 'product:<id>'.
  artwork_id        text NOT NULL,
  prompt_variant_id uuid NOT NULL REFERENCES public.design_prompt_variants(id) ON DELETE CASCADE,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS design_artworks_variant_idx
  ON public.design_artworks (prompt_variant_id);

CREATE TABLE IF NOT EXISTS public.design_events (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type        text NOT NULL
                    CHECK (event_type IN ('impression', 'click', 'detail_view', 'add_to_cart')),
  product_id        uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  artwork_id        text,
  prompt_variant_id uuid REFERENCES public.design_prompt_variants(id) ON DELETE SET NULL,
  -- Where it happened: home, catalog, product, storefront, cart, other.
  surface           text,
  -- Per-tab random id from the browser (sessionStorage), never a user id.
  session_id        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS design_events_window_idx
  ON public.design_events (created_at, product_id);
CREATE INDEX IF NOT EXISTS design_events_variant_idx
  ON public.design_events (prompt_variant_id, created_at);

-- Paid web-store order lines. "Order" = payment_status 'paid', not cancelled,
-- not an Etsy receipt (Etsy sales never saw our store's tiles).
CREATE OR REPLACE VIEW public.design_order_events
WITH (security_invoker = true) AS
SELECT
  oi.id               AS order_item_id,
  o.id                AS order_id,
  'order'::text       AS event_type,
  oi.product_id,
  da.artwork_id,
  da.prompt_variant_id,
  oi.quantity,
  oi.subtotal,
  o.created_at
FROM public.order_items oi
JOIN public.orders o ON o.id = oi.order_id
LEFT JOIN public.design_artworks da ON da.product_id = oi.product_id
WHERE oi.product_id IS NOT NULL
  AND o.payment_status = 'paid'
  AND COALESCE(o.status, '') <> 'cancelled'
  AND o.etsy_receipt_id IS NULL;

CREATE OR REPLACE FUNCTION public.design_performance_counts(p_since timestamptz, p_until timestamptz)
RETURNS TABLE (
  product_id        uuid,
  prompt_variant_id uuid,
  impressions       bigint,
  clicks            bigint,
  detail_views      bigint,
  add_to_carts      bigint,
  orders            bigint,
  units             bigint,
  revenue           numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH ev AS (
    SELECT e.product_id, e.prompt_variant_id,
           count(*) FILTER (WHERE e.event_type = 'impression')  AS impressions,
           count(*) FILTER (WHERE e.event_type = 'click')       AS clicks,
           count(*) FILTER (WHERE e.event_type = 'detail_view') AS detail_views,
           count(*) FILTER (WHERE e.event_type = 'add_to_cart') AS add_to_carts
    FROM public.design_events e
    WHERE e.created_at >= p_since AND e.created_at < p_until
    GROUP BY e.product_id, e.prompt_variant_id
  ), od AS (
    SELECT o.product_id, o.prompt_variant_id,
           count(DISTINCT o.order_id)        AS orders,
           COALESCE(sum(o.quantity), 0)::bigint AS units,
           COALESCE(sum(o.subtotal), 0)      AS revenue
    FROM public.design_order_events o
    WHERE o.created_at >= p_since AND o.created_at < p_until
    GROUP BY o.product_id, o.prompt_variant_id
  )
  SELECT COALESCE(ev.product_id, od.product_id),
         COALESCE(ev.prompt_variant_id, od.prompt_variant_id),
         COALESCE(ev.impressions, 0), COALESCE(ev.clicks, 0),
         COALESCE(ev.detail_views, 0), COALESCE(ev.add_to_carts, 0),
         COALESCE(od.orders, 0), COALESCE(od.units, 0), COALESCE(od.revenue, 0)
  FROM ev
  FULL JOIN od
    ON od.product_id = ev.product_id
   -- FULL JOIN needs a hashable condition, so NULL variants compare via a sentinel.
   AND COALESCE(od.prompt_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
     = COALESCE(ev.prompt_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
$$;

ALTER TABLE public.design_prompt_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_artworks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.design_events          ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.design_prompt_variants FROM anon, authenticated;
REVOKE ALL ON public.design_artworks        FROM anon, authenticated;
REVOKE ALL ON public.design_events          FROM anon, authenticated;
REVOKE ALL ON public.design_order_events    FROM PUBLIC, anon, authenticated;
GRANT ALL    ON public.design_prompt_variants, public.design_artworks, public.design_events TO service_role;
GRANT SELECT ON public.design_order_events TO service_role;

REVOKE ALL ON FUNCTION public.design_performance_counts(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.design_performance_counts(timestamptz, timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

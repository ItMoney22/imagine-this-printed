-- Materialized co-purchase pairs for the product recommender (Watchtower
-- task 7194f6fe-7f92-40a5-8dee-c41a986aa60a).
--
-- WHY: src/utils/product-recommender.ts's live path (getRecommendations) was
-- already real (a Supabase query), but its ranking was category-match +
-- is_featured + Math.random() — never actual purchase behavior. This table
-- is populated nightly by backend/scripts/refresh-product-copurchase.ts from
-- real `order_items`, so "customers who bought this also bought" becomes
-- literally true instead of a random-in-category guess.
--
-- Rows are DIRECTIONAL and symmetric: an order containing {A, B} writes both
-- (A, B) and (B, A) so a lookup by either anchor product is a single indexed
-- range scan, not a self-join at read time.

CREATE TABLE IF NOT EXISTS public.product_copurchase (
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  co_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  purchase_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (product_id, co_product_id)
);

-- Composite PK already gives an index on (product_id, co_product_id); this
-- second index additionally orders by purchase_count so "top N co-purchases
-- for this product" is an index-only scan, not a sort at query time.
CREATE INDEX IF NOT EXISTS idx_product_copurchase_ranked
  ON public.product_copurchase(product_id, purchase_count DESC);

-- Read-only for the storefront (recommender queries), write access is the
-- nightly job's service-role connection only.
ALTER TABLE public.product_copurchase ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read product co-purchase data" ON public.product_copurchase;
CREATE POLICY "Anyone can read product co-purchase data" ON public.product_copurchase
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role full access to product co-purchase" ON public.product_copurchase;
CREATE POLICY "Service role full access to product co-purchase" ON public.product_copurchase
  FOR ALL USING (auth.role() = 'service_role');

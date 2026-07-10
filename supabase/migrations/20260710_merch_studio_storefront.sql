-- Merch Studio foundation (Phase 1) — storefront creator products.
-- Verified against the LIVE DB 2026-07-10 before writing (products had no
-- cost_price column; user_product_royalties had no (order, product) uniqueness
-- and no duplicate rows, so the index builds clean).

-- 1) products.cost_price — ITP's base cost for creator (POD) products.
--    D1 money model: creator margin = retail − cost_price − fee share.
--    NULL = no cost basis (legacy AI designs keep the 15% royalty model).
--    Prisma already maps costPrice -> cost_price; only the live DB lacked it.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost_price numeric;

-- 2) Idempotent creator payout accrual: at most ONE royalty/margin row per
--    (order, product). Backstops duplicate Stripe webhook deliveries racing
--    the code-level existence check in backend/services/creator-margins.ts.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_product_royalties_order_product
  ON public.user_product_royalties (order_id, product_id)
  WHERE order_id IS NOT NULL AND product_id IS NOT NULL;

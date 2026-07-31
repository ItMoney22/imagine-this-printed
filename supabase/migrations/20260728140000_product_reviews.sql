-- Migration: 20260728140000_product_reviews.sql
-- Watchtower task cd19d3fb-cce5-437e-946c-8e271167d9b7 (reviews half).
--
-- WHY: the storefront had no reviews at all. The load-bearing decision here is
-- that a review can only be written by someone who actually bought the product.
-- An open review table is a spam magnet, and "verified buyer" is the entire
-- reason a review carries social proof.
--
-- That rule is enforced in TWO places on purpose:
--   1. the RLS INSERT policy below (blocks a direct-from-browser insert with
--      the anon key, which is the attack a public Supabase project invites), and
--   2. backend/routes/reviews.ts (blocks the API path).
-- Both are required. The backend uses the SERVICE ROLE key, which bypasses RLS
-- entirely — an RLS-only guard would protect nothing on the path the app
-- actually uses.

-- ---------------------------------------------------------------------------
-- Which order statuses count as "bought it"
-- ---------------------------------------------------------------------------
-- Mirrors backend/lib/order-status.ts: every status at or after payment.
-- Deliberately NOT 'pending' (payment not taken), 'cancelled' or 'refunded'
-- (a refunded order is not a purchase you get to review as verified).
--
-- SECURITY DEFINER + explicit search_path: the function reads orders/order_items,
-- which have their own RLS. Without DEFINER the policy's result would depend on
-- whether the caller can see their own order_items rows, which is a different
-- question than "did they buy it". `SET search_path` is mandatory on a DEFINER
-- function — the same lesson as 20260728_fix_get_user_role_ambiguity.sql.
--
-- It takes NO user_id parameter and reads auth.uid() itself, so it cannot be
-- used to probe whether some other customer bought something.
CREATE OR REPLACE FUNCTION public.viewer_purchased_product(p_product_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.product_id = p_product_id
      AND o.user_id = auth.uid()
      AND o.status IN ('paid', 'processing', 'printed', 'shipped', 'delivered', 'completed')
  );
$$;

-- ---------------------------------------------------------------------------
-- product_reviews
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,

  -- The order that entitles this review. Kept for auditability: it is how a
  -- human answers "prove this buyer is real" months later, and it survives the
  -- product being renamed. ON DELETE SET NULL so purging an order does not
  -- silently delete the customer's review.
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,

  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT CHECK (title IS NULL OR char_length(title) <= 120),
  body TEXT CHECK (body IS NULL OR char_length(body) <= 4000),

  -- Moderation. 'published' is the default because these are verified buyers,
  -- not anonymous submissions; 'hidden' is the admin's takedown switch.
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One review per customer per product. This is a DATABASE constraint, not an
  -- app-level check-then-insert, because two concurrent submits can both pass
  -- an application uniqueness check and both insert (the same race the Etsy
  -- receipt poller hit on orders.etsy_receipt_id). Editing goes through UPDATE.
  CONSTRAINT product_reviews_one_per_customer UNIQUE (product_id, user_id)
);

-- The storefront's only read pattern: published reviews for one product,
-- newest first.
CREATE INDEX IF NOT EXISTS idx_product_reviews_product_published
  ON public.product_reviews (product_id, created_at DESC)
  WHERE status = 'published';

-- "Have I already reviewed this?" and the account page's own-reviews list.
CREATE INDEX IF NOT EXISTS idx_product_reviews_user
  ON public.product_reviews (user_id, created_at DESC);

ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;

-- Public read of published reviews only. Hidden reviews disappear from the
-- storefront the moment an admin flips the status.
DROP POLICY IF EXISTS "Anyone can read published reviews" ON public.product_reviews;
CREATE POLICY "Anyone can read published reviews" ON public.product_reviews
  FOR SELECT USING (status = 'published');

-- A customer can always see their own review, including after it is hidden —
-- otherwise a moderated review just vanishes with no explanation.
DROP POLICY IF EXISTS "Customers can read their own reviews" ON public.product_reviews;
CREATE POLICY "Customers can read their own reviews" ON public.product_reviews
  FOR SELECT USING (auth.uid() = user_id);

-- THE verified-purchase gate.
DROP POLICY IF EXISTS "Verified buyers can write a review" ON public.product_reviews;
CREATE POLICY "Verified buyers can write a review" ON public.product_reviews
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND public.viewer_purchased_product(product_id)
  );

-- Editing your own review is allowed; moving it to another product or another
-- user is not, and a customer cannot un-hide a moderated review.
DROP POLICY IF EXISTS "Customers can edit their own review" ON public.product_reviews;
CREATE POLICY "Customers can edit their own review" ON public.product_reviews
  FOR UPDATE
  USING (auth.uid() = user_id AND status = 'published')
  WITH CHECK (auth.uid() = user_id AND status = 'published');

DROP POLICY IF EXISTS "Customers can delete their own review" ON public.product_reviews;
CREATE POLICY "Customers can delete their own review" ON public.product_reviews
  FOR DELETE USING (auth.uid() = user_id);

-- Moderation runs through the backend's service-role connection. Deliberately
-- NOT expressed as an "admins can do anything" policy calling get_user_role():
-- that helper is the subject of 20260728_fix_get_user_role_ambiguity.sql and
-- adding another dependent policy to it now would widen that blast radius.
DROP POLICY IF EXISTS "Service role full access to product reviews" ON public.product_reviews;
CREATE POLICY "Service role full access to product reviews" ON public.product_reviews
  FOR ALL USING (auth.role() = 'service_role');

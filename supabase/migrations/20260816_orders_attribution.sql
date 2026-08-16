-- Landing-UTM attribution captured onto the order at checkout (ba470233).
--
-- src/utils/utm.ts persists the visitor's last-touch utm_source/medium/
-- campaign/content/term (+ referrer + landed_at) to localStorage the moment
-- the app boots. checkout-payment-intent now forwards that record so a paid
-- order can be traced back to the social post that drove it —
-- utm_campaign is a social_outbox row id (backend/services/social-utm.ts),
-- so orders.attribution->>'utm_campaign' joins straight back to the post.
--
-- Nullable JSONB: most orders still have no known campaign (direct traffic,
-- organic search, a bookmark) and NULL is the honest value for "unknown",
-- not an empty object.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS attribution JSONB;

-- Read pattern is "find every order this campaign produced" (revenue
-- attribution for a specific outbox post) — a GIN index makes that ->>
-- lookup an index scan instead of a sequential one as the orders table grows.
CREATE INDEX IF NOT EXISTS orders_attribution_idx
  ON public.orders USING GIN (attribution);

COMMENT ON COLUMN public.orders.attribution IS
  'Last-touch landing UTM captured client-side at checkout (utm_source/medium/campaign/content/term, referrer, landed_at). NULL = no known campaign.';

-- Persist purchased shipping labels on the order row
-- (Watchtower task f2b836ab-c6b2-4d6b-bbb6-65a7b6629c75).
--
-- Background: src/pages/OrderManagement.tsx buys a Shippo label and, until now,
-- only wrote the tracking number + label URL into React state. A refresh lost
-- both — including for labels that had been paid for. The frontend already READ
-- `orders.shipping_label_url` (OrderManagement.tsx, CRM.tsx) but the column was
-- never created: `tracking_number`, `tracking_company` and `estimated_delivery`
-- exist from 001_initial_schema.sql, `shipping_label_url` did not.
--
-- Additive and idempotent: no data is rewritten, and NO policy is changed here.
--
-- RLS caveat (deliberately left alone — changing who can write orders is a
-- security decision, not part of this task): the live policy is
-- "Admins have full access to all orders" (005_rls_fixes.sql) which grants
-- ('admin','founder'). OrderManagement.tsx is reachable by 'manager' too, so a
-- manager's label-persist UPDATE will match zero rows. The page now detects that
-- (it asks for `.select('id')` back and treats an empty result as a failure) and
-- shows a loud "Label created but NOT saved" error instead of a phantom success.
-- If managers should be able to ship, add 'manager' to that policy in a separate,
-- reviewed migration.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_label_url TEXT;

COMMENT ON COLUMN public.orders.shipping_label_url IS
  'Carrier label PDF URL returned by Shippo when the label was purchased. Written by the admin Order Management "Generate Label" flow alongside tracking_number / tracking_company / estimated_delivery.';

-- Cheap lookup for "which orders already have a label" (admin fulfillment views
-- filter on exactly this). Partial index: only labelled orders are indexed.
CREATE INDEX IF NOT EXISTS idx_orders_shipping_label_url
  ON public.orders (id)
  WHERE shipping_label_url IS NOT NULL;

-- Live carrier tracking on orders + the thank-you coupon a delivery earns.
--
-- Background: `orders.tracking_number` / `tracking_company` have existed since
-- 001_initial_schema.sql, but nothing ever asked the carrier what happened to
-- the parcel. An order sat on status 'shipped' until a human clicked
-- "Delivered" in Order Management, which in practice nobody did — so
-- `delivered_at` stayed null, the delivery email never fired, and the buyer
-- never heard from us again.
--
-- These columns are the cache for backend/services/shipment-tracking.ts (Shippo
-- Tracking API). The admin panel and the guest order-status page both read
-- them, and backend/worker/delivery-tracking-sweep.ts writes them every
-- DELIVERY_SWEEP_MINUTES.
--
-- Additive and idempotent. No policy is changed here: the sweep and the API
-- write as the service role, and both readers go through backend routes, so the
-- existing orders RLS is untouched.
--
-- NOTE: the code degrades gracefully if this migration has not been applied —
-- every read/write drops these columns and retries (see
-- backend/services/order-tracking-deps.ts `isMissingColumnError`). Applying it
-- turns the cache and the sweep's queue ordering on; it is not a hard
-- dependency for live tracking itself.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tracking_status TEXT,
  ADD COLUMN IF NOT EXISTS tracking_status_detail TEXT,
  ADD COLUMN IF NOT EXISTS tracking_status_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tracking_location TEXT,
  ADD COLUMN IF NOT EXISTS tracking_eta TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tracking_events JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tracking_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tracking_error TEXT,
  ADD COLUMN IF NOT EXISTS delivery_coupon_code TEXT;

COMMENT ON COLUMN public.orders.tracking_status IS
  'Normalised carrier status: pre_transit | in_transit | out_for_delivery | delivered | returned | failure | unknown. Written by the tracking sweep and the admin tracking endpoint.';
COMMENT ON COLUMN public.orders.tracking_status_detail IS
  'The carrier''s own wording for the latest scan, e.g. "Shipper created a label, UPS has not received the package yet."';
COMMENT ON COLUMN public.orders.tracking_status_at IS
  'When the carrier recorded the latest scan (NOT when we polled — that is tracking_checked_at).';
COMMENT ON COLUMN public.orders.tracking_location IS
  'Where the parcel last was, e.g. "Atlanta, GA". Null until it actually moves.';
COMMENT ON COLUMN public.orders.tracking_eta IS
  'Carrier-published estimated delivery. Distinct from estimated_delivery, which is what the label was bought against.';
COMMENT ON COLUMN public.orders.tracking_events IS
  'Scan history as [{status, detail, date, location}], newest first.';
COMMENT ON COLUMN public.orders.tracking_checked_at IS
  'Last time we polled the carrier. Drives both the poll cache and the sweep queue order.';
COMMENT ON COLUMN public.orders.tracking_error IS
  'Last poll failure (carrier/API), cleared on the next success. Config problems (no token, unknown carrier) are deliberately NOT written here.';
COMMENT ON COLUMN public.orders.delivery_coupon_code IS
  'The one-time thank-you discount code minted when this order was delivered (discount_codes.code). Its presence is what stops a second code being issued.';

-- The sweep's queue: shipped orders that still have somewhere to go, oldest
-- check first. Partial so it stays small — settled and unshipped orders are not
-- indexed at all.
CREATE INDEX IF NOT EXISTS idx_orders_tracking_poll
  ON public.orders (tracking_checked_at ASC NULLS FIRST)
  WHERE tracking_number IS NOT NULL AND status = 'shipped';

-- Answers "which order did this code come from" without scanning discount_codes.
CREATE INDEX IF NOT EXISTS idx_orders_delivery_coupon_code
  ON public.orders (delivery_coupon_code)
  WHERE delivery_coupon_code IS NOT NULL;

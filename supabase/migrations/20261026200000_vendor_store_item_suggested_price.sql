-- What ITP suggests she sells an ITP product for (David 2026-10-26: "a spot on there where I can set the prices for
-- things and a suggested price she should sell them for on her store"). David sets it beside itp_cost_cents in the
-- admin panel; she sees it on the product and sets her own price_cents.
alter table public.vendor_store_items add column if not exists suggested_price_cents integer
  check (suggested_price_cents is null or suggested_price_cents >= 0);

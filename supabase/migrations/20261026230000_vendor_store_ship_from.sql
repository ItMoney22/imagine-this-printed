-- Where a store seller ships her own items from (David 2026-10-26, Crystal's store: "her own items ship from HER").
-- Her store rates her package from here with Shippo at checkout, and her Print label buys the label from here
-- (backend/routes/vendor-store.ts). Server-only like the rest of vendor_storefronts (grants revoked), so her home
-- address never reaches the public store. Shape: { name, street1, street2, city, state, zip, phone }.
-- The flat own_shipping_cents / itp_shipping_cents columns stay for old rows but nothing charges them any more.
alter table public.vendor_storefronts add column if not exists ship_from jsonb;

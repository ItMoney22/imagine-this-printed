-- The seller's Instagram handle (David 2026-10-26: "put her IG in her back end"). She sets it in her
-- store manager; the storefront links to it. Handle only, no @ and no URL (routes/vendor-store.ts checks it).
alter table public.vendor_storefronts add column if not exists instagram text
  check (instagram is null or instagram ~ '^[A-Za-z0-9._]{1,30}$');

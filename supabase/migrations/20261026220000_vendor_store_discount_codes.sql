-- A store's discount codes (David 2026-10-26, Crystal's store first: "she should be able to give a discount to
-- her peeps but whatever she does cuts at her own cost").
--
-- She makes them in her store manager (backend/routes/vendor-store-discounts.ts): percent off (amount 1..100)
-- or dollars off (amount in cents), an optional last day (ends_on, store time), on/off. A buyer types one in her
-- cart; the checkout (backend/routes/vendor-store.ts) takes it off the items only, and ITP's share is worked out
-- on the full prices first (backend/lib/vendor-store-split.ts), so a code only ever lowers her share. A code that
-- would take an order under ITP's share is refused at checkout.
--
-- Codes are stored upper-case and matched that way; one name per store.
-- Server-only, like vendor_store_items: RLS on with no policies and every grant revoked from anon/authenticated,
-- so only the API (service role) reads or writes these rows. Idempotent: safe to re-run.

create table if not exists public.vendor_store_discount_codes (
  id uuid primary key default gen_random_uuid(),
  storefront_id uuid not null references public.vendor_storefronts(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{2,23}$'),
  kind text not null check (kind in ('percent', 'amount')),
  amount integer not null check (amount > 0 and (kind <> 'percent' or amount <= 100)),
  ends_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storefront_id, code)
);

alter table public.vendor_store_discount_codes enable row level security;
revoke all on public.vendor_store_discount_codes from anon, authenticated;

notify pgrst, 'reload schema';

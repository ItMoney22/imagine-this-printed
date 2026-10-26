-- Vendor storefronts: a seller's own branded store on <slug>.imaginethisprinted.com
-- (David 2026-10-26, Crystal's Shirts and More first). Buyers check out through ITP;
-- Stripe pays the seller's connected account by destination charge and ITP keeps its
-- share as the application fee (backend/routes/vendor-store.ts, backend/lib/vendor-store-split.ts).
--
-- Two kinds of item live in one table:
--   * the seller's own product (product_id null): she makes and ships it, sets the price,
--     ITP keeps fee_percent of the sale;
--   * an ITP product she resells (product_id set): ITP makes and ships it, David sets
--     itp_cost_cents (what ITP keeps), she sets price_cents and keeps the rest.
--
-- Server-only, like product_print_files: RLS on with no policies and every grant revoked
-- from anon/authenticated, so only the API (service role) reads or writes these rows.

create table if not exists public.vendor_storefronts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,30}$'),
  name text not null,
  tagline text,
  logo_url text,
  theme jsonb not null default '{}'::jsonb,
  owner_user_id uuid references public.user_profiles(id) on delete set null,
  owner_email text,
  fee_percent numeric(5,2) not null default 10 check (fee_percent >= 0 and fee_percent <= 50),
  own_shipping_cents integer not null default 599 check (own_shipping_cents >= 0),
  itp_shipping_cents integer not null default 599 check (itp_shipping_cents >= 0),
  stripe_account_id text,
  status text not null default 'draft' check (status in ('draft', 'live', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_store_items (
  id uuid primary key default gen_random_uuid(),
  storefront_id uuid not null references public.vendor_storefronts(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  name text not null,
  description text,
  images jsonb not null default '[]'::jsonb,
  sizes text[] not null default '{}',
  colors text[] not null default '{}',
  price_cents integer not null check (price_cents >= 0),
  itp_cost_cents integer not null default 0 check (itp_cost_cents >= 0),
  active boolean not null default false,
  sort integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storefront_id, product_id)
);

create index if not exists idx_vendor_store_items_storefront on public.vendor_store_items (storefront_id, active, sort);
create index if not exists idx_vendor_storefronts_owner on public.vendor_storefronts (owner_user_id);

alter table public.vendor_storefronts enable row level security;
alter table public.vendor_store_items enable row level security;
revoke all on public.vendor_storefronts from anon, authenticated;
revoke all on public.vendor_store_items from anon, authenticated;

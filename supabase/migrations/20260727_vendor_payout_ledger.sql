-- Vendor payout ledger — real Stripe Connect payouts for marketplace vendors.
--
-- The LIVE vendor_payouts table is a stub:
--   id, vendor_id, amount, status, method, payout_date, notes, metadata, created_at
-- No order linkage, no fee breakdown, no Stripe ids — nothing a real payout
-- ledger can be built on. supabase/migrations/001_initial_schema.sql describes
-- a much richer table, but 001 was never applied to this project (same drift
-- that bit itc_transactions in 20260727_fix_itc_wallet_schema_drift.sql), so
-- this migration brings the LIVE table up to what the ledger needs instead of
-- trusting 001.
--
-- Additive only: every new column is nullable or defaulted and the table is
-- empty, so existing RLS policies ("Vendors can view own payouts",
-- "Admins can manage payouts") keep working untouched.

alter table public.vendor_payouts
  add column if not exists order_id           uuid,
  add column if not exists product_id         uuid,
  add column if not exists sale_amount        numeric not null default 0,
  add column if not exists platform_fee_rate  numeric not null default 0,
  add column if not exists platform_fee       numeric not null default 0,
  add column if not exists stripe_fee_rate    numeric not null default 0,
  add column if not exists stripe_fee         numeric not null default 0,
  add column if not exists payout_amount      numeric not null default 0,
  add column if not exists currency           text    not null default 'USD',
  add column if not exists payout_batch_id    text,
  add column if not exists stripe_transfer_id text,
  add column if not exists stripe_payout_id   text,
  add column if not exists failure_reason     text,
  add column if not exists processed_at       timestamptz,
  add column if not exists updated_at         timestamptz default now();

-- `amount` is a pre-existing NOT NULL column with no default. The service
-- always writes it (mirroring payout_amount) but a default keeps any other
-- writer from hard-failing on it.
alter table public.vendor_payouts alter column amount set default 0;

-- Accrual idempotency key. One ledger row per (order, vendor product) —
-- the same convention backend/services/creator-margins.ts uses for
-- user_product_royalties, and deliberately NOT keyed on order_items.id:
-- backend/routes/stripe.ts replaceOrderItems() deletes and re-inserts every
-- order_items row on each cart change, so line-item ids are not stable.
create unique index if not exists uq_vendor_payouts_order_product
  on public.vendor_payouts (order_id, product_id)
  where order_id is not null and product_id is not null;

create index if not exists idx_vendor_payouts_vendor_status
  on public.vendor_payouts (vendor_id, status);

create index if not exists idx_vendor_payouts_vendor_created
  on public.vendor_payouts (vendor_id, created_at desc);

create index if not exists idx_vendor_payouts_batch
  on public.vendor_payouts (payout_batch_id)
  where payout_batch_id is not null;

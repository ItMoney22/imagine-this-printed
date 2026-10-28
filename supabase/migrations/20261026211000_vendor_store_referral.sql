-- A store owner's referral link (David 2026-10-26, Crystal first): "if one of her referrals use
-- her link and buy a shirt she gets a cut. She needs her own link to give her stuff."
--
-- Her link is the same friend link the site already captures (imaginethisprinted.com/?ref=CODE,
-- src/utils/referral-capture.ts); the code belongs to her store instead of an account, because a
-- store can exist before its owner has an ITP account. A paid main-site order that came through it
-- pays her referral_percent of the products (after discounts, never shipping or tax) to the store's
-- Stripe Express account by transfer (backend/services/store-referral.ts).
--
-- referral_percent NULL = David has not set it yet: the cut is recorded on the order and waits.
-- Additive and nullable, so it is safe to apply before the code ships.

alter table public.vendor_storefronts
  add column if not exists referral_code text,
  add column if not exists referral_percent numeric(5,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vendor_storefronts_referral_code_check') then
    alter table public.vendor_storefronts
      add constraint vendor_storefronts_referral_code_check check (referral_code is null or referral_code ~ '^[A-Z0-9]{4,20}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'vendor_storefronts_referral_percent_check') then
    alter table public.vendor_storefronts
      add constraint vendor_storefronts_referral_percent_check check (referral_percent is null or (referral_percent >= 0 and referral_percent <= 50));
  end if;
end $$;

create unique index if not exists idx_vendor_storefronts_referral_code
  on public.vendor_storefronts (referral_code) where referral_code is not null;

-- Existing stores get their slug as the code (crystal -> CRYSTAL) unless a person's code already has it.
update public.vendor_storefronts s
   set referral_code = upper(regexp_replace(s.slug, '[^a-z0-9]', '', 'g'))
 where s.referral_code is null
   and length(regexp_replace(s.slug, '[^a-z0-9]', '', 'g')) between 4 and 20
   and not exists (
     select 1 from public.referral_codes rc
      where upper(rc.code) = upper(regexp_replace(s.slug, '[^a-z0-9]', '', 'g'))
   );

-- The cut's orders are found by store: orders.metadata.store_referral.storefront_id.
create index if not exists idx_orders_store_referral
  on public.orders ((metadata -> 'store_referral' ->> 'storefront_id'))
  where metadata ? 'store_referral';

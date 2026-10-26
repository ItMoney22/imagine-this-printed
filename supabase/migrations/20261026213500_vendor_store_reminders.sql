-- A seller's reminders (David 2026-10-26: "setup reminders for her through email with her assistant reminding her
-- to post etc."). Her store assistant writes each one fresh when it is due and emails it to the store's address
-- (crystal@imaginethisprinted.com, her in-app inbox). The clock is backend/worker/store-reminders-sweep.ts.
--
--   vendor_store_reminders:      what to remind her of and when. days = Eastern weekdays (0 Sunday .. 6 Saturday),
--                                time_of_day = Eastern wall clock. armed_at: no slot earlier than this ever sends, so
--                                switching one on at 10:30 doesn't mail that morning's 10:00 late.
--   vendor_store_reminder_sends: one row per reminder per slot. The unique (reminder_id, slot_at) is the claim: the
--                                worker that inserts it sends that slot, every other tick or replica skips it.
-- Server-only like the other vendor_store tables: RLS on, no policies, no anon/authenticated grants.

create table if not exists public.vendor_store_reminders (
  id uuid primary key default gen_random_uuid(),
  storefront_id uuid not null references public.vendor_storefronts(id) on delete cascade,
  kind text not null check (kind in ('instagram', 'orders', 'product', 'custom')),
  title text not null check (char_length(title) between 1 and 80),
  note text check (note is null or char_length(note) <= 300),
  days smallint[] not null check (cardinality(days) between 1 and 7 and days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  time_of_day time not null,
  enabled boolean not null default true,
  armed_at timestamptz not null default now(),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_vs_reminders_storefront on public.vendor_store_reminders (storefront_id, sort);
create index if not exists idx_vs_reminders_enabled on public.vendor_store_reminders (enabled) where enabled;

create table if not exists public.vendor_store_reminder_sends (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references public.vendor_store_reminders(id) on delete cascade,
  storefront_id uuid not null references public.vendor_storefronts(id) on delete cascade,
  slot_at timestamptz not null,
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'failed', 'skipped')),
  attempts integer not null default 1,
  to_email text,
  subject text,
  body text,
  written_by text check (written_by is null or written_by in ('assistant', 'template')),
  resend_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (reminder_id, slot_at)
);
create index if not exists idx_vs_reminder_sends_storefront on public.vendor_store_reminder_sends (storefront_id, created_at desc);

alter table public.vendor_store_reminders enable row level security;
alter table public.vendor_store_reminder_sends enable row level security;
revoke all on public.vendor_store_reminders from anon, authenticated;
revoke all on public.vendor_store_reminder_sends from anon, authenticated;

-- Every store starts with the three reminders on David's approved mock (itp-crystal-store-manager-inbox round 1):
-- Post on Instagram Mon/Wed/Fri 10 AM, Check new orders every day 9 AM, Add a new product Sundays (10 AM).
create or replace function public.seed_vendor_store_reminders(p_storefront_id uuid)
returns void
language sql
set search_path = public
as $$
  insert into public.vendor_store_reminders (storefront_id, kind, title, days, time_of_day, sort)
  select p_storefront_id, d.kind, d.title, d.days, d.time_of_day, d.sort
  from (values
    ('instagram', 'Post on Instagram', array[1, 3, 5]::smallint[], time '10:00', 1),
    ('orders', 'Check new orders', array[0, 1, 2, 3, 4, 5, 6]::smallint[], time '09:00', 2),
    ('product', 'Add a new product', array[0]::smallint[], time '10:00', 3)
  ) as d(kind, title, days, time_of_day, sort)
  where not exists (select 1 from public.vendor_store_reminders r where r.storefront_id = p_storefront_id);
$$;
revoke execute on function public.seed_vendor_store_reminders(uuid) from public, anon, authenticated;
grant execute on function public.seed_vendor_store_reminders(uuid) to service_role;

create or replace function public.vendor_storefronts_seed_reminders()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.seed_vendor_store_reminders(new.id);
  return new;
end;
$$;
revoke execute on function public.vendor_storefronts_seed_reminders() from public, anon, authenticated;
grant execute on function public.vendor_storefronts_seed_reminders() to service_role;

drop trigger if exists on_vendor_storefront_seed_reminders on public.vendor_storefronts;
create trigger on_vendor_storefront_seed_reminders
  after insert on public.vendor_storefronts
  for each row execute function public.vendor_storefronts_seed_reminders();

-- The stores that already exist (Crystal's).
select public.seed_vendor_store_reminders(id) from public.vendor_storefronts;

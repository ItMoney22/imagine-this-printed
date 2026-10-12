-- CRM server-side aggregation (Watchtower task 582e38ea).
--
-- src/pages/CRM.tsx used to fetch EVERY row of `user_profiles` and EVERY row of
-- `orders` on load and then build totalSpent / totalOrders / lastOrderDate with
-- a JavaScript loop. That is unbounded by construction -- and it could not be
-- fixed with a client-side .limit(), because truncating the orders fetch
-- silently under-counts a lifetime spend rather than just showing fewer rows.
--
-- These read-only functions move the GROUP BY to Postgres, where it belongs.
-- They are the contract behind /api/admin/crm/*.
--
-- Two correctness rules are baked in here so every caller gets the same answer:
--
--  1. MONEY ONLY COUNTS WHEN IT LANDED. An `orders` row is written when the
--     Stripe payment intent is CREATED, not when it succeeds, so an abandoned
--     checkout leaves a complete-looking order behind. Mirrors
--     EVER_PAID_PAYMENT_STATUSES in src/lib/order-payment-truth.ts and
--     backend/services/order-refunds.ts -- a refund or dispute still means
--     money was taken at some point, so those rows count.
--  2. GUEST ORDERS ARE ATTRIBUTED BY EMAIL. Half the real orders on this store
--     carry user_id IS NULL (guest checkout). The old JS loop keyed on
--     order.user_id, so those dropped into an unreachable bucket and were
--     credited to nobody. An order whose email matches a profile is that
--     customer order.
--
-- Security: these are SECURITY INVOKER (the default) on purpose. The backend
-- calls them with the service-role key, which bypasses RLS anyway; leaving them
-- executable by anon/authenticated would publish whole-table customer
-- aggregates on PostgREST to any logged-in browser. EXECUTE is revoked from
-- everyone and granted to service_role only.

-- Payment statuses that mean money was captured at some point.
create or replace function public.crm_ever_paid_statuses()
returns text[]
language sql
immutable
as $fn$
  select array['paid', 'refunded', 'partially_refunded', 'disputed']::text[]
$fn$;

-- Paginated customer list with exact per-customer order aggregates.
--
-- total_count is the full number of matching customers (a window count over the
-- filtered set), so the caller can render "page N of M" without a second round
-- trip.
--
-- p_sort: 'recent' (default, newest signup first) | 'spend' | 'orders'
--         | 'last_order' | 'name'
create or replace function public.crm_customer_stats(
  p_limit integer default 50,
  p_offset integer default 0,
  p_search text default null,
  p_role text default null,
  p_sort text default 'recent'
)
returns table (
  id uuid,
  email text,
  name text,
  phone text,
  company text,
  role text,
  registration_date timestamptz,
  total_spent numeric,
  total_orders bigint,
  last_order_date timestamptz,
  total_count bigint
)
language sql
stable
as $fn$
  with paid as (
    select
      coalesce(o.user_id, guest.id) as customer_id,
      o.total,
      o.created_at
    from public.orders o
    left join lateral (
      select p.id
      from public.user_profiles p
      where o.user_id is null
        and nullif(trim(o.customer_email), '') is not null
        and lower(p.email) = lower(trim(o.customer_email))
      order by p.created_at asc
      limit 1
    ) guest on true
    where lower(coalesce(o.payment_status, '')) = any (public.crm_ever_paid_statuses())
  ),
  agg as (
    select
      paid.customer_id,
      sum(coalesce(paid.total, 0))::numeric as total_spent,
      count(*)::bigint as total_orders,
      max(paid.created_at)::timestamptz as last_order_date
    from paid
    where paid.customer_id is not null
    group by paid.customer_id
  ),
  matched as (
    select
      p.id,
      coalesce(p.email, '') as email,
      coalesce(
        nullif(trim(p.display_name), ''),
        nullif(trim(p.full_name), ''),
        nullif(trim(p.username), ''),
        nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
        nullif(split_part(coalesce(p.email, ''), '@', 1), ''),
        'Unknown'
      ) as name,
      coalesce(p.shipping_phone, '') as phone,
      coalesce(p.company_name, '') as company,
      coalesce(p.role, 'customer') as role,
      p.created_at::timestamptz as registration_date,
      coalesce(a.total_spent, 0)::numeric as total_spent,
      coalesce(a.total_orders, 0)::bigint as total_orders,
      a.last_order_date
    from public.user_profiles p
    left join agg a on a.customer_id = p.id
    where (nullif(btrim(coalesce(p_role, '')), '') is null or p.role = p_role)
      and (
        nullif(btrim(coalesce(p_search, '')), '') is null
        or coalesce(p.email, '') ilike '%' || p_search || '%'
        or coalesce(p.display_name, '') ilike '%' || p_search || '%'
        or coalesce(p.full_name, '') ilike '%' || p_search || '%'
        or coalesce(p.username, '') ilike '%' || p_search || '%'
        or coalesce(p.company_name, '') ilike '%' || p_search || '%'
        or coalesce(p.first_name, '') ilike '%' || p_search || '%'
        or coalesce(p.last_name, '') ilike '%' || p_search || '%'
      )
  )
  select
    m.id,
    m.email,
    m.name,
    m.phone,
    m.company,
    m.role,
    m.registration_date,
    m.total_spent,
    m.total_orders,
    m.last_order_date,
    count(*) over ()::bigint as total_count
  from matched m
  order by
    case when p_sort = 'spend' then m.total_spent end desc nulls last,
    case when p_sort = 'orders' then m.total_orders end desc nulls last,
    case when p_sort = 'last_order' then m.last_order_date end desc nulls last,
    case when p_sort = 'name' then lower(m.name) end asc nulls last,
    m.registration_date desc nulls last,
    m.id asc
  limit greatest(coalesce(p_limit, 50), 0)
  offset greatest(coalesce(p_offset, 0), 0)
$fn$;

-- The header numbers on the CRM, computed over the whole table instead of over
-- whatever page happens to be loaded.
--
-- revenue is summed from `orders` directly, NOT from the customer rows. Three of
-- this store's paid orders are guest checkouts belonging to no profile, so a sum
-- over customers reported $0.00 of real money taken.
--
-- unpaid_drafts is reported rather than hidden: those rows exist, they are just
-- abandoned checkouts, and an admin counting rows in the orders tab should be
-- able to see where the difference went.
create or replace function public.crm_dashboard_totals()
returns table (
  customers bigint,
  paid_orders bigint,
  unpaid_drafts bigint,
  pending_orders bigint,
  revenue numeric
)
language sql
stable
as $fn$
  select
    (select count(*)::bigint from public.user_profiles) as customers,
    (select count(*)::bigint from public.orders o
      where lower(coalesce(o.payment_status, '')) = any (public.crm_ever_paid_statuses())) as paid_orders,
    (select count(*)::bigint from public.orders o
      where not (lower(coalesce(o.payment_status, '')) = any (public.crm_ever_paid_statuses()))) as unpaid_drafts,
    (select count(*)::bigint from public.orders o
      where lower(coalesce(o.payment_status, '')) = any (public.crm_ever_paid_statuses())
        and coalesce(o.status, '') = 'pending') as pending_orders,
    (select coalesce(sum(coalesce(o.total, 0)), 0)::numeric from public.orders o
      where lower(coalesce(o.payment_status, '')) = any (public.crm_ever_paid_statuses())) as revenue
$fn$;

-- Customer counts per role, for the Analytics tab segment bars. Previously
-- derived by scanning every loaded profile in the browser.
create or replace function public.crm_role_segments()
returns table (role text, customers bigint)
language sql
stable
as $fn$
  select coalesce(nullif(btrim(p.role), ''), 'customer') as role,
         count(*)::bigint as customers
  from public.user_profiles p
  group by 1
  order by 2 desc, 1 asc
$fn$;

-- Service-role only. See the header note.
revoke all on function public.crm_ever_paid_statuses() from public;
revoke all on function public.crm_customer_stats(integer, integer, text, text, text) from public;
revoke all on function public.crm_dashboard_totals() from public;
revoke all on function public.crm_role_segments() from public;

do $grants$
declare
  fns text[] := array[
    'public.crm_ever_paid_statuses()',
    'public.crm_customer_stats(integer, integer, text, text, text)',
    'public.crm_dashboard_totals()',
    'public.crm_role_segments()'
  ];
  fn text;
begin
  foreach fn in array fns loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end
$grants$;

-- Supporting indexes. The aggregate scans `orders` by payment_status and groups
-- by user_id; without these it is a seq scan on every CRM page load.
create index if not exists idx_orders_payment_status_user
  on public.orders (payment_status, user_id);
create index if not exists idx_orders_customer_email_lower
  on public.orders (lower(customer_email));
create index if not exists idx_user_profiles_email_lower
  on public.user_profiles (lower(email));

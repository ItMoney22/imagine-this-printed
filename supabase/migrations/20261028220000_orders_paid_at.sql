-- When an order became paid (Watchtower task b17dc9f6, 2026-10-28).
--
-- The print bridge (backend/routes/print-bridge.ts GET /queue) hands Watchtower
-- paid orders after a cursor. It used to walk created_at, but checkout writes the
-- order row as 'pending' when the customer opens the payment page, and the Stripe
-- webhook flips it to 'paid' later. An order opened first and paid second sat
-- behind a cursor that a newer, faster order had already moved past, so it was
-- never pulled: a paid name gift that never reaches review. paid_at is the moment
-- the row became paid, and the queue walks it instead.
--
-- The stamp is a trigger, not app code, so every writer that marks an order paid
-- gets it: the Stripe webhook (services/order-payment.ts), ITC wallet orders
-- (routes/wallet.ts), Etsy receipts inserted as paid (worker/etsy-receipt-ingest.ts),
-- routes/user-products.ts, and any writer added later. It stamps once: a row that
-- already has paid_at keeps it.
--
-- Backfill: rows already paid get paid_at = created_at. Their real paid time was
-- never recorded, and created_at is never later than it. That keeps all six old
-- paid orders at or below the bridge's seeded cursor (2026-09-12T14:07:56.865516Z,
-- the newest paid order's created_at), so none of them is pulled again.
--
-- Rollback: drop trigger on_order_paid_stamp on public.orders;
--           drop function public.stamp_order_paid_at();
--           drop index public.idx_orders_paid_at;
--           alter table public.orders drop column paid_at;

alter table public.orders add column if not exists paid_at timestamptz;

update public.orders
   set paid_at = created_at
 where payment_status = 'paid'
   and paid_at is null;

create or replace function public.stamp_order_paid_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.payment_status = 'paid' and new.paid_at is null then
    new.paid_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists on_order_paid_stamp on public.orders;
create trigger on_order_paid_stamp
  before insert or update of payment_status on public.orders
  for each row execute function public.stamp_order_paid_at();

create index if not exists idx_orders_paid_at
  on public.orders (paid_at)
  where payment_status = 'paid';

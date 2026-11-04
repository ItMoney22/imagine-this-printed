-- Live printer cam, ITP side (Watchtower task 528180f9).
--
-- Watchtower pushes each printing order line's live view about every 45 s; this
-- keeps the newest one per line, overwritten in place.
--
-- Its own table, not orders.metadata: /status and the Stripe webhook read, change
-- and write that whole object, so a write every 45 s would race them and could
-- wipe a print status. It also keeps signed frame links out of every orders read.
--
-- line_item_id is '' for a custom print: /queue sends those with no lineItemId,
-- and a NULL in the key would let every push add a new row.
--
-- RLS on with no policies and every grant revoked: the only reader is the API,
-- which checks the order belongs to the signed-in customer first.
--
-- Rollback: drop table public.order_print_live;

create table if not exists public.order_print_live (
  order_id uuid not null references public.orders(id) on delete cascade,
  line_item_id text not null default '',
  live jsonb not null,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (order_id, line_item_id)
);

alter table public.order_print_live enable row level security;
revoke all on public.order_print_live from anon, authenticated;

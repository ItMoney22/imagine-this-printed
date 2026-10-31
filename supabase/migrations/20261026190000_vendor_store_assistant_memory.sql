-- A seller's store assistant remembers (David 2026-10-26: "her assistant ... needs to have memory built in").
--   vendor_store_assistant_messages: the chat itself, so it follows her to any device.
--   vendor_store_assistant_memory:   short facts the assistant chose to keep about her (her style, her plans),
--                                    read back into every turn (backend/services/store-assistant.ts).
-- Server-only like the other vendor_store tables: RLS on, no policies, no anon/authenticated grants.

create table if not exists public.vendor_store_assistant_messages (
  id uuid primary key default gen_random_uuid(),
  storefront_id uuid not null references public.vendor_storefronts(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  text text not null,
  image_url text,
  created_at timestamptz not null default now()
);
create index if not exists idx_vs_assistant_messages on public.vendor_store_assistant_messages (storefront_id, created_at desc);

create table if not exists public.vendor_store_assistant_memory (
  id uuid primary key default gen_random_uuid(),
  storefront_id uuid not null references public.vendor_storefronts(id) on delete cascade,
  fact text not null check (char_length(fact) between 3 and 300),
  created_at timestamptz not null default now()
);
create index if not exists idx_vs_assistant_memory on public.vendor_store_assistant_memory (storefront_id, created_at desc);

alter table public.vendor_store_assistant_messages enable row level security;
alter table public.vendor_store_assistant_memory enable row level security;
revoke all on public.vendor_store_assistant_messages from anon, authenticated;
revoke all on public.vendor_store_assistant_memory from anon, authenticated;

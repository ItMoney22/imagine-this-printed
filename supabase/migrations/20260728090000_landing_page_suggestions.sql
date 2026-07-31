-- Mr Imagine Trend Scout: AI-proposed seasonal/trending landing pages.
-- Rows are written only by the backend (service role). Admin approves a
-- suggestion in the dashboard -> backend files a Watchtower task and stamps
-- watchtower_task_id; dismissed rows stay for dedupe so Mr Imagine doesn't
-- re-pitch the same idea next batch.

create table if not exists public.landing_page_suggestions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null,
  concept text not null,
  trend_rationale text not null,
  product_ideas jsonb not null default '[]'::jsonb,
  urgency text not null default 'medium'
    check (urgency in ('low', 'medium', 'high', 'critical')),
  launch_window text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'dismissed', 'built')),
  watchtower_task_id text,
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  model text,
  batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Service-role only: RLS on with no policies denies anon/authenticated access;
-- the backend's service key bypasses RLS.
alter table public.landing_page_suggestions enable row level security;

create index if not exists landing_page_suggestions_status_idx
  on public.landing_page_suggestions (status, created_at desc);

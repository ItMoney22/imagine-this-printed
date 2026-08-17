-- Create scout_design_briefs table to persist ranked design briefs across restarts/deploys.
create table if not exists public.scout_design_briefs (
  id text primary key,
  rank integer not null,
  score integer not null,
  theme text not null,
  saying text not null,
  style_notes text not null,
  target_holiday text not null,
  target_date text not null,
  niche text not null,
  audience text not null,
  product_type text not null,
  evidence jsonb not null default '[]'::jsonb,
  saturation text not null,
  risk_flags jsonb not null default '[]'::jsonb,
  source_queries jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable RLS and restrict to service-role (backend only)
alter table public.scout_design_briefs enable row level security;

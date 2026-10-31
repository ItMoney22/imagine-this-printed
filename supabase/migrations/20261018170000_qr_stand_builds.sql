-- QR counter stand print files (task deebfdca, mason-blaze, 2026-10-18).
--
-- One row per build of one stand line: what the stand says (link, caption,
-- logo) at the moment it was built, and what came back from the builder on
-- Earth (tools/qr-stand: gen.py + its scan-back). A rebuild is a NEW row, so the
-- history of what was printed for an order survives an admin's edit.
--
-- Written and read only by the backend (service role): the builder on Earth
-- talks to /api/qr-stand/builder/* over the print-bridge token, the admin over
-- /api/admin/qr-stands/*. No anon or authenticated policy on purpose.
--
-- Idempotent.

create table if not exists public.qr_stand_builds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  -- Position of the stand line in the order's items; with order_id, the line's
  -- identity (order_items rows are re-inserted on every draft update, so their
  -- ids are not stable until the order is paid).
  line_index integer not null default 0,
  link text not null,
  caption text not null,
  logo_path text,
  status text not null default 'queued'
    check (status in ('queued', 'building', 'ready', 'failed')),
  claimed_at timestamptz,
  built_at timestamptz,
  threemf_path text,
  face_path text,
  scan_ok boolean,
  scan_text text,
  qr_version integer,
  logo_mode text,
  error text,
  print_status text
    check (print_status in ('requested', 'sending', 'sent', 'failed')),
  print_requested_at timestamptz,
  print_sent_at timestamptz,
  print_job_id text,
  print_printer text,
  print_error text,
  -- The admin who asked for it, or null when the paid-order hook queued it.
  requested_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists qr_stand_builds_order_idx on public.qr_stand_builds (order_id, line_index, created_at desc);
create index if not exists qr_stand_builds_open_idx on public.qr_stand_builds (status, created_at)
  where status in ('queued', 'building');
create index if not exists qr_stand_builds_print_idx on public.qr_stand_builds (print_status, print_requested_at)
  where print_status in ('requested', 'sending');

alter table public.qr_stand_builds enable row level security;

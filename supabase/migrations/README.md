# supabase/migrations — how to work in this directory

Full audit + status of every migration in this repo lives in
[`MIGRATION_LEDGER.md`](./MIGRATION_LEDGER.md), next to this file. Read that
before touching anything here — this README is just the operating rules.

## Rules

1. **Version prefixes must be unique.** The Supabase CLI keys every migration
   by the digits before the first `_` in its filename. Two files sharing a
   prefix means only one of them can ever be tracked — the other silently
   never applies via `supabase db push`/`db reset`. Prefer full timestamps
   (`YYYYMMDDHHMMSS`, e.g. `20260728120000_thing.sql`) over bare dates
   (`20260728_thing.sql`) for anything landing the same day as another
   migration — bare dates are exactly what caused the last collision (see
   the ledger's "2026-07-28 ordering fix" entry).
2. **A migration that `ALTER`s a table must sort after the migration that
   `CREATE`s it.** File order is applied lexically, not by dependency graph.
   If file A alters a table B creates, A's prefix must be numerically greater
   than B's.
3. **New SQL always goes in a NEW file.** Never edit a migration that may
   already be live — see the ledger for why renaming/editing an applied
   migration is dangerous (it desyncs the local file from what
   `supabase_migrations.schema_migrations` has recorded).
4. **Idempotent by default.** Use `CREATE TABLE IF NOT EXISTS`,
   `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`,
   `CREATE OR REPLACE FUNCTION`. Production has repeatedly been patched by
   ad hoc scripts that bypass the CLI's own ledger (see below), so you cannot
   assume a migration you're writing is running against a clean baseline.
5. **Do not assume `supabase_migrations.schema_migrations` is authoritative.**
   It is not, in this repo. Ground truth is the live database's actual
   objects (tables/columns/functions/policies), because migrations here have
   historically been applied through at least three different paths (CLI,
   ad hoc Node/`pg` scripts, and manual SQL). The ledger explains this in
   full and lists which is which as of 2026-07-28.

## Two sources of schema truth, going forward

| Concern | Canonical location |
|---|---|
| PostgreSQL / Supabase migrations | `supabase/migrations/` |
| Prisma model layer | `backend/prisma/schema.prisma` |

The root `migrations/` directory is legacy and orphaned — see the ledger for
which of its files are safe to ignore vs. actively dangerous to apply.
`backend/prisma/migrations/`, `backend/migrations/`, `backend/db/migrations/`,
and `backend/supabase/migrations/` are all stray duplicates of things that
belong in the two canonical locations above; do not add new files to any of
them.

# Claude Task Brief

## Request
- Complete Watchtower task `b3c8029a-3d68-47ab-9ac1-6be1f89577f7`: merge `earth/marcus-wolfe/create-wholesale-applica-9d14723b-mswmd0co` into `main` through the repository pre-merge gate.
- This is code-history synchronization only. The production `wholesale_applications` table was already created and independently verified; do not run migrations against any database or make unrelated production changes.

## Repo detection
- Vite + React frontend with an Express/TypeScript backend and Supabase SQL migrations.
- The current `main` commit is `0c1ffd1`; source commit `3bf0650` has `main` as its direct ancestor, so the merge is a clean fast-forward and changes only three files.

## Relevant files
- `AGENTS.md`
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- `supabase/migrations/20260728_wholesale_applications.sql`
- `scripts/apply-pending-migrations.mjs`
- `supabase/migrations/MIGRATION_LEDGER.md`

## Files to edit (STRICT)
- `supabase/migrations/20260728_wholesale_applications.sql` — accept the source branch's defused version only.
- `scripts/apply-pending-migrations.mjs` — accept the source branch's `wholesale-applications-table` plan entry only.
- `supabase/migrations/MIGRATION_LEDGER.md` — accept the source branch's 2026-08-17 wholesale-application ledger entry only.
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- Do not edit application code, create another migration, alter the production database, or reintroduce an `admin_notifications` CHECK block.

## Plan
1. Use the repository's pre-merge gate to merge `earth/marcus-wolfe/create-wholesale-applica-9d14723b-mswmd0co` into `main`; it is a clean fast-forward from `0c1ffd1` to `3bf0650`.
2. Confirm `20260728_wholesale_applications.sql` contains only the idempotent table, indexes, RLS, and policies. Its header must document that the stale `admin_notifications_type_check` DROP/ADD block is defused.
3. Confirm the migration plan includes `id: 'wholesale-applications-table'`, targets this migration, has no prerequisites, and checks `to_regclass('public.wholesale_applications')`.
4. Confirm the migration ledger starts with the 2026-08-17 wholesale-applications entry, records the live apply and verification, and explains why the redundant CHECK block remains absent.
5. Verify the merge diff stays limited to the three files and introduces no whitespace errors. Do not apply the plan: production already has the target state.

## Acceptance criteria
- [ ] The source branch is merged to `main` through the pre-merge gate without conflicts.
- [ ] `20260728_wholesale_applications.sql` has no `ALTER TABLE public.admin_notifications` or `admin_notifications_type_check` statement; the defuse banner remains.
- [ ] `scripts/apply-pending-migrations.mjs` lists `wholesale-applications-table` for `20260728_wholesale_applications.sql` with the `to_regclass` check.
- [ ] `MIGRATION_LEDGER.md` contains the 2026-08-17 wholesale-applications section and its live-verification context.
- [ ] No database action, application-code change, or unrelated file change is introduced.

## Commands
- `git merge-base --is-ancestor main earth/marcus-wolfe/create-wholesale-applica-9d14723b-mswmd0co`
- `git merge-tree main earth/marcus-wolfe/create-wholesale-applica-9d14723b-mswmd0co`
- `git diff --check main earth/marcus-wolfe/create-wholesale-applica-9d14723b-mswmd0co`
- `node --check scripts/apply-pending-migrations.mjs`
- `git diff --name-only main earth/marcus-wolfe/create-wholesale-applica-9d14723b-mswmd0co`

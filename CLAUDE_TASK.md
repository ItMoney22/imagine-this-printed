# Claude Task Brief

## Request
- Watchtower task `9ac467d7-77d3-4cdc-bfc8-860e8cb487ba`: establish whether production has the order live-tracking migration, apply it if absent, and verify carrier polling plus customer/admin tracking views.
- Correction: commit `4d6d652` was already reported on `origin/main` on 2026-09-22. Do not re-push or cherry-pick. The current local `origin/main` reference also contains it; a fresh remote verification remains to be done.

## Repo detection
- Imagine This Printed is a Vite/React/TypeScript frontend, Node/Express backend and worker, and Supabase/PostgreSQL database. Main pushes trigger Render and Vercel deployments.
- This checkout is `earth/levi-james/apply-order-live-trackin-9ac467d7-mue0m6fl`, not `main`. Repository `AGENTS.md` limits Codex output to this brief and `TASK_NOTES.md`.
- Prior tracking notes say the production migration was refused on 2026-09-11; the present production schema, deployment state, and worker logs have not been verified in this run.

## Relevant files
- `AGENTS.md`; `CLAUDE.md`; `TASK_NOTES.md`
- `supabase/migrations/20260911000000_order_live_tracking.sql`; `supabase/migrations/README.md`; `supabase/migrations/MIGRATION_LEDGER.md`
- `backend/worker/delivery-tracking-sweep.ts`; `backend/worker/index.ts`
- `backend/routes/orders.ts`; `src/components/orders/LiveTrackingPanel.tsx`; `src/pages/OrderStatus.tsx`
- `package.json`; `backend/package.json`

## Files to edit (STRICT)
- Codex may edit only the absolute paths `D:\watchtower-dispatch-worktrees\imagine-this-printed\levi-james\apply-order-live-trackin-9ac467d7-mue0m6fl\CLAUDE_TASK.md` and `D:\watchtower-dispatch-worktrees\imagine-this-printed\levi-james\apply-order-live-trackin-9ac467d7-mue0m6fl\TASK_NOTES.md`.
- No application or migration file edit, `.beats.log`, repo commit, branch change, or push is authorized under `AGENTS.md`. Explicit scope expansion is required before Codex executes production changes or writes other repo files.

## Plan
1. Verify `4d6d652` on the live remote `origin/main` without changing branches or pushing.
2. Read production catalog columns and indexes directly; also inspect `supabase_migrations.schema_migrations`. Treat actual objects as ground truth because the migration ledger warns that historical writes bypassed the CLI ledger.
3. If absent, obtain the required scope expansion and production go-live ruling, then apply the existing additive SQL once through the established production connection. Verify all nine columns, both partial indexes, and migration tracking.
4. Inspect Render API and worker deployment versions/statuses and Vercel production deployment for the target commit. Review worker logs for sweep startup and a completed scan with no fatal error.
5. Verify order `ITP-MTRQH7VJ-2UO1` against the backend tracking response, then inspect the Manage Order modal and guest order-status view at desktop and mobile sizes for clean rendering and no uncaught errors. Record precise evidence and any remaining gap in the handoff.

## Acceptance criteria
- [ ] Production `public.orders` has `tracking_status`, `tracking_status_detail`, `tracking_status_at`, `tracking_location`, `tracking_eta`, `tracking_events`, `tracking_checked_at`, `tracking_error`, `delivery_coupon_code`, plus `idx_orders_tracking_poll` and `idx_orders_delivery_coupon_code`.
- [ ] Remote `main` contains `4d6d652`; Render API and worker and Vercel production deployments are healthy.
- [ ] Render worker logs show `[delivery-sweep]` startup and a completed live poll with no fatal error.
- [ ] Admin Manage Order and guest status views show tracking data without uncaught errors.
- [x] Scout brief and task notes are updated within the repo's two-file Codex scope.

## Commands
- Repository-sourced: `npm run build`, `npm --prefix backend run build`, `npm test`; use only if a concrete local build/test question remains.
- Read-only git: `git merge-base --is-ancestor 4d6d652 origin/main`; verify the actual remote before claiming current deployment.
- Read-only production checks: inspect PostgreSQL `information_schema.columns`, `pg_indexes`, and `supabase_migrations.schema_migrations`; inspect Render/Vercel deployment states and `[delivery-sweep]` logs through their authenticated adapters.
- Migration execution method must come from the established Supabase production connection and `supabase/migrations/README.md`; do not infer completion from the CLI ledger alone.
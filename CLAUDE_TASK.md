# Claude Task Brief

## Request

Watchtower task `1e0b76cb-af40-477e-a651-fe1f884c24e6`: reconcile `DELETE /api/tryon/:id` with the virtual try-on photo-retention policy.

Decision: choose approach A. A shopper deletion must remove the shopper-facing image bytes and clear their pointers, but must retain the `virtual_tryon_runs` row and its conversion-critical `cost_usd`, `itc_charged`, `status`, and `used_free_daily` fields. Do not move economics into `virtual_tryon_events`; that would create a second source of truth without solving a reporting need.

## Repo detection

- TypeScript Express backend in `backend/`; Vitest is run through the root `npm test` script.
- This dispatch branch predates the already-merged try-on feature. Start with a clean status and fast-forward it to `origin/main` before editing; the relevant implementation was merged in `6a64ec7` and remains on `origin/main`.
- The production retention sweep already deletes GCS bytes before nulling pointers, stamps `photos_purged_at`, and intentionally retains the run row for analytics.

## Relevant files

- `AGENTS.md`, `CLAUDE.md`, `CLAUDE_TASK.md`, `TASK_NOTES.md`
- `backend/routes/tryon.ts` — shopper DELETE currently deletes GCS objects and then hard-deletes the run row.
- `backend/worker/tryon-retention-sweep.ts` — authoritative byte-first purge semantics and `photos_purged_at` fallback.
- `backend/worker/tryon-retention-sweep.test.ts` — existing injected-dependency purge tests.
- `backend/services/virtual-tryon.ts` and `backend/services/virtual-tryon.test.ts` — analytics aggregation; inspect but do not change unless a test proves a retained row is excluded.
- `docs/VIRTUAL_TRYON.md` — sections 6 and 7.1 currently contradict the sweep by saying DELETE removes the row.

## Files to edit (STRICT)

- `backend/routes/tryon.ts`
- `backend/worker/tryon-retention-sweep.ts`
- `backend/worker/tryon-retention-sweep.test.ts`
- `docs/VIRTUAL_TRYON.md`
- `TASK_NOTES.md` — append one concise milestone bullet after each milestone.

Do not edit migrations, `virtual_tryon_events`, production data, or unrelated files. Do not delete the audit row `fabef3c0-3d15-4c9f-8f71-a4448e0e278f` in this code change; its later deletion is a separately authorized operational cleanup.

## Plan

1. Fast-forward to `origin/main`, reread the four approved implementation files, and confirm the current DELETE route still hard-deletes the row.
2. Extract or expose a small dependency-injected single-run photo-purge operation from the retention worker, then make the sweep use that same operation. It must preserve the established behavior: delete bytes first; treat GCS 404 as already removed; clear only the successfully removed group of pointers; stamp `photos_purged_at`; never delete the analytics row; leave failed-object pointers retryable.
3. Replace the DELETE route's hard row deletion with that shared purge operation after its owner-scoped lookup. Delete source and result photo assets by default, clear `model_photo_path`, `result_paths`, `result_urls`, and `result_url`, and return success only when the requested purge completed. On a transient object-delete failure, preserve the failed pointer and return a retryable error rather than claiming deletion succeeded.
4. Keep `summarizeConversion` and its `virtual_tryon_runs` input unchanged unless tests reveal an actual incompatibility. The report must continue counting the retained run row.
5. Update docs sections 6 and 7.1: a shopper deletion uses the same retention policy as the automatic sweep, removing photo data while retaining de-identified economic/reporting fields. State that deleted runs disappear from history because result pointers are null, not because the row is removed.
6. Add focused tests for manual-purge semantics through the shared operation: row/economic fields survive, GCS bytes and pointers are removed on success, 404 is idempotent, and a non-404 failure leaves its pointer available for retry. Keep existing sweep coverage passing.

## Acceptance criteria

- `DELETE /api/tryon/:id` no longer executes a delete against `virtual_tryon_runs`; an owner-scoped run row survives the manual deletion.
- Successful manual deletion removes associated GCS photo/result bytes, clears all shopper-facing image pointers, and stamps `photos_purged_at` (with the existing missing-column fallback retained).
- A non-404 storage failure never orphans a photo: its pointer remains; the endpoint does not report a false success.
- The retained row still supplies `cost_usd`, `itc_charged`, `status`, and `used_free_daily` to `summarizeConversion` / `/api/tryon/analytics`.
- `docs/VIRTUAL_TRYON.md` sections 6 and 7.1 accurately describe shopper-initiated deletion and the retention/reporting split.
- The retention-test audit row is untouched by this implementation.

## Commands

Run from repository root after dependencies are available:

```powershell
npm test -- backend/worker/tryon-retention-sweep.test.ts backend/services/virtual-tryon.test.ts
npm --prefix backend run typecheck
git diff --check
```

Use `npm run typecheck` as an additional frontend/root regression check only if the shared dependencies are intact. Do not run an install into the shared `node_modules` junction.

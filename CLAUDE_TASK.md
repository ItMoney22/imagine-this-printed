# Claude Task Brief

## Request
- Watchtower `6d36e6ab-1858-457a-bae8-e937da10a804`: recover Shippo labels by tracking number and backfill eligible orders.
- This Codex run is restricted by repo-root `AGENTS.md` to the two handoff files. Code implementation requires explicit scope expansion.

## Repo detection
- React/Vite/TypeScript frontend; Express/TypeScript backend; Supabase/PostgreSQL orders.
- Current dispatch branch: `earth/joshua-knight/build-shippo-label-recov-6d36e6ab-mue0mfk7`.
- Shipping Station prerequisite is only on unmerged `earth/zero-nine/shipping-station` (commit `627ad44`, tip `99f2693`). This branch lacks `GET /api/orders/:orderId/shipping-label/file`.

## Relevant files
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\joshua-knight\build-shippo-label-recov-6d36e6ab-mue0mfk7\backend\routes\orders.ts`: guarded label-purchase route, metadata shape, order persistence.
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\joshua-knight\build-shippo-label-recov-6d36e6ab-mue0mfk7\backend\services\`: candidate Shippo lookup service.
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\joshua-knight\build-shippo-label-recov-6d36e6ab-mue0mfk7\backend\scripts\`: candidate backfill location.
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\joshua-knight\build-shippo-label-recov-6d36e6ab-mue0mfk7\package.json` and `D:\watchtower-dispatch-worktrees\imagine-this-printed\joshua-knight\build-shippo-label-recov-6d36e6ab-mue0mfk7\backend\package.json`: verification commands.
- `earth/zero-nine/shipping-station:backend/routes/orders.ts`: existing file route to integrate.

## Files to edit (STRICT)
- For Codex under current `AGENTS.md`: only `D:\watchtower-dispatch-worktrees\imagine-this-printed\joshua-knight\build-shippo-label-recov-6d36e6ab-mue0mfk7\CLAUDE_TASK.md` and `D:\watchtower-dispatch-worktrees\imagine-this-printed\joshua-knight\build-shippo-label-recov-6d36e6ab-mue0mfk7\TASK_NOTES.md`.
- Once implementation scope is explicitly expanded, candidate code edits: `D:\watchtower-dispatch-worktrees\imagine-this-printed\joshua-knight\build-shippo-label-recov-6d36e6ab-mue0mfk7\backend\routes\orders.ts`, one lookup service with focused tests, one backfill script with focused tests. Update `TASK_NOTES.md` scope before editing.

## Plan
1. Integrate or base implementation on the unmerged Shipping Station branch without changing the shared checkout.
2. Query Shippo transactions server-side with `SHIPPO_API_TOKEN`; paginate, require exact tracking-number match, SUCCESS status, transaction ID and label URL; reject ambiguous matches.
3. Add admin/manager `POST /:orderId/shipping-label/recover`. Require an order tracking number, preserve other metadata, persist only label URL and shipping-label metadata, and return recovered transaction data. Do not buy a label or alter shipment status.
4. Backfill tracked orders missing label URLs with bounded pagination/concurrency, per-order logs, idempotency and no overwrites.
5. Test auth, exact match, pagination, misses, ambiguity, metadata preservation, write failures, backfill continuation and file-route readability.
6. With verified Shippo/Supabase access and applicable live-write approval, recover example order `ed1a6d61-f498-4402-aabf-47c235d4f0ac`; read back both database fields and fetch its label file.

## Acceptance criteria
- [ ] Protected endpoint returns 200 with recovered transaction details after a persisted update.
- [ ] Lookup never accepts a partial/wrong tracking match and handles no-match gracefully.
- [ ] Backfill continues across misses/errors and can resume safely.
- [ ] Example order has persisted `shipping_label_url` and `metadata.shipping_label.transaction_id`.
- [ ] `GET /api/orders/:id/shipping-label/file` serves its recovered label without 404/500.
- [ ] Live recovery is reported only after independent read-back.

## Commands
- `git branch -a --contains 627ad44`
- `npm --prefix backend run typecheck`
- `npm run test -- <focused test file>`
- `git diff --check -- CLAUDE_TASK.md TASK_NOTES.md`
- `git status --short`

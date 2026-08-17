# Claude Task Brief

## Request
- Watchtower task `4a1aecb9-58c9-4b6e-8138-c76a7d5ff958`: integrate commit `a2f069c` from `earth/lucas-blaze/move-shippo-label-purcha-1199ada7-ms3evqf3` onto the latest `origin/main` lineage, then merge/deploy it safely.
- Move Shippo label purchase fully server-side through `POST /api/orders/:orderId/shipping-label`; never expose a Shippo token through a `VITE_` variable.
- Preserve the label-persistence fixes already on `origin/main`, remove `src/utils/shippo.ts`, deploy to staging, and smoke-test mock mode without spending money.

## Repo detection
- React 19 + TypeScript + Vite frontend, Express/TypeScript backend, Supabase persistence.
- Current dispatch branch is `earth/dominic-vane/itp-merge-server-side-sh-4a1aecb9-mswmtbg4` at `0c1ffd1`; it is behind `origin/main` (`a2306d4` when scouted).
- `origin/main` contains the prior Shippo persistence merge (`3e3a148`, follow-up `2d4ef30`) but does not contain `a2f069c`.
- A push to `main` is production deployment; do not test a real Shippo purchase before approval `ff472d92-7f43-4d97-813f-e13a30ae99d7` is approved.

## Relevant files
- `src/pages/OrderManagement.tsx`: conflict hotspot. Preserve current order loading/notes/status/product-file behavior, but replace browser-side `shippoAPI` purchase + PATCH persistence with one `apiFetch` POST to the new endpoint. Keep founders read-only for label purchase.
- `backend/routes/orders.ts`: add the authenticated admin/manager endpoint without dropping newer `origin/main` routes, transition validation, product-file attachment, or PATCH behavior.
- `backend/routes/shipping.ts`: export the existing shared warehouse address only; retain `origin/main` signed quote-token logic.
- `src/utils/shippo.ts`: delete after confirming no remaining imports.
- `supabase/migrations/20260726_order_shipping_label.sql` and `20260727_orders_shipping_label_url.sql`: both add the same column idempotently. Keep the existing indexed migration and allow the branch migration unless the migration policy prefers consolidating comments; do not rewrite or drop the column.
- `.env.example`, `backend/.env.example`, `docs/ENV_VARIABLES.md`, `docs/archive/VERCEL_ENV_SETUP.md`, `docs/site-audit-findings.md`: remove client-token guidance and document only backend `SHIPPO_API_TOKEN`.

## Strict edit list for Claude
- `.env.example`
- `backend/.env.example`
- `backend/routes/orders.ts`
- `backend/routes/shipping.ts`
- `docs/ENV_VARIABLES.md`
- `docs/archive/VERCEL_ENV_SETUP.md`
- `docs/site-audit-findings.md`
- `src/pages/OrderManagement.tsx`
- `src/utils/shippo.ts` (delete)
- `supabase/migrations/20260727_orders_shipping_label_url.sql`
- `TASK_NOTES.md` (append milestone entries only)
- Do not edit unrelated files. Do not touch the shared checkout at `D:\Projects for MetaSphere\imagine-this-printed`.

## Plan
1. Re-check status and refs. On the already-checked-out dispatch branch, bring in current `origin/main` without switching branches, then merge `a2f069c`; never merge in the shared checkout.
2. Resolve conflicts by using `origin/main` as the structural base. In `OrderManagement.tsx`, keep later UI/data work while adopting `a2f069c`'s `apiFetch('/api/orders/:id/shipping-label', { method: 'POST' })` purchase flow and backend-reported mock state. Do not retain the redundant client PATCH after a successful real purchase.
3. In `backend/routes/orders.ts`, preserve all newer routes and add the server purchase handler with `requireAuth` plus `requireRole(['admin', 'manager'])`, duplicate-purchase guard, address validation, backend token, mock response that does not persist, Shippo shipment/transaction calls, service-role persistence, audit log, and paid-label recovery response when persistence fails.
4. Preserve `origin/main`'s signed checkout quote logic in `backend/routes/shipping.ts`; apply only the shared warehouse-address export needed by the orders route.
5. Remove every `VITE_SHIPPO_API_TOKEN`, `shippoAPI`, and `src/utils/shippo` reference; delete the utility. Confirm the backend variable remains `SHIPPO_API_TOKEN`.
6. Verify both shipping-label migrations are additive/idempotent. Do not reapply or mutate production schema solely because the second migration repeats `ADD COLUMN IF NOT EXISTS`.
7. Add focused automated coverage for authorization, missing order/address, mock behavior (no DB update), duplicate-purchase guard, successful persistence, and paid-label/persist-failure handling if an existing approved test location can cover the route without expanding scope; otherwise record the gap before deployment.
8. Run repository-sourced checks. Commit only owned files with subject beginning `dominic-vane:` and include task id `4a1aecb9-58c9-4b6e-8138-c76a7d5ff958` in the handoff.
9. Deploy a frontend preview and the corresponding backend staging revision using existing project staging configuration. Keep `SHIPPO_API_TOKEN` unset or use a non-billing test token. Smoke-test with an authenticated admin/manager order: POST returns `mock: true`, `persisted: false`, a demo label, and leaves order status/tracking/label unchanged. Verify founders receive 403 and unauthenticated callers receive 401.
10. Only after staging passes, follow the repo pre-merge gate and integrate to current `main`. Do not execute a real money-spending Shippo transaction while approval `ff472d92-7f43-4d97-813f-e13a30ae99d7` is pending.

## Acceptance criteria
- Current `main` includes `a2f069c`'s server-side architecture without losing later `origin/main` work.
- `src/utils/shippo.ts` is absent and no frontend bundle/config references `VITE_SHIPPO_API_TOKEN`.
- `OrderManagement.tsx` calls `POST /api/orders/:orderId/shipping-label` via `apiFetch`; it does not separately persist the purchased label.
- The endpoint is admin/manager-only, uses backend `SHIPPO_API_TOKEN`, blocks repeat purchases, returns an explicit non-persisting mock response when unconfigured, and persists real label/tracking/status metadata through the service-role client.
- Existing label persistence, shipping quote signing, order transitions, product-file enrichment, and founder read-only access do not regress.
- Both migrations coexist safely; the column/index remain present with no destructive operation.
- Frontend and backend typechecks/builds/tests pass.
- Staging mock smoke passes without carrier spend; deployment identifiers and evidence are recorded.
- The final commit hash, merge/deploy result, approval status, risks, and any follow-up task ids are written to the Watchtower handoff.

## Commands
```powershell
git status --short --branch
git merge-base --is-ancestor a2f069c HEAD
rg -n "VITE_SHIPPO_API_TOKEN|shippoAPI|utils/shippo|shipping-label" src backend .env.example backend/.env.example docs
npm run typecheck
npm test
npm run build
npm --prefix backend run typecheck
npm --prefix backend run build
```
- Use only deployment commands already documented/configured in the repo or hosting project. Do not invent a staging target and do not run a live purchase.

## Assumptions and risks
- Architectural choice: the new endpoint owns purchase and persistence atomically from the caller's perspective; the frontend PATCH path from the prior merge is intentionally removed from label generation but retained for unrelated order updates.
- The two migrations are safe together because both use `ADD COLUMN IF NOT EXISTS`; the earlier migration also creates the partial index.
- Concurrency remains worth reviewing: the URL-based duplicate guard prevents sequential rebuying but may not prevent two simultaneous first-purchase requests. If no lock/idempotency key exists, document this as a security/financial follow-up rather than silently claiming perfect idempotency.
- Staging infrastructure was not established during scouting. If no backend staging service exists, complete local authenticated mock testing plus frontend preview, then file a Watchtower follow-up for a real backend staging target instead of pointing a preview at production for mutation tests.

# Claude Task Brief

## Request
- Watchtower `13e1c509-a66a-44d0-a67b-f3719ce86855`: prepare and, after scoped customer go-live approval and all gates pass, repoint `api.imaginethisprinted.com` from Render to Fly with TLS, health checks, and rapid rollback.

## Repo detection
- Git worktree on the dispatched branch; Vite storefront, Express API, Render backend/worker, staged Fly API/worker.
- Public CNAME still resolves to `imagine-this-printed-backend.onrender.com` with TTL 300; public `/api/health` returned 200 during this scout. These checks do not prove current Cloudflare dashboard state or Fly readiness.
- Step 1's live Cloudflare zone read recorded the API CNAME as DNS-only (`proxied: false`), TTL 300, record ID `74b5eb9b47e763da941199bfcc7e0941`. Re-read before any change. There is no Cloudflare proxy hop; Render's `TRUST_PROXY_HOPS=2` must be measured anew for Fly, not copied from the stale comment in `backend/index.ts`.
- Latest Step 4 handoff says Fly API health/database checks passed, but Fly worker remains stopped and the deployment workflow is unmerged/disabled. Recheck all states.

## Relevant files
- `AGENTS.md`, `CLAUDE.md`, `TASK_NOTES.md`.
- `backend/index.ts` (proxy setting), `backend/package.json` (verification command), `README.md` (health endpoints), Step 1 inventory in commit `8886a12` at `docs/migration/render-to-fly/STEP-1-INVENTORY.md`.
- Step 3 handoff `E:\memory\watchtower\handoffs\handoff-dominic-vane-1790163441154.json` and Step 4 handoff `E:\memory\watchtower\handoffs\handoff-ethan-dunn-1790164403664.json`.

## Files to edit (STRICT)
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\dominic-vane\step-5-6-repoint-api-ima-13e1c509-mue1yibr\CLAUDE_TASK.md`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\dominic-vane\step-5-6-repoint-api-ima-13e1c509-mue1yibr\TASK_NOTES.md`
- Repo instructions forbid editing any other repo file. Cloudflare/Fly/Render changes are separate remote actions subject to verified access and the approval gate.

## Plan
1. Check the board for an existing scoped go-live approval; obtain one if absent. Do not change production DNS before it is granted.
2. Re-read the exact Cloudflare API record, including target, `proxied`, TTL, and ID; compare with live DNS. Confirm DNS-only and measure Fly's correct `TRUST_PROXY_HOPS` with a request through the real edge.
3. Re-prove Render/Fly secret parity immediately before cutover, API/database health, Fly worker readiness, and the release/deployment gate. Keep Render backend healthy and coordinate worker transition.
4. Add Fly certificate for `api.imaginethisprinted.com`; verify readiness and HTTPS with SNI against Fly before editing DNS. Recheck current CAA.
5. TTL is currently 300 seconds. If a lower supported DNS-only TTL is available, set it ahead of time and allow the old TTL to expire. If 300 is the minimum, document the propagation limit; never promise global failback in five minutes.
6. Save the original record; change only that CNAME to Fly. Check authoritative and recursive DNS answers, TLS, `/api/health`, storefront preflight and representative calls, Stripe webhook delivery, `pending_webhooks`, and Render direct health.
7. Rollback: PATCH the same Cloudflare record ID back to `imagine-this-printed-backend.onrender.com`, preserving DNS-only mode and the prepared TTL; verify Render direct and public health, authoritative and recursive DNS, TLS, storefront calls, and Stripe delivery. Keep Render running until resolver convergence. Record timestamps and values. Operator action can take under five minutes; propagation may take longer.

## Acceptance criteria
- [ ] Scoped go-live approval and current remote access verified.
- [ ] Current Cloudflare record and Fly trust-proxy hop count verified.
- [ ] Fly certificate active before DNS mutation; direct HTTPS/SNI succeeds.
- [ ] DNS TTL prepared and old cache TTL elapsed, or minimum-TTL constraint documented.
- [ ] Public API health returns 200 from Fly, storefront CORS/SSL passes, Stripe deliveries succeed, `pending_webhooks=0`.
- [ ] Render direct endpoint remains healthy as hot standby and rollback record is tested.
- [ ] Cutover and rollback evidence recorded. None of these is complete from this scout alone.

## Commands
- Repo sourced: `npm --prefix backend run verify:security` (`backend/package.json`); `curl https://api.imaginethisprinted.com/api/health` (`README.md`).
- Read-only: `Resolve-DnsName api.imaginethisprinted.com -Type CNAME`; `git status --short`; `git diff --check -- CLAUDE_TASK.md TASK_NOTES.md`.
- For remote operations, authenticate to the exact account/app/record, verify approval, and read back the returned state.

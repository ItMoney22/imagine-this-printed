# Claude Task Brief

## Request
- Watchtower task `d2ae8c07-ed4a-49af-b426-36a196dc777b`: build Pluto's resident shipping-label pull agent after the shipping-station API is deployed.
- This request is BLOCKED: on 2026-09-23 `https://api.imaginethisprinted.com/api/print-station/` returned HTTP 404. Do not begin implementation until that endpoint returns a non-404 response and the shipping-station branch has merged.

## Repo detection
- Vite/React TypeScript storefront with a separate Node/Express TypeScript backend; production API base is `https://api.imaginethisprinted.com` (README.md).
- `earth/zero-nine/shipping-station` contains the unmerged print-station route and service. The current branch has no print-station files.
- `AGENTS.md` restricts this Codex run to editing only the two repo-root task documents.

## Relevant files
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\jimmy-phix\build-pluto-print-agent-d2ae8c07-mue0mme1\AGENTS.md`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\jimmy-phix\build-pluto-print-agent-d2ae8c07-mue0mme1\CLAUDE.md`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\jimmy-phix\build-pluto-print-agent-d2ae8c07-mue0mme1\README.md`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\jimmy-phix\build-pluto-print-agent-d2ae8c07-mue0mme1\backend\package.json`
- Unmerged contract to inspect after merge: `backend/routes/print-station.ts` and `backend/services/print-station.ts` on `earth/zero-nine/shipping-station`.

## Files to edit (STRICT)
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\jimmy-phix\build-pluto-print-agent-d2ae8c07-mue0mme1\CLAUDE_TASK.md`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\jimmy-phix\build-pluto-print-agent-d2ae8c07-mue0mme1\TASK_NOTES.md`
- Agent code, tests, service configuration, and `.beats.log` require explicit expansion of the repo instruction's edit scope. No implementation file is approved for this Codex run.

## Plan
1. Wait for the shipping-station branch to merge and for the production API prefix to stop returning 404. Confirm the deployed route contract before consuming a job.
2. After scope expansion, add a resident outbound-only Pluto service. Poll `GET /api/print-station/jobs/next?station=pluto` with Bearer `PRINT_STATION_TOKEN`; treat 204 as normal idle. Parse the returned `job.jobId`, `job.fileUrl`, and `job.copies`.
3. Download the file with the same bearer token, validate type and 4x6 media, submit the requested copies to Pluto's named thermal-printer CUPS queue, then POST `{status:"printed"}`. On download or printer failure POST `{status:"failed",error:<actual diagnostic>}` and continue looping. Keep a claimed job in a local recovery record until status is acknowledged so restart does not silently abandon it.
4. Proposed assumptions pending Pluto inspection: idle poll every 15 seconds; bounded exponential backoff from 5 to 60 seconds on transient API errors; CUPS `lp` with explicit 4x6 media and a configured queue name; `PRINT_STATION_TOKEN` in a root-owned systemd EnvironmentFile with restrictive permissions. Verify the actual printer model, driver, label MIME type, and queue before writing the hardware adapter.
5. Verify 204 stability, successful download and 4x6 print, error text on forced printer failure, restart recovery, bearer auth on all three requests, and concurrent claim behavior using the server's guarded update. Install/enable the service only after deployment and printer access are verified.

## Acceptance criteria
- [ ] Production print-station API is deployed and no longer returns 404.
- [ ] Scope expansion permits agent code and service configuration.
- [ ] Idle 204 polling remains healthy indefinitely; transient failures back off and recover.
- [ ] A queued job is claimed, downloaded, printed at 4x6 on Pluto, and reported `printed`.
- [ ] Printer/download failure reports `failed` with the real error text; the loop survives.
- [ ] Every request carries the bearer token; concurrent stations cannot both claim the same job.
- [ ] No inbound push/webhook service is added on Pluto.

## Commands
- Gate: `curl.exe -s -o NUL -w 'status=%{http_code}' https://api.imaginethisprinted.com/api/print-station/`
- Inspect branch contract: `git show earth/zero-nine/shipping-station:backend/routes/print-station.ts`
- Existing repo checks from package files: `npm test`; `npm run typecheck`; in backend, `npm run build` and `npm run typecheck`.
- Document checks: `git diff --check -- CLAUDE_TASK.md TASK_NOTES.md`; `git status --short`.

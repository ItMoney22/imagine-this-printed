# Claude Task Brief

## Request
- Watchtower task: `aae83015-e9a7-48a9-b54a-97cb7fddfd25`.
- Prevent any non-Render process from consuming production `ai_jobs` rows.
- Preserve normal local-worker use against non-production Supabase projects.
- Document and test the startup contract so every production job is attributable to Render worker `srv-d7jppnn7f7vs73bb4p80`.

## Repo detection
- TypeScript/Node backend; worker entrypoint is `backend/worker/index.ts` and compiles to `backend/dist/worker/index.js`.
- `backend/load-env.ts` loads `backend/.env` with `override: true` before SDK construction.
- Render is the intended production worker host; a legacy/local PM2 definition still launches the same compiled worker from `backend/ecosystem.config.cjs`.
- Official Render runtime variables provide a reliable contract: `RENDER=true`, `RENDER_SERVICE_TYPE=worker`, `RENDER_SERVICE_ID`, `RENDER_INSTANCE_ID`, and `RENDER_GIT_COMMIT`.

## Root cause and current containment
- Root cause is proven, not inferred: PM2 process id 5, `imagine-this-printed-worker`, was online for about 10 hours on this Windows host. It ran `D:/Projects for MetaSphere/imagine-this-printed/backend/dist/worker/index.js` from the shared backend with `NODE_ENV=production`, `autorestart=true`, and production Supabase credentials loaded from `backend/.env`.
- Its local log contains the three exact ghost-mannequin jobs missing from Render logs:
  - `b6b8e3a6-e217-44d9-ad6d-2f5dcb10c6f1` at 2026-08-16 22:00, completed with `google/nano-banana-2-lite`.
  - `135cf8eb-f8ff-41b9-9d1d-f3ea067229a6` at 22:07, including the observed QA retry, then completed.
  - `83afc36a-8242-4953-a0c9-a5829733cc16` at 22:11, including the observed QA retry, then completed.
- Immediate reversible containment is already applied: `pm2 stop imagine-this-printed-worker`. PM2 now reports it stopped with PID 0, its PID file is absent, and the local API plus unrelated PM2 services remain online.
- This containment is not durable by itself: `npm run pm2:start`, `pm2 restart ecosystem.config.cjs`, or an old PM2 dump/resurrection can re-create the worker until the code/config guard ships.
- Host scan scope: current Windows machine, user `David`, all linked Imagine This Printed worktrees visible here, current process table, David's PM2 daemon/dump, scheduled tasks, and Windows services. No matching scheduled task or Windows service was found. This does not attest to other physical machines or user accounts.
- Seven `backend/.env` files target production; none currently has a direct worker process after containment:
  - Shared `D:/Projects for MetaSphere/imagine-this-printed` tree.
  - Lucas Blaze `rotate-render-openrouter-aa609d99-msvz7xr4` dispatch worktree.
  - Vinny Carbone `repair-psd-checkpoint-co-e7679a5a-mswl4uo0` dispatch worktree.
  - Zero Nine `david-action-reconcile-s-4a43156f-msv3tvbh` dispatch worktree.
  - Iahhm `grade-mockup-flux2-singl-6456344b-msvzdpeq` dispatch worktree.
  - Iahhm `fix-design-library-url-e-1cb2f16c-ms2csjjm` dispatch worktree.
  - Iahhm `itp-investigate-2-step-m-b4db4c72-mswkwwec` dispatch worktree.

## Relevant files
- `AGENTS.md`
- `CLAUDE.md`
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- `backend/load-env.ts`
- `backend/package.json`
- `backend/ecosystem.config.cjs`
- `backend/worker/index.ts`
- `backend/worker/ai-jobs-worker.ts`
- `backend/worker/ai-jobs-worker.claim.test.ts`

## Files to edit (STRICT)
- `backend/worker/index.ts`
- `backend/worker/runtime-guard.ts` (new, side-effect-free guard/identity helper)
- `backend/worker/runtime-guard.test.ts` (new)
- `backend/ecosystem.config.cjs`
- `TASK_NOTES.md` (append implementation/verification milestone only)
- Do not edit any other file. Do not copy or print secret values.

## Plan
1. Add a side-effect-free runtime guard that extracts the Supabase project ref from `SUPABASE_URL` and identifies the production ref `czzyrmizvjqlifcivrhn`.
2. For that production ref, hard-fail before importing or starting either worker unless all three conditions hold: `RENDER === 'true'`, `RENDER_SERVICE_TYPE === 'worker'`, and `RENDER_SERVICE_ID === 'srv-d7jppnn7f7vs73bb4p80'`. A generic `RENDER=true` check alone is insufficient because another Render service could inherit the credentials.
3. Keep non-production local workers usable. Do not add a bypass that permits non-Render access to the production ref.
4. Refactor `worker/index.ts` so `load-env` remains first, the guard runs before dynamic imports of `ai-jobs-worker` / `etsy-jobs-worker`, and a single loud startup identity banner logs hostname, PID, service id/name/type, instance id, and git commit. Never log credentials or complete environment dumps.
5. Remove the `imagine-this-printed-worker` app from the local/VPS PM2 ecosystem definition so `npm run pm2:start` cannot create a crash/restart loop after the guard ships. Leave the local API definition unchanged.
6. Unit-test production refusal cases (no Render vars, wrong service type, wrong service id), the exact intended Render-worker allow case, malformed/missing URL behavior, and non-production local allowance.
7. Verify no direct local worker process is running. After deployment, queue a zero-spend fixture or use the next legitimate job and correlate the full job id with the Render startup identity and existing claim/start/completion logs. Do not spend Replicate money solely for this test.

## Decisions / assumptions
- Detection mechanism: use Render's documented `RENDER=true` plus exact `RENDER_SERVICE_TYPE` and `RENDER_SERVICE_ID`; the intended id is pinned deliberately.
- Prevention method: hard stop for production credentials outside the exact Render worker. Loud logging alone does not prevent unaccounted spend.
- Banner detail: startup-only hostname, PID, service id/name/type, instance id, and git commit. Per-tick banners every five seconds would be noisy; existing job logs already carry full job ids.
- Scan boundary: this host/user and visible worktrees only. Preventive code is the control for unscanned machines.

## Acceptance criteria
- [ ] `worker/index.ts` refuses to start against production Supabase unless it is the exact intended Render background worker.
- [ ] Guard executes before worker modules can poll or claim jobs.
- [ ] Local non-production worker development remains possible.
- [ ] Startup log identifies Render service, instance, git commit, hostname, and PID without secrets.
- [ ] PM2 ecosystem can no longer launch the Imagine This Printed worker locally; its API app remains intact.
- [ ] Guard tests cover allowed and rejected environments and pass.
- [ ] Backend typecheck and build pass.
- [ ] Post-deploy evidence shows a production job's full id in the intended Render worker logs, with no corresponding local worker process.
- [ ] Root-cause report remains traceable to Watchtower task `aae83015-e9a7-48a9-b54a-97cb7fddfd25`.

## Commands
```powershell
# From repo root
npm test -- backend/worker/runtime-guard.test.ts
cd backend
npm run typecheck
npm run build
pm2 list --no-color
Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'dist[\\/]worker[\\/]index\.js|worker[\\/]index\.ts' }
```

- Render variable contract source: https://render.com/docs/environment-variables
- Do not run `npm run worker`, `npm run worker:dev`, `npm run start:worker`, or `npm run pm2:start` with the production `.env` during verification.

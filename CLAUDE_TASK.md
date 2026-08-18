# Claude Task Brief

## Request
- Watchtower task `3ba0cd22-5d2f-45f0-bee7-1290a032b8a2`: verify the Nano Banana 2 Lite composite swap has merged and deployed, then preserve production evidence for GCS MIME correctness and Etsy image acceptance.
- This is a verification and handoff task. Do not modify application code, Git refs, cloud configuration, GCS objects, Etsy listings, or production jobs from this dispatch.

## Repo detection
- Imagine This Printed is a Vite/React frontend plus an Express/TypeScript backend and async worker.
- GitHub `main` auto-deploys the backend and worker to Render; production health endpoints are available at the API domain.
- GCS persists mockup bytes, while Etsy uploads `metadata.etsy_shots.images` before product images.

## Relevant files
- `AGENTS.md`
- `CLAUDE.md`
- `TASK_NOTES.md`
- `backend/services/google-cloud-storage.ts`
- `backend/services/etsy.ts`
- `backend/services/image-flow/{models.ts,input-builder.ts,worker-helpers.ts}`
- `backend/worker/ai-jobs-worker.ts`
- `backend/scripts/verify-nano-banana-2-lite.ts`
- `RUNBOOK.md`, `README.md`, `backend/package.json`

## Files to edit (STRICT)
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- No other repo files. Do not create or modify release, cloud, Etsy, GCS, or handoff artifacts.

## Verified state
- Commit `a7b33939afd9a5c5675cc309eb2a72686114d017` is already an ancestor of `origin/main`; its Nano Banana Lite swap and MIME-sniffing changes are therefore merged.
- `origin/main` resolves to `41c1a5ae38badfe5578540cce65b7d5bb22f0d0e`; the API and storefront health probes both returned HTTP 200. A prior production handoff records both Render services live on that commit.
- The newer Flux 2 Pro rollout changes the active default for `flat_lay` and `ghost_mannequin` mockups. Therefore a first post-deploy job is not expected to log Nano Banana Lite for those templates. Nano Banana Lite remains the relevant historical and model-shot compatibility path.
- Live database evidence: the newest Lite mockup asset (2026-08-11T12:25:11Z) returns JPEG magic bytes and GCS `Content-Type: image/jpeg` (54,539 bytes); the MIME label matches its bytes.
- Etsy ledger evidence: 24 listings have accepted images, totaling 107 accepted uploads, with zero accepted-image rows carrying a `last_error`; the newest recorded success is 2026-08-09T23:55:21Z.

## Plan
1. Keep the merge proof (`git merge-base --is-ancestor a7b3393 origin/main`) with the deployment/health evidence above.
2. When a new Nano Banana Lite model-shot job occurs, query its GCS object and compare the HTTP content type against JPEG magic bytes.
3. Confirm the matching Etsy listing increments `uploaded_image_count` without `last_error`, noting that `services/etsy.ts` uploads model shots first.
4. Treat a Flux 2 Pro log for flat/ghost templates as expected current behavior, not a rollback; investigate only if model-shot/Lite paths lose MIME correctness or Etsy rejects an upload.
5. Do not run `verify-nano-banana-2-lite.ts` without an explicit spend approval: its header documents an approximately $0.15 Replicate cost.

## Acceptance criteria
- [x] The requested Nano Banana Lite commit is merged into `main`.
- [x] Production health is live; prior deployment evidence identifies `41c1a5a` as the deployed Render revision.
- [x] A persisted Lite mockup’s GCS metadata is `image/jpeg` and matches JPEG bytes.
- [x] Etsy ledger shows accepted image uploads with no recorded upload errors.
- [ ] A new post-`41c1a5a` real job is observed. Its expected model depends on template: Flux 2 Pro for flat/ghost, Lite only where the still-Lite path is selected.

## Commands
- `git merge-base --is-ancestor a7b3393 origin/main`
- `git rev-parse origin/main`
- `Invoke-WebRequest https://api.imaginethisprinted.com/api/health`
- `npm --prefix backend exec tsx scripts/verify-nano-banana-2-lite.ts` (optional, paid; do not run automatically)

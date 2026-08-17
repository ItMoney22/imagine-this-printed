# Claude Task Brief

## Request

Benchmark `tencent/hunyuan-3d-3.1` on Replicate against the existing Tripo image-to-3D lane for Watchtower task `c26d59e9-3043-4951-af0e-be83056b6eea`.

Run the same owned, representative concept image three times through Hunyuan, record each prediction's actual Replicate charge, inspect the generated GLBs and their existing GLB-to-STL results, then make a documented go/no-go recommendation. Integrate Hunyuan only if the measured result meets every gate below; Tripo stays the default provider either way.

## Repo detection

- Repository: `imagine-this-printed`, a Vite/React frontend with an Express/TypeScript backend and a queued AI worker.
- The active 3D generation queue type is `3d_model_tripo_v2`; the worker calls `generateTripo3D()` from `backend/services/tripo3d.ts`, then performs the shared GLB-to-STL conversion.
- `backend/routes/3d-models.ts` owns the authenticated conversion request and queue payload. Its public size/ITC contract must remain stable.
- The current Tripo client is direct API polling. Tripo's verified comparison baseline for this task is $0.20 for an untextured image-to-3D model.
- Replicate's current public Hunyuan page lists $0.50 per unit. Treat that as a pre-test warning, not a substitute for the required three live billing records. `metrics.predict_time` is not itself an actual billed amount.

## Relevant files

Read in this order:

1. `AGENTS.md`, `CLAUDE.md`, `CLAUDE_TASK.md`, `TASK_NOTES.md`
2. `backend/services/tripo3d.ts` — provider boundary, stable exported types, no-double-charge retry rule.
3. `backend/routes/3d-models.ts` — request validation, tier pricing, queue payload.
4. `backend/worker/ai-jobs-worker.ts` — read-only: confirm the existing `generateTripo3D()` call and leave its GLB-to-STL path unchanged.
5. `backend/services/glb-to-stl.ts` — read-only: use only to validate output compatibility if needed.
6. `backend/.env.example` — read-only unless separately authorized to document the flag.
7. Replicate's live Hunyuan schema and prediction/billing activity before constructing a request. Do not guess input field names, output shape, or pricing.

## Files to edit (STRICT)

- `backend/services/tripo3d.ts` — only if the measured benchmark passes every integration gate.
- `backend/routes/3d-models.ts` — only minimal provider-neutral request/logging metadata if required by the selected service contract.
- `CLAUDE_TASK.md`
- `TASK_NOTES.md` — append the benchmark table, recommendation, and one milestone bullet.

Do not edit the worker, `glb-to-stl` service, migrations, UI, package manifests, lockfiles, or any other file. Do not alter tier prices, ITC debiting, queue type names, or STL conversion behavior.

## Benchmark protocol

1. Select one owned, non-sensitive, representative concept image already accessible by HTTPS; use the exact same immutable URL and identical Hunyuan input settings for all three predictions. Prefer a single, well-lit figurine/character image with a simple background rather than a customer upload. Record its redacted identifier/URL fingerprint, dimensions, and model input in `TASK_NOTES.md`; never copy secrets into the notes.
2. Read the live Hunyuan schema and use the supported image-to-3D input exactly. Submit three separate predictions with `REPLICATE_API_TOKEN`; wait for terminal status and preserve each prediction ID, web URL, status, start/completion timestamps, `predict_time`, total time, output GLB URL/file size, and model/version.
3. For each completed prediction, obtain the actual billed dollar amount from Replicate's authenticated prediction activity/billing record. Record the source/time of that observation. If Replicate exposes only the listed per-unit price, report the precise limitation and do not label `predict_time × an assumed rate` as actual billing.
4. Visually inspect each GLB in a real 3D viewer at multiple rotations. Run the existing conversion path unchanged for each successful GLB (or a read-only equivalent that invokes its existing converter), and inspect the resulting STL for obvious print-breaking defects. Do not persist benchmark assets into production tables or storage.
5. Compare per-run charge, mean, range, failure rate, latency, output size, and quality against Tripo's $0.20 untextured baseline. Include the live Replicate model-page price in the evidence.

## Decision rules and implementation plan

Definitions for this task:

- **Materially under $0.20** means the three-run mean actual billed cost is **$0.15 or less** (at least 25% cheaper), with no individual successful run above $0.20.
- **Acceptable mesh quality** means all three outputs: (a) open as valid GLBs, (b) clearly preserve the reference subject's main silhouette and recognizable key features, (c) show no obvious detached debris, severe holes, collapsed limbs, or unusable texture/geometry artifacts at normal viewer distance, and (d) complete the existing GLB-to-STL conversion with finite, non-empty geometry and no visually obvious print-breaking gaps. Record failures honestly; do not average them away.
- Integrate only if all three runs succeed, all three pass the quality gate, and the cost gate passes. A current listed price of $0.50 per unit is therefore an expected no-go unless authenticated billing evidence differs.

If the benchmark is a no-go:

1. Do not change provider code.
2. Add the table, qualitative observations, calculation, and concise no-go recommendation to `TASK_NOTES.md`.
3. State that Tripo remains the provider and why.

If and only if the benchmark is a go:

1. Keep `generateTripo3D()` as the worker-facing stable entry point so the worker and its STL conversion remain untouched.
2. In `tripo3d.ts`, add narrow internal selection based on `MODEL_3D_PROVIDER`, defaulting to `tripo`; accept only `tripo` and `hunyuan` (case-normalized). An unknown value must fail closed with a configuration error, never silently select a paid provider.
3. Implement Hunyuan using the verified current Replicate schema and `REPLICATE_API_TOKEN`. Normalize a successful GLB into the existing output contract with truthful provider metadata (`'tripo' | 'hunyuan'`) and provider-specific raw response. Reject a non-GLB/missing output before downstream conversion.
4. Preserve Tripo's pre-submit-only retry policy. For Hunyuan, never re-submit after a prediction ID is issued; retries are allowed only before a billable prediction is accepted.
5. Keep `MODEL_3D_PROVIDER` process-wide and server-controlled. Do not accept it from request bodies or persist it as user-controlled input. Make route wording/logging provider-neutral only as needed.
6. Re-run a Hunyuan conversion under `MODEL_3D_PROVIDER=hunyuan` and a Tripo regression check with the flag unset/`tripo`; verify both use the unchanged STL converter.

## Acceptance criteria

- [ ] Exactly three completed Hunyuan predictions use one identical source image and settings.
- [ ] `TASK_NOTES.md` contains prediction IDs, actual billed amounts (or an explicit provider-side observability limitation), timings, output facts, evidence source, and a mean/range comparison to $0.20.
- [ ] `TASK_NOTES.md` contains per-run qualitative GLB/STL assessment and a clear recommendation.
- [ ] The $0.15/25% threshold and explicit mesh-quality gate are applied exactly.
- [ ] If the gate fails, no provider code changes are made and Tripo remains default.
- [ ] If the gate passes, `MODEL_3D_PROVIDER=hunyuan` selects the secondary provider; unset/`tripo` retains current behavior; an invalid value fails closed.
- [ ] Existing worker queue handling and GLB-to-STL conversion are unchanged.
- [ ] No secrets, raw API tokens, or customer images are committed or placed in task notes.

## Commands

Use repository-defined commands only:

```powershell
npm --prefix backend run typecheck
npm --prefix backend run dev:once
npm --prefix backend run worker
npm test
```

For live Replicate work, use an inline/scriptless Node or authenticated HTTP request that loads the existing local environment without printing secrets. Query the live model schema first, poll prediction IDs to terminal status, then inspect authenticated Replicate activity/billing for actual amounts. If backend dependencies are absent in this dispatch worktree, document the limitation and run the narrowest available validation; do not modify manifests or lockfiles to compensate.

## Handoff requirements

Update `TASK_NOTES.md` with a compact benchmark table, quality notes, evidence links/IDs, explicit decision, tests run, and environment-flag behavior if integrated. Commit only permitted changed files with an `iahhm:` subject. The Watchtower handoff must reference task `c26d59e9-3043-4951-af0e-be83056b6eea`, name the commit, state the $0.15 assumption and mesh-quality definition, and identify any blocked billing evidence.

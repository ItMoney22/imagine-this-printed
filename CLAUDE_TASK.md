# Claude Task Brief

## Request
- Watchtower task `6b03f251-d95c-4f2b-8ec5-109bbab63939`: gate and merge Jev copy QA commit `3b67791`, verify Render keys, and move `PRESENTATION_QA_JEV` from shadow to enforce only after the metal-art review settles.
- Repo `AGENTS.md` limits this Codex run to `CLAUDE_TASK.md` and `TASK_NOTES.md`; the merge, deployment changes, `.beats.log`, and external handoff need separate explicit scope authorization.

## Repo detection
- Git worktree on `earth/ethan-dunn/merge-jev-copy-qa-branch-6b03f251-mue2cqs4`.
- `main` is `eac8fedd`; Jev branch tip is `3b67791`; merge base is `ac3ad6e`. `main` contains two newer print-material commits. The Jev commit itself touches only the QA service, new Jev service/test/scripts/report, and `TASK_NOTES.md`; compare and merge against current `main` carefully.
- Vite/React frontend and Node/Express TypeScript backend. Root `package.json` owns Vitest, lint, frontend build; `backend/package.json` owns backend build/typecheck.

## Relevant files
- `AGENTS.md`, `CLAUDE.md`, `package.json`, `backend/package.json`, `TASK_NOTES.md`.
- On Jev branch: `backend/services/presentation-qa.ts`, `backend/services/jev.ts`, `backend/services/presentation-qa-jev.test.ts`, `backend/shared/catalog-capability.ts`, `docs/reports/jev-copy-qa-benchmark-2026-09-23.md`.

## Files to edit (STRICT)
- This Codex run: `CLAUDE_TASK.md` and `TASK_NOTES.md` only.
- Proposed Claude implementation scope after explicit expansion: merge Jev commit into `main`, resolving only actual conflicts; no unrelated code edits. Render configuration may be changed only after its service access and the metal-art review status are verified.

## Plan
1. Preserve the current worktree and inspect the Jev commit relative to current `main`; run focused Jev tests, the full Vitest suite, frontend build/lint, and backend build/typecheck from a clean merge candidate. Record any environment-sensitive or pre-existing failures rather than masking them.
2. Verify the deterministic floor blocks apparel claims for polo, tank/sleeveless, embroidery, and sublimation, allows valid live rows and legitimate metal-art sublimation, and does not let Jev clear a floor block.
3. With expanded scope, merge `earth/jessica-steele/add-jev-copy-qa-scoring-728d9207-mue1awk0` into `main` only after the gate passes and inspect the merge diff for the unrelated print-material changes already on `main`.
4. Verify `OPENROUTER_API_KEY` presence without disclosing values on both Render API and worker. Confirm actual presentation QA telemetry in shadow, including model errors, regex hits, and unhandled rejections.
5. Check metal-art copy review task `e987422f-afc4-46d0-9e67-8454e3c0764d`. If settled and shadow telemetry is clean, set `PRESENTATION_QA_JEV=enforce` in the applicable deployment environments; otherwise retain shadow. Verify a post-change QA execution and logs.

## Acceptance criteria
- [ ] Pre-merge gate passes on the merge candidate and the Jev branch is cleanly merged into `main`.
- [ ] Render API and worker both show active `OPENROUTER_API_KEY` presence; values are never copied to task files or logs.
- [ ] Apparel claim floor blocks invalid terms while valid live rows and legitimate metal art pass.
- [ ] Shadow/enforce logs show Jev evaluations, floor behavior, and no unhandled rejection or model crash.
- [ ] Enforce is enabled only after the metal-art copy review is settled; otherwise shadow remains and the dependency is reported.

## Commands
- `git diff --name-status 3b67791^ 3b67791`
- `git merge-base main 3b67791`
- `npm test -- backend/services/presentation-qa-jev.test.ts`
- `npm test`
- `npm run build`
- `npm run lint`
- `npm --prefix backend run build`
- `npm --prefix backend run typecheck`
- `git diff --check -- CLAUDE_TASK.md TASK_NOTES.md`
- Render env and log checks require verified deployment access; do not print secret values.

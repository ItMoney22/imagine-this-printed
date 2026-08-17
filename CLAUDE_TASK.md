# Claude Task Brief

## Request
- Watchtower task: `442a6ab4-875c-443c-ba84-72c2e3917dde`.
- Burn down every violation of the 11 rules temporarily downgraded in `eslint.config.js`, then restore each rule from `warn` to `error`.
- Preserve runtime behavior while replacing lint debt with real typing/refactors; do not hide violations with new disables, blanket ignores, or weaker rule options.
- Close the existing unrelated lint error so the GitHub Actions lint job can pass after the 11 rules are promoted.

## Repo detection
- Vite + React + TypeScript frontend under `src/`.
- Express/TypeScript backend under `backend/`; root ESLint covers both browser and Node code.
- GitHub Actions runs `npm run lint` from the repo root (`.github/workflows/ci.yml`).
- Fresh scout baseline on 2026-08-16: 514 files, 1 error, 2,349 warnings. The 11 targeted rules account for 2,281 warnings, not the older 2,006-warning estimate.
- Current targeted counts: `no-explicit-any` 1,948; `no-unused-vars` 267; `prefer-const` 25; `no-unsafe-function-type` 11; `react-refresh/only-export-components` 10; `react-hooks/rules-of-hooks` 5; `no-useless-escape` 4; `no-non-null-asserted-optional-chain` 4; `no-namespace` 3; `no-case-declarations` 3; `ban-ts-comment` 1.
- Non-target baseline: 66 `react-hooks/exhaustive-deps` warnings, two unused-disable warnings, and one `no-unused-expressions` error at `src/hooks/useMrImagineVoice.ts:185`.

## Relevant files
- `eslint.config.js` — 11 downgraded rules and four root snippet ignores.
- `.github/workflows/ci.yml` — confirms the root lint command is the CI gate.
- `package.json`, `CLAUDE.md` — authoritative commands and repository workflow.
- `src/components/KioskRoute.tsx` — four effects currently occur after early returns (fresh lines 115, 134, 141, 196).
- `src/pages/UserProfile.tsx` — a `useMemo` currently occurs after early returns (fresh line 454).
- `src/hooks/useMrImagineVoice.ts` — separate current lint error that blocks CI.
- `src/**/*.{ts,tsx}`, `backend/**/*.ts`, `scripts/**/*.ts`, `e2e/**/*.ts` — files reported by the targeted rules; edit only a file with a verified target violation or a directly required shared-type extraction.
- Root snippets: `AI_HANDLERS_TO_WIRE.ts`, `IMAGINATION_STATION_DPI_PATCHES.tsx`, `IMAGINATION_STATION_CODE_ADDITIONS.tsx`, `handlersToAdd.ts`.

## Files to edit (STRICT)
- `eslint.config.js`.
- `src/components/KioskRoute.tsx`, `src/pages/UserProfile.tsx`, and `src/hooks/useMrImagineVoice.ts`.
- Existing `*.ts`/`*.tsx` files under `src/`, `backend/`, `scripts/`, and `e2e/` only where the current ESLint output reports one of the 11 targeted rules.
- New colocated TypeScript type/constant modules only when needed to share a precise type or satisfy `react-refresh/only-export-components`; import and use every new module.
- Delete only `IMAGINATION_STATION_DPI_PATCHES.tsx` and `handlersToAdd.ts` among the four root snippets. They are tracked but unimported, have no filename references outside the ignore config/task notes, and their DPI/auto-nest/smart-fill behavior already exists in `src/pages/ImaginationStation.tsx` and `src/utils/dpi-calculator.ts`.
- Retain `AI_HANDLERS_TO_WIRE.ts` and `IMAGINATION_STATION_CODE_ADDITIONS.tsx`: current integration documentation still points readers to them (`IMAGINATION_STATION_AI_WIRING_GUIDE.md`, `WIRING_SUMMARY.md`, `QUICK_INTEGRATION_GUIDE.md`, and `STABILITY_FEATURES_SUMMARY.md`). Keep only these two snippet ignores in `globalIgnores` and record this retention rationale in the handoff.
- `TASK_NOTES.md` only for concise milestone/work-log updates required by `CLAUDE.md`.
- Do not edit UI styling, product behavior, generated assets, lockfiles, migrations, documentation, or unrelated lint rules.

## Plan
1. Re-run `npm run lint` and preserve a per-rule/per-file baseline before editing. Do not treat the 2026-07-26 counts as current.
2. Fix hooks first. In `KioskRoute`, invoke every effect before all loading/error returns and guard the effect body when `kiosk` or a required setting is absent; preserve cleanup behavior. In `UserProfile`, remove the unnecessary conditional `useMemo` or move a null-safe hook above all returns. Verify five zeroes, then promote `react-hooks/rules-of-hooks` to `error`.
3. Run the safe ESLint auto-fix pass, review every diff, then manually finish and promote in this order: `prefer-const`, `no-useless-escape`, `no-case-declarations`. Promote each only after its count is zero.
4. Fix `no-unused-vars` without fake renames: remove dead imports/locals/code, or adjust signatures only when callers/interfaces remain correct. Promote it after zero.
5. Fix and promote the five smaller remaining rules in this order: `ban-ts-comment`, `no-namespace`, `no-non-null-asserted-optional-chain`, `react-refresh/only-export-components`, `no-unsafe-function-type`. Replace broad `Function` types with actual call signatures and split React-only exports from shared constants/types where required.
6. Burn down `no-explicit-any` with behavior-preserving types. Start with `src/types` + `src/lib` (42 current warnings) so reusable contracts exist before consumers. Continue through `src/context` + `src/hooks` + `src/utils`, `src/components`, `src/pages`, backend shared/lib/middleware/utils, `backend/services`, `backend/routes`, `backend/worker` + `backend/scripts`, then root `scripts` + `e2e`. Current top-level counts are backend 1,393; src 516; scripts 36; e2e 3. Use `unknown` only at genuine trust boundaries and narrow it before access; do not perform a blind `any` to `unknown` replacement. Promote the rule only at zero.
7. Fix the separate `no-unused-expressions` error in `src/hooks/useMrImagineVoice.ts` so CI can return exit 0. Do not expand into the 66 non-target `exhaustive-deps` warnings unless a targeted refactor directly causes one.
8. Delete the two approved obsolete snippets, reduce `globalIgnores` to the two documented retained snippets, and state the evidence/assumption in the handoff.
9. Run lint after every rule promotion, then run typecheck, tests, and build. Review `git diff` for behavior changes and commit only this task's files on the already checked-out dispatch branch.

## Acceptance criteria
- [ ] `npm run lint` exits 0.
- [ ] All 11 formerly downgraded rules are set to `error` in `eslint.config.js`.
- [ ] All 11 targeted rules report zero violations across the repository.
- [ ] `KioskRoute.tsx` has no conditional effects and retains all timer/listener cleanup; `UserProfile.tsx` has no conditional memo hook.
- [ ] `prefer-const`, `no-useless-escape`, `no-case-declarations`, `no-unused-vars`, and `no-explicit-any` each report zero violations.
- [ ] No new lint disables, blanket ignores, rule exceptions, or rule-option weakening are introduced to conceal debt.
- [ ] The one unrelated `no-unused-expressions` CI blocker is fixed.
- [ ] `IMAGINATION_STATION_DPI_PATCHES.tsx` and `handlersToAdd.ts` are deleted; the two documentation-referenced snippet files are retained with a clear handoff justification and remain the only root snippet ignores.
- [ ] `npm run typecheck`, `npm test`, and `npm run build` pass.
- [ ] The handoff references Watchtower task `442a6ab4-875c-443c-ba84-72c2e3917dde`, records the fresh counts, exact files changed, verification, snippet decision, risks, commit hash, and any follow-up task IDs.

## Commands
```powershell
# Baseline / iterative lint (root command also covers backend)
npm run lint

# Safe mechanical pass; inspect the diff immediately afterward
npm run lint -- --fix

# Focused hook verification
npx eslint src/components/KioskRoute.tsx src/pages/UserProfile.tsx

# Required final verification from repo scripts
npm run lint
npm run typecheck
npm test
npm run build

# Review only this task's changes before the explicit-path commit
git status --short
git diff --check
git diff --stat
```

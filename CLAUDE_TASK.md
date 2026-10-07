# Claude Task Brief

## Request
Imagine Studio Step Flow follow-ups (Watchtower task 934dd6ed-6ae3-44a9-8658-5cfbdab0414b):
1. `etsy-seo-composer` should ingest `step_flow.colors.extras`, not just `metadata.shirt_color`.
2. Verify/fix the product details card re-rendering after a product-shot redo.
3. Add an E005 (Replicate content-safety refusal) rephrase/retry path to `DesignStep`.
4. Live-test Publish + the Etsy queue step on a throwaway product, post-deploy.

Note: this file previously held a stale brief from an unrelated, already-completed
task (a September 2026 Etsy weekly-review email report) — left over from a prior
commit to main that never reset it. Replaced here per the project's own working
rule ("update TASK_NOTES.md scope first, with rationale, before proceeding").

## Repo detection
Vite + React + TypeScript storefront with a Node/Express backend, Supabase, and a
step-flow product builder under `src/components/studio/` + `backend/services/step-flow/`.

## File shortlist (approved scope — 2026-09-23 step-flow follow-ups)
- `backend/services/etsy-seo-composer.ts` / `.test.ts`
- `backend/services/step-flow/shots.ts` / `.test.ts`
- `src/components/studio/DesignStep.tsx` / `DesignStep.test.tsx` (new)
- `src/components/studio/stepFlowReducer.ts` / `.test.ts`
- `CLAUDE_TASK.md`, `TASK_NOTES.md`

## Plan
1. Read `defaultColorsFor` in etsy-seo-composer.ts; extend it to prefer
   `step_flow.colors.{primary,extras}` over the single `shirt_color` field,
   mapping ColorId -> Etsy display label via `catalog-capability.ts`'s `COLORS`.
2. Trace the details-card redo path in `resolveStepFlow` (shots.ts): found the
   source shot's redo and the details re-render are decided in the SAME poll
   when both process in one `resolveStepFlow` call, but the 'details' branch
   read a stale in-memory snapshot of the source shot captured before the loop
   started — so a poll that resolves the redone source shot to 'done' still
   sees it as non-terminal for 'details', skips the re-render, and because
   BOTH shots then read as terminal to the client's `hasNonTerminalWork`, the
   poll loop stops before a next poll would ever retry it. Fixed by writing
   each `patchShotState` result back onto the in-memory `stepFlow.shots[key]`
   so later keys in the same loop see fresh data.
3. Added `getFailedDesignJob` / `isSensitivePromptError` / `softenDesignPrompt`
   selectors to stepFlowReducer.ts, and a rephrase panel in DesignStep.tsx that
   shows when the only design-generation job failed with an E005-shaped error,
   reusing the existing Tweak (fresh-draft-with-edited-prompt) mechanism.
4. Filed an APPROVAL (David: customer-facing go-live) instead of running a live
   Etsy publish myself — see TASK_NOTES.md and the handoff for the task id.

## Acceptance criteria
- [x] SEO composer output includes metadata for all configured extra colors.
- [x] Details card re-renders cleanly after a product-shot redo (regression test added).
- [x] E005 sensitivity error triggers an explicit rephrase panel in DesignStep.
- [ ] Live publish/Etsy-queue test on a throwaway product — deferred to a filed
      approval (customer-facing go-live on the real Etsy shop); see handoff.

## Commands
- `npx vitest run backend/services/step-flow backend/services/etsy-seo-composer.test.ts src/components/studio`
- `npx tsc -p tsconfig.app.json --noEmit`
- `npx eslint <touched files>`

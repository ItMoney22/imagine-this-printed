# Claude Task Brief

## Request
- Watchtower task `28ab467c-9149-42f2-a780-e5ea9a6077b7`: implement Jev product-kind classification, dry-run comparison, pipeline integration, and tests.
- `AGENTS.md` restricts Codex output to this brief and `TASK_NOTES.md`; application edits require explicit scope expansion.

## Repo detection
- Vite/React/TypeScript frontend and Node/TypeScript backend. Root scripts provide test/typecheck/build; backend scripts provide typecheck/build.
- Actual paths differ from dispatch: tiers is in `backend/shared`, approvals in `backend/routes/admin`, and admin category setter in `backend/services`.

## Relevant files
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\dr-dill\implement-jev-product-ki-28ab467c-mue3c3os\backend\services\etsy-copy-repair.ts`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\dr-dill\implement-jev-product-ki-28ab467c-mue3c3os\backend\services\etsy-seo-composer.ts`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\dr-dill\implement-jev-product-ki-28ab467c-mue3c3os\backend\routes\admin\user-product-approvals.ts`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\dr-dill\implement-jev-product-ki-28ab467c-mue3c3os\backend\shared\etsy-tiers.ts`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\dr-dill\implement-jev-product-ki-28ab467c-mue3c3os\backend\services\ai-product.ts`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\dr-dill\implement-jev-product-ki-28ab467c-mue3c3os\src\lib\product-kind.ts`

## Files to edit (STRICT)
- Current Codex scope: `D:\watchtower-dispatch-worktrees\imagine-this-printed\dr-dill\implement-jev-product-ki-28ab467c-mue3c3os\CLAUDE_TASK.md` and `D:\watchtower-dispatch-worktrees\imagine-this-printed\dr-dill\implement-jev-product-ki-28ab467c-mue3c3os\TASK_NOTES.md` only.
- Proposed scope after explicit expansion: the application files above, one shared backend classifier, one catalog dry-run script, and focused adjacent tests. Record exact paths in `TASK_NOTES.md` before editing.

## Plan
1. Read `jev-decisions` and inspect category data, admin override provenance, deterministic checks, and review-state mechanism.
2. Build one multi-option Jev evaluator with written descriptions for `hoodie`, `tee`, `youth_tee`, `metal`, `transfer`, `3d`, `tumbler`, `other`; return confidence and provenance. Jev takes no destructive action.
3. Run a read-only real-catalog dry-run and report Jev-versus-heuristic disagreements, ambiguity, and admin overrides before switching.
4. Preserve admin categories unconditionally. Route low-confidence items to human review; retain deterministic fallback if Jev is bypassed or offline. Document threshold and rationale.
5. Integrate four pipelines; test options, precedence, gating, and fallback; run TypeScript checks.

## Acceptance criteria
- [ ] Real-catalog dry-run produces detailed disagreement report before switching.
- [ ] Explicit admin category wins; low-confidence rows enter human review.
- [ ] Deterministic checks remain operational if Jev is unavailable.
- [ ] Four named pipelines consume shared classification safely.
- [ ] Focused tests pass and frontend/backend TypeScript checks have zero errors.

## Commands
- `npm test -- --run backend/services/etsy-copy-repair.test.ts backend/services/etsy-seo-composer.test.ts backend/shared/etsy-tiers.test.ts src/lib/product-kind.test.ts`
- `npm run typecheck`
- `npm --prefix backend run typecheck`
- `git diff --check -- CLAUDE_TASK.md TASK_NOTES.md`
- `git status --short`

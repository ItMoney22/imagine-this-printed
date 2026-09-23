# Claude Task Brief

## Request
- Watchtower task `7ea1aa2a-6a88-4353-bf43-e080a2348b45`: finish abandoned-cart recovery service, hourly worker, Resend sender, tests, and admin Orders copy.
- Correction: commit `524f8549` on `earth/zero-nine/order-payment-truth` already implements these surfaces. Assess and land that existing work before considering any new implementation.

## Repo detection
- Vite/React/TypeScript storefront, Node/Express backend, Supabase/Postgres, and a Render background worker.
- Current branch: `earth/zero-nine/implement-abandoned-cart-7ea1aa2a-mue0n06n`; clean before this scout. The existing implementation is on a separate branch.
- `AGENTS.md` limits Codex's repo writes to this brief and `TASK_NOTES.md`. Its scope-expansion rule requires explicit user confirmation before any implementation or merge work.

## Relevant files
- Read first: `AGENTS.md`, `CLAUDE.md`, `TASK_NOTES.md`, `backend/lib/abandoned-cart.ts`, `backend/worker/index.ts`, and `backend/package.json`.
- Inspect existing branch version of `backend/services/abandoned-cart.ts`, `backend/services/abandoned-cart.test.ts`, `backend/worker/ai-jobs-worker.ts`, `backend/utils/email-marketing.ts`, and `src/pages/OrderManagement.tsx` before changing anything.
- `supabase/migrations/20260728140100_abandoned_cart_reminders.sql` defines stage deduplication.

## Files to edit (STRICT)
- Currently authorized for Codex: `CLAUDE_TASK.md` and `TASK_NOTES.md` only.
- Proposed implementation scope after explicit expansion: merge/land the existing `earth/zero-nine/order-payment-truth` branch, then change only files shown by a concrete gap review. Do not create a second abandoned-cart service.

## Plan
1. Obtain explicit confirmation to expand the `AGENTS.md` repo edit scope before merging or changing implementation files.
2. Review the existing branch against current main and the task criteria; resolve only actual gaps or conflicts.
3. Verify missing-email handling, suppression and unsubscribe behavior, first/second stages, dedupe, worker timing, and admin copy through focused tests and typechecks.
4. Keep customer-facing sending disabled until a separately verified go-live approval; record precise remaining deployment steps.

## Acceptance criteria
- Existing implementation is integrated once, with no duplicate service.
- Pending unpaid carts with a usable email can receive first and second reminders at 4h and 24h, within 7 days; missing email and suppressed recipients receive none.
- Reminder stage records prevent duplicate sends, including overlapping sweeps.
- Render worker runs the sweep hourly with errors contained; admin copy accurately reflects deployed behavior.
- Focused tests and backend/frontend typechecks pass; production activation is verified separately.

## Commands
- `git show --stat --oneline 524f8549`
- `git diff --check -- CLAUDE_TASK.md TASK_NOTES.md`
- `npm --prefix backend run typecheck`
- `npm run typecheck`
- `npx vitest run backend/lib/abandoned-cart.test.ts backend/services/abandoned-cart.test.ts`
- `git status --short`

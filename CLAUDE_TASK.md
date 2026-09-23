# Claude Task Brief

## Request
Tune Jev triage priority scoring and mailbox internal-sender handling (Watchtower
task 09d844e1-18d4-4557-b993-f7e12de082d9), found during live verification of the
first Jev triage ship (task 6ff6495c):
1. A real damaged-print contact-form ticket got category `wrong_or_damaged` @0.89
   right but Jev's own priority call answered `low` @0.78 — only the deterministic
   `keyword:damaged` floor and the category-based elevation saved it.
2. `wecare`'s own ops reports / new-ticket alerts and David Trinidad's own mail
   were labelled `customer_issue`/`newsletter`/`spam` on `?triage=1`.

Note: this file previously held a stale brief from an unrelated, already-completed
task (Imagine Studio Step Flow follow-ups) — left over from a prior commit to main
that never reset it. Replaced here per the project's own working rule ("update
TASK_NOTES.md scope first, with rationale, before proceeding").

## Repo detection
Vite + React + TypeScript storefront with a Node/Express backend and Supabase; the
Jev triage lane lives in `backend/lib/jev.ts` + `backend/lib/jev-triage.ts`, wired
into support ticket intake, the shared mailbox (`?triage=1`) and Etsy buyer notes.

## File shortlist (approved scope — 2026-09-23 Jev triage tuning)
- `backend/lib/jev-triage.ts`
- `backend/lib/jev-triage.test.ts`
- `backend/scripts/jev-triage-eval.ts` (re-run only, not edited)
- `docs/reports/jev-triage-eval-2026-09-23.md`
- `CLAUDE_TASK.md`, `TASK_NOTES.md`

(This branch had diverged from `origin/main` — `jev-triage.ts` did not exist here
until merging `origin/main` in; that merge also touched
`src/components/studio/DesignStep.tsx` and `TASK_NOTES.md` to resolve two
conflicts. See the work log for detail.)

## Plan
1. Reword `SUPPORT_PRIORITY_CRITERIA` so `high` explicitly names damaged/defective
   goods (not just billing/refund/order-missing/bulk), and so neither `high` nor
   `low` can be read as "calm wording means it's not serious."
2. Add an `internal` `EmailLabel` and a deterministic floor in `emailFloor()` for
   `@imaginethisprinted.com` senders and addresses containing `davidltrinidad`.
3. Add unit tests for both, including the exact no-keyword-floor damaged case and
   a fake-Jev-guesses-wrong-but-floor-wins case for the internal sender.
4. Re-run `backend/scripts/jev-triage-eval.ts` against the original ship's dataset
   (recovered from that session's scratchpad) and confirm no regression + 14/14
   reply-needed recall.

## Acceptance criteria
- [x] Contact-form tickets regarding cracked, peeling, or damaged prints score
      `high` priority (proven by a no-keyword-floor unit test, since the live
      example itself also trips the keyword floor).
- [x] Internal ops reports, new-ticket alerts, and David Trinidad's mail are not
      mislabeled as customer_issue, newsletter, or spam (unit-tested; NOT
      re-verified against the live mailboxes from this worktree — no creds here).
- [x] `backend/scripts/jev-triage-eval.ts` passes with 14/14 recall on
      reply-needed tickets.
- [x] All unit tests in `backend/lib/jev-triage.test.ts` pass cleanly (29/29).

## Commands
- `npx vitest run backend/lib/jev-triage.test.ts`
- `npx tsc -p tsconfig.json --noEmit` (backend), `npx tsc -p tsconfig.app.json --noEmit` (frontend)
- `npx eslint backend/lib/jev-triage.ts backend/lib/jev-triage.test.ts`
- `npx tsx scripts/jev-triage-eval.ts <dataset.json>` (from `backend/`, needs `OPENROUTER_API_KEY`)

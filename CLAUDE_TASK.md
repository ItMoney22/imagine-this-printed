# Claude Task Brief

## Request
- Watchtower task `553190bc-9dd2-416d-8c58-e4c0d7b702cf`: make all backend ITC wallet balance changes atomic, ledger-consistent, and safe under concurrent debits.
- This Codex run is restricted by `AGENTS.md` to this brief and `TASK_NOTES.md`. Implementation needs explicit scope expansion before Codex may edit backend files.

## Repo detection
- Imagine This Printed: React/Vite frontend, Express/TypeScript backend and worker, Supabase PostgreSQL.
- Existing `supabase/migrations/20260428_decrement_itc_atomic.sql` defines a debit-only RPC. The migration ledger records it as never applied at its last audit; `backend/routes/wallet.ts` falls back to unsafe read-then-write when absent. Recheck live schema before deployment.
- `supabase/migrations/README.md` requires a new, uniquely timestamped migration. Do not edit an applied migration.

## Relevant files
- Read first: `AGENTS.md`, `CLAUDE.md`, `supabase/migrations/README.md`, `supabase/migrations/MIGRATION_LEDGER.md`, `supabase/migrations/20260428_decrement_itc_atomic.sql`, `supabase/migrations/20260810_lock_wallet_balance.sql`, `backend/routes/wallet.ts`, `backend/services/order-refunds.ts`, `backend/worker/ai-jobs-worker.ts`.
- Search every backend balance write. Additional observed writers include `backend/routes/{admin/wallet,community,designer,gift-cards,imagination-station,realistic-mockups,stripe,tryon,user-products}.ts`, `backend/services/{creator-margins,imagination-pricing,order-payment,referral-service,stripe-connect,user-royalties}.ts`. Search may reveal more, including indirect or raw SQL paths.

## Files to edit (STRICT)
- Codex approved now: `CLAUDE_TASK.md` and `TASK_NOTES.md` only.
- Implementation scope requested but pending explicit expansion: a new `supabase/migrations/YYYYMMDDHHMMSS_*.sql`; one backend wallet helper and its tests; backend route, service, and worker writers identified above; relevant existing tests. Add any newly discovered file to `TASK_NOTES.md` with rationale before editing it.
- Use absolute paths for every created or edited file. Do not touch the shared checkout.

## Plan
1. Verify actual database schema, constraints, grants, existing RPCs, and ledger columns; inventory all `itc_balance` writes and their business semantics, including fallback, compensation, and duplicate webhook paths.
2. Add an atomic RPC that updates the current wallet row under PostgreSQL row locking, rejects invalid amounts and insufficient funds, and returns a predictable result. Put balance update and `itc_transactions` insert in the same function transaction, with a unique idempotency key for retried economic events; resolve the live ledger schema first. Restrict RPC execution to the backend service role.
3. Add a typed backend helper for debit, credit, and idempotent ledger creation. Preserve each caller's response and refund behavior while replacing every read-compute-write balance mutation. Do not use a stale balance to compensate another operation.
4. Add database-backed concurrency tests: simultaneous debits against funds for one, mixed credits/debits without lost updates, rejection with unchanged balance, ledger failure rollback, and duplicate event replay. Update affected route/worker tests.
5. Verify source audit, tests, backend typecheck, root lint, and migration behavior. Commit only owned files on the existing branch and report exact verification and deployment status.

## Acceptance criteria
- No JavaScript read-then-write `itc_balance` balance mutation remains in `backend/`, including fallback and compensation paths.
- Overdraw or invalid amount fails inside PostgreSQL with a stable error/status and no balance or ledger change.
- Two concurrent debits where funds cover only one yield exactly one success; no lost credit/debit updates or duplicate economic-event credit.
- Every successful balance adjustment has the matching ledger row in the same transaction; ledger failure rolls back the balance.
- Relevant backend tests, typecheck, and lint pass. Live migration status and any unshipped branch work are stated accurately.

## Commands
- `rg -n "itc_balance|decrement_itc|itc_transactions" backend supabase/migrations`
- `npm test` (root script: `vitest run`)
- `npm run typecheck --prefix backend`
- `npm run lint`
- `git diff --check -- CLAUDE_TASK.md TASK_NOTES.md`
- `git status --short`

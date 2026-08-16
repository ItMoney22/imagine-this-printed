# Claude Task Brief

## Request
- Watchtower task `fb5d3899-7457-42bc-828a-51348cb01ce9`: merge and deploy the remaining transactional-email integration, then apply its production Supabase migration.

## Repo detection
- React/Vite frontend with an Express/TypeScript backend, GitHub `main`, Render backend deployment, and Supabase PostgreSQL.

## Relevant files
- `AGENTS.md`
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- `backend/utils/email.ts`
- `backend/routes/stripe.ts`
- `backend/routes/admin/user-product-approvals.ts`
- `backend/routes/admin/email-templates.ts`
- `backend/services/emailAI.ts`
- `supabase/migrations/20260816000000_deactivate_unwired_email_templates.sql`

## Files to edit (STRICT)
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- Do not edit repository implementation files.

## Plan
1. Confirm PR #7 merges the Amelia branch and preserves main's order-status-link enhancements.
2. Confirm Render runs merged main commit `64d6a0c` and the health endpoint succeeds.
3. Apply the migration transactionally to production and query the active template rows.

## Acceptance criteria
- [x] PR #7 merged to `main` as `64d6a0c48f1f754a12b81eef24716ed33b3800d8`.
- [x] Render backend deploy `dep-da12l1lr1llc73egd050` is live on that commit; `/api/health` returns 200.
- [x] The merged code routes all stated transactional types through `generateAIEmail` with fallbacks, sends `itc_purchase`, uses `/product/:id`, and filters active templates.
- [x] Production migration ran in a transaction: zero unwired active templates existed before or after, so zero rows changed as expected.
- [x] CI typecheck and build passed; lint has one unrelated pre-existing `no-unused-expressions` error in `src/hooks/useMrImagineVoice.ts:185`.

## Commands
- `gh pr view 7 --repo ItMoney22/imagine-this-printed`
- `node scripts/render-trigger-deploy.mjs` (Render returns an empty successful response; verify via its deploy API.)
- Production SQL was applied from the committed migration using the ITP pooler in one `BEGIN`/`COMMIT` transaction.

# Claude Task Brief

## Request
- Apply the additive `orders.shipping_label_url` production migration for Watchtower task `974998d9-6353-44b2-bb39-07211378cf08`.

## Repo detection
- Vite/React frontend with Express/TypeScript backend, Supabase PostgreSQL, and Prisma 5.22.
- The reviewed migration exists on commit `9b87aac`, not on the current `main` branch/worktree.

## Relevant files
- `AGENTS.md`
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- `backend/prisma/schema.prisma`
- `supabase/migrations/001_initial_schema.sql`
- Migration source: `git show 9b87aac:supabase/migrations/20260726_order_shipping_label.sql`

## Files to edit (STRICT)
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- Do not edit implementation or migration files in this worktree.

## Plan
1. Run the recovered reviewed SQL against production using Prisma 5.22 and the backend Prisma schema.
2. Assert, within the migration transaction, that `orders.shipping_label_url` is `TEXT` and that `idx_orders_shipping_label_url` is a valid partial index for non-null label URLs.
3. Record the deployed-code gap: `origin/main` and the public production bundle do not contain the persistence commit.
4. Merge/deploy commit `9b87aac`, then perform an approved real Shippo label purchase and confirm the URL persists.

## Acceptance criteria
- [x] Production `public.orders.shipping_label_url` exists as `TEXT`.
- [x] Valid partial index `idx_orders_shipping_label_url` exists for non-null label URLs.
- [x] Migration SQL executed successfully through Prisma 5.22 in a transaction.
- [ ] Live Shippo purchase verified after persistence code merge/deploy; tracked by Watchtower follow-up `a05ddd01-1b48-40ea-a64a-a7b571407bfd`.

## Commands
- Executed: `npx --yes prisma@5.22.0 db execute --stdin --schema backend/prisma/schema.prisma` with `DATABASE_URL` loaded privately from the production backend environment.
- No build is required for this schema-only operation.

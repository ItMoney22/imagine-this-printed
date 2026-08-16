# Claude Task Brief

## Request
- Watchtower task `7194f6fe-7f92-40a5-8dee-c41a986aa60a`: finish replacing the mock/random product recommender with real co-purchase frequency data and a nightly refresh.
- The current branch is only partially complete: the dead collaborative-filtering functions are gone and a table/reader exist, but the refresh is an unscheduled TypeScript full-table job, multi-anchor scoring is client-side, and cold-start ranking still uses `Math.random()`.
- Deliver a database-native, SQL-ranked implementation with no LLM or external model inference.

## Repo detection
- Vite + React + TypeScript storefront using the browser Supabase client.
- PostgreSQL/Supabase migrations are canonical under `supabase/migrations/`; migration files may already be live and must not be edited in place.
- `ProductRecommendations` is the shared renderer on Home, Cart, ProductPage, VendorStorefront, and RecommendationsDashboard.
- Existing partial work is committed on the current baseline; build forward from it rather than recreating the old audit findings.

## Relevant files
- `AGENTS.md`, `CLAUDE.md`, `TASK_NOTES.md`
- `src/utils/product-recommender.ts`
- `src/components/ProductRecommendations.tsx`
- `backend/scripts/refresh-product-copurchase.ts`
- `backend/scripts/refresh-product-copurchase.test.ts`
- `supabase/migrations/20260728_product_copurchase.sql` (read-only historical migration)
- `supabase/migrations/README.md`
- `package.json`, `backend/package.json`

## Files to edit (STRICT)
- `src/utils/product-recommender.ts`
- `src/components/ProductRecommendations.tsx`
- `backend/scripts/refresh-product-copurchase.ts` (delete after the SQL job supersedes it)
- `backend/scripts/refresh-product-copurchase.test.ts` (delete or replace with coverage for the shipping SQL/RPC contract)
- One NEW, uniquely timestamped migration under `supabase/migrations/`; do not edit `20260728_product_copurchase.sql`.
- One focused recommender test file may be created beside the utility/component if needed.
- `CLAUDE_TASK.md` and `TASK_NOTES.md` only for milestone logging.
- Do not edit page layouts or unrelated recommendation consumers.

## Plan
1. Probe the live database shape before writing SQL: confirm `orders.payment_status`, `order_items.order_id/product_id`, `pg_cron` availability, and whether the existing table/function/schedule are already deployed. Do not trust the legacy initial-schema columns alone.
2. Add a new idempotent migration that preserves the directional schema `(product_id, co_product_id, purchase_count, updated_at)`, primary key, and ranked index. Add a `SECURITY DEFINER` refresh function with a locked `search_path` and revoked public execute access.
3. Materialize pairs entirely in PostgreSQL: self-join distinct `(order_id, product_id)` rows on the same paid order, require different product IDs, group by the directional pair, and `COUNT(DISTINCT order_id)`. Refresh transactionally so readers never see a partially filled table.
4. Schedule the refresh in Supabase `pg_cron` at 03:15 UTC nightly using a stable named job. Make reruns idempotent and run the refresh once during migration so the table is populated immediately. If `pg_cron` is unavailable in the actual project, retain a thin service-role runner and add the repo's existing scheduler convention; do not leave another "NOT wired" script.
5. Add a stable SQL RPC for request-time ranking. For anchor IDs, sum `purchase_count` by `co_product_id`, exclude anchors/request exclusions, join only active products, and order by total frequency with a deterministic tie-breaker. With no anchors (Home/VendorStorefront/dashboard), rank globally from aggregate co-purchase frequency; use a deterministic active/featured fallback only when the table has no usable data.
6. Change `getRecommendations` to call the SQL RPC and map returned products. Remove remaining mock/write-only behavior, mock impression code, and random ranking where external callers allow it; preserve public click tracking only if it remains genuinely used.
7. Make `ProductRecommendations` cache keys/dependencies include current-product ID, sorted cart product IDs, exclusions, and category/context inputs. The present page/user/limit-only key leaks recommendations between different product/cart contexts.
8. Add focused tests for directional frequency counts, duplicate line-item de-duplication, paid-order filtering, exclusions, multi-anchor summing, global no-anchor ranking, deterministic ties/fallback, RPC failure fallback, and anchor-aware cache identity. Verify each of the five shared consumer pages still passes the intended context.
9. Explain the frequency join in the handoff and report the actual scheduler/table/function names, live migration status, query plan, and measured latency.

## Decisions / assumptions
- Scheduler: database-native Supabase `pg_cron`, 03:15 UTC nightly. This avoids external secrets and keeps data refresh beside the SQL it materializes.
- Schema: directional rows with UUID `product_id` and `co_product_id`, integer `purchase_count`, and `updated_at`; primary key `(product_id, co_product_id)` plus `(product_id, purchase_count DESC, co_product_id)` for stable indexed lookup.
- Purchase signal: only orders whose live payment state proves payment; exclude pending, failed, cancelled, disputed, and fully refunded orders. Decide how partial refunds count after inspecting live line-level refund data and document it.
- Performance target: storefront recommendation RPC p95 under 200 ms for `limit <= 12`, bounded inputs, no `order_items` scan or model call at request time. Confirm with `EXPLAIN (ANALYZE, BUFFERS)` against representative data.
- SQL frequency join: de-duplicate product IDs within each paid order, self-join that set by `order_id` where left product differs from right product, then count distinct orders per directional pair. Read-time SQL sums those precomputed counts across all current anchors and returns the highest-frequency active products.

## Acceptance criteria
- [ ] The five named mock collaborative-filtering functions remain absent from `src/utils/product-recommender.ts`.
- [ ] No `Math.random()`, demo fixture, fake product/user, write-only in-memory behavior store, or mock recommendation-impression path remains in the recommender.
- [ ] `product_copurchase` exists with directional counts derived only from real, paid `order_items` data and is populated immediately.
- [ ] A real nightly schedule is installed and verifiable; no source comment says scheduling is still unwired.
- [ ] Refresh materialization and request-time ranking are SQL-based; the browser does not fetch all pair rows to aggregate/sort them.
- [ ] Anchored surfaces use co-purchase patterns; unanchored Home/VendorStorefront/dashboard surfaces use global co-purchase frequency before deterministic cold-start fallback.
- [ ] Cache identity cannot reuse recommendations across different current products, carts, exclusions, or category contexts.
- [ ] The RPC is least-privilege, deterministic, input-bounded, indexed, and meets the stated latency target on representative data.
- [ ] Focused tests, frontend typecheck/build, and backend typecheck pass.
- [ ] The final handoff references task `7194f6fe-7f92-40a5-8dee-c41a986aa60a` and briefly explains the SQL frequency join and scheduling assumption.

## Commands
- `npm test -- --run <focused recommender test file>`
- `npm run typecheck`
- `npm run build`
- `npm --prefix backend run typecheck`
- Use the repo's documented Supabase workflow to apply/verify the new migration; first inspect live objects and migration history, then verify the cron row, materialized counts, RPC results, and `EXPLAIN (ANALYZE, BUFFERS)` output.

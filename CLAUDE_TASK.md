# Claude Task Brief

## Request
- Watchtower task `767f74d4-80d5-49bb-a703-481f056f7f93`: ingest exact Jiffy Shirts costs for every active catalog garment variant and price each selection as `(blank cost x 1.20) + existing decoration cost`.
- Add an admin margin inspector and executable sync instructions. Preserve the existing decoration component; replace only the flat/hard-coded blank component.

## Repo detection
- Vite + React + TypeScript storefront, Express TypeScript backend, and Supabase/PostgreSQL migrations.
- Current blank pricing is not database-normalized: `backend/shared/blank-line.ts` contains a September 2 Jiffy snapshot and a 10% constant; `backend/scripts/seed-blanks.ts` writes a retail matrix to `products.metadata.garment.pricing`; `backend/services/order-pricing.ts` trusts that database product metadata at checkout.
- Blank inventory already has the required identity grain (`brand + style_code + color + size`) and `cost_per_unit`, but it represents stocked inventory. Keep supplier price history/current sync in a separate table so a price sync cannot mutate on-hand inventory valuation.
- Printed apparel currently uses `products.price` plus fixed garment-tier and plus-size surcharges. Once exact size/color costs are used, those surcharges must not also be charged. There is no explicit `decoration_cost` symbol in the repo, so isolate and document the preserved decoration component instead of treating the entire current product price as blank cost.
- Live house blank styles currently declared in code are Gildan 5000, Gildan 64000, Bella+Canvas 3001, and Comfort Colors 1717. The sync must discover active styles from product garment metadata at runtime rather than hard-code that list.
- Visual work must follow `D:\Projects for MetaSphere\imagine-this-printed\DESIGN.md`: semantic color tokens, Lucide icons, no emoji UI, existing container rhythm, reduced-motion support, and desktop/mobile visual QA.

## Relevant files
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\backend\shared\blank-line.ts`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\backend\shared\blank-pricing.ts`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\backend\scripts\seed-blanks.ts`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\backend\services\order-pricing.ts`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\backend\routes\stripe.ts`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\src\lib\product-kind.ts`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\src\context\CartContext.tsx`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\src\pages\ProductPage.tsx`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\src\pages\Checkout.tsx`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\src\pages\AdminDashboard.tsx`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\supabase\migrations\20260706000000_blank_inventory.sql`

## Files to edit (STRICT)
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\supabase\migrations\20260921000000_blank_variant_costs.sql` (new)
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\backend\services\blank-variant-pricing.ts` and matching test (new)
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\backend\services\jiffy-variant-sync.ts` and matching test/fixtures (new)
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\backend\scripts\sync-jiffy-variant-costs.ts` (new)
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\backend\routes\admin\blank-costs.ts` and matching route test (new)
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\backend\routes\storefront.ts`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\backend\services\order-pricing.ts` and its existing test
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\backend\routes\stripe.ts`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\backend\index.ts`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\backend\package.json`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\src\lib\api.ts`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\src\lib\product-kind.ts` and focused pricing tests
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\src\context\CartContext.tsx` and its existing test
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\src\pages\ProductPage.tsx`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\src\pages\Cart.tsx`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\src\pages\Checkout.tsx`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\src\components\admin\AdminBlankMargins.tsx` (new)
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\src\pages\AdminDashboard.tsx`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\docs\JIFFY_VARIANT_COST_SYNC.md` (new)
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\TASK_NOTES.md` (append milestone bullets only)
- Do not edit static prices in `backend/shared/blank-line.ts` as the final source of truth. They may remain only as catalog identity or an explicitly labeled emergency display fallback; server checkout must fail closed when an active garment variant lacks a current database cost.

## Plan
1. Add `blank_variant_costs` at supplier/brand/style/color/size grain using integer `cost_cents`, `currency`, `source_url`, `last_synced`, created/updated timestamps, and a unique normalized variant key. Enable RLS with service-role writes and no anonymous wholesale-cost read. Add indexes for style lookup and stale-sync inspection. If an explicit per-product decoration field is required, add/backfill it in the same migration with a documented deterministic preservation rule.
2. Build a pure pricing service using integer cents. Resolve the selected product/tier to its manufacturer style, normalize Jiffy color/size aliases, fetch the exact cost, and calculate `retail_cents = round(cost_cents * 1.20) + decoration_cents`. Blank-only products use zero decoration. Decorated apparel preserves its pre-existing decoration component; remove legacy fixed tier and plus-size charges from this path so 2XL/3XL are not double-counted. Missing style/color/size is a hard checkout error with actionable logging.
3. Build the Jiffy sync around the active Supabase catalog: query active apparel/blank rows and their garment style metadata, then fetch every offered color/size for those styles. Use the signed-in account price, not a public/list teaser; require authenticated Jiffy context if account pricing is unavailable and fail without writing partial data. Parse into a complete in-memory batch, validate positive prices and catalog coverage, then upsert the batch with one sync timestamp. Never delete last-known-good rows on a partial fetch. Include fixture-based parser tests and a dry-run/coverage report.
4. Add `npm --prefix backend run sync:jiffy-costs -- --dry-run` and the write form without `--dry-run`. Report styles, variants, missing catalog combinations, changed prices, and sync timestamp. Keep credentials in environment only and document required variable names without committing values.
5. Expose a public storefront endpoint that returns retail prices only (no wholesale costs) for a product/tier matrix, plus admin-only list/sync-status endpoints protected by `requireAuth` + `requireAdmin`. Hydrate product-page/cart pricing from that retail matrix; preserve a stable cart snapshot for display, but make `order-pricing.ts` re-fetch exact costs and decoration server-side for every payment attempt. Update Stripe order snapshots/order items to record the server-derived unit price and cost provenance, not client metadata.
6. Wire an `AdminBlankMargins` tab/panel into `AdminDashboard`. Show style, color, size, blank cost, 20% markup dollars, decoration cost, retail, profit dollars, margin percent, last sync, stale/missing/underwater status, filters, and summary counts. Use design tokens and Lucide icons; no emoji or hard-coded hex values.
7. Test exact variants (white vs color and S vs 2XL/3XL), rounding, alias normalization, missing/stale data, sync idempotency/partial failure, anonymous cost secrecy, admin authorization, product selection, cart persistence, and forged-client-price rejection. Apply the migration locally, seed fixture data, and verify product page -> cart -> checkout totals agree.
8. Run the UI at desktop and mobile widths and inspect the product selector, cart, checkout, and admin margin table. Write `docs/JIFFY_VARIANT_COST_SYNC.md` with dry-run, live sync, expected output, required environment variables, failure recovery, stale-data checks, and a safe re-run procedure.

## Acceptance criteria
- [ ] Migration applies cleanly; one row exists per active style/color/size with integer cost, source, and `last_synced`, and RLS prevents public wholesale-cost reads.
- [ ] Initial dry-run and ingest discover styles from active catalog rows and prove 100% offered-variant coverage; no partial scrape overwrites last-known-good data.
- [ ] Product page, cart, checkout display, server charge, and stored order line agree on `round(exact blank cost cents x 1.20) + preserved decoration cents` for the selected style/color/size.
- [ ] Fixed tier/plus-size charges are not stacked on variants whose Jiffy cost already includes those differences.
- [ ] A forged client price cannot alter the charge, and a missing exact variant cost blocks checkout instead of falling back to a cheaper flat price.
- [ ] Admin UI shows cost, retail, profit, margin, sync age, and missing/stale/underwater signals for every catalog variant without exposing wholesale cost publicly.
- [ ] Sync command is idempotent, has a dry-run, uses authenticated account pricing, and is documented with executable re-run and recovery instructions.
- [ ] Focused tests, backend/frontend typechecks, lint, build, schema audit, desktop QA, and mobile QA pass.

## Commands
- `npm --prefix "D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\backend" run sync:jiffy-costs -- --dry-run`
- `npm --prefix "D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\backend" run sync:jiffy-costs`
- `npm --prefix "D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm\backend" run typecheck`
- `npm --prefix "D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm" run typecheck`
- `npm --prefix "D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm" test -- backend/services/blank-variant-pricing.test.ts backend/services/jiffy-variant-sync.test.ts backend/routes/admin/blank-costs.test.ts src/context/CartContext.test.tsx`
- `npm --prefix "D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm" run lint`
- `npm --prefix "D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm" run build`
- `npm --prefix "D:\watchtower-dispatch-worktrees\imagine-this-printed\rico-fernandez\ingest-variant-jiffy-shi-767f74d4-mubkedwm" run dev:all`
- Use the repository migration workflow documented in `supabase/migrations/README.md`; do not guess a direct production apply command.

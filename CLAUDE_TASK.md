# Claude Task Brief

## Request
- Watchtower task `74650bc6-6038-4f19-97ca-c0d863419a09`: estimate checkout parcel dimensions from cart contents and quote Shippo against the smallest suitable preset, with focused tests.
- This Codex run is a scout and handoff under `AGENTS.md`. It does not implement the checkout change.

## Repo detection
- Git worktree on `earth/vinny-carbone/estimate-checkout-shippi-74650bc6-mue0mkcx`; React/Vite storefront and Express/TypeScript backend.
- `backend/routes/shipping.ts` still sends 10 x 8 x 4 inches in `/api/shipping/rates`.
- `backend/services/parcel-presets.ts` is absent here, but exists on `earth/zero-nine/shipping-station`. Check whether its commit is already merged before copying or rebuilding it. That branch defines two poly mailers and 8 x 6 x 4, 12 x 9 x 4, 14 x 12 x 6, and 16 x 12 x 10 boxes.
- `AGENTS.md` restricts Codex repo edits to this file and `TASK_NOTES.md`; implementation requires a separately authorized Claude or expanded scope.

## Relevant files
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\vinny-carbone\estimate-checkout-shippi-74650bc6-mue0mkcx\backend\routes\shipping.ts`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\vinny-carbone\estimate-checkout-shippi-74650bc6-mue0mkcx\backend\services\shipping-quote.ts`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\vinny-carbone\estimate-checkout-shippi-74650bc6-mue0mkcx\backend\services\order-pricing.ts`
- `D:\watchtower-dispatch-worktrees\imagine-this-printed\vinny-carbone\estimate-checkout-shippi-74650bc6-mue0mkcx\src\utils\shipping-calculator.ts`
- `backend/services/parcel-presets.ts` on `earth/zero-nine/shipping-station` (missing locally).

## Files to edit (STRICT)
- Codex: `D:\watchtower-dispatch-worktrees\imagine-this-printed\vinny-carbone\estimate-checkout-shippi-74650bc6-mue0mkcx\CLAUDE_TASK.md` and `D:\watchtower-dispatch-worktrees\imagine-this-printed\vinny-carbone\estimate-checkout-shippi-74650bc6-mue0mkcx\TASK_NOTES.md` only.
- Claude implementation scope, once separately authorized: the route, preset module, one small cart-to-parcel estimator service and tests, quote verifier/pricing integration, and storefront request shaping only if cart dimensions or product type are not already sent. Use absolute paths for every created or edited file. No other files without updating the approved shortlist.

## Plan
1. Verify whether the preset module and any prior checkout estimate fix already landed on another branch. Import the existing preset definitions rather than maintaining a second list.
2. Inspect cart fields that reach `/api/shipping/rates` and payment intent. Define bounded, documented size/packing heuristics for shirts, hoodies, tumblers, metal art, 3D prints, mixed carts, and missing metadata. Handle quantity, dimensions, rotation, padding, and oversize explicitly. Choose the smallest fitting eligible preset, accounting for mailer versus rigid box.
3. Share cart weight computation with the existing `computeCartWeightLb` path. Send selected preset dimensions and weight in the Shippo payload. Make fallback estimates conservative for bulky carts.
4. Bind signed quote validation to the computed parcel or a stable cart/preset fingerprint as well as weight and ZIP. A same-weight bulky cart must not reuse a small-mailer rate token. Ensure issuer and payment verifier compute from equivalent trusted fields.
5. Add focused estimator and route payload tests for single, multi-item, bulky, mixed, malformed, and same-weight/different-box carts. Optional margin audit is read-only.

## Acceptance criteria
- Checkout Shippo requests use selected preset dimensions and computed cart weight; no fixed 10 x 8 x 4 dimensions remain in the quote path.
- Known single items fit their smallest suitable preset; additional or bulky items select larger packaging. No fragile item goes in a mailer.
- A signed quote for one parcel cannot be replayed for a different estimated parcel at the same weight.
- Focused tests verify parcel selection, Shippo JSON payloads, and quote validation; backend typecheck passes.
- No customer-facing deployment is performed as part of this brief.

## Commands
- `git show earth/zero-nine/shipping-station:backend/services/parcel-presets.ts`
- `rg -n "parcels:|computeCartWeightLb|verifyShippingQuote|shipping/rates" backend/routes/shipping.ts backend/services/shipping-quote.ts backend/services/order-pricing.ts src/utils/shipping-calculator.ts`
- `npm run typecheck --prefix backend` (from `backend/package.json`)
- `npm test -- backend/services/shipping-quote.test.ts` (root `package.json` uses `vitest run`; include new focused test paths)
- `git diff --check` and `git status --short`

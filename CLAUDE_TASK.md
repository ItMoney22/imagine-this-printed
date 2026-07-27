# Claude Task Brief

## Request

- Watchtower task `2b20562c-2a8b-42a7-a39b-bae14270dc1d`: stop product-card quick add from committing a multi-location shirt to an unseen default print placement.
- Implement option A: when a card's product has more than one available print location, take the customer to that product's detail page instead of opening/using quick add. The detail page already requires print-location selection.
- Preserve one-click quick add for a product with exactly one print location, and pass that sole location explicitly to the cart so the cart/checkout/order record shows the actual fulfillment choice.

## Repo detection

- TypeScript Vite + React storefront with an Express/TypeScript backend.
- Root scripts from `package.json`: `npm run typecheck`, `npm test`, `npm run lint`, and `npm run build`.
- `ProductPage` already treats more than one `print_locations` value as a required choice and forwards it to `addToCart`. `CartContext` dedupes on and persists `printLocation`; cart and checkout already display it.
- Existing listing-card convention is an inline size/color picker rather than a forced page visit. Print location differs because a customer must deliberately choose among multiple fulfillment placements; routing to the existing product page avoids duplicating validation and UI.

## Relevant files (Claude MUST read these first)

- `AGENTS.md`
- `CLAUDE.md`
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- `package.json`
- `src/components/ProductCard.tsx`
- `src/pages/ProductPage.tsx`
- `src/context/CartContext.tsx`
- `src/types/index.ts`
- `src/pages/KioskInterface.tsx`
- `src/pages/VendorStorefront.tsx`

## Files to edit (STRICT)

- `src/components/ProductCard.tsx`
- `src/components/ProductCard.test.tsx` (new, only if the existing Vitest setup can exercise the component)
- `src/pages/KioskInterface.tsx` (only if its product feed can carry `print_locations`; otherwise document why no edit is possible and do not fabricate a default)
- `TASK_NOTES.md` (append the implementation outcome)

Do not alter the cart/order persistence pipeline, checkout, fulfillment routes, schema, or unrelated product flows unless a typecheck proves a direct integration defect. Do not modify the product page's established selection validation.

## Context from scouting

- `src/components/ProductCard.tsx` calls `addToCart(product, 1, selectedSize, selectedColor)` after its inline size/color picker. It currently omits `printLocation` entirely.
- `src/pages/ProductPage.tsx` is correct: it automatically selects a sole location, requires a selection only when `print_locations.length > 1`, and passes the selected location to both Add to Cart and Buy Now.
- `src/context/CartContext.tsx` includes `printLocation` in the cart-line dedupe key and restored order state. The cart and checkout summaries already render it.
- `KioskInterface` has a separate local `addToCart`, not the shared `CartContext`; it currently adds a product on card tap with no size, color, or location choice. Treat it as a separate one-click purchase path and avoid silently accepting a multi-location product.
- `VendorStorefront` calls the shared cart through `handleAddToCart`, but constructs a minimal wholesale `Product` with no `print_locations`; it is not a catalog-shirt print-location path unless its data model is expanded separately.

## Required call-site disposition

Account for every `addToCart(` result from the repository search in the implementation notes/handoff:

| Location | Disposition |
| --- | --- |
| `src/components/ProductCard.tsx` | Change: multi-location routes to `/product/:slugOrId`; exactly one location is passed to the cart; absent locations retain existing non-apparel behavior. |
| `src/pages/ProductPage.tsx` (Add to Cart and Buy Now) | Already correct; retain its explicit multi-location validation and sole-location preselection. |
| `src/pages/KioskInterface.tsx` | Separate local cart. If products expose locations, block/reroute multi-location choices rather than defaulting. If the feed does not expose them, document this limitation and file a follow-up rather than implying it is protected. |
| `src/pages/VendorStorefront.tsx` | Wholesale-only minimal product conversion; no print-location data is carried. Do not assign a default. Document as not applicable until wholesale products gain locations. |
| `src/pages/ImaginationStation.tsx` | Custom DTF sheet; no product print location. No change. |
| `src/pages/MetalArtStudio.tsx` | Custom metal-art item; no shirt print location. No change. |
| `src/components/3d-models/Model3DDetailModal.tsx` | Generated 3D product; no shirt print location. No change. |
| `src/pages/ToyCreator.tsx` | Generated 3D product; no shirt print location. No change. |
| `src/components/DesignStudioModal.tsx` | Custom template flow. Preserve its explicit/custom metadata behavior; no silent catalog-shirt default. |
| `src/context/CartContext.tsx` | Shared API/reducer, not a UI entry point. No change expected. |

Repeat the search before handoff and update this table if an additional call site is found.

## Plan (step-by-step)

1. Derive the product's effective locations from the existing typed field (and only an already-supported metadata fallback if the catalog data shape requires it). Define `hasMultiplePrintLocations` and `singlePrintLocation` once in `ProductCard`.
2. In the quick-add click handler, before revealing the size/color picker, navigate multi-location products to `/product/${product.slug || product.id}`. Preserve the existing product page as the sole multi-choice UI.
3. For a sole location, keep the current inline picker and call `addToCart` with that location as its final argument. Include the same value in the cart-added event detail if consumers use it.
4. Inspect the kiosk product feed and make its one-tap flow safe if it can receive locations. Do not change specialized custom-item flows merely because they call the shared cart.
5. Add focused component coverage, if test infrastructure permits, for: multi-location navigation without cart addition; single-location cart addition carrying the sole location; and an item with no locations retaining current quick-add behavior.
6. Run the required checks and report every call-site disposition plus the decision rationale in `TASK_NOTES.md`.

## Acceptance criteria

- [ ] A product with multiple print locations cannot be added from a listing card without first reaching the product page's location selector.
- [ ] A single-location product remains one-click after the existing size/color selections and stores that sole location on its cart line.
- [ ] Products with no print-location concept retain existing quick-add behavior.
- [ ] The cart line/checkout continues to visibly show any selected or auto-selected print location.
- [ ] Every `addToCart` call site is explicitly classified as changed, already protected, not applicable, or a separately tracked limitation.
- [ ] `npm run typecheck` exits cleanly.
- [ ] `npm test` passes.

## Commands to run

```powershell
rg -n -S --glob '!node_modules' "addToCart\\(" src
npm run typecheck
npm test
git diff --check
git status --short
```

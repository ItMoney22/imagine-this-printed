# Claude Task Brief
## Request
- Watchtower task `dbb7017e-8a75-4c8e-9dff-f3e14d7025f0`: fix the live 4x6 metal-art overcharge.
- Stop applying the $2.50 plus-size garment upcharge to non-garment size axes, especially 4x6 metal-art prints.
- Make the client and server changes together. Checkout has a server-side 1-cent anti-tampering gate; changing only one side can 400 legitimate carts.

## Repo detection
- JavaScript/TypeScript project with a Vite + React frontend and an Express/TypeScript backend in `backend/`.
- Pricing is split across client cart/checkout display and the authoritative backend pricing engine.
- Product-kind helpers already exist in `src/lib/product-kind.ts`; `ProductCard` already uses `productKindOf(product)` and an `isApparel` guard for its plus-size badge.
- Root commands from `package.json`: `npm test`, `npm run typecheck`, `npm run build`, `npm run lint`.
- Backend command from `backend/package.json`: `npm run typecheck`; dispatch acceptance specifically asks for `cd backend && npx tsc --noEmit`.

## Relevant files (Claude MUST read these first)
- `AGENTS.md`
- `CLAUDE.md`
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- `src/context/CartContext.tsx`
- `src/pages/Checkout.tsx`
- `src/lib/product-kind.ts`
- `src/components/ProductCard.tsx`
- `backend/services/order-pricing.ts`
- `backend/services/order-pricing.test.ts`

## Files to edit (STRICT)
- `src/context/CartContext.tsx`
- `src/pages/Checkout.tsx`
- `backend/services/order-pricing.ts`
- `backend/services/order-pricing.test.ts`
- Optional only if typecheck/import structure requires it: `src/lib/product-kind.ts`
- Do not edit unrelated product, Etsy, shipping, coupon, Stripe, or UI styling files.

## Context from scouting
- Offending condition on the client:
  - `src/context/CartContext.tsx`: `return PLUS_SIZES.some(ps => size.toUpperCase().includes(ps))`
  - `src/pages/Checkout.tsx`: `return PLUS_SIZES.some(ps => size.toUpperCase().includes(ps))`
- Offending condition on the server:
  - `backend/services/order-pricing.ts`: `return PLUS_SIZES.some(ps => upper.includes(ps))`
- Why 4x6 is overcharged: `4x6`.toUpperCase() becomes `4X6`, and the substring check matches the apparel plus-size token `4X`.
- Current server code explicitly documents this as a known mirrored bug and applies `if (isPlusSize(item.selectedSize)) { perUnitCents += PLUS_SIZE_UPCHARGE_CENTS }` to every recognized line kind after unit price resolution.
- Product kinds affected by the current server condition:
  - Real catalog UUID products from `products.price`, regardless of category.
  - `metal-art-custom-*`, including `selectedSize: '4x6'`.
  - `imagination-sheet-*` and `3d-print-*` if they carry a selected size containing a plus-size token.
  - DTF transfer catalog products can also be affected if represented as UUID catalog products with a size token that matches the substring rule.
- Existing server tests include a known-bug assertion expecting `4x6` metal art to include the $2.50 charge. Replace it with the corrected behavior.
- `ProductCard` already has a local `isApparel` guard for plus-size labels. Keep that behavior; the checkout/cart totals need the same product-kind discipline.

## Plan (step-by-step)
1. Introduce or reuse an apparel-only predicate for plus-size pricing on the client.
   - Use `productKindOf(item.product) === 'apparel'` before applying the plus-size upcharge in `CartContext.calculateTotal`.
   - Apply the same guard in `Checkout.tsx` when computing `plusSizeUpcharge`.
   - Keep the token list behavior for real apparel sizes so `2XL`, `2X`, `XXL`, `3XL`, etc. still work.
2. Update `backend/services/order-pricing.ts` so plus-size upcharge is product-kind aware.
   - Metal-art custom lines must never run the garment-size upcharge.
   - `imagination-sheet-*` and `3d-print-*` fallback lines must never run it.
   - UUID catalog lines need category/product-kind information from the server, not just price. Extend the product price dependency shape minimally so the server can decide apparel vs non-apparel for catalog products.
   - Treat unknown or missing catalog kind conservatively: only apply the upcharge when the server can classify the catalog product as apparel.
3. Keep client/server lockstep.
   - A 4x6 metal-art cart line should be `$14.99` before add-ons on both sides.
   - A 2XL apparel catalog item should still be base price + `$2.50` on both sides.
4. Update tests in `backend/services/order-pricing.test.ts`.
   - Replace the existing `KNOWN PRE-EXISTING BUG` test with an assertion that `metal-art-custom-*` + `selectedSize: '4x6'` prices at `1499`.
   - Keep or add a matching assertion that a catalog apparel product with `selectedSize: '2XL'` still adds `250`.
   - Add a non-apparel catalog regression if the dependency shape now carries category/kind, e.g. metal-art or DTF catalog UUID with `selectedSize: '4x6'` / `2XL` does not receive the garment charge unless explicitly classified as apparel.
5. Check the custom non-apparel kinds named in the dispatch.
   - Verify `3d-print-*` and `imagination-sheet-*` do not receive any plus-size upcharge after the change.
   - Verify DTF transfers only receive the charge if the product is genuinely apparel-sized; otherwise no garment charge.

## Acceptance criteria (checkboxes)
- [ ] 4x6 metal-art item prices with no plus-size upcharge on client and server.
- [ ] 2XL+ apparel item still receives the $2.50 upcharge on client and server.
- [ ] `metal-art-custom-*`, `imagination-sheet-*`, and `3d-print-*` lines never receive garment-size upcharges.
- [ ] Catalog non-apparel products do not receive the upcharge just because their size string contains `2X`, `4X`, `XXL`, etc.
- [ ] Server tests cover both the 4x6 metal-art no-upcharge case and the 2XL apparel upcharge case.
- [ ] No checkout amount mismatch over 1 cent is introduced.

## Commands to run
- `npm test`
- `cd backend && npx tsc --noEmit`
- `npm run typecheck`
- Optional after fixes if time allows: `npm run build`

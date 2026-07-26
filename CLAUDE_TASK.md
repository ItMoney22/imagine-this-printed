# Claude Task Brief

## Request

Implement Watchtower task `12da6741-eb4f-4e41-82a0-86c0bc11b0e7`: a server-side, zero-cost (“sharp-only”) print-readiness gate for every custom design before it can be added to the cart/advance into checkout. It must calculate effective DPI at the ordered size, detect transparent-vs-white background mismatches, detect too-thin strokes, estimate ink coverage, return specific customer-facing failures, and never invoke a paid image model during validation.

## Repo detection

- Vite/React/TypeScript frontend; Express/TypeScript backend with `sharp` already installed in `backend/`.
- `CartContext` adds items to localStorage only, so an add-to-cart-only client guard can be bypassed. The authoritative server boundary for the existing flow is `POST /api/stripe/checkout-payment-intent`; it receives the full cart.
- Custom artwork enters through Design Studio, Imagination Station, and Metal Art Studio. Imagination Station currently has a client-only DPI guard. `src/utils/dpi-calculator.ts` and `backend/services/halftone.ts` provide the requested related primitives.

## Relevant files (read first)

- `AGENTS.md`, `CLAUDE.md`, `CLAUDE_TASK.md`, `TASK_NOTES.md`
- `src/utils/dpi-calculator.ts`
- `backend/services/halftone.ts`
- `src/context/CartContext.tsx`, `src/types/index.ts`, `src/pages/Checkout.tsx`
- `src/components/DesignStudioModal.tsx`, `src/pages/ImaginationStation.tsx`, `src/pages/MetalArtStudio.tsx`
- `backend/routes/stripe.ts`, `backend/index.ts`, `backend/routes/designer.ts`

## Files to edit (STRICT)

- `backend/services/print-readiness.ts` (new pure Sharp-based analyzer)
- `backend/routes/print-readiness.ts` (new validate endpoint) and `backend/index.ts` (mount only)
- `backend/routes/stripe.ts` (authoritative checkout-intent revalidation; reject invalid custom artwork before order/payment-intent writes)
- `src/context/CartContext.tsx`, `src/types/index.ts` (make adding a custom design await validation and carry only the validated readiness record)
- `src/components/DesignStudioModal.tsx`, `src/pages/ImaginationStation.tsx`, `src/pages/MetalArtStudio.tsx` (supply artwork URL/data plus ordered dimensions and render returned errors)
- Tests adjacent to the new service/route, using generated in-memory image fixtures; update only the minimal test configuration if existing conventions require it.
- Do not change paid `upscale-image`, `ai/upscale`, or `image-flow/upscale` behavior. Do not add a paid-model call, database migration, new dependency, or client-only bypass.

## Context and implementation decisions

- **Thresholds (assumption):** block below 150 effective DPI, 0.5 pt minimum stroke (about 2.08 px at 300 DPI), and 85% opaque/ink coverage. Include measured values and thresholds in the response. Preserve 300 DPI as the excellent-sheet target from `dpi-calculator.ts`; this gate uses 150 DPI as the production minimum pending the related min-DPI task.
- **Background mismatch (assumption):** only enforce when the request declares `backgroundIntent: 'transparent' | 'white'`. A transparent request fails when edge-connected, near-white opaque pixels (`R,G,B >= 245`, alpha >= 250) cover >=98% of the border sample and alpha coverage is >=99%; a white request fails when >=2% of pixels have alpha <250. Omit intent for products where either background is valid.
- **Stroke detection:** implement a deterministic raster proxy, not fake vector parsing: create an alpha/ink mask, use Sharp raw pixels, and use a distance-transform/erosion-style scan to find connected ink regions whose local diameter is under the 2.08 px threshold after scaling to output resolution. Report the narrowest estimated stroke and flag the check as unavailable only for an image with no detectable ink. Never claim exact vector-stroke analysis from raster data.
- **Ink coverage:** sample the print bounding box at a bounded Sharp resolution and calculate the percentage of pixels with alpha >= 16 (transparent images) or non-white ink (white-background images). Coverage over 85% blocks as an excessive solid-ink area.
- **Server authority:** new `POST /api/print-readiness/validate` fetches only allowlisted `https:` image URLs/data images within strict byte/pixel limits, or uses the submitted snapshot; it returns `{ ok, report, failures }` without writes. The frontend calls it before dispatching a custom item. `POST /api/stripe/checkout-payment-intent` must revalidate every custom item from its supplied artwork/order dimensions and return `422 { error: 'PRINT_READINESS_FAILED', failures }` before creating/updating Stripe or orders. Do not trust a client report by itself.
- **Paid escalation:** validation must be free and must not call Replicate/OpenAI. On a DPI or stroke failure, return an `upscaleSuggestion` with the existing paid endpoint (`/api/designer/upscale-image` for eligible Design Studio input; Imagination Station's existing `/api/imagination-station/ai/upscale` where applicable). The client may offer this action only after the failure; it must never auto-invoke or debit the user.
- **Error copy:** use check-specific messages, e.g. “This design will print at 112 DPI at 11 × 14 in; upload a larger file or reduce its print size (minimum 150 DPI).”, “This design has a solid white background but this product needs transparency.”, “Fine details are about 0.32 pt; use lines at least 0.5 pt wide.”, and “About 91% of this print area is ink; reduce the solid filled area below 85%.”

## Plan

1. Add pure, unit-testable request/result types and Sharp analysis in `backend/services/print-readiness.ts`. Reuse the DPI formula/threshold vocabulary from `dpi-calculator.ts`; keep the backend source independent of browser-only modules.
2. Add an authenticated/optional-auth validation route with URL/data-image safety limits, dimension normalization, stable failure codes, and no external paid calls.
3. Make `CartContext.addToCart` asynchronous only for custom artwork. Have the three custom-design callers collect actual ordered width/height and background intent, call the gate, display returned human errors, and dispatch only on success. Keep catalog/3D-cart adds synchronous and unchanged.
4. Defend the payment-intent route: validate every custom item before any Stripe/order mutation and return a 422 payload that Checkout can render. Snapshot the resulting readiness report with the item for fulfillment traceability.
5. Add unit cases for DPI, alpha/white mismatch, thin-line, solid-coverage, valid transparent art, malformed/oversized input, and no-paid-call behavior. Add route/integration cases proving failures block both frontend validation and checkout-intent creation while valid catalog carts remain unaffected.

## Acceptance criteria

- [ ] Each custom-design add path invokes the server gate; ordinary catalog and 3D adds remain unchanged.
- [ ] Checkout-intent creation repeats validation server-side and returns actionable 422 failures before any payment/order write.
- [ ] Effective DPI uses the actual ordered print dimensions and blocks below 150 DPI.
- [ ] Transparent/white intent mismatch, thin-detail, and ink-coverage failures are deterministic, measured, and human-readable.
- [ ] The route/service invokes no paid model. Paid upscale is presented only as an explicit, post-failure suggestion.
- [ ] Valid transparent and white-background designs pass when their declared intent matches, and a valid custom design proceeds normally.
- [ ] Unit and integration tests cover each failure and the no-regression path.

## Commands to run

```bash
npm run typecheck
npm run test
npm run build
npm run lint
cd backend && npm run typecheck
```

For a local integration smoke test, start the backend with `cd backend && npm run dev`, then submit an authenticated `POST /api/print-readiness/validate` request using the token workflow in `TESTING_README.md`. Do not run a paid upscale endpoint as part of verification.

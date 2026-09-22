# Claude Task Brief

## Request

- Validate Etsy taxonomy 6617’s custom variation slot for transfer-sheet sizes.
- Live API proof is complete: draft listing `4580221283` accepted `property_id: 513`, seller-provided name `Size`, and `price_on_property: [513]` for $12/$20/$28 transfer variants.

## Repo detection

- Vite + React TypeScript storefront with a Node/Express backend; Etsy integration is implemented in `backend/services/etsy.ts`.
- This dispatch branch does not contain Zero Nine’s existing fallback implementation. It is commit `d7a42cd` on `earth/zero-nine/fix-etsy-transfer-listin-93ef1eb3-mubkh0y1`.

## Relevant files

- `AGENTS.md`
- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- `backend/services/etsy.ts`
- `backend/services/etsy-variations.test.ts`
- `backend/shared/etsy-tiers.ts`
- `backend/scripts/etsy-poc.mjs`

## Files to edit (STRICT)

- `CLAUDE_TASK.md`
- `TASK_NOTES.md`
- Do not edit Etsy code: Etsy accepted `Size` on custom slot 513, so no fallback-name change is warranted.

## Plan

1. Keep draft listing `4580221283` in `draft`; do not activate it or modify any active listing.
2. Treat the returned inventory as the live contract: three products use custom slot 513 with `property_name: Size`, values `8.5x11 inches`, `11x17 inches`, `13x19 inches`, and prices $12, $20, $28; `price_on_property` is `[513]`.
3. Merge or cherry-pick Zero Nine’s already-existing commit `d7a42cd` through the normal reviewed integration flow before relying on the production publisher; this dispatch branch predates it.

## Acceptance criteria

- [x] Exactly one Etsy listing was created as a free, invisible draft: `4580221283`.
- [x] Etsy inventory PUT returned HTTP 200; no fallback name was required.
- [x] A subsequent inventory GET returned exactly three slot-513 `Size` variants at $12, $20, and $28 and `price_on_property: [513]`.
- [x] No active listings were touched and no activation fee was incurred.

## Commands

- `node backend/scripts/etsy-poc.mjs properties --ids 6617 --raw`
- `npm test -- backend/services/etsy-variations.test.ts`
- `git branch -a --contains d7a42cd`
- `git diff --check -- CLAUDE_TASK.md TASK_NOTES.md`
- `git status --short`

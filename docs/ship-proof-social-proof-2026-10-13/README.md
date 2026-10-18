# Proof index: ITP real social proof (task 36222110)

Every claim on the card, with the file or command that proves it.

## David's ruling (closes the card)

- Approval card `7f73abaf` ("email ITP's 2 real site buyers once asking for a review"), tasks table:
  `approval_notes = "Money picked option C: Close the reviews card for now."`, `approved_by = david`,
  `approved_at = 2026-10-13T19:17:33Z`.
- Option C's stated consequence: "Fake-review removal still ships (SHIP 17330514); social proof restarts only when a
  review appears on its own."
- So no customer was emailed, and the review sections stay empty until a real review exists.

## There is nothing real to show yet (re-checked 2026-10-13 19:47Z)

| Source | Result |
|---|---|
| `node backend/scripts/import-etsy-reviews.mjs --dry-run` (19:46:45Z) | `Etsy returned 0 reviews; 0 have text and a rating.` |
| Etsy `GET /v3/application/shops/67055923` (ImagineThisPrinted1) | `review_count 0`, `transaction_sold_count 0` |
| Etsy `GET /v3/application/shops/46974694` (ImagineThisPrinted, older) | `review_count 0`, `transaction_sold_count 3` |
| ITP Supabase `reviews` table, `count=exact` | `0` rows |

## Fake reviews were live, and this branch removes them

- `before-live-vendor-storefront-390.png`: imaginethisprinted.com/vendor/storefront/&lt;anything&gt; at 390px showed a
  hard-coded vendor with "4.8 stars, 127 Reviews" (invented).
- `after-branch-vendor-storefront-390.png`: same URL on this branch is the site 404.
- `after-branch-home-390-full.png`: home at 390px renders end to end, no empty reviews block.
- Commit `3d1bc61`: route removed from `src/App.tsx`; `VendorStorefront.tsx`, `VendorDirectory.tsx`,
  `VendorStorefrontManager.tsx` deleted.

## Guard: no invented review can ship

- `src/lib/real-reviews.test.ts` scans all of `src` for hard-coded star ratings, review counts and testimonial arrays,
  and checks every entry in `src/data/realReviews.ts` has a source (`etsy` or `permissioned`), a unique `sourceRef`
  (the Etsy review id or the buyer's permission message id), no filler text, and a permission note on every photo.
- `npx vitest run src/lib/real-reviews.test.ts` on this branch, 2026-10-13: `8 passed (8)`.
- Re-proved 2026-10-13 19:48Z: with the old `VendorStorefront.tsx` restored (`git show 3d1bc61^:...`) the test fails,
  `1 failed | 7 passed`, naming `VendorStorefront.tsx:77: rating: 4.8` and `:78: reviewCount: 127`.

## Still to happen

- **SHIP 17330514** (Nine): merge this branch to main, then walk /vendor/storefront/x at 390px (expect the 404).
  Branch merge-tree is clean against origin/main 9af48d8 and local main 1f5916b.
- **When the first real review lands** (Etsy emails the shop owner): `node backend/scripts/import-etsy-reviews.mjs`
  rewrites `src/data/realReviews.ts` with the verbatim review; ship it, and the home + product sections appear on their
  own. Buyer photos only with `--with-photos`, after the buyer's OK is on record.

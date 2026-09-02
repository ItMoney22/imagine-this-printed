# Blank Shirt Lane — design (2026-09-02)

David: "i want our cust to be able to buy blanks on our site we get our shirts
from jiffy.com ... we brand our shirts so we rip the tags and put our tags we
need good better best quality and the top line ... dont use the word gilden
next level etc but you can put compared to. make sure it has the stats and
make sure you put enough on our site with a 10% markup from jiffy to us."

## What already existed on `main` (verified)
- `src/lib/garment-tiers.ts` — four locked rungs (standard / soft / premium /
  heavyweight = Gildan 5000 / Gildan 64000 / Bella+Canvas 3001 / Comfort
  Colors 1717) used as the printed-apparel quality upsell, mirrored in
  `backend/services/order-pricing.ts`.
- `isBlankProduct()` in `src/lib/product-kind.ts`, a `blanks` metadata bucket
  in `ProductCatalog.tsx` (`/catalog/blanks`), Sidebar + Footer links to it,
  `blank_inventory` tables + admin UI.
- **No blank product rows, no spec/comparison page, no Navbar link, no per-size
  pricing.** `/catalog/blanks` rendered empty.

## Decisions
1. **Four house-branded blanks, one product each.** Names carry no
   manufacturer brand; the manufacturer appears only on a "Compared to" line:
   | Tier | House name | Compared to |
   |---|---|---|
   | Good | Classic Heavy Cotton Tee | Gildan 5000 |
   | Better | Soft Ring-Spun Tee | Gildan 64000 |
   | Best | Premium Retail-Fit Tee | Bella+Canvas 3001 |
   | Top Line | Heavyweight Garment-Dyed Tee | Comfort Colors 1717 |
   The ids are the SAME ids the printed-apparel tier picker already uses, so
   the upsell picker and the blanks lane share one identity table
   (`backend/shared/blank-line.ts`).
2. **Pricing = Jiffy cost x 1.10, per size band and per colour group.** Jiffy's
   real upcharges (2XL +$3.94, 3XL +$5.61, 4XL/5XL +$6.54 on the Good tier)
   dwarf the site's flat $2.50 plus-size rule, so blanks carry their own price
   table in `products.metadata.garment.pricing` (`default` + `by_color.White`)
   and the flat plus-size upcharge and tier upcharge are skipped for blanks —
   on the client (CartContext/Checkout/Cart/ProductPage) AND in the server
   pricing engine, which is what actually gets charged.
3. **Cost basis = what David's Jiffy account pays today (logged-in price),
   not the public list price.** Captured 2026-09-02 from jiffy.com while
   signed in (the page shows "Deliver To David — Rockmart 30153"). The account
   price is 34–45% under list. Both are stored in metadata (`cost.account`,
   `cost.list`); `seed-blanks.ts --basis list` reprices in one command if the
   discount ever goes away.
4. **Colour names are Jiffy's names** (not hex) so `blank_inventory` matching
   and Jiffy reorders line up; swatch hexes live in
   `metadata.garment.colors[]` and ProductPage resolves them from there.
5. **`category: 'shirts'` + `print_locations: ['front_image']`** — satisfies
   the `products_print_locations_valid` CHECK and keeps the existing
   blank-inventory decrement (`SHIRT_CATEGORIES`) working. A single print
   location never shows the placement selector.
6. **Images**: four generated flat-lay tees in `public/blanks/` (no GCS write
   needed; Vercel serves them).

## Surfaces
- `/blanks` — the lane: hero, four tier cards, full spec/price comparison
  table, "our label" story. Reads the four live products for prices/ids.
- Navbar "Blank Tees" (desktop + mobile); Sidebar/Footer repointed to `/blanks`;
  Home section between How It Works and Featured Products.
- ProductPage (blank mode): per-size prices on the size buttons, colour
  swatches from metadata, live unit price, spec block with "Compared to".

## Not in scope / follow-ups
- Bundle ("2 for $25") eligibility is decided from CLIENT-supplied metadata in
  the server engine — pre-existing; blanks are force-ineligible server-side
  here, the general hole is filed on the board.
- `blank_inventory` rows are not seeded (ITP orders from Jiffy per order).

# Blanks Catalog Data

Structured specs and vendor pricing for the blank t-shirt lines ITP sources from JiffyShirts, for the garment-tier / blanks storefront.

## Files

- **`blanks-catalog.json`** — source of truth. One entry per style with brand, style code, fabric weight/composition (including per-color material variants), full color list, size range, single-unit street pricing per size, and the vendor's bulk-discount ladder.
- **`blanks-catalog.csv`** — one row per style: identity + fabric + sizes + colors (semicolon-joined), generated from the JSON.
- **`blanks-catalog-price-breaks.csv`** — normalized long-format pricing: one row per style per size-group per price tier, generated from the JSON. This is the shape a seed script or `price_breaks` table would want.
- **`../scripts/gen-blanks-catalog-csv.mjs`** — regenerates both CSVs from the JSON. Run `node scripts/gen-blanks-catalog-csv.mjs` from the repo root after editing `blanks-catalog.json` by hand, so the CSVs never drift from the source JSON.

## Source & capture date

Scraped read-only from **jiffy.com** (the vendor rebranded — `jiffyshirts.com` now 301-redirects permanently to `jiffy.com`, same company/account/catalog) on **2026-08-19**. No purchases, accounts, or carts were created; all data came from public product pages. Prices, color counts, and stock are vendor-set and will drift — re-scrape before trusting this for a live cost basis more than a few weeks old.

## Lines covered

| Style | Brand | Style code | Weight | Base fabric |
|---|---|---|---|---|
| Heavy Cotton | Gildan | G500 (5000) | 5.3 oz | 100% cotton (blends in heathers/antiques) |
| Softstyle | Gildan | G640 (64000) | 4.5 oz | 100% ring-spun cotton (blends in heathers/antiques) |
| Unisex Jersey | Bella + Canvas | 3001C | 4.2 oz | 100% Airlume combed & ring-spun cotton |
| Heavyweight RS | Comfort Colors | C1717 | 6.1 oz | 100% ring-spun cotton, garment-dyed |

These are the four core lines named in the task brief. Other blanks ITP orders (e.g. Gildan 18000 crewneck, Next Level 3600) were not scouted this pass — see the follow-up task filed alongside this dataset if broader coverage is wanted.

## Important: how Jiffy's "bulk pricing" actually works

Jiffy does **not** use flat per-item quantity breaks (buy 24+, get $X/unit). Its discount is applied to the **running dollar subtotal of that product line in the cart** — as the subtotal crosses $99 / $150 / $250 / $500 / $1,000 / $1,750 / $3,800, the per-unit price for every size/color in that line drops to the tier's rate. `volume_price_breaks` in the JSON captures that ladder for White, for Gray (or the nearest heather/gray colorway), and the cheapest ("from") price across all other colors — all quoted for the style's base size run (S/XS through XL; oversizes 2XL+ aren't separately laddered on the product page).

`base_price_by_size_group` is the **single-unit, White, "everyday" street price per exact size** — already discounted off `msrp_usd` before any cart-subtotal tier is reached. It is not flat across a size run: e.g. Gildan 5000 size S street-prices at $1.86 while M–XL price at $2.79, despite sharing the same $5.04 MSRP. Use the per-size rows as given rather than collapsing them.

If a seed script needs a single "quantity" number instead of a dollar threshold, divide the threshold by the relevant per-unit price to approximate a piece count — that's a derived estimate, not a number the vendor publishes directly.

## Schema notes

- All prices are USD, vendor list price at time of capture (no ITP markup applied).
- `material_variants` documents composition exceptions by color (e.g. heathers running 50/50 or 65/35 poly-cotton) — pull from here, not just `material_primary`, when composition matters for print method (sublimation, DTF, etc.).
- `color_count` is the vendor's own displayed count ("View all N colors") and matches `colors.length` for every item as of capture.
- `discount_pct` values are as displayed on the site (rounded), not independently computed, except in the derived CSV where they're recomputed from `msrp_usd`/`unit_price_usd` and should match.

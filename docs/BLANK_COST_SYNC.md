# Blank cost sync & variant pricing

**Watchtower task:** `767f74d4-80d5-49bb-a703-481f056f7f93`
**Owner of the rule:** David — *"20% markup on the exact blank cost plus decoration cost."*

> **Retail = (blank_variant_cost × 1.20) + decoration_cost**

This is the runbook for keeping storefront prices honest when Jiffy moves its
wholesale prices. Two commands, in this order, and nothing else.

---

## TL;DR — re-run the sync

From `backend/`, with `backend/.env` present:

```bash
# 1. Pull today's supplier costs into public.blank_variant_costs
npx tsx --env-file=.env scripts/sync-jiffy-costs.ts --colors all

# 2. Push those costs into storefront prices
npx tsx --env-file=.env scripts/reprice-catalog-variants.ts --dry-run   # read the table first
npx tsx --env-file=.env scripts/reprice-catalog-variants.ts            # then apply
```

Then open **Admin → Margins** and check that nothing sits in the red.

Both scripts are idempotent. Running them twice changes nothing except
`last_synced`. Running only step 1 changes no prices at all — the costs land in
the table and the storefront keeps its old numbers until step 2 stamps them.

**Cadence:** monthly, and whenever Jiffy announces an increase. The Margins
screen shows how old the oldest cost row is, so staleness is visible rather
than assumed.

---

## What the pieces are

| Piece | Path | Job |
|---|---|---|
| Cost table | `public.blank_variant_costs` | One row per supplier × style × colour × size. Service-role only. |
| Migration | `supabase/migrations/20260922170000_blank_variant_costs.sql` | Creates it. Applied to prod 2026-09-22. |
| Supplier registry | `backend/shared/jiffy-catalog.ts` | Which Jiffy style backs each tier/garment, colour aliases, youth size mapping. |
| Pricing math | `backend/shared/variant-pricing.ts` | The house rule, the stamp shape, the readers. Shared by frontend + backend. |
| Resolver | `backend/services/variant-cost-resolver.ts` | Costs → per-product retail table. Used by the repricer AND the margin view, so they cannot disagree. |
| Ingest | `backend/scripts/sync-jiffy-costs.ts` | Scrapes Jiffy, upserts the table. |
| Reprice | `backend/scripts/reprice-catalog-variants.ts` | Stamps `products.metadata.garment.variant_pricing`. |
| Storefront | `src/lib/product-kind.ts` → `lineBasePrice()` | The one storefront price answer. |
| Server re-price | `backend/services/order-pricing.ts` | Authoritative. Reads the stamp from the DB row, never from the cart. |
| Admin view | `/admin/dashboard?tab=margins` | Cost vs retail vs margin per variant. |

---

## No credentials needed

Jiffy's **public** product page renders its size grid as

```html
<input … data-catalog-number="G500" data-color="Red" data-size="M"
       data-amount="2.99" data-sku="B11007524">
```

and `data-amount` is the wholesale unit price the account pays. Verified
2026-09-22: it matched, to the cent, all four tier cost tables David captured
on 2026-09-02 while **signed in** to his Jiffy account (G500 Red: 2.99 / 6.93 /
8.60 / 9.53). The struck-through `retail-amount` on the same row is Jiffy's
MSRP and is stored as `list_usd` for context only — nothing prices off it.

So there is **no Jiffy login, session cookie or API key anywhere in this
pipeline**, and there is nothing to rotate.

### Two traps, both already handled

1. **`?ac=` takes the colour NAME, not the anchor slug.** `?ac=sport-gray`
   silently serves whatever the page defaults to (Sand, on a G640) while
   `?ac=Sport%20Gray` serves the real thing. Single-word colours resolve either
   way, which is what makes it easy to miss — black/white/navy/red all work and
   only the two-word colours come back wrong. `jiffyProductUrl()` URL-encodes
   the name.
2. **The sync refuses to write a colour the page did not actually serve.** Every
   grid row echoes its own colour; if it does not match what was asked for, the
   rows are dropped with a warning rather than filed under the wrong name.

If Jiffy reshapes that markup, `backend/scripts/sync-jiffy-costs.test.ts` fails
against the captured fixture — the parser stops rather than repricing the
catalogue off zeros. The sync also exits non-zero rather than writing an empty
result over live costs.

---

## Command reference

### `sync-jiffy-costs.ts`

| Flag | Default | What it does |
|---|---|---|
| `--dry-run` | off | Parse and print the summary table, write nothing. |
| `--colors used` | `used` | Only the colours the storefront sells. Fast (~50 fetches). |
| `--colors all` | | Every colour the mill offers (~440 fetches, a few minutes). **Use this** — a colour we don't sell today is one we might tomorrow. |
| `--colors "Black,White"` | | An explicit list. |
| `--styles G500,G185` | all 7 | Limit to some styles. |
| `--concurrency 4` | 3 | Worker pool size. Keep it polite. |
| `--source snapshot` | `jiffy-web` | Offline seed from the costs checked into `backend/shared/blank-line.ts`. Tee tiers only — no hoodie, no youth. Fallback, not a substitute. |

The seven styles it covers:

| Code | Blank | Backs |
|---|---|---|
| `G500` | Gildan 5000 Heavy Cotton | standard tee tier |
| `G640` | Gildan 64000 Softstyle | soft tee tier |
| `3001C` | Bella+Canvas 3001 | premium tee tier |
| `C1717` | Comfort Colors 1717 | heavyweight tee tier |
| `G185` | Gildan 18500 Heavy Blend | hoodies |
| `G500B` | Gildan 5000B Youth | youth sizes on a tee listing |
| `G185B` | Gildan 18500B Youth | youth sizes on a hoodie listing |

Adding a style: add a row to `JIFFY_STYLES` in `backend/shared/jiffy-catalog.ts`
(the `slug` is the `jiffy.com/<slug>.html` path) and re-run. Nothing else needs
to change.

### `reprice-catalog-variants.ts`

| Flag | Default | What it does |
|---|---|---|
| `--dry-run` | off | Print the before/after table, write nothing. |
| `--markup 20` | 20 | Override the house markup. |
| `--status active` | `active` | `all` also reprices drafts. |
| `--product <uuid>` | | Just one listing. |
| `--include-underwater` | off | Also stamp listings priced at or below their own blank. **See below.** |

---

## What repricing does and does not move

The decoration half is **derived** from the listing's existing price against
its base blank:

```
decoration_cost = listing_price − (base_blank_cost × 1.20)
```

so the base variant (standard tier, S–XL, dearest stocked colour) keeps
**exactly** the price it already has. No headline price moves. What moves is
the upcharge on the variants that genuinely cost more.

Rails that a variant-priced line now **skips**, because the table already
contains them and charging both would charge twice:

- the flat **+$2.50 plus-size** upcharge
- the flat **$3 / $5 / $7 garment-tier** ladder

Rails that still apply on top:

- the **−$3 youth markdown** — it is a deliberate price decision, not a cost
  proxy. A youth blank actually costs *more* than an adult small ($3.22 vs
  $2.99 on a Gildan), so the rule would otherwise *raise* kids' prices.
- **add-ons**, unchanged.
- **bundle lines** ("2 for $25") stay on the old flat rails entirely — that base
  price ignores the product's own price, so the flat plus-size rule is still
  the only thing covering a 3XL inside a bundle.

### Underwater listings are skipped on purpose

A listing priced at or below its own blank cannot derive an honest decoration
cost, and repricing it would **move a listed price** — David's call, not a
script's. Those are reported and left alone. `deriveDecorationCost()` floors
the derived value at `MIN_DECORATION_COST` ($6) so the stamp stays sane if one
is ever forced through with `--include-underwater`.

As of 2026-09-22 there is exactly one: **America's 250th Anniversary Hoodie**,
listed at **$15.00** against a **$15.09** Gildan 18500 — a $3.11 loss on the
blank alone in S–XL, before ink, labour, packaging or the card fee, and a
$13.45 loss in 3XL.

### Youth sizes have one blank

There is no youth Comfort Colors to buy. A youth size on any listing is a
Gildan 5000B (tee) or 18500B (hoodie), so the quality ladder is hidden when a
youth size is selected and every tier prices at the youth blank. The old flat
ladder was taking $3–$7 for a blank we never pull.

---

## Reading the Margins screen

`/admin/dashboard?tab=margins` (admin or manager).

- Listings are sorted **thinnest variant margin first** — whatever is bleeding
  is the first row on the page.
- **Margin** is retail minus the blank it prints on. It is not net profit:
  ink, transfer film, press time, packaging and the card fee all come out of
  the decoration half, and there is no cost model for those yet.
- **Variants** counts every (tier × size × colour) the listing can be sold as;
  the `(n under)` suffix is how many of those sit at or below their blank.
- **Was / Change** on the drill-down is what that exact variant charged under
  the old flat rules. It is the whole argument for the change.
- **Supplier costs → oldest sync** is the staleness figure. If it drifts past a
  month, run the sync.

---

## Verified 2026-09-22

- Migration applied to prod; RLS on, zero policies (service-role only); ledger
  row inserted into `supabase_migrations.schema_migrations`.
- `--colors all` sync wrote **3,103 variant costs** across all 7 styles.
- Repricer stamped **91 of 92** active printed apparel listings (the 92nd is
  the underwater hoodie above); 4 blank products correctly skipped.
- Re-derived every stamped variant against the live table: **27,335 variants,
  zero at or below their blank** (was: every 2XL+ premium combination).
- Average change per **adult 2XL+** variant: **+$1.48**.

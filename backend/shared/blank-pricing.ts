// Blank-garment pricing helpers — the single source of truth read by BOTH the
// storefront (src/context/CartContext.tsx, src/pages/ProductPage.tsx,
// src/pages/Checkout.tsx, src/pages/Cart.tsx) and the server checkout pricing
// engine (backend/services/order-pricing.ts), the same way backend/shared/
// promos.ts is shared.
//
// WHY blanks carry their own price table (David 2026-09-02, "10% markup from
// jiffy to us"): Jiffy's real size upcharges (2XL +$3.94, 3XL +$5.61,
// 4XL/5XL +$6.54 on the Good tier alone) dwarf the site's flat $2.50 plus-size
// rule, and white costs less than every other colour. A blank is priced
// per SIZE and per COLOUR GROUP straight off its Jiffy cost, so the flat
// plus-size upcharge and the garment-tier upcharge are both SKIPPED for a
// blank — its table already contains everything.
//
// Stored on products.metadata.garment.pricing as:
//   { default: { S: 3.29, ..., '5XL': 10.48 },
//     by_color: { White: { S: 3.07, ... } } }
// Colour keys are the Jiffy colour NAMES (products.colors holds names for
// blanks, not hexes — see backend/shared/blank-line.ts).

export type SizePriceTable = Record<string, number>

export interface BlankPricing {
  /** Price per size for every colour not listed in by_color. */
  default: SizePriceTable
  /** Colour-name → per-size override. Since 2026-10-08 every listed colour has its own table, priced off
   *  that colour's own Jiffy cost (scripts/jiffy-capture.ts). */
  by_color?: Record<string, SizePriceTable>
  /** When true, a colour listed in by_color sells ONLY the sizes in its own table: Jiffy does not carry the
   *  rest in that colour (e.g. Soft Ring-Spun Maroon has no XS or 5XL), so there is no fallback to default. */
  by_color_only?: boolean
}

/** Round a marked-up cost to whole cents. 2.99 * 1.10 = 3.289 → 3.29. */
export function markupPrice(costDollars: number, markupPct: number): number {
  const cost = Number(costDollars)
  const pct = Number(markupPct)
  if (!Number.isFinite(cost) || !Number.isFinite(pct)) return NaN
  return Math.round(cost * (1 + pct / 100) * 100) / 100
}

/** Build the stored pricing table from per-size costs + a markup. */
export function buildBlankPricing(
  cost: { default: SizePriceTable; white?: SizePriceTable | null },
  whiteColorNames: string[],
  markupPct: number
): BlankPricing {
  const mark = (table: SizePriceTable): SizePriceTable => {
    const out: SizePriceTable = {}
    for (const [size, c] of Object.entries(table)) out[size] = markupPrice(c, markupPct)
    return out
  }
  const pricing: BlankPricing = { default: mark(cost.default) }
  if (cost.white && whiteColorNames.length > 0) {
    const white = mark(cost.white)
    pricing.by_color = {}
    for (const name of whiteColorNames) pricing.by_color[name] = white
  }
  return pricing
}

/** Sizes in the S-XL band are priced off the HIGHEST cost in the band, so a one-size Jiffy sale (White S
 *  at $1.82 while M-XL were $2.79 on 2026-10-07) never sets our price; 2XL and up are priced per size. */
export const BLANK_BAND_SIZES = ['XS', 'S', 'M', 'L', 'XL']

/**
 * Pricing from each colour's OWN Jiffy cost (David 2026-10-07: "redo all our blanks based off of Jiffy's
 * pricing, 15% markup ... based off of color"). `costsByColor` holds only the sizes Jiffy carries in that
 * colour; `sizes` is the tier's size list (order + which sizes we sell at all). The default table is the
 * most common colour table, used only for a colour name that is not listed.
 */
export function buildBlankPricingByColor(
  costsByColor: Record<string, SizePriceTable>,
  sizes: string[],
  markupPct: number
): BlankPricing {
  const by_color: Record<string, SizePriceTable> = {}
  for (const [color, costs] of Object.entries(costsByColor)) {
    const band = sizes.filter(s => BLANK_BAND_SIZES.includes(s) && Number.isFinite(costs[s])).map(s => costs[s])
    const bandMax = band.length ? Math.max(...band) : null
    const table: SizePriceTable = {}
    for (const s of sizes) {
      if (!Number.isFinite(costs[s])) continue
      const cost = BLANK_BAND_SIZES.includes(s) && bandMax !== null ? bandMax : costs[s]
      table[s] = markupPrice(cost, markupPct)
    }
    if (Object.keys(table).length) by_color[color] = table
  }
  const counts = new Map<string, { n: number; table: SizePriceTable }>()
  for (const table of Object.values(by_color)) {
    const key = JSON.stringify(sizes.map(s => table[s] ?? null))
    const hit = counts.get(key)
    counts.set(key, { n: (hit?.n ?? 0) + 1, table })
  }
  const common = [...counts.values()].sort((a, b) => b.n - a.n)[0]?.table ?? {}
  return { default: common, by_color, by_color_only: true }
}

/** True when a product's metadata marks it as a blank garment (mirrors
 *  src/lib/product-kind.ts isBlankProduct — kept identical on purpose). */
export function isBlankGarmentMeta(metadata: Record<string, any> | null | undefined): boolean {
  return metadata?.garment?.blank === true || metadata?.blank_only === true
}

/** The blank price table off product metadata, or null when absent/malformed. */
export function blankPricingOf(metadata: Record<string, any> | null | undefined): BlankPricing | null {
  const p = metadata?.garment?.pricing
  if (!p || typeof p !== 'object' || !p.default || typeof p.default !== 'object') return null
  return p as BlankPricing
}

function lookupSize(table: SizePriceTable | undefined, size: string): number | null {
  if (!table) return null
  const direct = table[size]
  if (Number.isFinite(direct)) return Number(direct)
  // Tolerate case / whitespace drift ("2xl", " XL ").
  const want = size.trim().toUpperCase()
  for (const [k, v] of Object.entries(table)) {
    if (k.trim().toUpperCase() === want && Number.isFinite(v)) return Number(v)
  }
  return null
}

/**
 * Unit price (dollars) for one blank in a given size + colour. Colour lookup
 * is by name, case-insensitive; a colour with no override uses `default`.
 * Returns null when the size is not in the table — callers must treat that
 * as "cannot price", never fall back to a guess (the server hard-errors).
 */
export function blankUnitPriceDollars(
  pricing: BlankPricing | null | undefined,
  size: string | null | undefined,
  color?: string | null
): number | null {
  if (!pricing || !size) return null
  const wantColor = String(color ?? '').trim().toLowerCase()
  if (wantColor && pricing.by_color) {
    for (const [name, table] of Object.entries(pricing.by_color)) {
      if (name.trim().toLowerCase() === wantColor) {
        const v = lookupSize(table, size)
        if (v !== null) return v
        // Not carried in this colour: refuse rather than sell a shirt we cannot buy.
        if (pricing.by_color_only) return null
        break
      }
    }
  }
  return lookupSize(pricing.default, size)
}

/**
 * Per-unit BASE price for a cart line (before add-ons): a blank garment's
 * size × colour price, else products.price. The storefront's cart, checkout
 * and product page all go through this so a blank can never be shown at its
 * "from" price in one place and its real size price in another.
 */
export function lineUnitBasePrice(
  product: { price: number; metadata?: Record<string, any> | null },
  size?: string | null,
  color?: string | null
): number {
  if (isBlankGarmentMeta(product.metadata)) {
    const p = blankUnitPriceDollars(blankPricingOf(product.metadata), size, color)
    if (p !== null) return p
  }
  return Number(product.price) || 0
}

/** Lowest price in the whole table — the honest "from $X" for cards/hero. */
export function blankFromPriceDollars(pricing: BlankPricing | null | undefined): number | null {
  if (!pricing) return null
  const all = [
    ...Object.values(pricing.default),
    ...Object.values(pricing.by_color ?? {}).flatMap(t => Object.values(t))
  ].filter(v => Number.isFinite(v)) as number[]
  if (all.length === 0) return null
  return Math.min(...all)
}

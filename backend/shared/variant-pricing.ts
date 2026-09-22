// Variant-level pricing for PRINTED apparel -- the house rule, in one place.
//
//   Retail = (blank_variant_cost * 1.20) + decoration_cost
//
// WHY (Watchtower 767f74d4, David 2026-09-21). Every printed shirt and hoodie
// priced off ONE flat `products.price` plus a flat $2.50 plus-size rule and a
// flat $3/$5/$7 tier upcharge. The real supplier upcharges are nothing like
// flat:
//
//   Gildan 5000 (standard tee) .. S-XL $2.99 -> 2XL $6.93 -> 5XL $9.53
//   Comfort Colors 1717 (top)  .. S-XL $7.53 -> 2XL $11.65 -> 4XL $16.62
//   Gildan 18500 (hoodie)      .. S-XL $15.09 -> 2XL $20.36 -> 3XL $23.71
//
// so a "Top Line 5XL" collected $2.50 + $7.00 = $9.50 of upcharge against a
// blank that costs $12.62 more than the base. Every one of those sold under
// water. This module replaces the flat rails with the actual variant cost.
//
// SHAPE. Supplier COST never reaches the browser -- it is competitively
// sensitive and lives only in `blank_variant_costs` (service-role only). What
// gets stamped onto `products.metadata.garment.variant_pricing`, and therefore
// what the storefront reads, is the derived RETAIL table:
//
//   { markup_pct: 20,
//     decoration_cost: 19.4,
//     default:  { standard: { S: 23.0, ..., '3XL': 29.72 }, premium: {...} },
//     by_color: { White: { standard: { S: 22.75, ... } } } }
//
// Read by BOTH sides of the build boundary, exactly like blank-pricing.ts:
//   - src/lib/product-kind.ts (lineBasePrice)  -> product page, cart, checkout
//   - backend/services/order-pricing.ts        -> the authoritative re-price
// The server re-reads the table from the DB row, never from the cart's copy of
// metadata -- a client's metadata is exactly as forgeable as its price.

export type SizePriceTable = Record<string, number>
/** tierId -> per-size price. Garments without a tier upsell use 'standard'. */
export type TierPriceTable = Record<string, SizePriceTable>

/**
 * The house markup on the exact blank cost. David 2026-09-21: "20% markup on
 * the exact blank cost plus decoration cost". Note this is NOT the blank-lane
 * markup (BLANK_MARKUP_PCT = 10) -- a blank sold plain is a different product
 * with no art, no transfer and no press time behind it.
 */
export const HOUSE_MARKUP_PCT = 20

/**
 * The floor under a derived decoration cost. A listing priced at or below its
 * own blank cost (the $15 hoodie against a $15.09 blank) would otherwise
 * derive a NEGATIVE decoration cost and re-stamp the loss as if it were the
 * plan. The floor keeps the stamp sane; the admin margin view is what surfaces
 * the listing so a human can reprice it. Deliberately conservative -- it is a
 * guard rail, not a pricing opinion.
 */
export const MIN_DECORATION_COST = 6

export interface VariantPricing {
  /** Markup applied to the blank cost, in percent (20 = x1.20). */
  markup_pct: number
  /** The non-blank half of the price: art, DTF transfer, press labour, margin. */
  decoration_cost: number
  /** Retail per tier -> size for every colour without an override. */
  default: TierPriceTable
  /** Supplier colour NAME -> the same shape, only for colours that differ. */
  by_color?: Record<string, TierPriceTable>
  /** tierId -> supplier style code, for ops traceability (not a secret). */
  styles?: Record<string, string>
  /** When the COSTS behind this table were last pulled from the supplier. */
  synced_at?: string
  /** When this table was stamped onto the product. */
  priced_at?: string
  /** True when decoration_cost had to be floored -- the listing is underwater. */
  underwater?: boolean
}

/** Round to whole cents. 2.99 * 1.2 = 3.5879... -> 3.59. */
export function round2(n: number): number {
  return Math.round(Number(n) * 100) / 100
}

/** Retail for one variant: cost x (1 + markup) + decoration, to the cent. */
export function retailFromCost(
  costDollars: number,
  decorationCost: number,
  markupPct: number = HOUSE_MARKUP_PCT
): number {
  const cost = Number(costDollars)
  const dec = Number(decorationCost)
  const pct = Number(markupPct)
  if (!Number.isFinite(cost) || !Number.isFinite(dec) || !Number.isFinite(pct)) return NaN
  return round2(cost * (1 + pct / 100) + dec)
}

/**
 * The decoration half of an existing listing price, so repricing does NOT move
 * the price of the size/colour the listing was priced for -- it only corrects
 * every OTHER variant. Inverse of retailFromCost.
 *
 * Returns the floored value plus whether the floor had to bite, because "this
 * listing does not even cover its blank" is the single most useful thing the
 * margin view can say.
 */
export function deriveDecorationCost(
  listingPriceDollars: number,
  baseVariantCostDollars: number,
  markupPct: number = HOUSE_MARKUP_PCT
): { decorationCost: number; underwater: boolean } {
  const price = Number(listingPriceDollars)
  const cost = Number(baseVariantCostDollars)
  if (!Number.isFinite(price) || !Number.isFinite(cost)) {
    return { decorationCost: MIN_DECORATION_COST, underwater: true }
  }
  const raw = round2(price - cost * (1 + Number(markupPct) / 100))
  if (raw < MIN_DECORATION_COST) return { decorationCost: MIN_DECORATION_COST, underwater: true }
  return { decorationCost: raw, underwater: false }
}

/**
 * Normalise a size band to its HIGHEST price. Jiffy runs odd one-size promos
 * (G500 White S was $1.82 while M-XL were $2.79; C1717 S was $5.33 against
 * $7.53) and a promo that expires next week must never become the customer's
 * price. Same rule blank-line.ts already applies by hand to its captured
 * costs -- here it is code, so a sync cannot forget it.
 */
export function normaliseBand(costs: SizePriceTable, band: string[]): SizePriceTable {
  const present = band.filter(s => Number.isFinite(costs[s]))
  if (present.length === 0) return { ...costs }
  const high = Math.max(...present.map(s => Number(costs[s])))
  const out: SizePriceTable = { ...costs }
  for (const s of present) out[s] = high
  return out
}

/** The base band that a listing's headline price is quoted for. */
export const BASE_SIZE_BAND = ['XS', 'S', 'M', 'L', 'XL']

/**
 * Build the stamped retail table from per-tier per-size COSTS.
 *
 * `costs` and `whiteCosts` are tierId -> size -> cost in dollars, already
 * band-normalised by the caller (or pass `normalise: true`).
 */
export function buildVariantPricing(input: {
  costs: Record<string, SizePriceTable>
  /** Supplier colour NAME -> tierId -> size -> cost, for colours that differ. */
  costsByColor?: Record<string, Record<string, SizePriceTable>>
  decorationCost: number
  markupPct?: number
  styles?: Record<string, string>
  syncedAt?: string
  underwater?: boolean
  normalise?: boolean
}): VariantPricing {
  const markupPct = input.markupPct ?? HOUSE_MARKUP_PCT
  const priceTier = (tiers: Record<string, SizePriceTable>): TierPriceTable => {
    const out: TierPriceTable = {}
    for (const [tierId, sizes] of Object.entries(tiers)) {
      const src = input.normalise ? normaliseBand(sizes, BASE_SIZE_BAND) : sizes
      const table: SizePriceTable = {}
      for (const [size, cost] of Object.entries(src)) {
        if (!Number.isFinite(cost)) continue
        table[size] = retailFromCost(Number(cost), input.decorationCost, markupPct)
      }
      if (Object.keys(table).length > 0) out[tierId] = table
    }
    return out
  }

  const pricing: VariantPricing = {
    markup_pct: markupPct,
    decoration_cost: round2(input.decorationCost),
    default: priceTier(input.costs)
  }
  if (input.styles && Object.keys(input.styles).length > 0) pricing.styles = input.styles
  if (input.syncedAt) pricing.synced_at = input.syncedAt
  if (input.underwater) pricing.underwater = true

  if (input.costsByColor) {
    const byColor: Record<string, TierPriceTable> = {}
    for (const [colorName, tiers] of Object.entries(input.costsByColor)) {
      const table = priceTier(tiers)
      // Only keep a colour whose table actually differs from the default --
      // otherwise the stamp doubles in size for nothing.
      if (Object.keys(table).length > 0 && JSON.stringify(table) !== JSON.stringify(pricing.default)) {
        byColor[colorName] = table
      }
    }
    if (Object.keys(byColor).length > 0) pricing.by_color = byColor
  }
  pricing.priced_at = new Date().toISOString()
  return pricing
}

// ---------------------------------------------------------------------------
// Readers -- used identically by the storefront and the server.
// ---------------------------------------------------------------------------

/** The variant table off a product's metadata, or null when absent/malformed. */
export function variantPricingOf(metadata: Record<string, any> | null | undefined): VariantPricing | null {
  const p = metadata?.garment?.variant_pricing
  if (!p || typeof p !== 'object') return null
  if (!p.default || typeof p.default !== 'object') return null
  if (!Number.isFinite(Number(p.decoration_cost))) return null
  return p as VariantPricing
}

/** True when this product prices from its own variant table. */
export function hasVariantPricing(metadata: Record<string, any> | null | undefined): boolean {
  return variantPricingOf(metadata) !== null
}

/** The tier a variant-priced line should be read at when none was picked. */
export const DEFAULT_VARIANT_TIER = 'standard'

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

function tierTable(tiers: TierPriceTable | undefined, tier: string): SizePriceTable | undefined {
  if (!tiers) return undefined
  const direct = tiers[tier]
  if (direct) return direct
  const want = tier.trim().toLowerCase()
  for (const [k, v] of Object.entries(tiers)) {
    if (k.trim().toLowerCase() === want) return v
  }
  return undefined
}

/**
 * Unit retail (dollars) for one printed variant, or null when the table cannot
 * answer. Null is NEVER a licence to guess: callers fall back to the flat
 * listing price (storefront) or raise a pricing error (server), the same
 * posture blank-pricing.ts takes.
 *
 * A tier the table does not carry returns null on purpose -- a hoodie has no
 * "premium" blank, and silently serving it the standard price would sell a
 * garment we cannot source at a price we never set.
 */
export function variantUnitPriceDollars(
  pricing: VariantPricing | null | undefined,
  size: string | null | undefined,
  color?: string | null,
  tier?: string | null
): number | null {
  if (!pricing || !size) return null
  const tierId = String(tier || DEFAULT_VARIANT_TIER)

  const wantColor = String(color ?? '').trim().toLowerCase()
  if (wantColor && pricing.by_color) {
    for (const [name, tiers] of Object.entries(pricing.by_color)) {
      if (name.trim().toLowerCase() === wantColor) {
        const v = lookupSize(tierTable(tiers, tierId), size)
        if (v !== null) return v
        break
      }
    }
  }
  return lookupSize(tierTable(pricing.default, tierId), size)
}

/** Lowest retail anywhere in the table -- the honest "from $X" for a card. */
export function variantFromPriceDollars(pricing: VariantPricing | null | undefined): number | null {
  if (!pricing) return null
  const all: number[] = []
  for (const tiers of [pricing.default, ...Object.values(pricing.by_color ?? {})]) {
    for (const sizes of Object.values(tiers)) {
      for (const v of Object.values(sizes)) if (Number.isFinite(v)) all.push(Number(v))
    }
  }
  return all.length > 0 ? Math.min(...all) : null
}

/** The tier ids a variant-priced product can actually be sold in. */
export function variantTierIds(pricing: VariantPricing | null | undefined): string[] {
  return pricing ? Object.keys(pricing.default) : []
}

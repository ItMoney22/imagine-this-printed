// Turns the raw supplier cost table (public.blank_variant_costs) into the
// per-product retail table the storefront prices from.
//
// ONE resolver, two callers, on purpose:
//   - backend/scripts/reprice-catalog-variants.ts  stamps the result onto
//     products.metadata.garment.variant_pricing
//   - backend/routes/admin/margins.ts              shows cost vs retail vs margin
// If the margin view and the repricer each built their own table, the margin
// column would be an opinion rather than a measurement.
//
// Watchtower 767f74d4.

import { supabase } from '../lib/supabase.js'
import {
  JIFFY_STYLES,
  jiffyStyleByTier,
  jiffyStyleByCode,
  youthStyleFor,
  supplierColorCandidates,
  supplierSizeFor,
  isYouthSizeToken,
  CAPABILITY_COLOR_IDS,
  type CapabilityColorId,
  type JiffyStyle
} from '../shared/jiffy-catalog.js'
import { COLORS, sizesForGarment, normalizeGarment, isYouthSize } from '../shared/catalog-capability.js'
import {
  buildVariantPricing,
  deriveDecorationCost,
  normaliseBand,
  BASE_SIZE_BAND,
  HOUSE_MARKUP_PCT,
  type SizePriceTable,
  type VariantPricing
} from '../shared/variant-pricing.js'

export interface CostRow {
  style_code: string
  color: string
  size: string
  cost_usd: number
  last_synced: string
}

/** style_code -> colour(lower) -> size -> cost. */
export type CostIndex = Map<string, Map<string, SizePriceTable>>

export interface LoadedCosts {
  index: CostIndex
  /** Oldest last_synced across everything loaded -- the honest staleness figure. */
  oldestSync: string | null
  rows: number
}

/** Pull the whole supplier cost table into memory. It is ~3k small rows. */
export async function loadVariantCosts(): Promise<LoadedCosts> {
  const index: CostIndex = new Map()
  let oldest: string | null = null
  let rows = 0
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('blank_variant_costs')
      .select('style_code, color, size, cost_usd, last_synced')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Failed to load blank_variant_costs: ${error.message}`)
    const batch = (data || []) as CostRow[]
    for (const r of batch) {
      const style = String(r.style_code).toUpperCase()
      if (!index.has(style)) index.set(style, new Map())
      const byColor = index.get(style)!
      const key = String(r.color).trim().toLowerCase()
      if (!byColor.has(key)) byColor.set(key, {})
      byColor.get(key)![String(r.size).trim().toUpperCase()] = Number(r.cost_usd)
      if (r.last_synced && (!oldest || r.last_synced < oldest)) oldest = r.last_synced
      rows++
    }
    if (batch.length < PAGE) break
  }
  return { index, oldestSync: oldest, rows }
}

/** The supplier colour name actually stocked for a capability colour, or null. */
export function resolveSupplierColor(
  index: CostIndex,
  styleCode: string,
  colorId: CapabilityColorId
): string | null {
  const byColor = index.get(styleCode.toUpperCase())
  if (!byColor) return null
  for (const candidate of supplierColorCandidates(styleCode, colorId)) {
    if (byColor.has(candidate.toLowerCase())) return candidate
  }
  return null
}

/**
 * The tiers a garment can actually be made in.
 *
 * A tee is offered in all four house tiers (BLANK_LINE). A hoodie has exactly
 * one blank -- Gildan 18500 -- so it gets a single 'standard' tier and the
 * $3/$5/$7 tier upcharge stops applying to it, which is correct: those numbers
 * were only ever the tee ladder, and a hoodie was collecting them against a
 * blank that does not change.
 */
export function stylesForGarment(garmentId: string): Array<{ tierId: string; style: JiffyStyle }> {
  if (garmentId === 'tshirt') {
    return JIFFY_STYLES.filter(s => s.tierId).map(s => ({ tierId: s.tierId as string, style: s }))
  }
  const own = JIFFY_STYLES.find(s => s.garmentId === garmentId)
  return own ? [{ tierId: 'standard', style: own }] : []
}

function costFor(index: CostIndex, styleCode: string, supplierColor: string, size: string): number | null {
  const table = index.get(styleCode.toUpperCase())?.get(supplierColor.trim().toLowerCase())
  if (!table) return null
  const v = table[supplierSizeFor(size)]
  return Number.isFinite(v) ? Number(v) : null
}

export interface ResolvedVariantCosts {
  /** tierId -> size -> cost, using the DEAREST capability colour for each cell. */
  costs: Record<string, SizePriceTable>
  /** capability colour LABEL -> tierId -> size -> cost, for colours that differ. */
  costsByColor: Record<string, Record<string, SizePriceTable>>
  /** tierId -> the supplier style that backs it. */
  styles: Record<string, string>
  /** Sizes with no cost anywhere -- a hole a human has to close. */
  missingSizes: string[]
  /** Capability colours this garment's blanks do not stock. */
  missingColors: string[]
}

/**
 * Every (tier, colour, size) cost for one garment.
 *
 * The `default` table takes the DEAREST capability colour in each cell so a
 * colour we somehow failed to resolve can never be sold below its own cost;
 * cheaper colours (White is cheaper on every Gildan) get an explicit override.
 *
 * Youth sizes price off the YOUTH blank for every tier -- a youth Bella+Canvas
 * is not something we stock, so a 'premium' YM is physically a Gildan 5000B
 * and is priced as one.
 */
export function resolveVariantCosts(index: CostIndex, garmentId: string): ResolvedVariantCosts {
  const tiers = stylesForGarment(garmentId)
  const youth = youthStyleFor(garmentId)

  // The capability band (what we advertise) PLUS every adult size the mill
  // actually stocks. Some legacy listings carry 4XL/5XL on products.sizes even
  // though catalog-capability stops at 3XL — leaving those out of the table
  // would drop them straight back onto the flat $2.50 rule against a blank
  // that costs $6.54 more. A size we can price but do not advertise is
  // harmless; a size we advertise but cannot price is the bug.
  const sizes = [...sizesForGarment(garmentId)]
  for (const { style } of tiers) {
    for (const table of index.get(style.code.toUpperCase())?.values() ?? []) {
      for (const size of Object.keys(table)) if (!sizes.includes(size)) sizes.push(size)
    }
  }

  const costs: Record<string, SizePriceTable> = {}
  const perColor: Record<string, Record<string, SizePriceTable>> = {}
  const styles: Record<string, string> = {}
  const missingSizes = new Set<string>()
  const missingColors = new Set<string>()

  for (const { tierId, style } of tiers) {
    styles[tierId] = style.code
    const tierDefault: SizePriceTable = {}

    for (const colorId of CAPABILITY_COLOR_IDS) {
      const label = COLORS[colorId].label
      const adultColor = resolveSupplierColor(index, style.code, colorId)
      const youthColor = youth ? resolveSupplierColor(index, youth.code, colorId) : null
      if (!adultColor) {
        missingColors.add(`${style.code}:${label}`)
        continue
      }

      const table: SizePriceTable = {}
      for (const size of sizes) {
        const useYouth = isYouthSizeToken(size) || isYouthSize(size)
        const styleCode = useYouth && youth ? youth.code : style.code
        const supplierColor = useYouth && youth ? youthColor ?? adultColor : adultColor
        const c = costFor(index, styleCode, supplierColor, size)
        if (c === null) continue
        table[size] = c
      }
      if (Object.keys(table).length === 0) continue

      // Promo-proof the base band before anything prices off it.
      const normalised = normaliseBand(table, BASE_SIZE_BAND)
      if (!perColor[label]) perColor[label] = {}
      perColor[label][tierId] = normalised
      for (const [size, c] of Object.entries(normalised)) {
        tierDefault[size] = Math.max(tierDefault[size] ?? 0, c)
      }
    }

    for (const size of sizes) if (!Number.isFinite(tierDefault[size])) missingSizes.add(`${tierId}:${size}`)
    if (Object.keys(tierDefault).length > 0) costs[tierId] = tierDefault
  }

  return {
    costs,
    costsByColor: perColor,
    styles,
    missingSizes: [...missingSizes],
    missingColors: [...missingColors]
  }
}

export interface PricedProduct {
  garmentId: string
  pricing: VariantPricing
  /** The cost the listing price was reconciled against (base tier, base size). */
  baseCost: number
  decorationCost: number
  underwater: boolean
  missingSizes: string[]
  missingColors: string[]
}

/**
 * The full answer for one product: which garment it is, what its blanks cost,
 * and therefore what every variant should retail for.
 *
 * `listingPrice` anchors the table: the decoration half is derived so the BASE
 * variant (standard tier, base size band, dearest colour) keeps exactly the
 * price the listing already has. Nothing about the headline price moves --
 * only the upcharge for the variants that genuinely cost more. The one
 * exception is a listing priced below its own blank, which is reported as
 * `underwater` and needs a human, not a formula.
 */
export function priceProduct(
  index: CostIndex,
  input: { garmentId?: string | null; category?: string | null; listingPrice: number; syncedAt?: string | null; markupPct?: number }
): PricedProduct | { error: string } {
  const garmentId = normalizeGarment(input.garmentId) ?? normalizeGarment(input.category ?? null)
  if (!garmentId) return { error: `not an offered garment (product_type=${input.garmentId ?? 'null'}, category=${input.category ?? 'null'})` }

  const resolved = resolveVariantCosts(index, garmentId)
  const tierIds = Object.keys(resolved.costs)
  if (tierIds.length === 0) return { error: `no supplier costs for garment "${garmentId}" — run scripts/sync-jiffy-costs.ts` }

  const baseTier = resolved.costs.standard ? 'standard' : tierIds[0]
  const baseSize = BASE_SIZE_BAND.find(s => Number.isFinite(resolved.costs[baseTier][s]))
  if (!baseSize) return { error: `no base-band cost for garment "${garmentId}" tier "${baseTier}"` }
  const baseCost = resolved.costs[baseTier][baseSize]

  const markupPct = input.markupPct ?? HOUSE_MARKUP_PCT
  const { decorationCost, underwater } = deriveDecorationCost(input.listingPrice, baseCost, markupPct)

  const pricing = buildVariantPricing({
    costs: resolved.costs,
    costsByColor: resolved.costsByColor,
    decorationCost,
    markupPct,
    styles: resolved.styles,
    syncedAt: input.syncedAt ?? undefined,
    underwater
  })

  return {
    garmentId,
    pricing,
    baseCost,
    decorationCost,
    underwater,
    missingSizes: resolved.missingSizes,
    missingColors: resolved.missingColors
  }
}

/** Raw cost for one concrete sale, for the margin view. Null when unknown. */
export function variantCost(
  index: CostIndex,
  garmentId: string,
  tierId: string,
  size: string,
  colorLabel?: string | null
): number | null {
  const tiers = stylesForGarment(garmentId)
  const entry = tiers.find(t => t.tierId === tierId) ?? tiers[0]
  if (!entry) return null
  const useYouth = isYouthSizeToken(size) || isYouthSize(size)
  const youth = youthStyleFor(garmentId)
  const style = useYouth && youth ? youth : entry.style
  const colorId = CAPABILITY_COLOR_IDS.find(id => COLORS[id].label.toLowerCase() === String(colorLabel ?? '').trim().toLowerCase())
  const supplierColor = colorId ? resolveSupplierColor(index, style.code, colorId) : null
  if (supplierColor) return costFor(index, style.code, supplierColor, size)
  // No colour picked: charge-safe answer is the dearest colour we stock.
  const byColor = index.get(style.code.toUpperCase())
  if (!byColor) return null
  let max: number | null = null
  for (const id of CAPABILITY_COLOR_IDS) {
    const name = resolveSupplierColor(index, style.code, id)
    if (!name) continue
    const c = costFor(index, style.code, name, size)
    if (c !== null) max = max === null ? c : Math.max(max, c)
  }
  return max
}

export { jiffyStyleByTier, jiffyStyleByCode }

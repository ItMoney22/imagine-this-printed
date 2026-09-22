// Admin margin inspection: blank cost vs retail vs margin, per variant.
//
// Watchtower 767f74d4. The point of this screen is to make a losing SKU
// impossible to miss. Before it existed the catalogue had a $15 hoodie against
// a $15.09 blank and nothing anywhere said so.
//
// Every number here is computed by backend/services/variant-cost-resolver.ts —
// the SAME module scripts/reprice-catalog-variants.ts stamps prices with — so
// the margin column is a measurement of what the storefront actually charges,
// not a second opinion about it.
//
// Mounted at /api/admin/margins. Admin + manager only: `blank_variant_costs`
// is service-role-only and supplier cost never reaches a customer browser.
import { Router, Request, Response } from 'express'
import { requireAuth, requireRole } from '../../middleware/supabaseAuth.js'
import { supabase } from '../../lib/supabase.js'
import { loadVariantCosts, priceProduct, variantCost, stylesForGarment, type CostIndex } from '../../services/variant-cost-resolver.js'
import { variantPricingOf, variantUnitPriceDollars, variantTierIds, HOUSE_MARKUP_PCT, round2 } from '../../shared/variant-pricing.js'
import { isBlankGarmentMeta } from '../../shared/blank-pricing.js'
import {
  COLORS,
  sizesForGarment,
  normalizeGarment,
  isYouthSize,
  isPlusSize,
  PLUS_SIZE_UPCHARGE_DOLLARS,
  YOUTH_SIZE_DISCOUNT_DOLLARS
} from '../../shared/catalog-capability.js'
import { JIFFY_STYLES, jiffyStyleByCode } from '../../shared/jiffy-catalog.js'

const router = Router()
router.use(requireAuth)
router.use(requireRole(['admin', 'manager']))

const APPAREL_CATEGORIES = ['shirts', 't-shirts', 'hoodies', 'apparel']

// The flat rails this feature replaced, kept here ONLY to show what a variant
// used to be charged — the "recovered" column is the whole argument for the
// change. Mirrors src/lib/garment-tiers.ts UPCHARGE_BY_ID.
const LEGACY_TIER_UPCHARGE: Record<string, number> = { standard: 0, soft: 3, premium: 5, heavyweight: 7 }

function legacyRetail(listingPrice: number, size: string, tierId: string): number {
  let p = Number(listingPrice) || 0
  if (isPlusSize(size)) p += PLUS_SIZE_UPCHARGE_DOLLARS
  if (isYouthSize(size)) p -= YOUTH_SIZE_DISCOUNT_DOLLARS
  p += LEGACY_TIER_UPCHARGE[tierId] ?? 0
  return round2(Math.max(0, p))
}

/** What the storefront charges today for this variant, youth markdown included. */
function currentRetail(pricing: ReturnType<typeof variantPricingOf>, listingPrice: number, size: string, tierId: string, color?: string | null): number {
  const v = variantUnitPriceDollars(pricing, size, color, tierId)
  const base = v ?? legacyRetail(listingPrice, size, tierId)
  // The youth markdown is a separate rail on top of the variant table — see
  // computeExtrasCentsPerUnit. It is NOT in the stamped price.
  const withYouth = v != null && isYouthSize(size) ? base - YOUTH_SIZE_DISCOUNT_DOLLARS : base
  return round2(Math.max(0, withYouth))
}

interface ProductRow {
  id: string
  name: string
  category: string | null
  price: number
  status: string | null
  metadata: Record<string, any> | null
}

/** Worst variant on a product: the one whose margin over its blank is thinnest. */
function scanVariants(
  index: CostIndex,
  p: ProductRow,
  garmentId: string,
  pricing: ReturnType<typeof variantPricingOf>
) {
  const tierIds = pricing ? variantTierIds(pricing) : stylesForGarment(garmentId).map(t => t.tierId)
  const sizes = sizesForGarment(garmentId)
  const colorLabels = Object.values(COLORS).map(c => c.label)

  let worst: {
    tier: string; size: string; color: string; cost: number; retail: number; margin: number; marginPct: number
  } | null = null
  let underwaterCount = 0
  let total = 0
  let recovered = 0

  for (const tierId of tierIds) {
    for (const size of sizes) {
      for (const color of colorLabels) {
        const cost = variantCost(index, garmentId, tierId, size, color)
        if (cost == null) continue
        const retail = currentRetail(pricing, Number(p.price), size, tierId, color)
        const margin = round2(retail - cost)
        const marginPct = retail > 0 ? round2((margin / retail) * 100) : 0
        total++
        if (margin <= 0) underwaterCount++
        recovered += retail - legacyRetail(Number(p.price), size, tierId)
        if (!worst || margin < worst.margin) worst = { tier: tierId, size, color, cost, retail, margin, marginPct }
      }
    }
  }
  return { worst, underwaterCount, total, recovered: round2(recovered / Math.max(1, total)) }
}

// GET /api/admin/margins — one row per apparel product, worst variant first.
router.get('/', async (req: Request, res: Response) => {
  try {
    const status = String(req.query.status || 'active')
    let q = supabase.from('products').select('id, name, category, price, status, metadata').in('category', APPAREL_CATEGORIES)
    if (status !== 'all') q = q.eq('status', status)
    const { data, error } = await q
    if (error) throw error

    const { index, oldestSync, rows: costRows } = await loadVariantCosts()

    const products: any[] = []
    for (const p of (data || []) as ProductRow[]) {
      if (isBlankGarmentMeta(p.metadata)) continue // priced by seed-blanks.ts
      const garmentId = normalizeGarment(p.metadata?.product_type) ?? normalizeGarment(p.category)
      const pricing = variantPricingOf(p.metadata)
      if (!garmentId) {
        products.push({
          id: p.id, name: p.name, category: p.category, status: p.status,
          listed_price: Number(p.price), priced_per_variant: false,
          issue: `not an offered garment (product_type=${p.metadata?.product_type ?? 'null'})`
        })
        continue
      }

      const scan = scanVariants(index, p, garmentId, pricing)
      const quote = priceProduct(index, { garmentId, category: p.category, listingPrice: Number(p.price) })
      products.push({
        id: p.id,
        name: p.name,
        category: p.category,
        status: p.status,
        garment: garmentId,
        listed_price: Number(p.price),
        priced_per_variant: pricing != null,
        stamped_at: pricing?.priced_at ?? null,
        costs_synced_at: pricing?.synced_at ?? null,
        markup_pct: pricing?.markup_pct ?? HOUSE_MARKUP_PCT,
        decoration_cost: pricing?.decoration_cost ?? ('error' in quote ? null : quote.decorationCost),
        base_blank_cost: 'error' in quote ? null : quote.baseCost,
        underwater: pricing?.underwater ?? ('error' in quote ? false : quote.underwater),
        variants: scan.total,
        underwater_variants: scan.underwaterCount,
        worst_variant: scan.worst,
        avg_recovered_per_unit: scan.recovered,
        issue: 'error' in quote ? quote.error : null
      })
    }

    // Thinnest margin first — the screen's whole job is to put a losing SKU on
    // top rather than make someone go looking for it.
    products.sort((a, b) => {
      const am = a.worst_variant?.margin ?? Number.POSITIVE_INFINITY
      const bm = b.worst_variant?.margin ?? Number.POSITIVE_INFINITY
      return am - bm
    })

    res.json({
      products,
      summary: {
        products: products.length,
        priced_per_variant: products.filter(p => p.priced_per_variant).length,
        underwater: products.filter(p => p.underwater || (p.underwater_variants ?? 0) > 0).length,
        cost_rows: costRows,
        costs_oldest_sync: oldestSync,
        markup_pct: HOUSE_MARKUP_PCT
      }
    })
  } catch (err: any) {
    console.error('[admin/margins] list failed:', err?.message || err)
    res.status(500).json({ error: err?.message || 'Failed to load margins' })
  }
})

// GET /api/admin/margins/costs — the supplier cost table's health.
router.get('/costs', async (_req: Request, res: Response) => {
  try {
    const { index, oldestSync, rows } = await loadVariantCosts()
    const styles = JIFFY_STYLES.map(s => {
      const byColor = index.get(s.code.toUpperCase())
      const costs: number[] = []
      for (const table of byColor?.values() ?? []) costs.push(...Object.values(table).filter(Number.isFinite))
      return {
        code: s.code,
        brand: s.brand,
        style: s.manufacturerStyle,
        label: s.label,
        tier_id: s.tierId,
        garment_id: s.garmentId,
        colors: byColor?.size ?? 0,
        variants: costs.length,
        min_cost: costs.length ? round2(Math.min(...costs)) : null,
        max_cost: costs.length ? round2(Math.max(...costs)) : null
      }
    })
    res.json({ styles, rows, oldest_sync: oldestSync })
  } catch (err: any) {
    console.error('[admin/margins] costs failed:', err?.message || err)
    res.status(500).json({ error: err?.message || 'Failed to load supplier costs' })
  }
})

// GET /api/admin/margins/:id?color=Black — the full tier x size grid.
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, category, price, status, metadata')
      .eq('id', req.params.id)
      .single()
    if (error || !data) return res.status(404).json({ error: 'Product not found' })
    const p = data as ProductRow

    const garmentId = normalizeGarment(p.metadata?.product_type) ?? normalizeGarment(p.category)
    if (!garmentId) return res.status(400).json({ error: 'Not an offered garment — nothing to price' })

    const { index, oldestSync } = await loadVariantCosts()
    const pricing = variantPricingOf(p.metadata)
    const color = typeof req.query.color === 'string' && req.query.color ? req.query.color : null
    const tierIds = pricing ? variantTierIds(pricing) : stylesForGarment(garmentId).map(t => t.tierId)
    const sizes = sizesForGarment(garmentId)

    const grid = []
    for (const tierId of tierIds) {
      for (const size of sizes) {
        const cost = variantCost(index, garmentId, tierId, size, color)
        if (cost == null) continue
        const retail = currentRetail(pricing, Number(p.price), size, tierId, color)
        const was = legacyRetail(Number(p.price), size, tierId)
        const margin = round2(retail - cost)
        grid.push({
          tier: tierId,
          style: jiffyStyleByCode(pricing?.styles?.[tierId] ?? '')?.manufacturerStyle ?? null,
          size,
          color: color ?? 'any (dearest stocked)',
          blank_cost: cost,
          retail,
          was_retail: was,
          delta: round2(retail - was),
          margin,
          margin_pct: retail > 0 ? round2((margin / retail) * 100) : 0,
          underwater: margin <= 0
        })
      }
    }

    res.json({
      product: {
        id: p.id, name: p.name, category: p.category, status: p.status,
        listed_price: Number(p.price), garment: garmentId,
        priced_per_variant: pricing != null,
        decoration_cost: pricing?.decoration_cost ?? null,
        markup_pct: pricing?.markup_pct ?? HOUSE_MARKUP_PCT,
        costs_synced_at: pricing?.synced_at ?? oldestSync
      },
      colors: Object.values(COLORS).map(c => ({ id: c.id, label: c.label, hex: c.hex })),
      grid
    })
  } catch (err: any) {
    console.error('[admin/margins] detail failed:', err?.message || err)
    res.status(500).json({ error: err?.message || 'Failed to load product margins' })
  }
})

export default router

// Storefront helper for the blank-tee lane: pairs each tier in the shared
// blank line (backend/shared/blank-line.ts) with its LIVE product row so
// prices/links come from the database, and falls back to the shared table's
// own cost × markup when a tier has not been seeded yet (the page still
// renders, it just links to the catalog bucket instead of a product).
import { supabase } from './supabase'
import {
  BLANK_LINE,
  BLANK_MARKUP_PCT,
  BLANK_SIZE_ORDER,
  type BlankTierSpec
} from '../../backend/shared/blank-line'
import {
  buildBlankPricing,
  blankPricingOf,
  blankFromPriceDollars,
  blankUnitPriceDollars,
  type BlankPricing
} from '../../backend/shared/blank-pricing'

export interface BlankTierCard {
  tier: BlankTierSpec
  /** Live products row id, when seeded. */
  productId: string | null
  slug: string | null
  /** Where "Shop" goes: the product page, or the catalog bucket as a fallback. */
  href: string
  pricing: BlankPricing
  fromPrice: number
  colorCount: number
  sizes: string[]
  image: string
  live: boolean
}

function fallbackPricing(tier: BlankTierSpec): BlankPricing {
  return buildBlankPricing(tier.cost.account, tier.whiteColors, BLANK_MARKUP_PCT)
}

function toCard(tier: BlankTierSpec, row: any | null): BlankTierCard {
  const livePricing = row ? blankPricingOf(row.metadata) : null
  const pricing = livePricing ?? fallbackPricing(tier)
  const sizes: string[] = Array.isArray(row?.sizes) && row.sizes.length > 0 ? row.sizes : tier.sizes
  return {
    tier,
    productId: row?.id ?? null,
    slug: row?.slug ?? null,
    href: row ? `/product/${row.slug || row.id}` : '/catalog/blanks',
    pricing,
    fromPrice: blankFromPriceDollars(pricing) ?? 0,
    colorCount: Array.isArray(row?.colors) && row.colors.length > 0 ? row.colors.length : tier.colors.length,
    sizes: [...sizes].sort((a, b) => BLANK_SIZE_ORDER.indexOf(a as any) - BLANK_SIZE_ORDER.indexOf(b as any)),
    image: row?.images?.[0] || tier.image,
    live: !!row
  }
}

/** The four tier cards, in rank order, with live rows merged in. */
export async function loadBlankTierCards(): Promise<BlankTierCard[]> {
  let rows: any[] = []
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, slug, name, price, images, sizes, colors, metadata')
      .eq('metadata->garment->>blank', 'true')
      .eq('status', 'active')
      .eq('is_active', true)
    if (error) throw error
    rows = data || []
  } catch (err) {
    console.warn('[blank-lane] live rows unavailable, using shared table', err)
  }
  const byTier = new Map<string, any>()
  for (const r of rows) {
    const tierId = r?.metadata?.garment?.tier
    if (tierId && !byTier.has(tierId)) byTier.set(tierId, r)
  }
  return [...BLANK_LINE]
    .sort((a, b) => a.rank - b.rank)
    .map(t => toCard(t, byTier.get(t.id) ?? null))
}

/** Price for one size in the default (colour) group, for the compare table. */
export function tierSizePrice(card: BlankTierCard, size: string): number | null {
  return blankUnitPriceDollars(card.pricing, size)
}

/** Price for one size in White, when White runs cheaper; null when identical. */
export function tierWhiteSizePrice(card: BlankTierCard, size: string): number | null {
  const white = blankUnitPriceDollars(card.pricing, size, 'White')
  const def = blankUnitPriceDollars(card.pricing, size)
  if (white === null || def === null || white === def) return null
  return white
}

export const COMPARE_SIZE_ROWS: string[] = ['S', '2XL', '3XL', '4XL', '5XL']

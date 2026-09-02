// Garment quality tiers — the shirt-quality upsell (David 2026-08-19).
// Base catalog price buys the standard blank (Gildan 5000, tag pulled and
// rebranded); premium blanks add a fixed per-unit upcharge. Applies to
// apparel products that are NOT blanks (a blank IS its tier, priced as-is).
//
// Keep ids + upcharges in sync with GARMENT_TIER_UPCHARGE_CENTS in
// backend/services/order-pricing.ts — the server re-prices every checkout and
// hard-errors on an unrecognized tier, so drift breaks checkout loudly.
//
// Brand/style specifics come from the JiffyShirts scout (Watchtower task
// 14d214d5) — until that data lands these are our four locked quality rungs.

export interface GarmentTier {
  id: string
  label: string
  brand: string
  styleCode: string
  upcharge: number // dollars per unit, on top of the product price
  blurb: string
}

export const GARMENT_TIERS: GarmentTier[] = [
  {
    id: 'standard',
    label: 'Classic',
    brand: 'Gildan',
    styleCode: '5000',
    upcharge: 0,
    blurb: 'Our everyday heavy cotton tee — 5.3 oz, durable and true to size.'
  },
  {
    id: 'soft',
    label: 'Softstyle',
    brand: 'Gildan',
    styleCode: '64000',
    upcharge: 3,
    blurb: 'Lighter 4.5 oz ring-spun cotton — noticeably softer, modern fit.'
  },
  {
    id: 'premium',
    label: 'Premium',
    brand: 'Bella+Canvas',
    styleCode: '3001',
    upcharge: 5,
    blurb: 'Retail-grade 4.2 oz Airlume combed cotton — the softest print base.'
  },
  {
    id: 'heavyweight',
    label: 'Garment-Dyed Heavy',
    brand: 'Comfort Colors',
    styleCode: '1717',
    upcharge: 7,
    blurb: 'Thick 6.1 oz garment-dyed cotton — vintage boxy feel that lasts.'
  }
]

export const DEFAULT_GARMENT_TIER_ID = 'standard'

export function getGarmentTier(id?: string | null): GarmentTier | null {
  if (!id) return null
  return GARMENT_TIERS.find(t => t.id === id) || null
}

export function garmentTierUpcharge(id?: string | null): number {
  return getGarmentTier(id)?.upcharge ?? 0
}

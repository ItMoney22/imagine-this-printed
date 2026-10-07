// Garment quality tiers — the shirt-quality upsell (David 2026-08-19).
// Base catalog price buys the standard blank (tag pulled and rebranded);
// premium blanks add a fixed per-unit upcharge. Applies to apparel products
// that are NOT blanks (a blank IS its tier, priced as-is from its own
// size × colour table — see backend/shared/blank-pricing.ts).
//
// Keep ids + upcharges in sync with GARMENT_TIER_UPCHARGE_CENTS in
// backend/services/order-pricing.ts — the server re-prices every checkout and
// hard-errors on an unrecognized tier, so drift breaks checkout loudly.
//
// Identity (house name, "compared to" manufacturer/style, specs, colours,
// Jiffy costs) lives in backend/shared/blank-line.ts — the same table the
// /blanks lane and the blank seed script read. David 2026-09-02: never show
// the manufacturer brand as OUR name; it may only appear as "Compared to …".

import { BLANK_LINE, compareToLabel, type BlankTierSpec } from '../../backend/shared/blank-line'
import { getGarment } from '../../backend/shared/catalog-capability'

export interface GarmentTier {
  id: string
  /** Good / Better / Best / Top Line */
  grade: BlankTierSpec['grade']
  /** House name — no manufacturer brand. */
  label: string
  /** "Compared to Gildan 5000" — the ONLY place the manufacturer is named. */
  compareTo: string
  upcharge: number // dollars per unit, on top of the product price
  blurb: string
  weightOz: number
}

const UPCHARGE_BY_ID: Record<string, number> = {
  standard: 0,
  soft: 3,
  premium: 5,
  heavyweight: 7
}

export const GARMENT_TIERS: GarmentTier[] = BLANK_LINE.map(t => ({
  id: t.id,
  grade: t.grade,
  label: t.name.replace(/ Tee$/, ''),
  compareTo: compareToLabel(t),
  upcharge: UPCHARGE_BY_ID[t.id] ?? 0,
  blurb: t.tagline,
  weightOz: t.specs.weightOz
}))

// Hoodie blanks (David 2026-10-07 site walk: the hoodie page was offering the
// T-shirt blanks above). A hoodie is printed on the capability table's
// standard hoodie (backend/shared/catalog-capability.ts GARMENTS 'hoodie',
// Gildan 18500; the live hoodie rows record style G185 and nothing else), so
// it shows that one blank and never the tee tiers. No upcharge. A premium
// hoodie goes here AND into GARMENT_TIER_UPCHARGE_CENTS in
// backend/services/order-pricing.ts together, under its own id.
const HOODIE_GARMENT = getGarment('hoodie')

export const HOODIE_TIERS: GarmentTier[] = [
  {
    id: 'standard',
    grade: 'Good',
    label: 'Classic Heavy Blend Hoodie',
    compareTo: compareToLabel({ compareTo: { brand: 'Gildan', style: '18500' } }),
    upcharge: 0,
    blurb: 'Warm cotton-poly fleece pullover with a lined hood and a front pouch pocket.',
    weightOz: HOODIE_GARMENT?.weightOz ?? 8
  }
]

/** The blanks a printed listing offers: tee blanks for a tee, hoodie blanks for a hoodie. */
export function garmentTiersFor(picker: 'tee' | 'hoodie' | null): GarmentTier[] {
  if (picker === 'tee') return GARMENT_TIERS
  if (picker === 'hoodie') return HOODIE_TIERS
  return []
}

export const DEFAULT_GARMENT_TIER_ID = 'standard'

export function getGarmentTier(id?: string | null): GarmentTier | null {
  if (!id) return null
  return GARMENT_TIERS.find(t => t.id === id) || null
}

export function garmentTierUpcharge(id?: string | null): number {
  return getGarmentTier(id)?.upcharge ?? 0
}

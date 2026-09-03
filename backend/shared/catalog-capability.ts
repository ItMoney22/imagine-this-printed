/**
 * ITP catalog capability boundary — the ONE list of what Imagine This Printed
 * can physically make right now. Imported by the frontend (like
 * `backend/shared/metal-art`) and the backend alike.
 *
 * David 2026-09-01: "we have a lot of products that we can't even post to Etsy
 * because we don't even do embroidery." Anything not in GARMENTS is not
 * offered, not generated, not mocked up, not listed. Mrs. Imagine, the Step
 * Flow builder and the Etsy composer all read from here.
 *
 * Print method is DTF only. Polo, tank, embroidery and sublimation garments are
 * explicitly NOT offered — see NOT_OFFERED. Blanks mirror src/lib/garment-tiers
 * (Gildan 5000 is the standard tee; Gildan 18500 the standard hoodie).
 */

export type GarmentId = 'tshirt' | 'hoodie' | 'youth-tshirt'

/**
 * Who physically wears this garment. This is a CAPABILITY fact, not a
 * styling preference: it is the single thing that decides whether a listing
 * photo may show a child (David 2026-09-03 — a cute kids' design was mocked
 * up on a bearded man, and the fix could not be "photograph a kid" alone
 * because the catalogue had no youth size to sell them).
 *
 * The rule the whole build follows: the CAST's age band is the GARMENT's age
 * band. A child never models a garment we only make in adult sizes, and an
 * adult never models the youth tee — see services/step-flow/casting.ts.
 */
export type GarmentAudience = 'adult' | 'youth'

export type ColorId =
  | 'black'
  | 'white'
  | 'navy'
  | 'heather-grey'
  | 'red'
  | 'forest-green'
  | 'royal-blue'

export interface CapabilityColor {
  id: ColorId
  label: string
  hex: string
  /** Approximate relative luminance 0..1 of the blank, used by color advice. */
  luma: number
}

export interface CapabilityGarment {
  id: GarmentId
  label: string
  /** products.category the garment files under. */
  category: 't-shirts' | 'hoodies'
  /** Plain-English noun for prompts ("crew neck t-shirt", "pullover hoodie"). */
  noun: string
  blank: string
  weightOz: number
  colors: ColorId[]
  /** Default print area width in inches for the front-center placement. */
  printWidthInches: number
  /** Adult or youth body — drives casting, the size chart and the size variations. */
  audience: GarmentAudience
  /**
   * The sizes this blank is actually sold in, smallest first. Sourced here so
   * the Etsy variation axis, the details card's size table and
   * `products.sizes` can never drift into promising a size we don't stock
   * (they each used to carry their own hardcoded S-3XL list).
   */
  sizes: string[]
}

export const COLORS: Record<ColorId, CapabilityColor> = {
  black: { id: 'black', label: 'Black', hex: '#000000', luma: 0.02 },
  white: { id: 'white', label: 'White', hex: '#FFFFFF', luma: 0.98 },
  navy: { id: 'navy', label: 'Navy', hex: '#1E3A5F', luma: 0.12 },
  'heather-grey': { id: 'heather-grey', label: 'Heather Grey', hex: '#9CA3AF', luma: 0.55 },
  red: { id: 'red', label: 'Red', hex: '#DC2626', luma: 0.25 },
  'forest-green': { id: 'forest-green', label: 'Forest Green', hex: '#166534', luma: 0.14 },
  'royal-blue': { id: 'royal-blue', label: 'Royal Blue', hex: '#2563EB', luma: 0.22 },
}

export const GARMENTS: CapabilityGarment[] = [
  {
    id: 'tshirt',
    label: 'T-Shirt',
    category: 't-shirts',
    noun: 'crew neck t-shirt',
    blank: 'Gildan 5000 Heavy Cotton',
    weightOz: 5.3,
    colors: ['black', 'white', 'navy', 'heather-grey', 'red', 'forest-green', 'royal-blue'],
    printWidthInches: 11,
    audience: 'adult',
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
  },
  {
    id: 'hoodie',
    label: 'Hoodie',
    category: 'hoodies',
    noun: 'pullover hoodie',
    blank: 'Gildan 18500 Heavy Blend',
    weightOz: 8.0,
    colors: ['black', 'white', 'navy', 'heather-grey', 'red', 'forest-green'],
    printWidthInches: 10,
    audience: 'adult',
    sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
  },
  // David 2026-09-03: added so a kids' design can be photographed on a kid
  // and still be a listing we can actually fulfil. Same DTF process, same
  // Gildan Heavy Cotton fabric, youth cut (style 5000B). Sizes are Gildan's
  // published youth range; the print is 8 inches wide because an 11-inch
  // adult print is wider than a youth MEDIUM's entire 18-inch body.
  {
    id: 'youth-tshirt',
    label: 'Youth T-Shirt',
    category: 't-shirts',
    noun: 'youth crew neck t-shirt',
    blank: 'Gildan 5000B Heavy Cotton Youth',
    weightOz: 5.3,
    colors: ['black', 'white', 'navy', 'heather-grey', 'red', 'forest-green', 'royal-blue'],
    printWidthInches: 8,
    audience: 'youth',
    sizes: ['YXS', 'YS', 'YM', 'YL', 'YXL'],
  },
]

export const PRINT_METHODS = ['dtf'] as const
export type PrintMethod = (typeof PRINT_METHODS)[number]

/** Things people keep asking for that ITP does not make. Never generate these. */
export const NOT_OFFERED = ['polo', 'tank', 'embroidery', 'sublimation-garment'] as const

export const GARMENT_IDS: GarmentId[] = GARMENTS.map((g) => g.id)

export function getGarment(id: string | null | undefined): CapabilityGarment | null {
  if (!id) return null
  return GARMENTS.find((g) => g.id === id) ?? null
}

export function isOfferedGarment(id: string | null | undefined): id is GarmentId {
  return getGarment(id) !== null
}

export function colorsForGarment(id: GarmentId): CapabilityColor[] {
  const g = getGarment(id)
  return g ? g.colors.map((c) => COLORS[c]) : []
}

/** The sizes a garment is sold in. Unknown garment → the adult tee range (the historical default). */
export function sizesForGarment(id: string | null | undefined): string[] {
  return [...(getGarment(id)?.sizes ?? ['S', 'M', 'L', 'XL', '2XL', '3XL'])]
}

/**
 * Whether this garment is worn by an adult or a child. Unknown/absent garment
 * is treated as 'adult' — the safe default everywhere it matters, because it
 * is the answer that never puts a child in a photograph by accident.
 */
export function audienceForGarment(id: string | null | undefined): GarmentAudience {
  return getGarment(id)?.audience ?? 'adult'
}

/** True when this garment is a youth cut, i.e. the listing photo should show a child. */
export function isYouthGarment(id: string | null | undefined): boolean {
  return audienceForGarment(id) === 'youth'
}

export function isColorOfferedOn(garment: GarmentId, color: string): color is ColorId {
  const g = getGarment(garment)
  return !!g && (g.colors as string[]).includes(color)
}

/** Throws if a garment/color pair is outside what ITP can make. */
export function assertOffered(garment: string, color?: string): CapabilityGarment {
  const g = getGarment(garment)
  if (!g) throw new Error(`Garment "${garment}" is not offered (ITP makes: ${GARMENT_IDS.join(', ')})`)
  if (color && !(g.colors as string[]).includes(color)) {
    throw new Error(`${g.label} is not offered in "${color}" (offered: ${g.colors.join(', ')})`)
  }
  return g
}

/** Legacy garment strings → capability id ('t-shirts'/'shirts' → tshirt). Null if not offered. */
export function normalizeGarment(value: string | null | undefined): GarmentId | null {
  const v = (value || '').toLowerCase().trim()
  if (!v) return null
  // Youth is matched FIRST: 'youth tshirt' also contains 'tshirt', and
  // resolving it to the adult tee would quietly sell adult sizes with a child
  // in the photo — the precise mismatch the youth lane exists to prevent.
  if (['youth-tshirt', 'youth tshirt', 'youth t-shirt', 'youth tee', 'youth-tee', 'kids tshirt', 'kids t-shirt', 'kids tee', 'kids-tshirt', 'toddler tee'].includes(v)) {
    return 'youth-tshirt'
  }
  if (['tshirt', 't-shirt', 'tee', 't-shirts', 'shirts', 'shirt'].includes(v)) return 'tshirt'
  if (['hoodie', 'hoodies', 'hooded sweatshirt'].includes(v)) return 'hoodie'
  return null
}

/** Legacy color strings ('gray', 'Heather Grey', '#000000') → capability id. Null if unknown. */
export function normalizeColor(value: string | null | undefined): ColorId | null {
  const v = (value || '').toLowerCase().trim().replace(/\s+/g, '-')
  if (!v) return null
  if (v in COLORS) return v as ColorId
  if (v === 'gray' || v === 'grey' || v === 'heather-gray') return 'heather-grey'
  if (v === 'green') return 'forest-green'
  if (v === 'blue') return 'royal-blue'
  const byHex = (Object.values(COLORS) as CapabilityColor[]).find((c) => c.hex.toLowerCase() === v)
  return byHex ? byHex.id : null
}

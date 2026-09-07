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

import { normalizeMetalSizeKey } from './metal-art.js'

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
   *
   * This is the garment's OWN band only. The full set a listing offers is
   * `sizesForGarment()` — this plus `youth` below.
   */
  sizes: string[]
  /**
   * The youth cut of this same garment, sold on the SAME listing (David
   * 2026-09-07: "we need to make sure all of our shirts and hoodies are
   * available in youth sizes as well").
   *
   * This is a different physical blank, not a smaller size of the same one —
   * a youth tee is a Gildan 5000B, not a small 5000 — so the blank and the
   * print width are declared alongside the sizes. Null on a garment that IS
   * already a youth cut.
   */
  youth: YouthCut | null
}

/** The youth counterpart of an adult garment, sold on the same listing. */
export interface YouthCut {
  /** Youth sizes, smallest first. */
  sizes: string[]
  /** The youth blank actually pulled when one of those sizes is ordered. */
  blank: string
  /**
   * Print width in inches for the youth body. An 11-inch adult print is wider
   * than a youth MEDIUM's entire 18-inch body, so this is never inherited.
   */
  printWidthInches: number
}

/**
 * The youth size band, smallest first. Gildan's published youth range, shared
 * by the youth tee (5000B) and the youth hoodie (18500B).
 */
export const YOUTH_SIZES = ['YXS', 'YS', 'YM', 'YL', 'YXL'] as const
export type YouthSize = (typeof YOUTH_SIZES)[number]

/**
 * What comes OFF the listing price when a youth size is ordered (David
 * 2026-09-07). The exact mirror of the +$2.50 plus-size upcharge, and like it
 * this is the ONE definition — order-pricing.ts, CartContext, Checkout, the
 * product page and the Etsy variation axis all import it rather than keeping
 * a fourth copy of the number that drifts.
 */
export const YOUTH_SIZE_DISCOUNT_CENTS = 300
export const YOUTH_SIZE_DISCOUNT_DOLLARS = YOUTH_SIZE_DISCOUNT_CENTS / 100

/**
 * The PLUS-SIZE rail — the other half of the same idea, and now declared here
 * once instead of in four places.
 *
 * It used to be copy-pasted into backend/services/order-pricing.ts,
 * src/context/CartContext.tsx and src/pages/Checkout.tsx, each carrying a
 * "mirrors <the other file>" comment. That is not a mirror, it is three
 * chances to drift, and it has already cost us once: the substring match below
 * treats '4x6' as a plus size (it contains the '4X' token), so a metal art
 * panel was silently charged +$2.50 until it had to be fixed in all three
 * copies on 2026-09-02. Etsy is the fourth consumer (David 2026-09-07), so the
 * rule moved here rather than being pasted a fourth time.
 */
export const PLUS_SIZES = ['2XL', '2X', 'XXL', '3XL', '3X', 'XXXL', '4XL', '4X', 'XXXXL', '5XL', '5X', 'XXXXXL']
export const PLUS_SIZE_UPCHARGE_CENTS = 250
export const PLUS_SIZE_UPCHARGE_DOLLARS = PLUS_SIZE_UPCHARGE_CENTS / 100

/**
 * True for an apparel size that carries the plus-size upcharge.
 *
 * Two guards, both load-bearing:
 *   - a metal-art PANEL size is not apparel ('4x6' → '4X6', which contains the
 *     '4X' token) — the bug fixed 2026-09-02;
 *   - a YOUTH size is never a plus size, so a parent is never charged the
 *     upcharge on a child's shirt.
 * The substring match itself is preserved exactly as it was, so consolidating
 * these copies cannot change what any existing cart or order prices.
 */
export function isPlusSize(size?: string | null): boolean {
  if (!size) return false
  if (normalizeMetalSizeKey(size)) return false
  if (isYouthSize(size)) return false
  return PLUS_SIZES.some(ps => size.toUpperCase().includes(ps))
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
    youth: {
      sizes: [...YOUTH_SIZES],
      blank: 'Gildan 5000B Heavy Cotton Youth',
      printWidthInches: 8,
    },
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
    youth: {
      sizes: [...YOUTH_SIZES],
      blank: 'Gildan 18500B Heavy Blend Youth',
      printWidthInches: 8,
    },
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
    sizes: [...YOUTH_SIZES],
    // Already a youth cut — there is no youth-of-the-youth band.
    youth: null,
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

/** A garment's own size band, WITHOUT the youth cut. Unknown garment → the adult tee range. */
export function adultSizesForGarment(id: string | null | undefined): string[] {
  return [...(getGarment(id)?.sizes ?? ['S', 'M', 'L', 'XL', '2XL', '3XL'])]
}

/**
 * The youth sizes this garment also sells, or [] when it has no youth cut
 * (or already IS one). A garment we don't recognise gets the adult tee's
 * answer, which is the youth band — an unknown legacy 't-shirts' row is far
 * more likely a tee than something we've never heard of.
 */
export function youthSizesForGarment(id: string | null | undefined): string[] {
  const g = getGarment(id)
  if (!g) return [...YOUTH_SIZES]
  return g.youth ? [...g.youth.sizes] : []
}

/**
 * EVERY size a listing for this garment offers — the adult band followed by
 * the youth band (David 2026-09-07: shirts and hoodies sell in youth sizes on
 * the same listing). This is what `products.sizes`, the Etsy variation axis,
 * the storefront size picker and the details-card size chart all read, so
 * they cannot disagree about what a buyer may order.
 *
 * A garment that IS a youth cut returns its youth sizes once, not twice.
 */
export function sizesForGarment(id: string | null | undefined): string[] {
  return [...adultSizesForGarment(id), ...youthSizesForGarment(id)]
}

/**
 * True for a youth size, in any of the spellings that reach us: the canonical
 * 'YM', the Etsy variation label 'Youth M', and either with stray case or
 * whitespace. Deliberately anchored rather than a substring match — the
 * plus-size rail was overcharging metal art because it matched '4x6' as '4X',
 * and this is the same shaped bug waiting to happen.
 */
export function isYouthSize(size: string | null | undefined): boolean {
  const v = String(size ?? '').trim().toUpperCase().replace(/^YOUTH\s+/, 'Y')
  return (YOUTH_SIZES as readonly string[]).includes(v)
}

/** Dollars off this line for a youth size; 0 for every adult size. */
export function youthDiscountCents(size: string | null | undefined): number {
  return isYouthSize(size) ? YOUTH_SIZE_DISCOUNT_CENTS : 0
}

/**
 * The blank actually pulled for a garment + size — the adult blank, or the
 * youth blank when a youth size was ordered. Fulfilment reads this: a 'YM'
 * line on a t-shirt listing is a Gildan 5000B, not a small 5000.
 */
export function blankForSize(id: string | null | undefined, size?: string | null): string | null {
  const g = getGarment(id)
  if (!g) return null
  if (isYouthSize(size) && g.youth) return g.youth.blank
  return g.blank
}

/** Print width for a garment + size — the youth body takes a narrower print. */
export function printWidthForSize(id: string | null | undefined, size?: string | null): number | null {
  const g = getGarment(id)
  if (!g) return null
  if (isYouthSize(size) && g.youth) return g.youth.printWidthInches
  return g.printWidthInches
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

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

/**
 * Which bodies this listing may honestly be photographed on, smallest set
 * first-listed as the garment's own band.
 *
 * The rule a listing photo has to satisfy is "never advertise a size we don't
 * sell" — NOT "never show a child". Those were the same sentence until
 * 2026-09-07, when shirts and hoodies gained a youth cut sold on the SAME
 * listing (see `youth` above). From that day the adult tee genuinely ships
 * YXS-YXL on a 5000B, so a kid in its photo is a real, buyable variant.
 *
 * David 2026-09-08, on a kids' ghost design stuck with a grown man because the
 * garment said 'adult': "an adult can buy it too tho so lets make sure i can
 * reshoot with a kid." This is that answer, derived from the catalogue rather
 * than asserted: a band is photographable when the listing actually sells it.
 */
export function photographableAudiences(id: string | null | undefined): GarmentAudience[] {
  const own = audienceForGarment(id)
  if (own === 'youth') return ['youth']
  return youthSizesForGarment(id).length ? ['adult', 'youth'] : ['adult']
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

// ---------------------------------------------------------------------------
// MANUFACTURING METHODS — what ITP can physically DO to a blank.
//
// David 2026-08-24 (task 9ff3919c), verbatim ground truth:
//   CAN     DTF (the core business), UV DTF, sublimation (METAL ART and
//           TUMBLERS ONLY — never apparel), digital download.
//   CANNOT  embroidery, screen print, vinyl.
//
// This is not a styling list. Every entry is a claim a listing is allowed to
// make to a buyer, and anything absent is a promise we would have to break.
// David 2026-09-01: "we have a lot of products that we can't even post to Etsy
// because we don't even do embroidery" — 18 live products claimed embroidery
// and 23 claimed polo, all written by a generator that was never told what the
// shop owns.
// ---------------------------------------------------------------------------

export type ProductLineId = 'apparel' | 'metal-art' | 'tumblers' | 'digital-download'
export type MethodId = 'dtf' | 'uv-dtf' | 'sublimation' | 'digital-download'

export interface ManufacturingMethod {
  id: MethodId
  label: string
  /**
   * How listing copy is allowed to name this method, in buyer English. Fed
   * verbatim into the generator prompts so a model never has to invent a
   * decoration verb — inventing one is exactly how "embroidered" reached 18
   * live listings.
   */
  copyPhrase: string
  /** The product lines this method may be claimed on. */
  lines: ProductLineId[]
}

export const MANUFACTURING_METHODS: ManufacturingMethod[] = [
  {
    id: 'dtf',
    label: 'DTF transfer',
    copyPhrase: 'printed with a DTF (direct-to-film) transfer heat-pressed onto the garment',
    lines: ['apparel'],
  },
  {
    id: 'uv-dtf',
    label: 'UV DTF',
    copyPhrase: 'applied as a UV DTF transfer',
    lines: ['tumblers'],
  },
  {
    // The one method with a hard line through the middle of it: sublimation is
    // real here, but ONLY on metal panels and tumblers. A sublimated GARMENT is
    // something ITP cannot make, which is why this is declared per-line rather
    // than as a global "we do sublimation".
    id: 'sublimation',
    label: 'Sublimation',
    copyPhrase: 'dye-sublimated directly into the panel surface',
    lines: ['metal-art', 'tumblers'],
  },
  {
    id: 'digital-download',
    label: 'Digital download',
    copyPhrase: 'delivered as an instant digital download — nothing is shipped',
    lines: ['digital-download'],
  },
]

export interface ProductLine {
  id: ProductLineId
  label: string
  /** products.category values that belong to this line. */
  categories: string[]
  /** Methods allowed on this line; the first entry is the one copy declares. */
  methods: MethodId[]
  /**
   * A standing hold means: generate nothing new on this line. Not
   * "deprioritise" — zero briefs, zero listings. Read it through
   * `isLineOnHold()`, never directly, so the env override below always applies.
   */
  hold: boolean
  holdReason: string | null
  /** The Watchtower row that owns lifting the hold. */
  holdTaskId: string | null
  /** Env var that lifts the hold without a code change. */
  holdEnvVar: string | null
}

export const PRODUCT_LINES: ProductLine[] = [
  {
    id: 'apparel',
    label: 'Apparel',
    categories: ['t-shirts', 'hoodies', 'shirts'],
    methods: ['dtf'],
    hold: false,
    holdReason: null,
    holdTaskId: null,
    holdEnvVar: null,
  },
  {
    id: 'metal-art',
    label: 'Metal Art',
    categories: ['metal-art'],
    methods: ['sublimation'],
    // STANDING HOLD — Watchtower task c11af937. Mrs. Imagine must produce zero
    // metal briefs while this is true. Set ITP_METAL_ART_HOLD=false on the
    // backend to lift it; leaving the constant `true` means the hold survives a
    // fresh deploy with no env set, which is the safe direction to fail.
    hold: true,
    holdReason: 'Metal art is on a standing production hold (Watchtower c11af937) — no new metal listings.',
    holdTaskId: 'c11af937',
    holdEnvVar: 'ITP_METAL_ART_HOLD',
  },
  {
    id: 'tumblers',
    label: 'Tumblers',
    categories: ['tumblers', 'drinkware'],
    methods: ['uv-dtf', 'sublimation'],
    hold: false,
    holdReason: null,
    holdTaskId: null,
    holdEnvVar: null,
  },
  {
    id: 'digital-download',
    label: 'Digital Downloads',
    categories: ['digital-downloads', 'digital'],
    methods: ['digital-download'],
    hold: false,
    holdReason: null,
    holdTaskId: null,
    holdEnvVar: null,
  },
]

export function getProductLine(id: string | null | undefined): ProductLine | null {
  if (!id) return null
  return PRODUCT_LINES.find((l) => l.id === id) ?? null
}

/** products.category → the line it belongs to. Unknown category → null. */
export function lineForCategory(category: string | null | undefined): ProductLine | null {
  const c = (category || '').toLowerCase().trim()
  if (!c) return null
  return PRODUCT_LINES.find((l) => l.categories.includes(c)) ?? null
}

/**
 * Whether this line is on a standing hold RIGHT NOW.
 *
 * Reads the env var on every call rather than once at import: the batch runner
 * and the QA gate live in the same process for hours, and a hold that is only
 * read at boot is a hold nobody can trust.
 */
export function isLineOnHold(id: ProductLineId | string | null | undefined): boolean {
  const line = getProductLine(id)
  if (!line) return false
  if (line.holdEnvVar) {
    const override = process.env[line.holdEnvVar]
    if (override === 'false' || override === '0') return false
    if (override === 'true' || override === '1') return true
  }
  return line.hold
}

/** The same question asked with a products.category instead of a line id. */
export function isCategoryOnHold(category: string | null | undefined): boolean {
  const line = lineForCategory(category)
  return line ? isLineOnHold(line.id) : false
}

export function holdReasonFor(id: ProductLineId | string | null | undefined): string | null {
  const line = getProductLine(id)
  return line && isLineOnHold(line.id) ? line.holdReason : null
}

/** Every line currently frozen, for a one-line log at batch start. */
export function heldLines(): ProductLine[] {
  return PRODUCT_LINES.filter((l) => isLineOnHold(l.id))
}

/** The method a line's listing copy should declare; null for an unknown line. */
export function methodForLine(id: ProductLineId | string | null | undefined): ManufacturingMethod | null {
  const line = getProductLine(id)
  if (!line) return null
  const methodId = line.methods[0]
  return MANUFACTURING_METHODS.find((m) => m.id === methodId) ?? null
}

/** The sentence a generator must put in the copy for this products.category. */
export function decorationPhraseForCategory(category: string | null | undefined): string | null {
  const line = lineForCategory(category)
  return line ? (methodForLine(line.id)?.copyPhrase ?? null) : null
}

// ---------------------------------------------------------------------------
// BANNED DECORATION VOCABULARY — words a listing may never contain.
//
// Deliberately BLUNT, and the bluntness is the design rather than an oversight.
// The cost of a false positive is one regenerated paragraph (free and automatic
// — see writeCopy's retry in services/mrs-imagine.ts). The cost of a false
// NEGATIVE is a live listing promising a process the shop cannot run: a refund,
// a bad review and an Etsy policy problem. Those costs are not close, so the
// filter errs hard toward rejecting.
//
// Two known and ACCEPTED false positives, written down so nobody "fixes" them:
//   - "vinyl" also names a record. A retro vinyl-record design is a fine tee,
//     but "vinyl" in apparel copy overwhelmingly reads as heat-transfer vinyl,
//     which ITP does not cut. The design keeps its concept; the copy loses the
//     word.
//   - "knit" and "woven" are true statements about cotton fabric. They are
//     banned anyway, because inside a decoration sentence they claim a
//     construction we do not offer, and no buyer needs the weave named to buy
//     a t-shirt.
//
// Every pattern is stored as a SOURCE STRING, not a RegExp object. A shared /g
// RegExp carries `lastIndex` between calls and silently skips matches on every
// second scan — the same shape of bug as the '4x6' → '4X' plus-size match
// already documented above.
// ---------------------------------------------------------------------------

export interface BannedTerm {
  /** Regex source, matched case-insensitively with the global flag per call. */
  source: string
  /** Human name of the claim being blocked. */
  label: string
  /** What ITP actually does instead — goes straight into the fix instruction. */
  instead: string
}

export const BANNED_DECORATION_TERMS: BannedTerm[] = [
  { source: 'embroider\\w*', label: 'embroidery', instead: 'ITP does not embroider. Say the design is printed with a DTF transfer.' },
  { source: '\\bstitch(?:ed|ing|es)?\\b', label: 'stitching', instead: 'Nothing is stitched into the design. Describe the printed artwork instead.' },
  { source: '\\bscreen[-\\s]?print\\w*\\b', label: 'screen printing', instead: 'ITP does not screen print. The process is a DTF transfer.' },
  { source: '\\bsilk[-\\s]?screen\\w*\\b', label: 'silk screening', instead: 'ITP does not silk screen. The process is a DTF transfer.' },
  { source: '\\bvinyl\\b', label: 'vinyl / HTV', instead: 'ITP does not cut heat-transfer vinyl. Say DTF transfer and drop the word vinyl entirely.' },
  { source: '\\bhtv\\b', label: 'heat-transfer vinyl', instead: 'ITP does not cut heat-transfer vinyl. Say DTF transfer.' },
  { source: 'engrav\\w*', label: 'engraving', instead: 'Nothing is engraved. Metal art is dye-sublimated; apparel is DTF printed.' },
  { source: '\\betch(?:ed|ing)\\b', label: 'etching', instead: 'Nothing is etched. Metal art is dye-sublimated; apparel is DTF printed.' },
  { source: '\\bknit(?:ted|ting|s)?\\b', label: 'knitting', instead: 'Do not name the fabric construction. Describe the printed design.' },
  { source: '\\bwoven\\b', label: 'weaving', instead: 'Do not name the fabric construction. Describe the printed design.' },
  { source: '\\bappliqu(?:e|\u00e9)\\w*\\b', label: 'applique', instead: 'ITP does not applique. The design is a DTF transfer.' },
  { source: '\\bpatch(?:es|ed)?\\b', label: 'patches', instead: 'ITP does not sew patches. The design is printed directly on the garment.' },
  // NOT_OFFERED garments, as COPY claims. A title selling a "polo" is
  // unfulfillable even when the product row correctly says tshirt — 23 live
  // products claimed polo on 2026-09-01.
  { source: '\\bpolos?\\b', label: 'polo shirt', instead: 'ITP makes t-shirts, hoodies and youth t-shirts only. Sell one of those.' },
  { source: '\\btank[-\\s]?tops?\\b|\\btanktops?\\b', label: 'tank top', instead: 'ITP makes t-shirts, hoodies and youth t-shirts only. Sell one of those.' },
]

export interface BannedTermHit {
  /** The banned claim, by name. */
  label: string
  /** The literal words found, deduped. */
  matched: string[]
  instead: string
  /** Which field the words were found in ('title', 'description', 'tags'). */
  field?: string
}

/**
 * Every banned decoration claim in one blob of text. An empty array is clean.
 * A fresh RegExp per term per call, so this is stateless and safe to call in a
 * loop (see the lastIndex note above).
 */
export function findBannedDecorationTerms(text: string | null | undefined, field?: string): BannedTermHit[] {
  const haystack = String(text ?? '')
  if (!haystack) return []
  const hits: BannedTermHit[] = []
  for (const term of BANNED_DECORATION_TERMS) {
    const matches = haystack.match(new RegExp(term.source, 'gi'))
    if (matches && matches.length) {
      hits.push({
        label: term.label,
        matched: [...new Set(matches.map((m) => m.trim()))],
        instead: term.instead,
        ...(field ? { field } : {}),
      })
    }
  }
  return hits
}

/** The shape every copy-producing stage hands to the filter. */
export interface ListingCopyParts {
  title?: string | null
  description?: string | null
  tags?: string[] | null
}

/** Scan a whole listing — title, description and every tag — field by field. */
export function scanListingCopy(copy: ListingCopyParts): BannedTermHit[] {
  return [
    ...findBannedDecorationTerms(copy.title, 'title'),
    ...findBannedDecorationTerms(copy.description, 'description'),
    ...findBannedDecorationTerms((copy.tags ?? []).join(', '), 'tags'),
  ]
}

/** One line a model can act on: what was found and what to say instead. */
export function describeBannedHits(hits: BannedTermHit[]): string {
  return hits
    .map((h) => `${h.field ? `${h.field}: ` : ''}"${h.matched.join('", "')}" (${h.label}) — ${h.instead}`)
    .join(' ')
}

/**
 * HARD OUTPUT FILTER. Throws when listing copy claims anything ITP cannot make.
 *
 * Called immediately before any database insert, so that no code path —
 * generator, retry, repair, or a caller nobody has written yet — can land an
 * unfulfillable claim in `products`.
 */
export function assertCopyIsFulfillable(copy: ListingCopyParts, context = 'listing copy'): void {
  const hits = scanListingCopy(copy)
  if (hits.length) {
    throw new Error(`${context} claims production ITP cannot do — ${describeBannedHits(hits)}`)
  }
}

/**
 * The exact vocabulary rule handed to a copywriting model, built from the list
 * above so the prompt can never drift from the filter that judges its output.
 */
export function bannedVocabularyRule(): string {
  const words = BANNED_DECORATION_TERMS.map((t) => t.label).join(', ')
  return (
    'NEVER claim a production method this shop does not run. These are FORBIDDEN, and any listing ' +
    `containing one is rejected outright: ${words}. Do not use the words embroidered, embroidery, ` +
    'stitched, stitching, screen print, screen printed, silk screen, vinyl, HTV, engraved, etched, ' +
    'knit, knitted, woven, applique, patch, polo or tank top anywhere in the title, description or tags.'
  )
}

// The supplier side of the blank line: which Jiffy catalogue number backs each
// house tier / capability garment, and how to reach its page.
//
// Read by BOTH sides of the build boundary (same convention as
// backend/shared/blank-line.ts):
//   - backend/scripts/sync-jiffy-costs.ts         -> what to fetch
//   - backend/scripts/reprice-catalog-variants.ts -> which style prices a product
//   - backend/routes/admin/margins.ts             -> labels for the margin table
//
// COST BASIS (verified live 2026-09-22, no login). Jiffy's public product page
// renders its size grid as `data-color=... data-size=... data-amount=...`, and
// that `data-amount` is the wholesale unit price the account actually pays --
// it matched every one of the four tier costs David captured while SIGNED IN
// on 2026-09-02 to the cent (G500 Red: 2.99 / 6.93 / 8.60 / 9.53). The bigger
// struck-through `retail-amount` on the same row is Jiffy's MSRP and is stored
// as list_usd for context only. So the sync needs no credentials.
//
// jiffyshirts.com 301s to jiffy.com; use jiffy.com directly.

export const JIFFY_ORIGIN = 'https://www.jiffy.com'

/** Sizes as Jiffy prints them, smallest first. */
export const JIFFY_SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'] as const
export type JiffySize = (typeof JIFFY_SIZE_ORDER)[number]

export interface JiffyStyle {
  /** Catalogue number as Jiffy prints it -- the table's style_code. */
  code: string
  brand: string
  /** Page slug: https://www.jiffy.com/<slug>.html */
  slug: string
  /** backend/shared/blank-line.ts tier id, when this style backs a house tier. */
  tierId: 'standard' | 'soft' | 'premium' | 'heavyweight' | null
  /** catalog-capability garment this style is the blank for. */
  garmentId: 'tshirt' | 'hoodie' | 'youth-tshirt' | 'youth-hoodie' | null
  /** Manufacturer style as the rest of the codebase names it (Gildan "5000"). */
  manufacturerStyle: string
  label: string
}

/**
 * Every blank ITP sells or prints on. The four tee tiers mirror BLANK_LINE;
 * the hoodie and the two youth cuts come from catalog-capability's GARMENTS
 * and had NO cost data anywhere before this table existed -- which is exactly
 * how a $15 hoodie listing went live against a $15.09 blank.
 */
export const JIFFY_STYLES: JiffyStyle[] = [
  { code: 'G500', brand: 'Gildan', slug: 'gildan-G500', tierId: 'standard', garmentId: 'tshirt', manufacturerStyle: '5000', label: 'Heavy Cotton Tee' },
  { code: 'G640', brand: 'Gildan', slug: 'gildan-G640', tierId: 'soft', garmentId: 'tshirt', manufacturerStyle: '64000', label: 'Softstyle Tee' },
  { code: '3001C', brand: 'Bella+Canvas', slug: 'bellacanvas-3001C', tierId: 'premium', garmentId: 'tshirt', manufacturerStyle: '3001', label: 'Jersey Tee' },
  { code: 'C1717', brand: 'Comfort Colors', slug: 'comfortcolors-C1717', tierId: 'heavyweight', garmentId: 'tshirt', manufacturerStyle: '1717', label: 'Garment-Dyed Tee' },
  { code: 'G185', brand: 'Gildan', slug: 'gildan-G185', tierId: null, garmentId: 'hoodie', manufacturerStyle: '18500', label: 'Heavy Blend Hoodie' },
  { code: 'G500B', brand: 'Gildan', slug: 'gildan-G500B', tierId: null, garmentId: 'youth-tshirt', manufacturerStyle: '5000B', label: 'Heavy Cotton Youth Tee' },
  { code: 'G185B', brand: 'Gildan', slug: 'gildan-G185B', tierId: null, garmentId: 'youth-hoodie', manufacturerStyle: '18500B', label: 'Heavy Blend Youth Hoodie' }
]

export function jiffyStyleByCode(code: string | null | undefined): JiffyStyle | null {
  if (!code) return null
  const want = String(code).trim().toUpperCase()
  return JIFFY_STYLES.find(s => s.code.toUpperCase() === want) ?? null
}

export function jiffyStyleByTier(tierId: string | null | undefined): JiffyStyle | null {
  if (!tierId) return null
  return JIFFY_STYLES.find(s => s.tierId === tierId) ?? null
}

/** The youth blank that goes with an adult garment, or null. */
export function youthStyleFor(garmentId: string | null | undefined): JiffyStyle | null {
  if (garmentId === 'tshirt') return jiffyStyleByCode('G500B')
  if (garmentId === 'hoodie') return jiffyStyleByCode('G185B')
  return null
}

/** URL-safe colour slug -- Jiffy's own `?ac=` token. "Sport Grey" -> "sport-grey". */
export function jiffyColorSlug(name: string): string {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * The PDP for one colour. `ac` ("active colour") takes the colour NAME
 * url-encoded, NOT the anchor slug -- measured 2026-09-22: `?ac=sport-gray`
 * silently serves whatever colour the page defaults to (Sand, on a G640) while
 * `?ac=Sport%20Gray` serves the real thing. Single-word colours work either
 * way, which is exactly what makes the bug easy to miss: black/white/navy/red
 * all resolve, and only the two-word colours quietly come back wrong.
 */
export function jiffyProductUrl(style: JiffyStyle, colorName?: string | null): string {
  const base = `${JIFFY_ORIGIN}/${style.slug}.html`
  return colorName ? `${base}?ac=${encodeURIComponent(colorName)}` : base
}

// ---------------------------------------------------------------------------
// Capability colour -> supplier colour name.
//
// The storefront offers seven colours (catalog-capability COLORS). Every mill
// calls them something different, and the difference is not cosmetic: on a
// Gildan 5000 "White" costs $2.79 where "Red" costs $2.99, so resolving
// "white" to the wrong supplier name quietly prices the cheapest variant off
// the dearest cost. Per-style overrides first, then the shared default; the
// resolver takes the first alias that exists in the cost table.
// ---------------------------------------------------------------------------

export type CapabilityColorId =
  | 'black' | 'white' | 'navy' | 'heather-grey' | 'red' | 'forest-green' | 'royal-blue'

const DEFAULT_COLOR_ALIASES: Record<CapabilityColorId, string[]> = {
  black: ['Black'],
  white: ['White'],
  navy: ['Navy'],
  'heather-grey': ['Sport Grey', 'Sport Gray', 'Heather Grey', 'Athletic Heather', 'Grey', 'Gray'],
  red: ['Red'],
  'forest-green': ['Forest Green', 'Forest'],
  'royal-blue': ['Royal', 'True Royal', 'Royal Blue']
}

const STYLE_COLOR_ALIASES: Record<string, Partial<Record<CapabilityColorId, string[]>>> = {
  // Bella+Canvas names its greys and its royal differently.
  '3001C': {
    'heather-grey': ['Athletic Heather', 'Solid Athletic Gray', 'Ash'],
    'royal-blue': ['True Royal'],
    'forest-green': ['Forest']
  },
  // Comfort Colors is garment-dyed: no true heather, and royal is "Royal Caribe".
  C1717: {
    'heather-grey': ['Grey', 'Granite', 'Graphite'],
    'royal-blue': ['Royal Caribe', 'Flo Blue'],
    'forest-green': ['Blue Spruce', 'Emerald', 'Moss'],
    navy: ['True Navy', 'Navy']
  }
}

/** Supplier colour names to try, in order, for a capability colour on a style. */
export function supplierColorCandidates(styleCode: string, colorId: CapabilityColorId): string[] {
  const overrides = STYLE_COLOR_ALIASES[styleCode.toUpperCase()]?.[colorId] ?? []
  const seen = new Set<string>()
  return [...overrides, ...DEFAULT_COLOR_ALIASES[colorId]].filter(n => {
    const k = n.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export const CAPABILITY_COLOR_IDS: CapabilityColorId[] =
  Object.keys(DEFAULT_COLOR_ALIASES) as CapabilityColorId[]

/**
 * Every supplier colour name worth syncing when the caller asks only for the
 * colours we actually sell (`--colors used`). Union of the capability aliases
 * across the style -- a superset costs one extra page fetch, a missing one is
 * a pricing hole.
 */
export function usedSupplierColorNames(styleCode: string): string[] {
  const out = new Set<string>()
  for (const id of CAPABILITY_COLOR_IDS) {
    for (const n of supplierColorCandidates(styleCode, id)) out.add(n)
  }
  return [...out]
}

// ---------------------------------------------------------------------------
// Youth sizes.
//
// A youth tee is a different blank (G500B), not a smaller G500, and Jiffy
// prints its sizes as XS-XL while ITP sells them as YXS-YXL. This is the ONE
// place that translation lives.
// ---------------------------------------------------------------------------

export const YOUTH_SIZE_TO_SUPPLIER: Record<string, JiffySize> = {
  YXS: 'XS', YS: 'S', YM: 'M', YL: 'L', YXL: 'XL'
}

export function supplierSizeFor(size: string): string {
  const key = String(size ?? '').trim().toUpperCase()
  return YOUTH_SIZE_TO_SUPPLIER[key] ?? key
}

export function isYouthSizeToken(size: string): boolean {
  return Object.prototype.hasOwnProperty.call(YOUTH_SIZE_TO_SUPPLIER, String(size ?? '').trim().toUpperCase())
}

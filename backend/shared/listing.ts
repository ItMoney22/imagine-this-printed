// What a listing IS and what its product page shows: the kind, the sizes and
// colours a shopper can pick, and the gallery images in page order. Moved here
// from src/lib/product-kind.ts (which re-exports every name unchanged) so the
// server can read the SAME answers the product page renders — the Google
// Shopping / Pinterest product feed (routes/seo.ts, task 1df2f0be) must list
// exactly the sizes and images a shopper sees, not a second copy of the rules.
// Same frontend/backend shared-code convention as metal-art.ts and
// product-gallery.ts.
import {
  normalizeGarment,
  adultSizesForGarment,
  youthSizesForGarment,
  isYouthSize,
  printWidthForSize
} from './catalog-capability.js'
import { STUDIO_SIZE_KEYS, metalSizesFor, type MetalArtSizeKey } from './metal-art.js'
import { isCreatorProductMeta } from './creator-product.js'

/** The product-row fields these rules read. src/types Product satisfies it. */
export interface ListingRow {
  category?: string | null
  metadata?: Record<string, any> | null
  images?: string[] | null
  sizes?: string[] | null
  colors?: string[] | null
}

export type ProductKind = 'metal' | '3d' | 'apparel'

/** The panel sizes a metal print offers, canonical + in studio order (legacy 8x11 → 8x10). */
export function metalSizeOptions(product: Pick<ListingRow, 'metadata' | 'sizes'>): MetalArtSizeKey[] {
  return metalSizesFor(product)
}

// True when the product is a blank garment sold as-is (no print). Blanks are
// seeded with metadata.garment = { blank: true, tier, brand, style_code } and
// metadata.blank_style pinning them to blank_inventory for auto-decrement.
export function isBlankProduct(product: Pick<ListingRow, 'metadata'>): boolean {
  return product?.metadata?.garment?.blank === true || product?.metadata?.blank_only === true
}

export function productKindOf(product: Pick<ListingRow, 'category' | 'metadata'>): ProductKind {
  const c = String(product?.category || '').toLowerCase()
  const t = String(product?.metadata?.product_template || product?.metadata?.category || '').toLowerCase()
  if (c.includes('metal') || t.includes('metal') || t.includes('wall')) return 'metal'
  if (c.includes('3d') || c.includes('toy') || t.includes('3d') || t.includes('toy')) return '3d'
  return 'apparel'
}

// Canonical catalog category id used by the storefront filter/sidebar. Falls
// back to the column when it's already a real apparel category.
// Category values that exist in the products table but are NOT the ids the
// catalog sidebar filters on, so a product carrying one is counted under "All
// Products" yet unreachable from every category pill. Live data holds a
// `t-shirts` row today (verified 2026-07-29); `3d-models` is in the Product
// category union while the sidebar only offers `3d-prints`.
export const CATEGORY_ALIASES: Record<string, string> = {
  't-shirts': 'shirts',
  tshirts: 'shirts',
  shirt: 'shirts',
  tee: 'shirts',
  tees: 'shirts',
  hoodie: 'hoodies',
  tumbler: 'tumblers',
  'dtf-transfer': 'dtf-transfers',
  '3d-models': '3d-prints',
  '3d-print': '3d-prints',
  'metal-arts': 'metal-art',
  metal: 'metal-art',
  // Legacy vendor-dashboard categories (pre-reconciliation, see
  // VendorDashboard.tsx) — these were generic merch tags, not real product
  // types, so there's no better bucket than the apparel default.
  gaming: 'shirts',
  eco: 'shirts',
  office: 'shirts',
  lifestyle: 'shirts',
  tech: 'shirts',
}

export function canonicalCategoryOf(product: Pick<ListingRow, 'category' | 'metadata'>): string {
  const kind = productKindOf(product)
  if (kind === 'metal') return 'metal-art'
  if (kind === '3d') return '3d-prints'
  // apparel: keep an explicit existing category, else default to shirts
  const c = String(product?.category || '').toLowerCase().trim()
  if (!c) return 'shirts'
  return CATEGORY_ALIASES[c] || c
}

// Default size options when a product has none set on its column. Type-aware so
// metal shows print sizes instead of shirt sizes.
//
// 3D returns NOTHING on purpose (David 2026-09-06): a printed object ships at
// the one size shown in its own product photo, so inventing a mini/small/
// medium/large ladder promised four variants that don't exist and forced the
// customer to pick one before checking out. A 3D listing that really is sold
// in tiers carries them explicitly on products.sizes (the admin size picker
// offers TIER_3D), and those still render. Empty here means "one size" —
// callers must hide the size picker and not require a selection.
export function defaultSizesFor(kind: ProductKind): string[] {
  if (kind === 'metal') return STUDIO_SIZE_KEYS
  if (kind === '3d') return []
  // Apparel's fallback is the capability table's adult tee range, NOT the
  // hardcoded S-2XL this used to return. That stale list was what every live
  // shirt and hoodie actually showed (measured 2026-09-07: all 84 rows carry
  // an EMPTY sizes column, so every one of them fell through to here) — it
  // was quietly hiding the 3XL we do stock.
  return adultSizesForGarment('tshirt')
}

/** The garment a product row is for: its explicit product_type, else its category. */
export function garmentIdOf(product: Pick<ListingRow, 'category' | 'metadata'>): string | null {
  return normalizeGarment(product?.metadata?.product_type) ?? normalizeGarment(product?.category ?? null)
}

/**
 * The sizes a product page/card should actually offer, and therefore whether a
 * size must be picked before add-to-cart. ONE answer shared by ProductPage and
 * ProductCard so the catalog card and the product page can never disagree
 * about whether a listing has sizes at all.
 */
export function sizeChoicesFor(
  product: Pick<ListingRow, 'category' | 'metadata' | 'sizes'>
): string[] {
  const kind = productKindOf(product)
  if (kind === 'metal') return metalSizeOptions(product)
  // A transfer is film, not a shirt: it is sold by print width, never S-3XL.
  if (listingKindOf(product) === 'dtf-transfer') return transferSizeChoicesFor(product)
  // An EMPTY sizes column is truthy, so the legacy metadata fallback has to be
  // tried on length, not on `||` — otherwise a row that was migrated to the
  // column but left empty hides the metadata list it still carries.
  const column = product?.sizes
  const legacy = (product as any)?.metadata?.sizes
  const stored =
    Array.isArray(column) && column.length > 0 ? column
    : Array.isArray(legacy) && legacy.length > 0 ? legacy
    : null

  // Printed apparel ALSO sells the youth cut of the same garment on the same
  // listing (David 2026-09-07: "all of our shirts and hoodies available in
  // youth sizes as well"). Appended to whatever the row stores rather than
  // read instead of it, so a row whose sizes column was frozen before the
  // youth band existed still offers youth — the requirement is that no shirt
  // or hoodie can be missing it, and a stale column must not be able to.
  //
  // Blanks are excluded: a blank's sizes ARE its price table (every size in
  // the picker must have a row in metadata.garment.pricing, and the youth
  // blanks aren't in that table), so adding a size we cannot price would make
  // it unbuyable. Blanks are their own /blanks lane, not a printed listing.
  if (kind === 'apparel' && !isBlankProduct(product)) {
    const garment = garmentIdOf(product)
    // The fallback is THIS garment's own band, not a generic apparel default.
    // defaultSizesFor() answers for the adult tee, so using it here would put
    // S-3XL on a youth-tee listing whose sizes column happens to be empty —
    // a photo of a child advertising sizes we'd never ship them.
    const base = stored ?? adultSizesForGarment(garment)
    // The same rule for a band that GREW: 4XL joined on 2026-10-16 (David, a
    // customer wanted the Folgers tee in 4XL), after ~2,400 rows had already
    // frozen S-3XL into their column. A listing that sells 3XL gets 4XL right
    // after it. One that stops short of 3XL was cut down on purpose (a few
    // live ones stop at XL or 2XL) and is left exactly as it is.
    const has = (size: string) => base.some(b => String(b).toUpperCase() === size)
    const grows = has('3XL') && !has('4XL') && adultSizesForGarment(garment).includes('4XL')
    const at = grows ? base.findIndex(b => String(b).toUpperCase() === '3XL') + 1 : base.length
    const withGrown = grows ? [...base.slice(0, at), '4XL', ...base.slice(at)] : base
    const youth = youthSizesForGarment(garment)
    const missing = youth.filter(y => !has(y))
    return [...withGrown, ...missing]
  }

  return stored ?? defaultSizesFor(kind)
}

// ---------------------------------------------------------------------------
// What the shopper is buying, and therefore which pickers the listing shows
// (David 2026-10-07 live phone walk). productKindOf() only splits apparel /
// metal / 3D, so a $5 DTF transfer and a hoodie both rendered as a t-shirt:
// shirt sizes, shirt colours and the tee blanks on a transfer, and the tee
// blanks on a hoodie. This is the finer answer the product page and the
// catalog card both read.
//
// Precedence: metal / 3D (productKindOf) -> blank -> the dtf-transfers
// category -> hoodie (category or garment) -> tee. The category column beats
// metadata.product_type on purpose: the transfer rows were generated by the
// garment builder and still say product_type 'tshirt'.
export type ListingKind = 'dtf-transfer' | 'hoodie' | 'tee' | 'blank' | 'metal' | '3d'

export function listingKindOf(product: Pick<ListingRow, 'category' | 'metadata'>): ListingKind {
  const kind = productKindOf(product)
  if (kind === 'metal') return 'metal'
  if (kind === '3d') return '3d'
  if (isBlankProduct(product)) return 'blank'
  const category = canonicalCategoryOf(product)
  if (category === 'dtf-transfers') return 'dtf-transfer'
  if (category === 'hoodies' || garmentIdOf(product) === 'hoodie') return 'hoodie'
  return 'tee'
}

/**
 * A personalizable template: the design ships with an empty photo slot and
 * the customer supplies the picture (backend/routes/admin/ai-products.ts
 * writes is_template + personalization 'customer_photo').
 */
export function isCustomTemplate(product: Pick<ListingRow, 'metadata'>): boolean {
  return product?.metadata?.is_template === true || product?.metadata?.personalization === 'customer_photo'
}

export interface ListingOptionSets {
  kind: ListingKind
  /** Which blank line the quality picker offers; null = no picker. */
  blankPicker: 'tee' | 'hoodie' | null
  colors: boolean
  placement: boolean
  /** "Upload Your Own Design" — only where the shopper brings the art. */
  upload: boolean
  /** "Add to Imagination Sheet" — the gang sheet; needs artwork to put on it. */
  gangSheet: boolean
  /** Virtual try-on dresses a person, so only garments. */
  tryOn: boolean
}

export function listingOptionSets(product: Pick<ListingRow, 'category' | 'metadata'>): ListingOptionSets {
  const kind = listingKindOf(product)
  // A creator's own apparel (backend/shared/creator-product.ts) is sold as
  // their shirt: no design tools, no putting their art on a gang sheet
  // (David 2026-10-07, Darrell's "Walk By Faith").
  const creator = isCreatorProductMeta(product?.metadata)
  const upload = !creator && (isBlankProduct(product) || isCustomTemplate(product))
  const gangSheet = !creator
  switch (kind) {
    case 'dtf-transfer':
      return { kind, blankPicker: null, colors: false, placement: false, upload, gangSheet, tryOn: false }
    case 'hoodie':
      return { kind, blankPicker: 'hoodie', colors: true, placement: true, upload, gangSheet, tryOn: true }
    case 'tee':
      return { kind, blankPicker: 'tee', colors: true, placement: true, upload, gangSheet, tryOn: true }
    case 'blank':
      // A blank IS its tier and has nothing printed, so no quality picker,
      // no placement and no artwork for a gang sheet.
      return { kind, blankPicker: null, colors: true, placement: false, upload, gangSheet: false, tryOn: true }
    default:
      return { kind, blankPicker: null, colors: true, placement: false, upload: false, gangSheet: false, tryOn: false }
  }
}

/** The colours a listing offers; a transfer has none (it is film, not a shirt). */
export function colorChoicesFor(product: Pick<ListingRow, 'category' | 'metadata' | 'colors'>): string[] {
  return listingOptionSets(product).colors ? (product?.colors ?? []) : []
}

// Shirt sizes a transfer row may still carry from the garment builder. They
// are never transfer sizes, so they are dropped rather than offered.
const GARMENT_SIZE_TOKENS = new Set(['XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '2X', 'XXXL', '3XL', '3X', '4XL', '4X', '5XL', '5X'])

/**
 * The sizes a DTF transfer is sold in. Real transfer sizes stored on the row
 * (an admin's '8.5x11"' sheet sizes) win. Otherwise the transfer is offered at
 * the width the design is printed on our own shirts — metadata.print_size_inches,
 * else the adult tee's front print — plus the youth tee's narrower print, both
 * from the capability table. Both sell at the listing price: the smaller print
 * uses less film, so it can never be sold at a loss.
 */
export function transferSizeChoicesFor(product: Pick<ListingRow, 'metadata' | 'sizes'>): string[] {
  const stored = [
    ...(Array.isArray(product?.sizes) ? product.sizes : []),
    ...(Array.isArray(product?.metadata?.sizes) ? product.metadata.sizes : [])
  ]
    .map(s => String(s).trim())
    .filter(s => s && !GARMENT_SIZE_TOKENS.has(s.toUpperCase()) && !isYouthSize(s))
  if (stored.length > 0) return Array.from(new Set(stored))

  const recorded = Number(product?.metadata?.print_size_inches)
  const adult = Number.isFinite(recorded) && recorded >= 3 && recorded <= 16
    ? Math.round(recorded)
    : printWidthForSize('tshirt') ?? 11
  const youth = printWidthForSize('tshirt', youthSizesForGarment('tshirt')[0]) ?? 8
  return adult > youth ? [`${adult} in (adult)`, `${youth} in (youth)`] : [`${adult} in`]
}

/**
 * The size a listing opens on, or '' when the shopper must choose. A transfer
 * opens on its first (adult) size and a metal print on its smallest panel, so
 * the page shows a real, buyable price; a one-size listing has nothing to
 * choose. Garment sizes are never guessed: a wrong shirt size is a return.
 */
export function defaultSizeFor(product: Pick<ListingRow, 'category' | 'metadata' | 'sizes'>): string {
  const choices = sizeChoicesFor(product)
  const kind = listingKindOf(product)
  if (kind === 'metal' || kind === 'dtf-transfer' || choices.length === 1) return choices[0] ?? ''
  return ''
}

// Role-tagged design assets stored on products.metadata.assets. This lets the
// storefront show only display-safe images (clean art + contextual mockups)
// while halftone / DTF print files stay HIDDEN as paid digital deliverables —
// a raw halftone "looks shitty on the product list", so it's never a thumbnail.
export interface ProductAssets {
  clean?: string         // clean design art — un-watermarked DELIVERABLE (download)
  display?: string       // watermarked public hero variant of the clean art
  mockups?: string[]     // in-room / on-person mockups (best hero)
  halftone?: string      // halftone version — deliverable only (digital)
  dtf?: string           // DTF print-ready file — deliverable only (digital)
}

export function getProductAssets(product: Pick<ListingRow, 'metadata'>): ProductAssets {
  const a = product?.metadata?.assets
  return a && typeof a === 'object' ? a as ProductAssets : {}
}

// Public gallery images (hero + thumbnails): contextual mockups first (a
// shirt-on-person / art-in-room reads far better in a grid than flat art),
// then clean art, then any remaining raw images — but NEVER the halftone or DTF
// deliverables. Deduped, falsy-stripped, order preserved.
export function getGalleryImages(product: Pick<ListingRow, 'images' | 'metadata'>): string[] {
  const assets = getProductAssets(product)
  // A creator's own apparel leads with their garment photos and never shows
  // the bare art: on white it lost Darrell's cream lettering entirely, and
  // its clean/DTF files ARE the print file (David 2026-10-07).
  if (isCreatorProductMeta(product?.metadata)) {
    const hidden = new Set([assets.display, assets.clean, assets.dtf, assets.halftone, (assets as Record<string, unknown>).back_print].filter(Boolean) as string[])
    const photos: string[] = []
    for (const u of [...(assets.mockups || []), product?.metadata?.mockup_url, ...(product?.images || [])]) {
      if (u && typeof u === 'string' && !photos.includes(u) && !hidden.has(u)) photos.push(u)
    }
    return photos
  }
  // Deliverables are download-only; they must never appear in the display set,
  // even if one also sits in images[] (legacy halftone-as-images[0]). Once a
  // watermarked `display` exists, the clean original is also gated out of view.
  const deliverables = new Set([assets.halftone, assets.dtf].filter(Boolean) as string[])
  if (assets.display && assets.clean) deliverables.add(assets.clean)
  const out: string[] = []
  const push = (u?: string | null) => {
    if (u && typeof u === 'string' && !out.includes(u) && !deliverables.has(u)) out.push(u)
  }
  // A garment shot (ghost mannequin, flat lay, hanger, composite, on-model)
  // leads even when a watermarked art `display` exists: a catalog tile that
  // opens on bare art, or art on a painted checkerboard, reads as broken
  // (task 732f8a71, live walk 10/7). Rows with no garment shot are unchanged.
  const shots = (product?.images || []).filter(isGarmentShotUrl).sort((a, b) => garmentShotRank(a) - garmentShotRank(b))
  shots.forEach(push)
  push(assets.display)                  // watermarked hero (preferred)
  ;(assets.mockups || []).forEach(push)
  push(product?.metadata?.mockup_url)   // legacy single mockup
  push(assets.clean)                    // un-watermarked clean (only if no display)
  ;(product?.images || []).forEach(push)
  return out
}

// Folder names the garment-shot pipeline writes under (step-flow shots, blank
// composites, Etsy on-model shots). Raw art lives under /original/,
// /ai-generated/, design-library/, mrs-imagine/<id>/ or a bare products/<id>.png.
const GARMENT_SHOT_RANK: Array<[RegExp, number]> = [
  [/\/ghost_mannequin\//i, 0],
  [/\/flat_lay\//i, 1],
  [/\/hanger\//i, 2],
  [/\/composite\//i, 3],
  [/\/mr_imagine\//i, 4],
  [/etsy_shot_/i, 5],
]

function garmentShotRank(url: string): number {
  const hit = GARMENT_SHOT_RANK.find(([re]) => re.test(url))
  return hit ? hit[1] : 99
}

/** True for a url the shot pipeline made of the garment itself (not the bare art, not a details card). */
export function isGarmentShotUrl(url: unknown): url is string {
  return typeof url === 'string' && garmentShotRank(url) < 99
}

// Single source of truth for "what kind of product is this" + the metal-art
// add-on catalog. Used by ProductPage, ProductCard, ProductCatalog and the
// cart so apparel / metal / 3D are classified and priced consistently.
//
// The classification reads the products.category column FIRST, then falls back
// to metadata.product_template / metadata.category. This matters because some
// approved products (notably metal art submitted before the approval route set
// the category column) have a null category but carry product_template
// 'metal-art' in metadata — without the fallback they'd render as t-shirts.
import type { Product, CartAddon, TshirtPrintLocation } from '../types'
import { isBlankGarmentMeta, blankPricingOf, blankUnitPriceDollars } from '../../backend/shared/blank-pricing'
import {
  normalizeGarment,
  adultSizesForGarment,
  youthSizesForGarment,
  isYouthSize,
  isPlusSize,
  printWidthForSize,
  PLUS_SIZE_UPCHARGE_DOLLARS,
  YOUTH_SIZE_DISCOUNT_DOLLARS
} from '../../backend/shared/catalog-capability'
import {
  STUDIO_SIZE_KEYS,
  METAL_ADDONS as METAL_ADDONS_SHARED,
  METAL_ART_PRICES,
  metalSizesFor,
  normalizeMetalSizeKey,
  type MetalArtSizeKey
} from '../../backend/shared/metal-art'
import { isCreatorProductMeta } from '../../backend/shared/creator-product'

export type ProductKind = 'metal' | '3d' | 'apparel'

// Catalog of metal-art add-ons. `printed` = produced in-house on our 3D
// printer. Prices/labels/blurbs now come from backend/shared/metal-art.ts —
// the single source of truth also read by order-pricing.ts server-side —
// this just adapts that {id,label,cents,printed,blurb} shape into the
// {id,name,price,printed,blurb} shape the storefront (ProductPage.tsx) has
// always rendered, with price in DOLLARS (the shared module stores cents).
// Order: easel_stand, standoff_mount, hanging_kit, gift_box, magnet_mount,
// printed_stand (insertion order of the shared catalog).
//
// AdminCreatorProductsTab.tsx still carries its own separate duplicate list
// for the approval UI (out of scope for this change) — keep its ids in sync
// by hand until it's migrated to import from the shared module too.
export const METAL_ADDONS: { id: string; name: string; price: number; printed: boolean; blurb: string }[] =
  Object.values(METAL_ADDONS_SHARED).map(a => ({
    id: a.id,
    name: a.label,
    price: a.cents / 100,
    printed: a.printed,
    blurb: a.blurb
  }))

// Catalog of 3D-toy add-ons (David 2026-08-19): every toy prints with hidden
// magnets in both palms, so extra parts snap on — and the paint kit ships
// paints matched to the toy's own ≤4-color palette (metadata.print3d.palette).
// Keep ids + prices in sync with TOY_ADDONS_CENTS in
// backend/services/order-pricing.ts (server-verified, unknown id = hard error).
export const TOY_ADDONS: { id: string; name: string; price: number; printed: boolean; blurb: string }[] = [
  { id: 'toy_paint_kit',     name: 'Matched paint kit',          price: 15,   printed: false, blurb: 'The exact paints for THIS toy\'s colors — a fun paint-at-home project for kids.' },
  { id: 'toy_weapon_pack',   name: 'Snap-on weapon pack',        price: 6.99, printed: true,  blurb: '3 magnet-mount weapons that snap right into your figure\'s hands.' },
  { id: 'toy_pet_companion', name: 'Pet companion',              price: 9.99, printed: true,  blurb: 'A mini magnet-base sidekick printed to match your figure.' },
  { id: 'toy_magnet_pair',   name: 'Extra magnet pair',          price: 2.99, printed: false, blurb: 'Spare 5mm magnets for your own snap-on creations.' },
]

export function getAddonById(id: string) {
  return METAL_ADDONS.find(a => a.id === id) || TOY_ADDONS.find(a => a.id === id) || null
}

// Resolve the add-on ids stored on a product (metadata.addons) into the full
// catalog entries the storefront can render + price. A METAL PRINT with no
// explicit list offers the whole metal add-on catalog (mounting magnets, 3D
// printed stands, ...): David 2026-09-02 — the Step Flow never wrote
// metadata.addons, so every metal print published through it reached the
// storefront with no add-ons at all. An explicit non-empty list still wins.
export function resolveProductAddons(product: Product): typeof METAL_ADDONS {
  const ids = product?.metadata?.addons
  if (Array.isArray(ids) && ids.length > 0) {
    return ids
      .map((id: string) => getAddonById(id))
      .filter((a): a is (typeof METAL_ADDONS)[number] => !!a)
  }
  if (productKindOf(product) === 'metal') return METAL_ADDONS
  return []
}

// ---------------------------------------------------------------------------
// Per-unit BASE price (before add-ons / tier / plus-size extras) — the ONE
// storefront answer to "what does this line cost", shared by ProductPage, the
// cart, the floating cart and the checkout summary so they can never
// disagree. Mirrors backend/services/order-pricing.ts server-side:
//   - metal print → the panel size's price from the locked shared table
//     (4x6 $8.95 / 8x10 $16.95), defaulting to the listing's smallest offered
//     size when no size is picked yet. `products.price` on a metal row is
//     only its entry price and is never charged for a larger panel.
//   - everything else → products.price.
export function unitBasePrice(product: Pick<Product, 'price' | 'category' | 'metadata' | 'sizes'>, selectedSize?: string | null): number {
  if (productKindOf(product) === 'metal') {
    const key: MetalArtSizeKey = normalizeMetalSizeKey(selectedSize) ?? metalSizesFor(product)[0]
    return METAL_ART_PRICES[key]
  }
  return Number(product?.price) || 0
}

/** Catalog-card price: a metal print's smallest offered size ("from $8.95"), else products.price. */
/**
 * One cart/checkout line's BASE unit price, with BOTH special rails in one
 * place so the storefront can never disagree with the server:
 *   1. a BLANK garment prices off its size x colour table (blank-pricing.ts),
 *   2. a METAL print off the panel size the customer picked,
 *   3. everything else off the flat catalog price.
 * Same precedence as computeLineItemCents in backend/services/order-pricing.ts
 * (blank checked first - a product is never both).
 */
export function lineBasePrice(
  product: Pick<Product, 'price' | 'category' | 'metadata' | 'sizes'>,
  selectedSize?: string | null,
  selectedColor?: string | null
): number {
  if (isBlankGarmentMeta(product?.metadata)) {
    const p = blankUnitPriceDollars(blankPricingOf(product?.metadata), selectedSize, selectedColor)
    if (p !== null) return p
  }
  return unitBasePrice(product, selectedSize)
}

export function startingPrice(product: Pick<Product, 'price' | 'category' | 'metadata' | 'sizes'>): number {
  return unitBasePrice(product)
}

/** True when the card/page should say "from" — a metal print offering more than one size. */
export function hasPriceRange(product: Pick<Product, 'price' | 'category' | 'metadata' | 'sizes'>): boolean {
  return productKindOf(product) === 'metal' && metalSizesFor(product).length > 1
}

/** The panel sizes a metal print offers, canonical + in studio order (legacy 8x11 → 8x10). */
export function metalSizeOptions(product: Pick<Product, 'metadata' | 'sizes'>): MetalArtSizeKey[] {
  return metalSizesFor(product)
}

/** Price of one panel size in dollars, for size-picker labels. */
export function metalSizePrice(sizeKey: MetalArtSizeKey): number {
  return METAL_ART_PRICES[sizeKey]
}

// True when the product is a blank garment sold as-is (no print). Blanks are
// seeded with metadata.garment = { blank: true, tier, brand, style_code } and
// metadata.blank_style pinning them to blank_inventory for auto-decrement.
export function isBlankProduct(product: Pick<Product, 'metadata'>): boolean {
  return product?.metadata?.garment?.blank === true || product?.metadata?.blank_only === true
}

// Per-unit sum of selected add-on prices.
export function addonsUnitTotal(addons?: CartAddon[] | null): number {
  if (!Array.isArray(addons)) return 0
  return addons.reduce((sum, a) => sum + (Number(a.price) || 0), 0)
}

// Stable signature so the cart can treat "same product, different add-ons" as
// distinct line items.
export function addonsSignature(addons?: CartAddon[] | null): string {
  if (!Array.isArray(addons) || addons.length === 0) return ''
  return addons.map(a => a.id).sort().join(',')
}

/**
 * Stable signature for a personalized line's field values.
 *
 * Used in the cart merge key so SMITH 22 and LOPEZ 41 in the same size stay
 * TWO lines. Keys are sorted, so an object built in a different order still
 * matches — otherwise a repeat add could fail to merge and the cart would show
 * the same player twice.
 */
export function personalizationSignature(values?: Record<string, string> | null): string {
  if (!values || typeof values !== 'object') return ''
  const keys = Object.keys(values).filter(k => values[k] !== undefined && values[k] !== '')
  if (keys.length === 0) return ''
  return keys.sort().map(k => `${k}=${values[k]}`).join('&')
}

export function productKindOf(product: Pick<Product, 'category' | 'metadata'>): ProductKind {
  const c = String(product?.category || '').toLowerCase()
  const t = String(product?.metadata?.product_template || product?.metadata?.category || '').toLowerCase()
  if (c.includes('metal') || t.includes('metal') || t.includes('wall')) return 'metal'
  if (c.includes('3d') || c.includes('toy') || t.includes('3d') || t.includes('toy')) return '3d'
  // Home decor is printed on the same 3D printers (the candle holder), so it
  // sells like a 3D print: one size, no shirt tools. It just isn't a toy.
  if (c === HOME_DECOR_CATEGORY) return '3d'
  return 'apparel'
}

/** 3D-printed decor that is not a toy (task 389defc8: the candle holder). */
export const HOME_DECOR_CATEGORY = 'home-decor'

/**
 * "Candle not included" — what the product photo shows that the box does not
 * hold. Read from metadata.not_included (e.g. ["Candle"]); null when nothing.
 */
export function notIncludedNote(product: Pick<Product, 'metadata'> | null | undefined): string | null {
  const raw = product?.metadata?.not_included
  const items = (Array.isArray(raw) ? raw : []).map(x => String(x).trim()).filter(Boolean)
  if (items.length === 0) return null
  const list = items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
  return `${list} not included`
}

/** Age floor for anything with magnets in it (CPSC magnet rule territory). */
export const MAGNET_AGE_FLOOR = 14

/**
 * True when a printed figure carries magnets: Toy Factory figures record
 * print3d.magnet_sockets, and the magnet add-on is sold with them.
 */
export function hasMagnets(product: Pick<Product, 'category' | 'metadata'> | null | undefined): boolean {
  const m = product?.metadata
  if (!m) return false
  if (Number(m.print3d?.magnet_sockets) > 0) return true
  return Array.isArray(m.addons) && m.addons.includes('toy_magnet_pair')
}

// Canonical catalog category id used by the storefront filter/sidebar. Falls
// back to the column when it's already a real apparel category.
// Category values that exist in the products table but are NOT the ids the
// catalog sidebar filters on, so a product carrying one is counted under "All
// Products" yet unreachable from every category pill. Live data holds a
// `t-shirts` row today (verified 2026-07-29); `3d-models` is in the Product
// category union while the sidebar only offers `3d-prints`.
const CATEGORY_ALIASES: Record<string, string> = {
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

export function canonicalCategoryOf(product: Pick<Product, 'category' | 'metadata'>): string {
  if (String(product?.category || '').toLowerCase().trim() === HOME_DECOR_CATEGORY) return HOME_DECOR_CATEGORY
  const kind = productKindOf(product)
  if (kind === 'metal') return 'metal-art'
  if (kind === '3d') return '3d-prints'
  // apparel: keep an explicit existing category, else default to shirts
  const c = String(product?.category || '').toLowerCase().trim()
  if (!c) return 'shirts'
  return CATEGORY_ALIASES[c] || c
}

// Storefront category ids ProductCatalog.tsx filters on (matches its
// `categories` array). Shared with VendorDashboard.tsx so vendor
// creation/edit forms only ever offer categories the catalog can actually
// route a product to.
export const STOREFRONT_CATEGORIES: { id: string; label: string }[] = [
  { id: 'shirts', label: 'T-Shirts' },
  { id: 'hoodies', label: 'Hoodies' },
  { id: 'tumblers', label: 'Tumblers' },
  { id: 'dtf-transfers', label: 'DTF Transfers' },
  { id: '3d-prints', label: '3D Prints' },
  { id: 'home-decor', label: 'Home Decor' },
  { id: 'metal-art', label: 'Metal Art' },
]

// Reverse of CATEGORY_ALIASES: every raw `products.category` value —
// including the canonical id itself — that resolves to a given canonical
// storefront category. ProductCatalog's server-side filter uses this so a
// category-tab click also matches legacy/aliased values already sitting in
// the table, not just the canonical id (canonicalCategoryOf alone only
// affects client-side display, run *after* the DB query already excluded
// the row).
export function categoryValuesFor(canonicalId: string): string[] {
  const values = new Set<string>([canonicalId])
  for (const [raw, canonical] of Object.entries(CATEGORY_ALIASES)) {
    if (canonical === canonicalId) values.add(raw)
  }
  return Array.from(values)
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
export function garmentIdOf(product: Pick<Product, 'category' | 'metadata'>): string | null {
  return normalizeGarment(product?.metadata?.product_type) ?? normalizeGarment(product?.category ?? null)
}

/**
 * The sizes a product page/card should actually offer, and therefore whether a
 * size must be picked before add-to-cart. ONE answer shared by ProductPage and
 * ProductCard so the catalog card and the product page can never disagree
 * about whether a listing has sizes at all.
 */
export function sizeChoicesFor(
  product: Pick<Product, 'category' | 'metadata' | 'sizes'>
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
    const youth = youthSizesForGarment(garment)
    const missing = youth.filter(y => !base.some(b => String(b).toUpperCase() === y))
    return [...base, ...missing]
  }

  return stored ?? defaultSizesFor(kind)
}

/** True when this size is the youth cut of the listing's garment. Re-exported
 *  so the storefront doesn't import the capability module in five places. */
export { isYouthSize }

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

export function listingKindOf(product: Pick<Product, 'category' | 'metadata'>): ListingKind {
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
export function isCustomTemplate(product: Pick<Product, 'metadata'>): boolean {
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

export function listingOptionSets(product: Pick<Product, 'category' | 'metadata'>): ListingOptionSets {
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
export function colorChoicesFor(product: Pick<Product, 'category' | 'metadata' | 'colors'>): string[] {
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
export function transferSizeChoicesFor(product: Pick<Product, 'metadata' | 'sizes'>): string[] {
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
export function defaultSizeFor(product: Pick<Product, 'category' | 'metadata' | 'sizes'>): string {
  const choices = sizeChoicesFor(product)
  const kind = listingKindOf(product)
  if (kind === 'metal' || kind === 'dtf-transfer' || choices.length === 1) return choices[0] ?? ''
  return ''
}

/**
 * Dollars this size adds to (or takes off) the listing price, for the size
 * button label. The same two rails the server charges
 * (backend/services/order-pricing.ts): +$2.50 for 2XL and up, -$3.00 for a
 * youth size, printed tees and hoodies only. Blanks and metal price each size
 * outright and show that price instead, so they carry no delta.
 */
export function sizePriceDelta(product: Pick<Product, 'category' | 'metadata'>, size: string): number {
  const kind = listingKindOf(product)
  if (kind !== 'tee' && kind !== 'hoodie') return 0
  if (isPlusSize(size)) return PLUS_SIZE_UPCHARGE_DOLLARS
  if (isYouthSize(size)) return -YOUTH_SIZE_DISCOUNT_DOLLARS
  return 0
}

/** '+$2.50' / '-$3.00'; '' for no change. */
export function formatPriceDelta(delta: number): string {
  if (!delta) return ''
  return `${delta > 0 ? '+' : '-'}$${Math.abs(delta).toFixed(2)}`
}

// Where the design is printed (metadata.print_placement) -> the print_locations
// value it is printed at. Same table as PLACEMENT_DEFAULT_LOCATIONS in
// backend/routes/admin/ai-products.ts (first entry of each), which is what
// wrote print_locations for these rows in the first place.
const PLACEMENT_TO_LOCATION: Record<string, TshirtPrintLocation> = {
  'front-center': 'front_image',
  'left-pocket': 'pocket',
  'back-only': 'back_image',
  'front-back': 'front_image',
  'pocket-front-back-full': 'pocket'
}

/** The print placements a shopper can pick between; [] when the listing has no placement. */
export function placementChoicesFor(product: Pick<Product, 'category' | 'metadata' | 'print_locations'>): TshirtPrintLocation[] {
  if (!listingOptionSets(product).placement) return []
  return Array.isArray(product?.print_locations) ? product.print_locations : []
}

/**
 * The placement a listing opens on: where the design is actually printed, so
 * a finished design never blocks Add to Cart behind a placement pick (the 10/7
 * checkout walk on f09a7d64 ended in an empty cart). Unrecorded -> Front, then
 * the first offered location. Null when the listing has no placement.
 */
export function defaultPrintLocation(product: Pick<Product, 'category' | 'metadata' | 'print_locations'>): TshirtPrintLocation | null {
  const offered = placementChoicesFor(product)
  if (offered.length === 0) return null
  const recorded = PLACEMENT_TO_LOCATION[String(product?.metadata?.print_placement ?? '').toLowerCase().trim()]
  if (recorded && offered.includes(recorded)) return recorded
  if (offered.includes('front_image')) return 'front_image'
  return offered[0]
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

export function getProductAssets(product: Pick<Product, 'metadata'>): ProductAssets {
  const a = product?.metadata?.assets
  return a && typeof a === 'object' ? a as ProductAssets : {}
}

// True when the product offers a digital download bundle (clean/halftone/DTF).
export function hasDigitalDeliverables(product: Pick<Product, 'metadata'>): boolean {
  const a = getProductAssets(product)
  return !!(a.clean || a.halftone || a.dtf)
}

/**
 * True when the page may SELL the digital bundle. Never on a creator's own
 * apparel: their print file doubles as the "clean" and "DTF" deliverable, so
 * a $9.99 download undercut the shirt and handed out the art (David
 * 2026-10-07). The API refuses the purchase too (routes/user-products.ts).
 */
export function offersDigitalDownload(product: Pick<Product, 'metadata'>): boolean {
  return !isCreatorProductMeta(product?.metadata) && hasDigitalDeliverables(product)
}

// Public gallery images (hero + thumbnails): contextual mockups first (a
// shirt-on-person / art-in-room reads far better in a grid than flat art),
// then clean art, then any remaining raw images — but NEVER the halftone or DTF
// deliverables. Deduped, falsy-stripped, order preserved.
export function getGalleryImages(product: Pick<Product, 'images' | 'metadata'>): string[] {
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
  push(assets.display)                  // watermarked hero (preferred)
  ;(assets.mockups || []).forEach(push)
  push(product?.metadata?.mockup_url)   // legacy single mockup
  push(assets.clean)                    // un-watermarked clean (only if no display)
  ;(product?.images || []).forEach(push)
  return out
}

// Digital download bundle (gated behind a paid digital purchase): clean design
// + halftone + DTF print-ready, in that order. Empty when none are tagged.
export function getDeliverables(product: Pick<Product, 'metadata'>): { kind: 'design' | 'halftone' | 'dtf'; label: string; url: string }[] {
  const a = getProductAssets(product)
  const out: { kind: 'design' | 'halftone' | 'dtf'; label: string; url: string }[] = []
  if (a.clean) out.push({ kind: 'design', label: 'Design — clean art (PNG)', url: a.clean })
  if (a.halftone) out.push({ kind: 'halftone', label: 'Halftone version (PNG)', url: a.halftone })
  if (a.dtf) out.push({ kind: 'dtf', label: 'DTF print-ready (PNG)', url: a.dtf })
  return out
}

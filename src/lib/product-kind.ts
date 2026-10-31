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
  plusSizeUpchargeDollars,
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
import {
  type ProductKind,
  metalSizeOptions,
  isBlankProduct,
  productKindOf,
  CATEGORY_ALIASES,
  canonicalCategoryOf,
  defaultSizesFor,
  garmentIdOf,
  sizeChoicesFor,
  type ListingKind,
  listingKindOf,
  isCustomTemplate,
  type ListingOptionSets,
  listingOptionSets,
  colorChoicesFor,
  transferSizeChoicesFor,
  defaultSizeFor,
  type ProductAssets,
  getProductAssets,
  getGalleryImages,
  isGarmentShotUrl
} from '../../backend/shared/listing'
// Kind / size / colour / gallery rules live in backend/shared/listing.ts so the
// server (the product feed) reads the same answers; re-exported unchanged.
export {
  type ProductKind,
  metalSizeOptions,
  isBlankProduct,
  productKindOf,
  canonicalCategoryOf,
  defaultSizesFor,
  garmentIdOf,
  sizeChoicesFor,
  type ListingKind,
  listingKindOf,
  isCustomTemplate,
  type ListingOptionSets,
  listingOptionSets,
  colorChoicesFor,
  transferSizeChoicesFor,
  defaultSizeFor,
  type ProductAssets,
  getProductAssets,
  getGalleryImages,
  isGarmentShotUrl
}

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

/** Price of one panel size in dollars, for size-picker labels. */
export function metalSizePrice(sizeKey: MetalArtSizeKey): number {
  return METAL_ART_PRICES[sizeKey]
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

/** True when this size is the youth cut of the listing's garment. Re-exported
 *  so the storefront doesn't import the capability module in five places. */
export { isYouthSize }

/**
 * Dollars this size adds to (or takes off) the listing price, for the size
 * button label. The same two rails the server charges
 * (backend/services/order-pricing.ts): +$2.50 for 2XL/3XL, +$3.25 for 4XL, -$3.00 for a
 * youth size, printed tees and hoodies only. Blanks and metal price each size
 * outright and show that price instead, so they carry no delta.
 */
export function sizePriceDelta(product: Pick<Product, 'category' | 'metadata'>, size: string): number {
  const kind = listingKindOf(product)
  if (kind !== 'tee' && kind !== 'hoodie') return 0
  if (isPlusSize(size)) return plusSizeUpchargeDollars(size)
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

// Shopper-facing words for products.print_locations / cart printLocation values.
export const PRINT_LOCATION_LABELS: Record<TshirtPrintLocation, string> = {
  front_image: 'Front',
  back_image: 'Back',
  pocket: 'Pocket'
}

// Label for a placement value. Unknown values never show raw: "sleeve_image" reads "Sleeve".
export function printLocationLabel(loc: string | null | undefined): string {
  if (!loc) return ''
  const known = PRINT_LOCATION_LABELS[loc as TshirtPrintLocation]
  if (known) return known
  const words = loc.replace(/_image$/i, '').replace(/[_-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : ''
}

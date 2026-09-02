// Single source of truth for "what kind of product is this" + the metal-art
// add-on catalog. Used by ProductPage, ProductCard, ProductCatalog and the
// cart so apparel / metal / 3D are classified and priced consistently.
//
// The classification reads the products.category column FIRST, then falls back
// to metadata.product_template / metadata.category. This matters because some
// approved products (notably metal art submitted before the approval route set
// the category column) have a null category but carry product_template
// 'metal-art' in metadata — without the fallback they'd render as t-shirts.
import type { Product, CartAddon } from '../types'
import {
  STUDIO_SIZE_KEYS,
  METAL_ADDONS as METAL_ADDONS_SHARED,
  METAL_ART_PRICES,
  metalSizesFor,
  normalizeMetalSizeKey,
  type MetalArtSizeKey
} from '../../backend/shared/metal-art'

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

export function productKindOf(product: Pick<Product, 'category' | 'metadata'>): ProductKind {
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
// metal shows print sizes and 3D shows tiers instead of shirt sizes.
export function defaultSizesFor(kind: ProductKind): string[] {
  if (kind === 'metal') return STUDIO_SIZE_KEYS
  if (kind === '3d') return ['mini', 'small', 'medium', 'large']
  return ['S', 'M', 'L', 'XL', '2XL']
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

// Public gallery images (hero + thumbnails): contextual mockups first (a
// shirt-on-person / art-in-room reads far better in a grid than flat art),
// then clean art, then any remaining raw images — but NEVER the halftone or DTF
// deliverables. Deduped, falsy-stripped, order preserved.
export function getGalleryImages(product: Pick<Product, 'images' | 'metadata'>): string[] {
  const assets = getProductAssets(product)
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

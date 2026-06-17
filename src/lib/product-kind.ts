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

export type ProductKind = 'metal' | '3d' | 'apparel'

// Catalog of metal-art add-ons. `printed` = produced in-house on our 3D printer.
// Keep the ids in sync with backend approval (METAL_ADDONS in
// AdminCreatorProductsTab.tsx + the approve route metadata).
export const METAL_ADDONS: { id: string; name: string; price: number; printed: boolean; blurb: string }[] = [
  { id: 'easel_stand',    name: 'Tabletop easel stand',        price: 7,  printed: true,  blurb: 'Stand it on a desk or shelf — 3D-printed to fit your print.' },
  { id: 'standoff_mount', name: 'Floating standoff wall mount', price: 10, printed: true,  blurb: 'Modern floating look, sits off the wall. Hardware included.' },
  { id: 'hanging_kit',    name: 'Sawtooth hanging kit',         price: 5,  printed: true,  blurb: 'Classic flush wall hanging — ready in seconds.' },
  { id: 'gift_box',       name: 'Gift packaging',               price: 5,  printed: false, blurb: 'Arrives gift-boxed and ready to give.' },
]

export function getAddonById(id: string) {
  return METAL_ADDONS.find(a => a.id === id) || null
}

// Resolve the add-on ids stored on a product (metadata.addons) into the full
// catalog entries the storefront can render + price.
export function resolveProductAddons(product: Product): typeof METAL_ADDONS {
  const ids = product?.metadata?.addons
  if (!Array.isArray(ids)) return []
  return ids
    .map((id: string) => getAddonById(id))
    .filter((a): a is (typeof METAL_ADDONS)[number] => !!a)
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
export function canonicalCategoryOf(product: Pick<Product, 'category' | 'metadata'>): string {
  const kind = productKindOf(product)
  if (kind === 'metal') return 'metal-art'
  if (kind === '3d') return '3d-prints'
  // apparel: keep an explicit existing category, else default to shirts
  const c = String(product?.category || '').toLowerCase()
  return c || 'shirts'
}

// Default size options when a product has none set on its column. Type-aware so
// metal shows print sizes and 3D shows tiers instead of shirt sizes.
export function defaultSizesFor(kind: ProductKind): string[] {
  if (kind === 'metal') return ['4x6', '8x11']
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

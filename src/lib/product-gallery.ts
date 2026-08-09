/**
 * Product gallery contract — the single source of truth for what a published
 * product's images[] looks like:
 *
 *   1. Ghost mannequin mockup (primary)
 *   2. Flat lay mockup
 *   3. Mr. Imagine mockup — exactly ONE
 *   4. Real-person model shots (2), mirrored from the Etsy shoot
 *   5. Pocket-scale shot, when the design is also offered as a pocket print
 *   6. The design itself, WATERMARKED (never the raw design)
 *
 * Used by the wizard Approve step and every AdminDashboard publish path so the
 * storefront can't end up with duplicate mockups or an unprotected design.
 *
 * ROLE_ORDER is a WHITELIST, not a sort: a role missing from it is invisible on
 * the storefront no matter how many were generated. Any new mockup role has to
 * be added here or the render is paid for and never seen.
 */

export interface GalleryAsset {
  id?: string
  kind?: string | null
  asset_role?: string | null
  url?: string | null
  display_order?: number | null
  created_at?: string | null
}

const ROLE_ORDER = [
  'mockup_ghost_mannequin',
  'mockup_flat_lay',
  'mockup_mr_imagine',
  'mockup_model_1',
  'mockup_model_2',
  // Pocket sits after the front shots: it is the small-print variant, so it
  // should never be what a shopper sees first in the grid.
  'mockup_pocket',
  'design_watermarked',
] as const

/** Gallery index of the pocket-scale shot, so a placement pick can jump to it. */
export const POCKET_ROLE = 'mockup_pocket'

export function buildProductGallery(assets: GalleryAsset[]): string[] {
  const images: string[] = []

  for (const role of ROLE_ORDER) {
    const candidates = assets.filter((a) => a.asset_role === role && a.url)
    if (candidates.length === 0) continue
    // Newest wins — exactly one image per role, even if old duplicates linger.
    candidates.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    images.push(candidates[0].url as string)
  }

  // Legacy fallback: products created before the contract may have mockups
  // without asset_role values. Take mockup-kind assets in display order, but
  // never the raw source design — watermark protection is the point.
  if (images.length === 0) {
    const mockups = assets
      .filter((a) => a.kind === 'mockup' && a.url)
      .sort((a, b) => (a.display_order ?? 99) - (b.display_order ?? 99))
    const seen = new Set<string>()
    for (const m of mockups) {
      if (seen.has(m.url as string)) continue
      seen.add(m.url as string)
      images.push(m.url as string)
    }
  }

  return images
}

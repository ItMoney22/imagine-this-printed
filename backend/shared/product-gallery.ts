/**
 * Product gallery contract — the single source of truth for what a published
 * product's images[] looks like:
 *
 *   1. Ghost mannequin mockup (primary)
 *   2. Flat lay mockup
 *   3. Hanger shot (Step Flow's step 4 — garment on a wooden hanger)
 *   4. Back view, when the product is printed on both sides (front-back)
 *   5. Real-person model shots (2), mirrored from the Etsy shoot
 *   6. Product-details card (Step Flow's in-house sharp render — spec/size chart)
 *   7. Extra-color shots, one per approved non-primary color (Step Flow)
 *   8. Mr. Imagine mockup — exactly ONE
 *   9. Pocket-scale shot, when the design is also offered as a pocket print
 *  10. The design itself, WATERMARKED (never the raw design)
 *
 * Canonical home (2026-09-01 review fix): this used to be forked — a copy in
 * `src/lib/product-gallery.ts` for the frontend and a second, drifted copy
 * (`GALLERY_FIXED_ROLE_ORDER`/`buildStepFlowGallery`) inside
 * `backend/services/step-flow/shots.ts` — with mr_imagine sitting in a
 * different position in each. `backend/shared/` is already the frontend/
 * backend shared-code convention (see `metal-art.ts`, `catalog-capability.ts`)
 * so this is the ONE copy now: `src/lib/product-gallery.ts` re-exports it,
 * and `shots.ts` imports it directly instead of keeping its own list.
 *
 * Used by the wizard Approve step, the Step Flow publish route, and every
 * AdminDashboard publish path so the storefront can't end up with duplicate
 * mockups or an unprotected design.
 *
 * ROLE_ORDER is a WHITELIST, not a sort: a role missing from it (or not
 * matching the `mockup_color_*` wildcard) is invisible on the storefront no
 * matter how many were generated. Any new mockup role has to be added here or
 * the render is paid for and never seen.
 *
 * `print_*` roles (Step Flow's team-only halftone print file, design doc
 * §10 — `asset_role: 'print_halftone'`, `kind: 'print'`) are DELIBERATELY NOT
 * in this list. David: customers must never see the halftoned print file —
 * it's for the team when pressing/printing, not a listing photo. Leaving it
 * out of the whitelist is what keeps it out of `products.images` no matter
 * what publishes the product; do not add a `print_*` entry here.
 */

import { isMetalProductRow } from './metal-art.js'

export interface GalleryAsset {
  id?: string
  kind?: string | null
  asset_role?: string | null
  url?: string | null
  display_order?: number | null
  created_at?: string | null
}

/** Sentinel role matching any `mockup_color_<ColorId>` extra-color shot. */
const COLOR_ROLE_WILDCARD = 'mockup_color_*'
const COLOR_ROLE_PREFIX = 'mockup_color_'

export const ROLE_ORDER = [
  'mockup_ghost_mannequin',
  'mockup_flat_lay',
  'mockup_hanger',
  // Back view right after the front flat lay so a two-sided product reads
  // front-then-back, before the lifestyle shots.
  'mockup_back',
  'mockup_model_1',
  'mockup_model_2',
  // Metal print size scenes (Step Flow §14) — largest first, right before
  // the details card, same "biggest photo leads" convention as the rest of
  // this list. A garment product never has these roles; a metal product
  // never has mockup_ghost_mannequin/flat_lay/hanger/model above — the two
  // product kinds' roles simply don't overlap.
  'mockup_metal_8x10',
  'mockup_metal_4x6',
  'mockup_details',
  COLOR_ROLE_WILDCARD,
  // Mr. Imagine, then pocket, then the watermark — after the Step Flow's own
  // shots (David 2026-09-01: the flow's approve-per-step shots are the
  // listing's real photography; mascot/pocket/watermark are supporting
  // images, not the lead).
  'mockup_mr_imagine',
  'mockup_pocket',
  'design_watermarked',
] as const

/**
 * Metal prints (Step Flow §14) lead with the ARTWORK, not a scene: a metal
 * panel is the flat art itself, full-bleed, so the (watermarked) design IS
 * the product photo — the desk/wall scenes and the details card follow it.
 * David 2026-09-02 on the first Golden Gate metal print: the flow "didn't
 * put the main image in the product details, just the mockups". Same
 * whitelist as ROLE_ORDER otherwise, so nothing a garment can't have leaks
 * in and nothing a metal product can have is dropped.
 */
export const METAL_ROLE_ORDER = [
  'design_watermarked',
  ...ROLE_ORDER.filter((r) => r !== 'design_watermarked'),
] as const

/** Gallery index of the pocket-scale shot, so a placement pick can jump to it. */
export const POCKET_ROLE = 'mockup_pocket'
/** Gallery role of the back-side render on two-sided (front-back) products. */
export const BACK_ROLE = 'mockup_back'

/**
 * @param order Which role whitelist/ordering to apply — ROLE_ORDER (garments,
 *   the default) or METAL_ROLE_ORDER (metal prints, artwork first). Callers
 *   that know the product kind pass it; `buildProductGalleryFor` picks it
 *   from a row.
 */
export function buildProductGallery(assets: GalleryAsset[], order: readonly string[] = ROLE_ORDER): string[] {
  const images: string[] = []

  for (const role of order) {
    if (role === COLOR_ROLE_WILDCARD) {
      // Extra-color shots: one per distinct mockup_color_<id> role (there can
      // be several — one per approved extra color), newest wins within a role.
      const colorRoles = Array.from(
        new Set(
          assets
            .filter((a) => a.asset_role && a.asset_role.startsWith(COLOR_ROLE_PREFIX) && a.url)
            .map((a) => a.asset_role as string)
        )
      ).sort()
      for (const colorRole of colorRoles) {
        const candidates = assets.filter((a) => a.asset_role === colorRole && a.url)
        candidates.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        if (candidates[0]?.url) images.push(candidates[0].url as string)
      }
      continue
    }
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

/** buildProductGallery with the ordering picked from the product row's kind (metal → artwork first). */
export function buildProductGalleryFor(
  row: { category?: unknown; metadata?: any } | null | undefined,
  assets: GalleryAsset[]
): string[] {
  return buildProductGallery(assets, isMetalProductRow(row) ? METAL_ROLE_ORDER : ROLE_ORDER)
}

// Single source of truth for metal-art print facts (panel geometry and
// substrate/mounting copy), shared between the storefront studio
// (src/pages/MetalArtStudio.tsx, src/lib/product-kind.ts) and the Etsy
// publishing lane (backend/services/etsy.ts, etsy-seo-composer.ts).
//
// Written for Watchtower task ffdbe384-3d7d-48f0-9c10-db6ba3a99e79. Full
// writeup in that task + the accompanying handoff, short version:
//
//   The studio canvas has been built for an 8x11 aspect ratio (330x454px =
//   0.727, exactly 8/11) since it shipped. The Etsy lane has published 8x10
//   (0.800) since commit 8f37312. Those are two different rectangles —
//   artwork composed on the studio canvas prints cropped/letterboxed if the
//   physical panel is actually 8x10, and if 8x11 is what actually ships,
//   every live Etsy listing is currently misdescribing what the customer
//   receives.
//
// *** OWNER-GATED — David is the only one who knows what's actually stocked
// and pressed, and whether 4x6/8x10 is genuinely a separate Etsy-only SKU
// from the website's 4x6/8x11. This module does NOT resolve that: it
// centralizes the geometry both sides already use so there's exactly one
// place to fix once he confirms, instead of N hardcoded copies quietly
// drifting apart again. Neither side's currently-offered size list has been
// changed by this refactor — see STUDIO_SIZE_KEYS / ETSY_SIZE_KEYS below and
// the CONFLICT block for what to do once you have an answer. ***

export type MetalArtSizeKey = '4x6' | '8x10' | '8x11'

export interface MetalArtSizeSpec {
  labelIn: string
  widthIn: number
  heightIn: number
  /** Studio canvas pixel dimensions at the fixed ~72dpi-equivalent scale MetalArtStudio.tsx renders at. */
  canvas: { w: number; h: number }
}

// Geometry for every candidate size. Both call sites below read their own
// (currently unchanged) size list against this same map, so a dimension typo
// or a future re-measurement only needs fixing in one place.
export const METAL_ART_SIZES: Record<MetalArtSizeKey, MetalArtSizeSpec> = {
  '4x6':  { labelIn: '4 × 6"',  widthIn: 4, heightIn: 6,  canvas: { w: 240, h: 360 } },
  '8x10': { labelIn: '8 × 10"', widthIn: 8, heightIn: 10, canvas: { w: 330, h: 412 } },
  '8x11': { labelIn: '8 × 11"', widthIn: 8, heightIn: 11, canvas: { w: 330, h: 454 } },
}

// What the storefront studio currently sells (src/pages/MetalArtStudio.tsx,
// src/lib/product-kind.ts). Unchanged by this refactor.
export const STUDIO_SIZE_KEYS: MetalArtSizeKey[] = ['4x6', '8x11']

// What the Etsy lane currently publishes (backend/services/etsy.ts). Also
// unchanged by this refactor.
export const ETSY_SIZE_KEYS: MetalArtSizeKey[] = ['4x6', '8x10']

// ---------------------------------------------------------------------------
// THE CONFLICT — single point of change once David confirms the physical
// panel(s):
//
// Candidate A — one real SKU, 8x11: the studio canvas is right (330x454 =
//   8/11, zero cropping) and the Etsy listing is wrong. Fix: change
//   ETSY_SIZE_KEYS's second entry to '8x11' and correct + republish the live
//   Etsy listing (title/description/variation currently say 8x10).
// Candidate B — two real SKUs: the website sells 8x11, Etsy separately sells
//   a true 8x10 panel pressed differently. Fix: nothing structural — both
//   lists above already reflect this split; just delete this comment block
//   and STUDIO/ETSY_SIZE_KEYS documents it going forward.
// Candidate C — one real SKU, 8x10: Etsy is right and the studio canvas is
//   wrong. Fix: change STUDIO_SIZE_KEYS's second entry to '8x10' and give
//   MetalArtStudio.tsx an 8x10 canvas ratio (already defined above) instead
//   of 8x11 — a real product-behavior change, not just a copy fix.
//
// Nothing here silently picks one. Both lists keep shipping exactly what
// they ship today until this comment is replaced with a decision.
export const METAL_ART_SIZE_CONFLICT_OPEN = true

// ---------------------------------------------------------------------------
// Substrate / mounting — ALSO owner-gated, ALSO a live contradiction:
//   - backend/services/etsy-seo-composer.ts (published Etsy copy): dye-
//     sublimated ALUMINUM metal print.
//   - src/pages/MetalArtStudio.tsx (storefront cart line, before this fix):
//     "Magnet-mounted steel plate."
// Aluminum isn't ferromagnetic, so either one substrate claim is wrong, or
// the magnet mounts to a separate wall bracket/plate rather than the panel
// itself. Defaulting to ALUMINUM since that's the wording already live on
// Etsy; the storefront copy has been reworded to stop claiming a bare
// "magnet-mounted steel plate" until David confirms the real substrate and
// mounting hardware.
export const METAL_ART_SUBSTRATE = 'aluminum' as const

// Deliberately mount-agnostic until the mounting hardware is confirmed — see
// the substrate note above.
export const METAL_ART_MOUNTING_COPY = 'arrives ready to hang'

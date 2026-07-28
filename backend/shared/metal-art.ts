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

// RESOLVED by David 2026-07-28 (in-session, direct answer): the physical
// panels stocked and pressed are 4x6 and 8x10 — Candidate C. Etsy was right;
// the studio canvas was the wrong one and now renders the 8x10 geometry from
// the map above. '8x11' stays in METAL_ART_SIZES only as legacy geometry for
// old carts/products that recorded it.
export const STUDIO_SIZE_KEYS: MetalArtSizeKey[] = ['4x6', '8x10']

// What the Etsy lane publishes (backend/services/etsy.ts).
export const ETSY_SIZE_KEYS: MetalArtSizeKey[] = ['4x6', '8x10']

export const METAL_ART_SIZE_CONFLICT_OPEN = false

// ---------------------------------------------------------------------------
// Substrate / mounting — RESOLVED by David 2026-07-28: the panels are
// ALUMINUM and ship WITH a hanger included. Listings may claim "ready to
// hang". (The old storefront "magnet-mounted steel plate" line was wrong.)
export const METAL_ART_SUBSTRATE = 'aluminum' as const

export const METAL_ART_MOUNTING_COPY = 'includes a hanger — arrives ready to hang'

// ---------------------------------------------------------------------------
// Scale anchors for AI mockups — David 2026-07-28: "I don't want to post a
// 4x6 and they mock it up on a wall looking massive." Image models ignore
// bare dimensions; they respect COMPARISONS to everyday objects. Every metal
// mockup prompt must embed the anchor text for the size being staged.
export function metalScaleAnchor(sizeKey: MetalArtSizeKey): string {
  const s = METAL_ART_SIZES[sizeKey]
  if (sizeKey === '4x6') {
    return (
      `The panel is SMALL: exactly ${s.widthIn}x${s.heightIn} inches — postcard-sized, ` +
      'smaller than a sheet of paper, about the height of a coffee mug and a half. It reads as a ' +
      'small desk/shelf accent piece. Stage it TRUE TO SCALE next to everyday objects that prove the ' +
      'size (a coffee mug, a phone, a small plant pot roughly as tall as the panel). It must NOT ' +
      'look like large statement wall art.'
    )
  }
  return (
    `The panel is exactly ${s.widthIn}x${s.heightIn} inches — the size of a sheet of letter paper, ` +
    'a modest tabletop/shelf piece or a small accent on a wall. Stage it TRUE TO SCALE next to ' +
    'everyday objects that prove the size (books, a lamp, a standard picture frame of similar size). ' +
    'It must NOT look like a large statement piece or poster-sized art.'
  )
}

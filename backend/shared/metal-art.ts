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
// Prices — single source of truth for the storefront studio
// (src/pages/MetalArtStudio.tsx) AND the server-side checkout pricing engine
// (backend/services/order-pricing.ts). Both used to carry their own
// hardcoded copy; order-pricing.ts's copy was keyed '8x11': 2999 with NO
// '8x10' entry at all — a straight bug, since the real panel (per the
// resolution above) is 8x10, not 8x11. Fixed here.
//
// David 2026-09-02 (verbatim): "for a 4x6 $8.95 and a 8x10 we do 16.95."
// These replace the prior $14.99 / $29.99.
export const METAL_ART_PRICES_CENTS: Record<MetalArtSizeKey, number> = {
  '4x6': 895,
  '8x10': 1695,
  // Legacy alias: '8x11' is not offered (see STUDIO_SIZE_KEYS above) but old
  // carts/products may still carry it — same physical panel as 8x10 today,
  // so it's priced the same rather than left to error out at checkout.
  '8x11': 1695,
}

// Dollar view for UI code that displays/exports prices in dollars (mirrors
// the shape MetalArtStudio.tsx has always exported as METAL_ART_PRICES).
export const METAL_ART_PRICES: Record<MetalArtSizeKey, number> = Object.fromEntries(
  (Object.entries(METAL_ART_PRICES_CENTS) as [MetalArtSizeKey, number][]).map(([key, cents]) => [key, cents / 100])
) as Record<MetalArtSizeKey, number>

// ---------------------------------------------------------------------------
// Add-on catalog — single source of truth for the storefront
// (src/lib/product-kind.ts) and the server-side pricing engine
// (backend/services/order-pricing.ts). Both used to carry their own
// hardcoded copy that could silently drift.
//
// PLACEHOLDER PRICES: magnet_mount and printed_stand are NEW add-ons David
// named on 2026-09-02 ("we have addons like mounting magnets or 3d printed
// stands etc.") without giving dollar figures — the cents below are
// placeholders pending his sign-off, not a confirmed price. The other four
// (easel_stand/standoff_mount/hanging_kit/gift_box) are the existing,
// already-live prices — unchanged.
export interface MetalAddonSpec {
  id: string
  label: string
  cents: number
  /** true = produced in-house on our 3D printer. */
  printed: boolean
  blurb: string
}

export const METAL_ADDONS: Record<string, MetalAddonSpec> = {
  easel_stand: {
    id: 'easel_stand',
    label: 'Tabletop easel stand',
    cents: 700,
    printed: true,
    blurb: 'Stand it on a desk or shelf — 3D-printed to fit your print.'
  },
  standoff_mount: {
    id: 'standoff_mount',
    label: 'Floating standoff wall mount',
    cents: 1000,
    printed: true,
    blurb: 'Modern floating look, sits off the wall. Hardware included.'
  },
  hanging_kit: {
    id: 'hanging_kit',
    label: 'Sawtooth hanging kit',
    cents: 500,
    printed: true,
    blurb: 'Classic flush wall hanging — ready in seconds.'
  },
  gift_box: {
    id: 'gift_box',
    label: 'Gift packaging',
    cents: 500,
    printed: false,
    blurb: 'Arrives gift-boxed and ready to give.'
  },
  // NEW 2026-09-02 (David) — prices are PLACEHOLDERS, not confirmed.
  magnet_mount: {
    id: 'magnet_mount',
    label: 'Magnet mounting kit',
    cents: 495,
    printed: false,
    blurb: 'Rare-earth magnets so it mounts flush to any metal surface — no holes, no hanger.'
  },
  printed_stand: {
    id: 'printed_stand',
    label: '3D-printed display stand',
    cents: 695,
    printed: true,
    blurb: 'A custom stand printed to hold this panel upright on a desk or shelf.'
  },
}

// Cents-only lookup — what order-pricing.ts's KNOWN_ADDONS_CENTS table needs.
export const METAL_ADDONS_CENTS: Record<string, number> = Object.fromEntries(
  Object.values(METAL_ADDONS).map(a => [a.id, a.cents])
)

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

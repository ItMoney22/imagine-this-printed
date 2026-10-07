// ---------------------------------------------------------------------------
// Mini-Me: a customer's photo turned into a 3D-printed statue (David 2026-10-07).
//
//   "a customer will upload a photo and we would create like a mini statue ...
//    mainly going to be in white and then with a paint kit, but for extra money
//    they can get it in color, max four colors ... in the base an NFC chip that
//    the customer can upload a video to ... that will be extra as well."
//
// ONE place for Mini-Me sizes and prices, shared by the storefront and the API
// (frontend imports it across the build boundary, like blank-pricing.ts).
// Pure: no I/O, unit-tested in mini-me.test.ts.
// ---------------------------------------------------------------------------

export type MiniMeColorMode = 'white' | 'color4'
export type MiniMeSize = 'small' | 'medium'

/**
 * PENDING DAVID APPROVAL. Zero Nine is pricing from real costs (Tripo model,
 * filament incl. AMS purge waste, print time, NFC tag, paint kit, packaging).
 * Until this flips to true, customer pages must show "from $__" instead of a
 * number: GET /api/3d-models/mini-me/pricing reports `approved`.
 */
export const MINI_ME_PRICES_APPROVED = false

/** Size -> the Tripo tier that sculpts it and the printed height. */
export const MINI_ME_SIZES: Record<MiniMeSize, { label: string; tier: 'small' | 'medium'; heightMm: number }> = {
  small: { label: 'Mini (about 10 cm tall)', tier: 'small', heightMm: 100 },
  medium: { label: 'Classic (about 15 cm tall)', tier: 'medium', heightMm: 150 }
}

/** PENDING DAVID APPROVAL: placeholder cents until the cost research lands. */
export const MINI_ME_PRICE_CENTS = {
  /** White PLA statue + paint kit (the kit is always included with white). */
  white: { small: 3999, medium: 5999 } as Record<MiniMeSize, number>,
  /** Full color, up to 4 filaments on the AMS, on top of the white price. */
  color4Upcharge: { small: 1500, medium: 2000 } as Record<MiniMeSize, number>,
  /** NFC tag in the base, written with the link to the customer's video. */
  nfcVideo: 1200
}

/** Cart / order add-on id for the NFC video base. */
export const MINI_ME_NFC_ADDON_ID = 'nfc_video'

/** Most filaments one AMS run holds (Bambu A1 + AMS lite). */
export const MINI_ME_MAX_COLORS = 4

export function isMiniMeSize(v: unknown): v is MiniMeSize {
  return v === 'small' || v === 'medium'
}

export function miniMeColorMode(v: unknown): MiniMeColorMode {
  return v === 'color4' ? 'color4' : 'white'
}

/** Base unit price in cents (no add-ons): white includes the paint kit; color adds the upcharge. */
export function miniMeBaseCents(size: MiniMeSize, colorMode: MiniMeColorMode): number {
  const white = MINI_ME_PRICE_CENTS.white[size]
  return colorMode === 'color4' ? white + MINI_ME_PRICE_CENTS.color4Upcharge[size] : white
}

/** Full unit price in cents for display (the server reprices add-ons itself from TOY_ADDONS_CENTS). */
export function miniMeUnitCents(size: MiniMeSize, colorMode: MiniMeColorMode, addonIds: readonly string[] = []): number {
  const nfc = addonIds.includes(MINI_ME_NFC_ADDON_ID) ? MINI_ME_PRICE_CENTS.nfcVideo : 0
  return miniMeBaseCents(size, colorMode) + nfc
}

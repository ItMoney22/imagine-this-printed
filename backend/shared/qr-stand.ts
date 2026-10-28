// Single source of truth for the Custom QR Counter Stand (task deebfdca), shared
// by the order page (src/pages/QrStandOrder.tsx), the checkout trust boundary
// (backend/routes/stripe.ts + order-pricing.ts), the admin editor and the
// builder on Earth (tools/qr-stand/gen.py applies the same link rule).
//
// The stand is a priced LINE TYPE, not a products row: a cart line whose id is
// `qr-stand` (or `qr-stand-<anything>`) is priced from QR_STAND.priceCents here
// and nowhere else, the way `metal-art-custom-*` lines are. That keeps the price
// in one module and means the product goes live exactly when this code ships.
//
// Browser-safe: no node imports. The reseller ref is VERIFIED server-side in
// backend/services/qr-stand-reseller.ts; here it is only carried.

export const QR_STAND = {
  lineIdPrefix: 'qr-stand',
  name: 'Custom QR Counter Stand',
  /** David 2026-10-17: $25 a stand, on sale to our clients for $17.95. */
  priceCents: 1795,
  wasCents: 2500,
  /** Parcel weight for the shipping quote: ~52 g of plastic plus a box. */
  weightLb: 0.35,
  /** The page's route. Sidebar "Business Products" points here. */
  path: '/business/qr-stand',
} as const

/** QR version 6 at error level H holds 58 bytes in byte mode. v7 puts an
 *  alignment pattern dead centre, under the logo. gen.py: MAX_LINK_BYTES. */
export const QR_LINK_MAX_BYTES = 58
/** David's words for a link that is too long (card deebfdca). */
export const QR_TOO_LONG = 'use a shorter link'

export const QR_CAPTIONS = ['Review Us', 'Pay Here', 'Visit Our Website', 'Scan For Menu'] as const
/** The caption shrinks to fit the plate, but past this it stops reading from a counter. */
export const QR_CAPTION_MAX = 24
/** Latin letters (accents too), digits, spaces and everyday punctuation: what the
 *  stand's bold face can actually draw. Anything else would print as a box. */
const CAPTION_CHARS = /^[A-Za-z0-9\u00C0-\u00FF .,!?&'\u2019:#@/+%$()-]*$/

/** Where customer logos land in the bucket. The builder only ever fetches a logo
 *  the SERVER resolves from this prefix, never a URL a browser sent. */
export const QR_LOGO_PREFIX = 'qr-stand-logos/'
const LOGO_PATH = /^qr-stand-logos\/[0-9a-f-]{36}\.png$/

export function isQrStandLineId(id: unknown): boolean {
  const s = String(id ?? '')
  return s === QR_STAND.lineIdPrefix || s.startsWith(`${QR_STAND.lineIdPrefix}-`)
}

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length
}

/** A typed link as the stand will encode it: trimmed, https:// added when the
 *  customer typed a bare domain (the desktop maker's rule). */
export function normalizeQrLink(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`
}

/** null when the link can go on a stand, else the words to show the customer. */
export function qrLinkProblem(link: string): string | null {
  if (!link) return 'Type where the code should point.'
  if (utf8Bytes(link) > QR_LINK_MAX_BYTES) return QR_TOO_LONG
  if (/\s/.test(link)) return 'A link has no spaces in it.'
  try {
    const u = new URL(link)
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return 'That does not look like a web link.'
  } catch {
    return 'That does not look like a web link.'
  }
  return null
}

export function cleanQrCaption(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim()
}

export function qrCaptionProblem(caption: string): string | null {
  if (!caption) return 'Pick the words under the code.'
  if (caption.length > QR_CAPTION_MAX) return `Keep the words under ${QR_CAPTION_MAX} letters.`
  if (!CAPTION_CHARS.test(caption)) return 'Use letters, numbers and simple punctuation only.'
  return null
}

export function isQrLogoPath(path: unknown): path is string {
  return typeof path === 'string' && LOGO_PATH.test(path)
}

/** The cart line carries these in CartItem.personalization (string map). */
export const QR_FIELD = {
  link: 'qr_link',
  caption: 'qr_caption',
  logoPath: 'qr_logo_path',
  logoUrl: 'qr_logo_url',
  ref: 'qr_ref',
} as const

export interface QrStandFields {
  link: string
  caption: string
  /** Bucket path under QR_LOGO_PREFIX, or null for a blank centre square. */
  logoPath: string | null
  /** A reseller site's signed ref (Darrell's shop), verified server-side. */
  ref: string | null
}

/** Read and check a cart line's stand fields. Never trusts a logo URL: only a
 *  path under our own prefix survives. */
export function readQrStandFields(personalization: unknown): { fields: QrStandFields; problem: string | null } {
  const p = (personalization && typeof personalization === 'object' ? personalization : {}) as Record<string, unknown>
  const link = normalizeQrLink(p[QR_FIELD.link])
  const caption = cleanQrCaption(p[QR_FIELD.caption])
  const rawLogo = p[QR_FIELD.logoPath]
  const logoPath = isQrLogoPath(rawLogo) ? rawLogo : null
  const ref = typeof p[QR_FIELD.ref] === 'string' && p[QR_FIELD.ref] ? String(p[QR_FIELD.ref]).slice(0, 1024) : null
  const fields = { link, caption, logoPath, ref }
  if (rawLogo && !logoPath) return { fields, problem: 'Please upload your logo again.' }
  return { fields, problem: qrLinkProblem(link) ?? qrCaptionProblem(caption) }
}

// The one seasonal offer the storefront advertises. The banner and badge read
// the live discount_codes row, so they can only ever say what the cart will do:
// no row, inactive, expired or used up = nothing is advertised.

/** discount_codes.code of the offer the home banner and badges advertise. */
export const FEATURED_OFFER_CODE = 'SPOOKY20'

/**
 * Codes that only take money off designs of one theme. David 2026-10-16, on
 * the Folgers racing tee showing "20% off with SPOOKY20": "this isnt
 * halloween so it shouldnt qualify for 20% off". A row can also carry its own
 * theme in discount_codes.metadata.theme, which wins over this table.
 */
export const OFFER_THEMES: Record<string, string> = { SPOOKY20: 'halloween' }

/** The theme a code is limited to, or null for a code that covers the whole order. */
export function offerThemeOf(row: { code?: string | null; metadata?: any } | null | undefined): string | null {
  if (!row) return null
  const own = typeof row.metadata?.theme === 'string' ? row.metadata.theme.trim().toLowerCase() : ''
  return own || OFFER_THEMES[String(row.code || '').toUpperCase()] || null
}

export interface ThemedProductFields {
  name?: string | null
  description?: string | null
  search_keywords?: string[] | string | null
  metadata?: any
}

/**
 * Is this product one of the theme's designs? Only places someone wrote the
 * word on purpose count: the collection it was imported into (Halloween,
 * Halloween Vol2, Vol3), its name, its description, its search keywords and
 * its listing tags. Never a guess from the picture: "spooky"-adjacent words
 * would sweep in the alien tees, which are not Halloween designs.
 */
export function matchesOfferTheme(product: ThemedProductFields | null | undefined, theme: string | null): boolean {
  if (!theme) return true
  if (!product) return false
  const meta = product.metadata || {}
  const keywords = Array.isArray(product.search_keywords) ? product.search_keywords.join(' ') : product.search_keywords || ''
  const tags = [meta.etsy_pack?.tags, meta.tags].flat().filter((t) => typeof t === 'string').join(' ')
  const text = [product.name, product.description, meta.collection, keywords, tags].filter(Boolean).join(' ')
  const word = theme.replace(/[^a-z0-9 ]/gi, '')
  return word.length > 0 && new RegExp(`\\b${word}\\b`, 'i').test(text)
}

export interface FeaturedOfferRow {
  code: string
  type: string
  value: number
  is_active: boolean
  expires_at: string | null
  max_uses: number | null
  current_uses: number | null
  min_order_amount: number | null
  metadata?: any
}

export interface FeaturedOffer {
  code: string
  percentOff: number
  /** ISO end instant; the offer is always time-boxed. */
  endsAt: string
  minOrderAmount: number | null
  /** Only designs of this theme get the discount (and the badge); null = everything. */
  theme: string | null
}

/**
 * discount_codes.expires_at is `timestamp without time zone` holding UTC, so it
 * arrives with no offset ("2026-11-01T03:59:00"). A browser reads that as its
 * own local time: the live banner said "Ends November 1" for an offer that ends
 * Oct 31 11:59pm ET. Pin a zone-less value to UTC.
 */
export function utcInstant(ts: string): Date {
  return new Date(/(z|[+-]\d\d:?\d\d)$/i.test(ts) ? ts : `${ts}Z`)
}

/** Null unless the row is a live, time-boxed percentage offer right now. */
export function describeFeaturedOffer(
  row: FeaturedOfferRow | null | undefined,
  now: Date = new Date()
): FeaturedOffer | null {
  if (!row || !row.is_active || row.type !== 'percentage') return null
  if (!row.expires_at) return null // an offer with no end date is never advertised
  const ends = utcInstant(row.expires_at)
  if (ends.getTime() <= now.getTime()) return null
  if (row.max_uses != null && (row.current_uses ?? 0) >= row.max_uses) return null
  if (!Number.isFinite(row.value) || row.value <= 0 || row.value >= 100) return null
  return {
    code: row.code,
    percentOff: row.value,
    endsAt: ends.toISOString(),
    minOrderAmount: row.min_order_amount ?? null,
    theme: offerThemeOf(row)
  }
}

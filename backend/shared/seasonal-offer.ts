// The one seasonal offer the storefront advertises. The banner and badge read
// the live discount_codes row, so they can only ever say what the cart will do:
// no row, inactive, expired or used up = nothing is advertised.

/** discount_codes.code of the offer the home banner and badges advertise. */
export const FEATURED_OFFER_CODE = 'SPOOKY20'

export interface FeaturedOfferRow {
  code: string
  type: string
  value: number
  is_active: boolean
  expires_at: string | null
  max_uses: number | null
  current_uses: number | null
  min_order_amount: number | null
}

export interface FeaturedOffer {
  code: string
  percentOff: number
  /** ISO end instant; the offer is always time-boxed. */
  endsAt: string
  minOrderAmount: number | null
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
    minOrderAmount: row.min_order_amount ?? null
  }
}

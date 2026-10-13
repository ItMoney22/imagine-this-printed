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

/** Null unless the row is a live, time-boxed percentage offer right now. */
export function describeFeaturedOffer(
  row: FeaturedOfferRow | null | undefined,
  now: Date = new Date()
): FeaturedOffer | null {
  if (!row || !row.is_active || row.type !== 'percentage') return null
  if (!row.expires_at) return null // an offer with no end date is never advertised
  if (new Date(row.expires_at).getTime() <= now.getTime()) return null
  if (row.max_uses != null && (row.current_uses ?? 0) >= row.max_uses) return null
  if (!Number.isFinite(row.value) || row.value <= 0 || row.value >= 100) return null
  return {
    code: row.code,
    percentOff: row.value,
    endsAt: row.expires_at,
    minOrderAmount: row.min_order_amount ?? null
  }
}

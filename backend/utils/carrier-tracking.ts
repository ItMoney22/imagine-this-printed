// ============================================================================
// Carrier resolution + tracking deep links (shared by every transactional email)
//
// Two inputs, either of which may be missing:
//   • carrier  — free-text from orders.tracking_company (set by admin / Shippo)
//   • tracking — the tracking number itself
//
// Resolution order: explicit carrier name wins; otherwise we infer the carrier
// from the tracking-number shape (same regexes the customer-facing MyOrders page
// uses, so the site and the email never disagree). Unknown shapes fall back to a
// package-search URL so the button is never dead.
// ============================================================================

export interface CarrierInfo {
  /** Display name, e.g. "UPS" */
  name: string
  /** Deep link to that carrier's tracking page for this number */
  trackingUrl: string
  /** false when we couldn't identify the carrier and fell back to a search link */
  resolved: boolean
}

type UrlBuilder = (tracking: string) => string

const CARRIERS: Record<string, { name: string; url: UrlBuilder }> = {
  ups: {
    name: 'UPS',
    url: t => `https://www.ups.com/track?tracknum=${encodeURIComponent(t)}`,
  },
  usps: {
    name: 'USPS',
    url: t => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(t)}`,
  },
  fedex: {
    name: 'FedEx',
    url: t => `https://www.fedex.com/fedextrack/?tracknumbers=${encodeURIComponent(t)}`,
  },
  dhl: {
    name: 'DHL',
    url: t => `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encodeURIComponent(t)}`,
  },
  ontrac: {
    name: 'OnTrac',
    url: t => `https://www.ontrac.com/tracking/?number=${encodeURIComponent(t)}`,
  },
  lasership: {
    name: 'LaserShip',
    url: t => `https://www.lasership.com/track/${encodeURIComponent(t)}`,
  },
  canadapost: {
    name: 'Canada Post',
    url: t => `https://www.canadapost-postescanada.ca/track-reperage/en#/resultList?searchFor=${encodeURIComponent(t)}`,
  },
}

// The carrier column is free text — admins type "UPS Ground", Shippo sends
// "USPS Priority Mail", Stripe sends "usps". Match on substrings rather than an
// exact-alias table so service-level suffixes still resolve.
//
// ORDER MATTERS: "usps" contains "ups", so USPS must be tested first.
const CARRIER_PATTERNS: Array<[RegExp, string]> = [
  [/usps|united states postal|postal service|priority mail|first[\s-]?class mail/, 'usps'],
  [/fedex|fed ex|federal express/, 'fedex'],
  [/\bdhl\b/, 'dhl'],
  [/\bups\b|united parcel/, 'ups'],
  [/ontrac/, 'ontrac'],
  [/lasership/, 'lasership'],
  [/canada post|postes canada|canadapost/, 'canadapost'],
]

function matchCarrierName(carrier: string): string | null {
  const c = carrier.toLowerCase().trim()
  if (!c) return null
  for (const [pattern, key] of CARRIER_PATTERNS) {
    if (pattern.test(c)) return key
  }
  return null
}

const cleanTracking = (tracking: string): string => tracking.trim().replace(/\s+/g, '')

/**
 * Infer the carrier purely from the tracking-number shape.
 * UPS = 1Z + 16, USPS = 9x… (20-24) or a bare 20-22 digit label, FedEx = 12/15 digits.
 */
export function inferCarrierFromTracking(tracking: string): string | null {
  const t = cleanTracking(tracking)
  if (/^1Z[0-9A-Z]{16}$/i.test(t)) return 'ups'
  if (/^(9[2-5]\d{18,24}|\d{20,22})$/.test(t)) return 'usps'
  if (/^\d{12}$|^\d{15}$/.test(t)) return 'fedex'
  if (/^\d{10}$/.test(t)) return 'dhl'
  return null
}

/**
 * Resolve a display name + clickable tracking URL for a shipment.
 * Always returns something usable — falls back to a package search when the
 * carrier can't be identified, so the email never renders a dead link.
 */
export function resolveCarrier(tracking: string, carrier?: string | null): CarrierInfo {
  const t = cleanTracking(tracking)

  const key =
    (carrier ? matchCarrierName(carrier) : null) ||
    inferCarrierFromTracking(t) ||
    undefined

  if (key && CARRIERS[key]) {
    return { name: CARRIERS[key].name, trackingUrl: CARRIERS[key].url(t), resolved: true }
  }

  return {
    name: (carrier || '').trim() || 'Standard Shipping',
    trackingUrl: `https://www.google.com/search?q=${encodeURIComponent(`track package ${t}`)}`,
    resolved: false,
  }
}

/** Convenience wrapper when only the URL is needed. */
export function getTrackingUrl(tracking: string, carrier?: string | null): string {
  return resolveCarrier(tracking, carrier).trackingUrl
}

// ============================================================================
// Live carrier tracking (Shippo Tracking API)
//
// Until now a tracking number on an order was a string and a deep link: the
// admin pasted it, the buyer got an email, and nobody on this side of the glass
// ever learned what the parcel did next. Orders sat on "Shipped" until someone
// remembered to click "Delivered" by hand — which mostly never happened, so the
// delivered email (and the thank-you it carries) never went out either.
//
// This module is the read side of that: one GET per shipment against
// https://api.goshippo.com/tracks/{carrier}/{number}, normalized into our own
// vocabulary. It is deliberately pure-ish — the HTTP call is injectable — so
// the status mapping is testable without a network or a Shippo account.
//
// It never throws: every failure comes back as a typed result, because the
// callers (an admin panel refresh and a background sweep) must both degrade to
// "here's the carrier's own tracking page" rather than break.
// ============================================================================

import { resolveCarrier } from '../utils/carrier-tracking.js'

/** Our own shipment vocabulary — a superset of what any one carrier reports. */
export type ShipmentStatus =
  | 'pre_transit'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'returned'
  | 'failure'
  | 'unknown'

/** One carrier scan. */
export interface TrackingScan {
  status: ShipmentStatus
  detail: string
  date: string | null
  location: string | null
}

export interface LiveTracking {
  trackingNumber: string
  /** Display name, e.g. "UPS" */
  carrier: string
  /** The carrier's own tracking page for this number. */
  trackingUrl: string
  status: ShipmentStatus
  statusDetail: string
  /** When the carrier recorded the current status. */
  statusAt: string | null
  /** "Atlanta, GA" — wherever the parcel last was. */
  location: string | null
  /** Carrier's estimated delivery, when it publishes one. */
  eta: string | null
  /** Carrier service level, e.g. "Surepost Lightweight" — null if not reported. */
  service: string | null
  /** Newest scan first. */
  events: TrackingScan[]
}

export type TrackingFetchResult =
  | { ok: true; tracking: LiveTracking }
  | {
      ok: false
      /**
       * no_token          — SHIPPO_API_TOKEN isn't set (feature is simply off)
       * unsupported_carrier — we can't tell which carrier this is
       * not_found         — Shippo has never seen this number
       * error             — network/5xx/parse; retryable
       */
      reason: 'no_token' | 'unsupported_carrier' | 'not_found' | 'error'
      message: string
    }

export interface TrackingDeps {
  token?: string
  fetchFn?: typeof fetch
}

const SHIPPO_BASE = 'https://api.goshippo.com'

// Shippo's status vocabulary → ours. Anything unlisted (including the literal
// "UNKNOWN") stays 'unknown', which the UI renders as "no scans yet".
const STATUS_MAP: Record<string, ShipmentStatus> = {
  PRE_TRANSIT: 'pre_transit',
  TRANSIT: 'in_transit',
  DELIVERED: 'delivered',
  RETURNED: 'returned',
  FAILURE: 'failure',
  UNKNOWN: 'unknown',
}

// Shippo hangs "out for delivery" off a substatus of TRANSIT rather than giving
// it a status of its own, but it is the one scan a customer actually cares
// about, so it gets promoted to a first-class status here.
const OUT_FOR_DELIVERY_SUBSTATUSES = new Set(['out_for_delivery', 'delivery_attempted_out_for_delivery'])

export const isTerminalStatus = (status: ShipmentStatus): boolean =>
  status === 'delivered' || status === 'returned' || status === 'failure'

/**
 * "Atlanta, GA" — or null when the carrier sent no real place.
 *
 * UPS pads every pre-transit scan with `{city:"", state:"", country:"US"}`
 * (verified live), so a naive formatter renders the location of a package that
 * hasn't moved as "US". Domestic-only country codes are therefore dropped.
 */
export function formatLocation(loc: any): string | null {
  if (!loc || typeof loc !== 'object') return null
  const parts = [loc.city, loc.state].filter((p: any) => typeof p === 'string' && p.trim().length > 0)
  const country = typeof loc.country === 'string' ? loc.country.trim().toUpperCase() : ''
  if (parts.length === 0) {
    return country && country !== 'US' && country !== 'USA' ? country : null
  }
  if (country && country !== 'US' && country !== 'USA') parts.push(country)
  return parts.join(', ')
}

function mapStatus(raw: any): ShipmentStatus {
  const status = STATUS_MAP[String(raw?.status || '').toUpperCase()] || 'unknown'
  const substatus = String(raw?.substatus?.code || '').toLowerCase()
  if (status === 'in_transit' && OUT_FOR_DELIVERY_SUBSTATUSES.has(substatus)) return 'out_for_delivery'
  return status
}

const asIso = (value: any): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Turn a Shippo track object into our shape. Exported for tests and because the
 * webhook payload (should we ever wire one) carries the same object.
 */
export function normalizeShippoTrack(body: any, trackingNumber: string, carrier?: string | null): LiveTracking {
  const info = resolveCarrier(trackingNumber, carrier)
  const current = body?.tracking_status || {}

  const events: TrackingScan[] = Array.isArray(body?.tracking_history)
    ? body.tracking_history
        .map((h: any) => ({
          status: mapStatus(h),
          detail: String(h?.status_details || h?.status || '').trim(),
          date: asIso(h?.status_date),
          location: formatLocation(h?.location),
        }))
        // Carriers send history oldest-first; every reader here wants the
        // newest scan at the top.
        .sort((a: TrackingScan, b: TrackingScan) => (b.date || '').localeCompare(a.date || ''))
    : []

  const status = mapStatus(current)

  return {
    trackingNumber,
    carrier: info.name,
    trackingUrl: info.trackingUrl,
    status,
    statusDetail:
      String(current?.status_details || '').trim() ||
      events[0]?.detail ||
      '',
    statusAt: asIso(current?.status_date) || events[0]?.date || null,
    location: formatLocation(current?.location) || events[0]?.location || null,
    eta: asIso(body?.eta) || asIso(body?.original_eta),
    service: (typeof body?.servicelevel?.name === 'string' && body.servicelevel.name.trim()) || null,
    events,
  }
}

/**
 * Ask Shippo where a parcel is.
 *
 * Shippo registers a tracking number on first GET, so the same call both
 * subscribes the shipment and reads it — no separate POST /tracks/ needed.
 */
export async function fetchLiveTracking(
  trackingNumber: string,
  carrier?: string | null,
  deps: TrackingDeps = {}
): Promise<TrackingFetchResult> {
  const token = deps.token !== undefined ? deps.token : process.env.SHIPPO_API_TOKEN
  const doFetch = deps.fetchFn || fetch
  const number = String(trackingNumber || '').trim().replace(/\s+/g, '')

  if (!number) {
    return { ok: false, reason: 'unsupported_carrier', message: 'No tracking number on this order' }
  }
  if (!token) {
    return { ok: false, reason: 'no_token', message: 'SHIPPO_API_TOKEN is not set — live tracking is off' }
  }

  const shippoCarrier = resolveCarrier(number, carrier).shippoCarrier
  if (!shippoCarrier) {
    return {
      ok: false,
      reason: 'unsupported_carrier',
      message: `Could not identify the carrier for ${number}${carrier ? ` ("${carrier}")` : ''}`,
    }
  }

  try {
    const res = await doFetch(`${SHIPPO_BASE}/tracks/${shippoCarrier}/${encodeURIComponent(number)}`, {
      method: 'GET',
      headers: {
        Authorization: `ShippoToken ${token}`,
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      if (res.status === 404) {
        return { ok: false, reason: 'not_found', message: `Shippo has no record of ${number} yet` }
      }
      return {
        ok: false,
        reason: 'error',
        message: `Shippo ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
      }
    }

    const body = await res.json()
    return { ok: true, tracking: normalizeShippoTrack(body, number, carrier) }
  } catch (err: any) {
    return { ok: false, reason: 'error', message: err?.message || String(err) }
  }
}

/** Short human label for a status — shared by the admin panel and the API. */
export const STATUS_LABELS: Record<ShipmentStatus, string> = {
  pre_transit: 'Label created',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  returned: 'Returned to sender',
  failure: 'Delivery problem',
  unknown: 'No scans yet',
}

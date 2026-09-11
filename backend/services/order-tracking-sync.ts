// ============================================================================
// One order, one carrier poll, one decision.
//
// This is the piece that makes a tracking number mean something: it reads the
// live scan (services/shipment-tracking.ts), writes it onto the order so both
// the admin panel and the buyer's status page show real carrier data, and —
// when the carrier says DELIVERED — moves the order to delivered, mints the
// thank-you coupon and mails it. Once. Ever.
//
// Used by two callers that must not disagree:
//   • GET /api/orders/:id/tracking   (admin opens the Manage Order modal)
//   • worker/delivery-tracking-sweep (every N minutes, unattended)
//
// Both can run against the same order at the same moment, so "delivered" is
// CLAIMED, not set: deps.claimDelivered performs a conditional update and
// reports whether THIS call was the one that moved it. Only the winner mails
// the customer, which is what stops a double "your order arrived!" email.
// ============================================================================

import { checkOrderTransition } from '../lib/order-status.js'
import type { LiveTracking, ShipmentStatus, TrackingFetchResult } from './shipment-tracking.js'
import type { DeliveryCoupon } from './delivery-coupon.js'

export interface SyncableOrder {
  id: string
  order_number?: string | null
  status?: string | null
  customer_email?: string | null
  customer_name?: string | null
  shipping_address?: any
  tracking_number?: string | null
  tracking_company?: string | null
  tracking_status?: string | null
  delivery_coupon_code?: string | null
}

export interface TrackingSyncDeps {
  fetchTracking: (trackingNumber: string, carrier?: string | null) => Promise<TrackingFetchResult>
  /** Persist the tracking snapshot columns. Returns false if the write didn't stick. */
  saveSnapshot: (orderId: string, patch: Record<string, any>) => Promise<boolean>
  /**
   * Conditionally move the order to delivered. MUST be atomic ("update … where
   * status <> 'delivered'") and return true only when this call did the move.
   */
  claimDelivered: (orderId: string, deliveredAt: string | null) => Promise<boolean>
  issueCoupon: (order: SyncableOrder) => Promise<DeliveryCoupon | null>
  sendDeliveredEmail: (order: SyncableOrder, coupon: DeliveryCoupon | null) => Promise<boolean>
  now: () => Date
}

export interface TrackingSyncResult {
  orderId: string
  /** Live status from the carrier, or null when the poll failed. */
  status: ShipmentStatus | null
  tracking: LiveTracking | null
  /** True only when THIS call moved the order into delivered. */
  deliveredNow: boolean
  emailed: boolean
  couponCode: string | null
  error: string | null
  /** Set when no poll happened at all. */
  skipped?: 'no_tracking' | 'no_token' | 'unsupported_carrier'
}

const base = (orderId: string): TrackingSyncResult => ({
  orderId,
  status: null,
  tracking: null,
  deliveredNow: false,
  emailed: false,
  couponCode: null,
  error: null,
})

export async function syncOrderTracking(
  order: SyncableOrder,
  deps: TrackingSyncDeps
): Promise<TrackingSyncResult> {
  const result = base(order.id)
  const trackingNumber = (order.tracking_number || '').trim()

  if (!trackingNumber) {
    result.skipped = 'no_tracking'
    return result
  }

  const fetched = await deps.fetchTracking(trackingNumber, order.tracking_company)
  const checkedAt = deps.now().toISOString()

  if (!fetched.ok) {
    // "No token" and "we can't tell who the carrier is" are configuration
    // facts, not shipment facts — writing them onto the order would just paint
    // a scary error on a perfectly healthy parcel every few minutes.
    if (fetched.reason === 'no_token' || fetched.reason === 'unsupported_carrier') {
      result.skipped = fetched.reason
      result.error = fetched.message
      return result
    }

    result.error = fetched.message
    // Stamp checked_at even on failure: it's what keeps the sweep's queue
    // moving instead of retrying one broken number forever.
    await deps.saveSnapshot(order.id, {
      tracking_checked_at: checkedAt,
      tracking_error: fetched.message,
    })
    return result
  }

  const tracking = fetched.tracking
  result.tracking = tracking
  result.status = tracking.status

  await deps.saveSnapshot(order.id, {
    tracking_status: tracking.status,
    tracking_status_detail: tracking.statusDetail || null,
    tracking_status_at: tracking.statusAt,
    tracking_location: tracking.location,
    tracking_eta: tracking.eta,
    tracking_events: tracking.events,
    tracking_checked_at: checkedAt,
    tracking_error: null,
  })

  if (tracking.status !== 'delivered') return result

  // The carrier says it arrived. Whether the ORDER may say so is the state
  // machine's call — a refunded or cancelled order stays where it is.
  const transition = checkOrderTransition(order.status, 'delivered')
  if (!transition.ok || transition.kind === 'noop') return result

  const claimed = await deps.claimDelivered(order.id, tracking.statusAt)
  if (!claimed) return result

  result.deliveredNow = true

  let coupon: DeliveryCoupon | null = null
  try {
    coupon = await deps.issueCoupon(order)
  } catch (err: any) {
    // A missing coupon is a missing bonus; the email still goes.
    result.error = `Coupon failed: ${err?.message || String(err)}`
  }
  result.couponCode = coupon?.code || null

  try {
    result.emailed = await deps.sendDeliveredEmail(order, coupon)
  } catch (err: any) {
    result.error = err?.message || String(err)
  }

  return result
}

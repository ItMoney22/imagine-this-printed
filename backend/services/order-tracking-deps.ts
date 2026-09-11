// ============================================================================
// The live wiring for order-tracking-sync.ts: Supabase + Shippo + Resend.
//
// Kept apart from the sync logic so that logic stays unit-testable without a
// database, and so the admin route and the background sweep provably run the
// SAME code — the delivered email, the coupon and the status write cannot drift
// between "an admin looked at the order" and "the worker noticed".
// ============================================================================

import { supabase } from '../lib/supabase.js'
import { fetchLiveTracking } from './shipment-tracking.js'
import { issueDeliveryCoupon, randomCouponSuffix, type CouponOrder, type DeliveryCoupon } from './delivery-coupon.js'
import { sendOrderDeliveredEmail } from '../utils/email.js'
import type { SyncableOrder, TrackingSyncDeps } from './order-tracking-sync.js'

/** Columns every tracking caller needs. Kept in one place so they can't drift. */
export const TRACKING_ORDER_COLUMNS =
  'id, order_number, status, customer_email, customer_name, shipping_address, ' +
  'tracking_number, tracking_company, tracking_status, tracking_status_detail, ' +
  'tracking_status_at, tracking_location, tracking_eta, tracking_events, ' +
  'tracking_checked_at, tracking_error, delivery_coupon_code, shipped_at, delivered_at, estimated_delivery'

/**
 * Columns added by 20260911000000_order_live_tracking.sql. If that migration
 * hasn't been applied yet, PostgREST rejects the whole SELECT/UPDATE — so every
 * read and write below degrades to the pre-migration column set instead of
 * failing. Live tracking then still WORKS (it just isn't cached), which matters
 * because frontend and backend deploy independently here.
 */
const NEW_TRACKING_COLUMNS = [
  'tracking_status',
  'tracking_status_detail',
  'tracking_status_at',
  'tracking_location',
  'tracking_eta',
  'tracking_events',
  'tracking_checked_at',
  'tracking_error',
  'delivery_coupon_code',
]

export const LEGACY_ORDER_COLUMNS =
  'id, order_number, status, customer_email, customer_name, shipping_address, ' +
  'tracking_number, tracking_company, shipped_at, delivered_at, estimated_delivery'

/** True when a PostgREST error is "that column does not exist". */
export const isMissingColumnError = (error: any): boolean => {
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase()
  return error?.code === 'PGRST204' || error?.code === '42703' || message.includes('column') && message.includes('does not exist')
}

const buyerName = (order: SyncableOrder): string | undefined =>
  order.customer_name ||
  [order.shipping_address?.firstName, order.shipping_address?.lastName].filter(Boolean).join(' ') ||
  undefined

/** Drop the not-yet-migrated columns from a patch so the rest still writes. */
const stripNewColumns = (patch: Record<string, any>): Record<string, any> => {
  const out: Record<string, any> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!NEW_TRACKING_COLUMNS.includes(key)) out[key] = value
  }
  return out
}

export const issueCouponForOrder = (order: CouponOrder): Promise<DeliveryCoupon | null> =>
  issueDeliveryCoupon(order, {
    async insertCoupon(row) {
      const { error } = await supabase.from('discount_codes').insert(row)
      if (!error) return { ok: true }
      // 23505 = unique_violation on discount_codes.code
      return { ok: false, duplicate: error.code === '23505', error: error.message }
    },
    async saveCodeOnOrder(orderId, code) {
      const { error } = await supabase
        .from('orders')
        .update({ delivery_coupon_code: code, updated_at: new Date().toISOString() })
        .eq('id', orderId)
      if (error && isMissingColumnError(error)) {
        console.warn('[order-tracking] orders.delivery_coupon_code missing — coupon issued but not stamped on the order')
        return false
      }
      return !error
    },
    randomSuffix: () => randomCouponSuffix(),
    now: () => new Date(),
  })

export const sendDeliveredWithCoupon = (order: SyncableOrder, coupon: DeliveryCoupon | null): Promise<boolean> => {
  if (!order.customer_email) return Promise.resolve(false)
  return sendOrderDeliveredEmail(order.customer_email, order.order_number || order.id, {
    orderId: order.id,
    customerName: buyerName(order),
    coupon: coupon ? { code: coupon.code, percent: coupon.percent, expiresAt: coupon.expiresAt } : null,
  })
}

/** The production dependency set. */
export function makeTrackingSyncDeps(): TrackingSyncDeps {
  return {
    fetchTracking: (trackingNumber, carrier) => fetchLiveTracking(trackingNumber, carrier),

    async saveSnapshot(orderId, patch) {
      const write = async (body: Record<string, any>) =>
        supabase.from('orders').update(body).eq('id', orderId)

      const { error } = await write(patch)
      if (!error) return true

      if (isMissingColumnError(error)) {
        const reduced = stripNewColumns(patch)
        if (Object.keys(reduced).length === 0) return false
        const retry = await write(reduced)
        return !retry.error
      }

      console.error(`[order-tracking] Failed to save tracking snapshot for ${orderId}:`, error.message)
      return false
    },

    /**
     * Atomic claim. `.neq('status', 'delivered')` is what makes the delivered
     * email exactly-once: whichever caller wins the race gets a row back, the
     * loser gets none and stays quiet.
     */
    async claimDelivered(orderId, deliveredAt) {
      const stamp = deliveredAt || new Date().toISOString()
      const { data, error } = await supabase
        .from('orders')
        .update({
          status: 'delivered',
          fulfillment_status: 'delivered',
          delivered_at: stamp,
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId)
        .neq('status', 'delivered')
        .select('id')

      if (error) {
        console.error(`[order-tracking] Failed to mark ${orderId} delivered:`, error.message)
        return false
      }
      return (data?.length || 0) > 0
    },

    issueCoupon: (order) => issueCouponForOrder(order),
    sendDeliveredEmail: (order, coupon) => sendDeliveredWithCoupon(order, coupon),
    now: () => new Date(),
  }
}

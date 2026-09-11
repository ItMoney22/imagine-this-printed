// ============================================================================
// The clock behind "it should auto change when delivered".
//
// Every shipped order with a tracking number gets polled against the carrier on
// a timer. When the carrier says DELIVERED the order moves itself to delivered
// and the buyer gets the delivery email with their thank-you coupon — no admin
// has to notice, remember, or click anything.
//
// Before this, orders.status sat at 'shipped' forever: the only code that could
// set 'delivered' was an admin button nobody pressed, so the delivered email
// (and every bit of repeat business it was supposed to earn) never went out.
//
// Shape follows worker/step-flow-stall-sweep.ts: injectable deps, one log line
// per tick, and safe to run on several worker replicas — delivery is claimed
// with a conditional UPDATE, so only one replica can mail a given customer.
// ============================================================================

import { supabase } from '../lib/supabase.js'
import { syncOrderTracking, type SyncableOrder, type TrackingSyncDeps } from '../services/order-tracking-sync.js'
import {
  makeTrackingSyncDeps,
  isMissingColumnError,
  TRACKING_ORDER_COLUMNS,
  LEGACY_ORDER_COLUMNS
} from '../services/order-tracking-deps.js'

/** How often the sweep runs. */
export const DELIVERY_SWEEP_MINUTES = Number(process.env.DELIVERY_SWEEP_MINUTES) > 0
  ? Number(process.env.DELIVERY_SWEEP_MINUTES)
  : 30

/** Orders polled per tick — keeps carrier calls (and Shippo spend) predictable. */
export const DELIVERY_SWEEP_BATCH = Number(process.env.DELIVERY_SWEEP_BATCH) > 0
  ? Number(process.env.DELIVERY_SWEEP_BATCH)
  : 25

/**
 * After this long with no delivery scan, stop polling. A parcel that has been
 * in limbo for two months is a support case, not a tracking problem, and we
 * shouldn't spend a carrier call on it every half hour forever.
 */
export const DELIVERY_SWEEP_MAX_AGE_DAYS = Number(process.env.DELIVERY_SWEEP_MAX_AGE_DAYS) > 0
  ? Number(process.env.DELIVERY_SWEEP_MAX_AGE_DAYS)
  : 45

const FIRST_RUN_DELAY_MS = 60_000

export interface DeliverySweepSummary {
  scanned: number
  delivered: number
  emailed: number
  errors: number
}

export interface DeliverySweepDeps {
  /** Orders due a poll, oldest check first. */
  fetchDueOrders: (limit: number) => Promise<SyncableOrder[]>
  sync: (order: SyncableOrder) => Promise<{ deliveredNow: boolean; emailed: boolean; error: string | null; couponCode: string | null }>
}

export function makeSupabaseSweepDeps(syncDeps: TrackingSyncDeps = makeTrackingSyncDeps()): DeliverySweepDeps {
  return {
    async fetchDueOrders(limit) {
      const cutoff = new Date(Date.now() - DELIVERY_SWEEP_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()

      const query = (columns: string, withTrackingColumns: boolean) => {
        let q = supabase
          .from('orders')
          .select(columns)
          .eq('status', 'shipped')
          .not('tracking_number', 'is', null)
          // Age bound. Not every path that ships an order stamps shipped_at
          // (a label bought outside the app, a legacy row), and a plain
          // `.gte('shipped_at', …)` silently drops those orders from the sweep
          // forever — they would never auto-deliver. Chained .or() calls AND
          // together in PostgREST (verified live against this database), so
          // this composes with the status filter below rather than widening it.
          .or(`shipped_at.gte.${cutoff},and(shipped_at.is.null,created_at.gte.${cutoff})`)

        if (withTrackingColumns) {
          // Never re-poll a parcel the carrier has already settled.
          q = q
            .or('tracking_status.is.null,tracking_status.in.(pre_transit,in_transit,out_for_delivery,unknown)')
            // Nulls first: an order that has never been polled jumps the queue.
            .order('tracking_checked_at', { ascending: true, nullsFirst: true })
        }

        return q.limit(limit)
      }

      const { data, error } = await query(TRACKING_ORDER_COLUMNS, true) as any
      if (!error) return (data || []) as SyncableOrder[]

      if (isMissingColumnError(error)) {
        // Migration not applied yet — still sweep, just without the cache-aware
        // filtering. Delivery detection itself doesn't need those columns.
        const legacy = await query(LEGACY_ORDER_COLUMNS, false) as any
        if (legacy.error) throw new Error(legacy.error.message)
        return (legacy.data || []) as SyncableOrder[]
      }

      throw new Error(error.message)
    },

    async sync(order) {
      const outcome = await syncOrderTracking(order, syncDeps)
      return {
        deliveredNow: outcome.deliveredNow,
        emailed: outcome.emailed,
        error: outcome.error,
        couponCode: outcome.couponCode
      }
    }
  }
}

/**
 * One pass: poll each due order, deliver the ones the carrier has delivered.
 * A single bad order never stops the batch.
 */
export async function sweepDeliveries(
  deps: DeliverySweepDeps,
  limit: number = DELIVERY_SWEEP_BATCH
): Promise<DeliverySweepSummary> {
  const summary: DeliverySweepSummary = { scanned: 0, delivered: 0, emailed: 0, errors: 0 }
  const orders = await deps.fetchDueOrders(limit)

  for (const order of orders) {
    summary.scanned++
    try {
      const outcome = await deps.sync(order)
      if (outcome.deliveredNow) {
        summary.delivered++
        if (outcome.emailed) summary.emailed++
        console.log(
          `[delivery-sweep] 📬 ${order.order_number || order.id} delivered — ` +
            `${outcome.emailed ? 'customer emailed' : 'EMAIL NOT SENT'}` +
            `${outcome.couponCode ? ` with coupon ${outcome.couponCode}` : ' (no coupon)'}`
        )
      }
      if (outcome.error) summary.errors++
    } catch (err: any) {
      summary.errors++
      console.error(`[delivery-sweep] ${order.order_number || order.id} failed:`, err?.message || String(err))
    }
  }

  return summary
}

/** One tick, wrapped so a thrown query can never take the worker down. */
export async function runDeliverySweep(
  deps: DeliverySweepDeps = makeSupabaseSweepDeps()
): Promise<DeliverySweepSummary | null> {
  try {
    const summary = await sweepDeliveries(deps)
    if (summary.scanned > 0) {
      console.log(
        `[delivery-sweep] checked ${summary.scanned} shipment(s) — ` +
          `${summary.delivered} delivered, ${summary.emailed} emailed, ${summary.errors} error(s)`
      )
    }
    return summary
  } catch (err: any) {
    console.error('[delivery-sweep] sweep failed:', err?.message || String(err))
    return null
  }
}

export function startDeliveryTrackingSweep(): void {
  if (process.env.DELIVERY_SWEEP_ENABLED === 'false') {
    console.log('[delivery-sweep] disabled (DELIVERY_SWEEP_ENABLED=false)')
    return
  }
  if (!process.env.SHIPPO_API_TOKEN) {
    console.log('[delivery-sweep] SHIPPO_API_TOKEN not set — live tracking is off, orders stay on manual Delivered')
    return
  }

  console.log(
    `[delivery-sweep] 🚚 polling carriers every ${DELIVERY_SWEEP_MINUTES}m ` +
      `(${DELIVERY_SWEEP_BATCH} shipments/tick, giving up after ${DELIVERY_SWEEP_MAX_AGE_DAYS} days) — ` +
      'delivered orders mark themselves and email the customer a thank-you coupon'
  )

  setInterval(() => { void runDeliverySweep() }, DELIVERY_SWEEP_MINUTES * 60 * 1000)
  setTimeout(() => { void runDeliverySweep() }, FIRST_RUN_DELAY_MS)
}

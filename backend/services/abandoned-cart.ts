// Abandoned-checkout recovery: the data layer the decision layer was waiting for.
//
// backend/lib/abandoned-cart.ts (the schedule), its tests, and
// 20260728140100_abandoned_cart_reminders.sql (the dedupe table) were all
// written on 2026-07-28 and then nothing else was. There was no service, no
// email and no worker wiring, and the migration was never applied — verified on
// prod 2026-09-07: `relation "public.abandoned_cart_reminders" does not exist`.
// So in the ~6 weeks since, not one customer was ever asked whether they meant
// to leave their cart behind.
//
// This is that missing half. It runs on the worker's hourly sweep.
//
// WHAT IT WILL AND WILL NOT MAIL
//
// Candidate = an `orders` row still sitting unpaid (see shared/order-visibility.ts
// for why payment_status, not status, is the test) with an email captured at
// checkout and a cart snapshot in metadata.items. Timing and stage come from
// decideReminderStage(); this module owns only the query, the guards and the send.
//
// Deliberately NOT mailed:
//   * anyone on the suppression list — handled for free inside
//     sendEmailWithTracking, which refuses suppressed addresses.
//   * a checkout that has since been paid, cancelled or refunded.
//   * a cart older than MAX_RECOVERY_AGE_MS (7 days). The worker's own
//     cleanupIncompleteOrders() hard-deletes unpaid rows at 10 days, so the
//     recovery window closes comfortably before the evidence disappears.
//   * the same order+stage twice, EVER — enforced by the primary key on
//     abandoned_cart_reminders, not by a check-then-send race.
import { supabase } from '../lib/supabase.js'
import {
  decideReminderStage,
  MAX_RECOVERY_AGE_MS,
  type ReminderStage
} from '../lib/abandoned-cart.js'
import { isAbandonedCheckout } from '../shared/order-visibility.js'
import { sendAbandonedCartEmail, type AbandonedCartItem } from '../utils/email-marketing.js'
import { buildCartRecoveryUrl } from '../utils/cart-recovery-token.js'

/** Ceiling on sends per sweep, so a backlog or a bug can't blast the list. */
const MAX_SENDS_PER_RUN = Number(process.env.ABANDONED_CART_MAX_PER_RUN || 25)

/**
 * Master switch. Defaults ON — the whole point is that this was dark for six
 * weeks — but a single env var stops all commercial sending without a deploy
 * if a template or the schedule turns out to be wrong.
 */
function isEnabled(): boolean {
  return String(process.env.ABANDONED_CART_EMAILS ?? 'true').toLowerCase() !== 'false'
}

export interface SweepResult {
  scanned: number
  sent: number
  skipped: number
  failed: number
  /** Populated when the sweep could not run at all (disabled, or table missing). */
  halted?: string
}

/** orders.metadata.items, written by snapshotCartItems() in routes/stripe.ts. */
function snapshotToItems(metadata: any): AbandonedCartItem[] {
  const raw = Array.isArray(metadata?.items) ? metadata.items : []
  return raw.map((i: any) => ({
    name: i?.name ?? null,
    quantity: Number(i?.quantity) || 1,
    price: i?.price != null ? Number(i.price) : null,
    image: i?.image ?? null,
    size: i?.size ?? null,
    color: i?.color ?? null
  }))
}

/**
 * One pass of the recovery job.
 *
 * Never throws: it runs inside the worker's hourly loop and a recovery email is
 * never worth taking the worker down for.
 */
export async function sweepAbandonedCarts(now: Date = new Date()): Promise<SweepResult> {
  const result: SweepResult = { scanned: 0, sent: 0, skipped: 0, failed: 0 }

  if (!isEnabled()) {
    return { ...result, halted: 'ABANDONED_CART_EMAILS=false' }
  }

  const oldestRecoverable = new Date(now.getTime() - MAX_RECOVERY_AGE_MS).toISOString()

  const { data: rows, error } = await supabase
    .from('orders')
    .select('id, order_number, customer_email, customer_name, total, status, payment_status, created_at, metadata, shipping_address')
    .eq('payment_status', 'pending')
    .not('customer_email', 'is', null)
    .gt('created_at', oldestRecoverable)
    .order('created_at', { ascending: true })
    .limit(200)

  if (error) {
    console.error('[abandoned-cart] Candidate query failed:', error.message)
    return { ...result, halted: `candidate query failed: ${error.message}` }
  }

  // isAbandonedCheckout re-applies the cancelled/refunded exclusion the SQL
  // above can't express cleanly, so a draft an admin killed is never chased.
  const candidates = (rows || []).filter(isAbandonedCheckout)
  result.scanned = candidates.length
  if (candidates.length === 0) return result

  // Which stages have already gone out, in ONE query rather than per order.
  const { data: sentRows, error: sentError } = await supabase
    .from('abandoned_cart_reminders')
    .select('order_id, stage')
    .in('order_id', candidates.map(c => c.id))

  if (sentError) {
    // The dedupe table is the ONLY thing standing between a customer and a
    // repeat send. If it can't be read, send nothing — mailing twice is worse
    // than mailing late, and an unapplied migration lands here.
    console.error('[abandoned-cart] Reminder-history query failed, refusing to send:', sentError.message)
    return { ...result, halted: `reminder history unreadable: ${sentError.message}` }
  }

  const sentByOrder = new Map<string, ReminderStage[]>()
  for (const row of sentRows || []) {
    const list = sentByOrder.get(row.order_id) || []
    list.push(row.stage as ReminderStage)
    sentByOrder.set(row.order_id, list)
  }

  for (const order of candidates) {
    if (result.sent >= MAX_SENDS_PER_RUN) {
      console.warn(`[abandoned-cart] Hit MAX_SENDS_PER_RUN (${MAX_SENDS_PER_RUN}); remaining carts wait for the next sweep`)
      break
    }

    const decision = decideReminderStage(
      {
        orderId: order.id,
        email: order.customer_email,
        createdAt: order.created_at,
        sentStages: sentByOrder.get(order.id) || []
      },
      now
    )

    if (!decision.send) {
      result.skipped++
      continue
    }

    const items = snapshotToItems(order.metadata)
    if (items.length === 0) {
      // Nothing to show them. A "you left something behind" email with an empty
      // cart is worse than no email.
      result.skipped++
      continue
    }

    // Claim the stage BEFORE sending, not after. The primary key on
    // (order_id, stage) makes this the atomic gate: two overlapping sweeps
    // both reach here, one wins the INSERT and the other gets 23505 and backs
    // off. Claiming after the send would leave a window where a crash between
    // send and record re-mails the customer on the next tick.
    const { error: claimError } = await supabase
      .from('abandoned_cart_reminders')
      .insert({ order_id: order.id, stage: decision.stage })

    if (claimError) {
      if (claimError.code === '23505') {
        result.skipped++
        continue
      }
      console.error(`[abandoned-cart] Could not claim ${order.order_number || order.id} / ${decision.stage}:`, claimError.message)
      result.failed++
      continue
    }

    try {
      const sendResult = await sendAbandonedCartEmail({
        to: order.customer_email!,
        customerName:
          order.customer_name ||
          [order.shipping_address?.firstName, order.shipping_address?.lastName].filter(Boolean).join(' ') ||
          null,
        items,
        total: Number(order.total) || 0,
        recoverUrl: buildCartRecoveryUrl(order.id),
        stage: decision.stage
      })

      if (sendResult.success) {
        result.sent++
        // Store the provider id so a complaint can be traced back to the exact send.
        if (sendResult.messageId) {
          await supabase
            .from('abandoned_cart_reminders')
            .update({ provider_email_id: sendResult.messageId })
            .eq('order_id', order.id)
            .eq('stage', decision.stage)
        }
        console.log(`[abandoned-cart] 📧 ${decision.stage} reminder sent for ${order.order_number || order.id} to ${order.customer_email}`)
      } else if (sendResult.suppressed) {
        // Unsubscribed or previously bounced. The claim row stays: it is a
        // correct record that this stage is done and must not be retried.
        result.skipped++
        console.log(`[abandoned-cart] 🚫 ${order.customer_email} is suppressed (${sendResult.suppressionReason}) — not mailed`)
      } else {
        result.failed++
        console.error(`[abandoned-cart] Send failed for ${order.order_number || order.id} — the claim row stays, so this stage will NOT be retried`)
      }
    } catch (err: any) {
      result.failed++
      console.error(`[abandoned-cart] Send threw for ${order.order_number || order.id}:`, err?.message || err)
    }
  }

  if (result.sent > 0 || result.failed > 0) {
    console.log(`[abandoned-cart] Sweep done — scanned ${result.scanned}, sent ${result.sent}, skipped ${result.skipped}, failed ${result.failed}`)
  }
  return result
}

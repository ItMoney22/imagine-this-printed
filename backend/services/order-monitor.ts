// ---------------------------------------------------------------------------
// Health + order monitor (runs on the worker's hourly loop).
//
//  - Worker heartbeat: one audit_logs row per run; /api/health/worker and the
//    admin ops panel read the latest to detect a dead worker.
//  - Stalled orders: paid but not moving past ORDER_STALL_DAYS (default 3) →
//    admin bell (type 'order_stalled') + digest email. One alert per order,
//    tracked in orders.metadata.stall_alerted_at.
//  - AI-job failure spike: >= AI_JOBS_SPIKE_THRESHOLD failures in the last
//    hour → 'health_alert' bell + email, re-alerted at most every 6h.
//  - Daily ops summary email around DAILY_SUMMARY_HOUR ET (default 8):
//    orders/revenue last 24h, unfulfilled paid, stalls, pending approvals,
//    low blank stock, AI-job failures.
//
// Everything catches its own errors — the monitor must never take down the
// worker loop.
// ---------------------------------------------------------------------------
import { supabase } from '../lib/supabase.js'
import { sendEmail } from '../utils/email.js'

const ORDER_STALL_DAYS = Number(process.env.ORDER_STALL_DAYS || 3)
const AI_JOBS_SPIKE_THRESHOLD = Number(process.env.AI_JOBS_SPIKE_THRESHOLD || 5)
const DAILY_SUMMARY_HOUR = Number(process.env.DAILY_SUMMARY_HOUR || 8) // ET
const ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL || 'wecare@imaginethisprinted.com'
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://imaginethisprinted.com'

const TERMINAL_ORDER_STATUSES = ['shipped', 'delivered', 'completed', 'cancelled', 'refunded']

export interface StalledOrder {
  id: string
  order_number: string | null
  customer_email: string | null
  total: number
  status: string
  fulfillment_status: string | null
  created_at: string
  age_days: number
  already_alerted: boolean
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

function etHourNow(): number {
  return Number(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }))
}

async function lastAuditAt(action: string): Promise<string | null> {
  const { data } = await supabase
    .from('audit_logs')
    .select('created_at')
    .eq('action', action)
    .order('created_at', { ascending: false })
    .limit(1)
  return data?.[0]?.created_at ?? null
}

// Paid orders older than ORDER_STALL_DAYS that never reached a terminal state.
export async function getStalledOrders(): Promise<StalledOrder[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, customer_email, total, status, fulfillment_status, created_at, metadata')
    .eq('payment_status', 'paid')
    .lt('created_at', daysAgoIso(ORDER_STALL_DAYS))
    .order('created_at', { ascending: true })
    .limit(200)
  if (error) {
    console.error('[order-monitor] Stall query failed:', error.message)
    return []
  }
  return (data || [])
    .filter(o => !TERMINAL_ORDER_STATUSES.includes(String(o.status || '').toLowerCase()))
    .filter(o => String(o.fulfillment_status || 'unfulfilled').toLowerCase() !== 'fulfilled')
    .map(o => ({
      id: o.id,
      order_number: o.order_number,
      customer_email: o.customer_email,
      total: Number(o.total) || 0,
      status: o.status,
      fulfillment_status: o.fulfillment_status,
      created_at: o.created_at,
      age_days: Math.floor((Date.now() - new Date(o.created_at).getTime()) / 86400000),
      already_alerted: Boolean(o.metadata?.stall_alerted_at)
    }))
}

export async function getWorkerHeartbeat(): Promise<{ last_seen: string | null; ok: boolean }> {
  const lastSeen = await lastAuditAt('worker_heartbeat')
  const ok = !!lastSeen && Date.now() - new Date(lastSeen).getTime() < 2.5 * 60 * 60 * 1000
  return { last_seen: lastSeen, ok }
}

async function alertStalledOrders(): Promise<void> {
  const stalled = await getStalledOrders()
  const fresh = stalled.filter(s => !s.already_alerted)
  if (fresh.length === 0) return

  console.log(`[order-monitor] 🚨 ${fresh.length} newly stalled order(s)`)

  const { error: notifError } = await supabase.from('admin_notifications').insert(
    fresh.map(s => ({
      type: 'order_stalled',
      title: `Order ${s.order_number || s.id.slice(0, 8)} stalled ${s.age_days}d`,
      message: `$${s.total.toFixed(2)} paid order still ${s.status}/${s.fulfillment_status || 'unfulfilled'} after ${s.age_days} days.` +
        (s.customer_email ? ` Customer: ${s.customer_email}` : '')
    }))
  )
  if (notifError) console.error('[order-monitor] Stall notifications failed:', notifError.message)

  const rows = fresh.map(s => `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${s.order_number || s.id.slice(0, 8)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #dc2626; font-weight: bold;">${s.age_days}d</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${s.status} / ${s.fulfillment_status || 'unfulfilled'}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">$${s.total.toFixed(2)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${s.customer_email || '—'}</td>
        </tr>`).join('')
  try {
    await sendEmail({
      to: ALERT_EMAIL,
      subject: `⚠️ ${fresh.length} paid order${fresh.length === 1 ? '' : 's'} stalled past ${ORDER_STALL_DAYS} days`,
      htmlContent: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #dc2626; margin-top: 0;">Paid orders need attention</h2>
          <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px;">
            <thead><tr style="background: #f9fafb; text-align: left;">
              <th style="padding: 8px 12px;">Order</th><th style="padding: 8px 12px; text-align: center;">Age</th>
              <th style="padding: 8px 12px;">State</th><th style="padding: 8px 12px; text-align: right;">Total</th>
              <th style="padding: 8px 12px;">Customer</th>
            </tr></thead>
            <tbody>${rows}
            </tbody>
          </table>
          <p style="color: #6b7280; margin-top: 16px;">
            Work the queue in <a href="${FRONTEND_URL}/admin/orders" style="color: #7c3aed;">Order Management</a>.
          </p>
        </div>
      `
    })
  } catch (err: any) {
    console.error('[order-monitor] Stall email failed:', err?.message || err)
  }

  // Mark alerted (metadata merge per order — small N)
  for (const s of fresh) {
    const { data: order } = await supabase.from('orders').select('metadata').eq('id', s.id).single()
    await supabase
      .from('orders')
      .update({ metadata: { ...(order?.metadata || {}), stall_alerted_at: new Date().toISOString() } })
      .eq('id', s.id)
  }
}

async function alertAiJobFailureSpike(): Promise<void> {
  const { count, error } = await supabase
    .from('ai_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'failed')
    .gt('updated_at', hoursAgoIso(1))
  if (error || count == null || count < AI_JOBS_SPIKE_THRESHOLD) return

  const lastAlert = await lastAuditAt('ai_jobs_spike_alert')
  if (lastAlert && Date.now() - new Date(lastAlert).getTime() < 6 * 60 * 60 * 1000) return

  console.log(`[order-monitor] 🚨 AI-job failure spike: ${count} in the last hour`)
  await supabase.from('admin_notifications').insert({
    type: 'health_alert',
    title: `AI jobs failing: ${count} in the last hour`,
    message: 'Check Replicate/Tripo credentials and the worker logs on Render.'
  })
  await supabase.from('audit_logs').insert({ action: 'ai_jobs_spike_alert', metadata: { failed_last_hour: count } })
  try {
    await sendEmail({
      to: ALERT_EMAIL,
      subject: `🚨 AI job failures spiking (${count}/hour)`,
      htmlContent: `<p>${count} AI jobs failed in the last hour (threshold ${AI_JOBS_SPIKE_THRESHOLD}). Check the worker logs on Render and provider credits (Replicate / Tripo / OpenRouter).</p>`
    })
  } catch (err: any) {
    console.error('[order-monitor] Spike email failed:', err?.message || err)
  }
}

async function sendDailySummaryIfDue(): Promise<void> {
  if (etHourNow() !== DAILY_SUMMARY_HOUR) return
  const lastSent = await lastAuditAt('daily_summary_sent')
  if (lastSent && Date.now() - new Date(lastSent).getTime() < 20 * 60 * 60 * 1000) return

  const since = hoursAgoIso(24)

  const { data: recentOrders } = await supabase
    .from('orders')
    .select('total, payment_status')
    .gt('created_at', since)
  const paid = (recentOrders || []).filter(o => o.payment_status === 'paid')
  const revenue = paid.reduce((s, o) => s + (Number(o.total) || 0), 0)

  const { count: unfulfilledPaid } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('payment_status', 'paid')
    .neq('fulfillment_status', 'fulfilled')
    .not('status', 'in', `(${TERMINAL_ORDER_STATUSES.join(',')})`)

  const stalled = await getStalledOrders()

  const { count: pendingApprovals } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending_approval')

  const { data: blanks } = await supabase.from('blank_inventory').select('brand, style_code, color, size, qty_on_hand, reorder_threshold')
  const lowStock = (blanks || []).filter(b => b.qty_on_hand <= b.reorder_threshold)

  const { count: failedJobs } = await supabase
    .from('ai_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'failed')
    .gt('updated_at', since)

  const stallRows = stalled.slice(0, 10).map(s =>
    `<li>${s.order_number || s.id.slice(0, 8)} — ${s.age_days}d, $${s.total.toFixed(2)}, ${s.status}</li>`).join('')
  const lowRows = lowStock.slice(0, 15).map(b =>
    `<li>${b.brand} ${b.style_code} ${b.color}/${b.size} — <strong>${b.qty_on_hand}</strong> left</li>`).join('')

  try {
    await sendEmail({
      to: ALERT_EMAIL,
      subject: `📊 ITP daily ops — ${paid.length} orders / $${revenue.toFixed(2)} last 24h` +
        (stalled.length ? ` · ${stalled.length} stalled` : '') +
        (lowStock.length ? ` · ${lowStock.length} low-stock` : ''),
      htmlContent: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #7c3aed; margin-top: 0;">Daily ops summary</h2>
          <ul style="color: #374151; line-height: 1.8;">
            <li><strong>Orders (24h):</strong> ${paid.length} paid ($${revenue.toFixed(2)}), ${(recentOrders || []).length - paid.length} unpaid/drafts</li>
            <li><strong>Paid awaiting fulfillment:</strong> ${unfulfilledPaid ?? 0}</li>
            <li><strong>Stalled &gt; ${ORDER_STALL_DAYS}d:</strong> ${stalled.length}</li>
            <li><strong>Designs pending approval:</strong> ${pendingApprovals ?? 0}</li>
            <li><strong>Low blank stock:</strong> ${lowStock.length} SKU(s)</li>
            <li><strong>AI jobs failed (24h):</strong> ${failedJobs ?? 0}</li>
          </ul>
          ${stalled.length ? `<h3 style="color: #dc2626;">Stalled orders</h3><ul style="color: #374151;">${stallRows}</ul>` : ''}
          ${lowStock.length ? `<h3 style="color: #d97706;">Low stock</h3><ul style="color: #374151;">${lowRows}</ul>` : ''}
          <p style="color: #6b7280;">
            <a href="${FRONTEND_URL}/admin" style="color: #7c3aed;">Admin dashboard</a> ·
            <a href="${FRONTEND_URL}/admin/orders" style="color: #7c3aed;">Orders</a> ·
            <a href="${FRONTEND_URL}/admin?tab=inventory" style="color: #7c3aed;">Inventory</a>
          </p>
        </div>
      `
    })
    await supabase.from('audit_logs').insert({
      action: 'daily_summary_sent',
      metadata: { orders_24h: paid.length, revenue_24h: revenue, stalled: stalled.length, low_stock: lowStock.length }
    })
    console.log('[order-monitor] 📊 Daily summary sent')
  } catch (err: any) {
    console.error('[order-monitor] Daily summary failed:', err?.message || err)
  }
}

// ---------------------------------------------------------------------------
// Payment reconciler (2026-08-07).
//
// Why this exists: ITP's first real order ($26, ITP-MSJK1K3I-8GDG) was captured
// by Stripe and then sat at status=pending/payment_status=pending, with no
// customer email, no rewards, no inventory movement and no team alert — because
// the Stripe Dashboard endpoint still pointed at /api/webhooks/stripe, a route
// deleted on 2026-07-27 in f4785ce. Every delivery 404'd for eleven days and
// NOTHING in the system noticed: the stall alert waits 3 days, and the daily
// digest counts only payment_status='paid', so it cheerfully reported
// "0 orders / $0.00 last 24h" on a day money came in.
//
// So the webhook can no longer be the only thing that knows a payment
// succeeded. Every hour this asks Stripe the direct question — "is this
// PaymentIntent succeeded?" — for orders we still believe are unpaid, and heals
// any it finds through applyPaidCheckoutOrder, the exact same function the
// webhook calls. Stripe is the source of truth for money; this makes the DB
// eventually agree with it no matter what happens to webhook delivery.
// ---------------------------------------------------------------------------

// How far back to look. Stripe retries a failed webhook for ~3 days, so a
// window wider than that catches orders whose retries have been exhausted, and
// RECONCILE_LOOKBACK_HOURS lets a longer outage be swept manually.
const RECONCILE_LOOKBACK_HOURS = Number(process.env.RECONCILE_LOOKBACK_HOURS || 24 * 14)
// Cap per run so one sweep can't spend the whole hour hitting Stripe.
const RECONCILE_MAX_PER_RUN = Number(process.env.RECONCILE_MAX_PER_RUN || 25)

export async function reconcileUnrecordedPayments(): Promise<{ checked: number; healed: number }> {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    console.warn('[reconciler] STRIPE_SECRET_KEY not set — skipping payment reconciliation')
    return { checked: 0, healed: 0 }
  }

  // Candidates: we think they're unpaid, but they have a PaymentIntent, so the
  // customer at least reached Stripe. Cancelled/refunded orders are excluded —
  // a cancelled order whose intent shows succeeded is a refund question, not a
  // "mark it paid" one, and quietly flipping it to paid would be wrong.
  const { data: candidates, error } = await supabase
    .from('orders')
    .select('id, order_number, payment_intent_id, total, created_at, status, payment_status')
    .neq('payment_status', 'paid')
    .not('payment_intent_id', 'is', null)
    .not('status', 'in', '(cancelled,refunded)')
    .gt('created_at', hoursAgoIso(RECONCILE_LOOKBACK_HOURS))
    .order('created_at', { ascending: false })
    .limit(RECONCILE_MAX_PER_RUN)

  if (error) {
    console.error('[reconciler] Candidate query failed:', error.message)
    return { checked: 0, healed: 0 }
  }
  if (!candidates || candidates.length === 0) return { checked: 0, healed: 0 }

  const { default: Stripe } = await import('stripe')
  const stripe = new Stripe(stripeKey, { apiVersion: '2025-02-24.acacia' })
  const { applyPaidCheckoutOrder } = await import('./order-payment.js')

  let healed = 0
  const healedOrders: string[] = []

  for (const order of candidates) {
    try {
      const pi = await stripe.paymentIntents.retrieve(order.payment_intent_id!)
      // Anything other than 'succeeded' is a legitimately unpaid order: an
      // abandoned checkout sits at requires_payment_method forever and must be
      // left exactly as it is.
      if (pi.status !== 'succeeded') continue

      console.warn(
        `[reconciler] 🚨 ${order.order_number || order.id.slice(0, 8)} is SUCCEEDED in Stripe but ` +
        `payment_status=${order.payment_status} in the DB — webhook delivery missed it. Healing.`
      )
      const result = await applyPaidCheckoutOrder(pi, undefined, 'reconciler')
      if (result.claimed) {
        healed++
        healedOrders.push(order.order_number || order.id.slice(0, 8))
      }
    } catch (err: any) {
      // A single unreadable intent (deleted, wrong account, network blip) must
      // not stop the sweep from healing the rest.
      console.error(`[reconciler] Check failed for order ${order.id}:`, err?.message || err)
    }
  }

  if (healed > 0) {
    // The per-order team alert already fired inside applyPaidCheckoutOrder with
    // its "recovered by the reconciler" banner. This row is the separate,
    // louder signal that the DELIVERY PIPELINE is broken — the thing to fix so
    // the reconciler stops being needed.
    await supabase.from('admin_notifications').insert({
      type: 'health_alert',
      title: `⚠️ Stripe webhook missed ${healed} payment${healed === 1 ? '' : 's'}`,
      message:
        `Recovered ${healedOrders.join(', ')} by polling Stripe directly. The payment(s) were captured but ` +
        `never delivered to POST /api/stripe/webhook. Check the endpoint URL, status and signing secret in ` +
        `the Stripe Dashboard.`
    }).then(({ error: e }) => {
      if (e) console.error('[reconciler] Alert insert failed:', e.message)
    })
    await supabase.from('audit_logs').insert({
      action: 'payments_reconciled',
      metadata: { healed, orders: healedOrders, checked: candidates.length }
    })
  }

  console.log(`[reconciler] Checked ${candidates.length} unpaid order(s) against Stripe, healed ${healed}`)
  return { checked: candidates.length, healed }
}

// Entry point for the worker's hourly loop.
export async function monitorHealthAndOrders(): Promise<void> {
  try {
    await supabase.from('audit_logs').insert({ action: 'worker_heartbeat', metadata: { at: new Date().toISOString() } })
    // Reconcile FIRST: an order healed here should be counted as paid by the
    // stall check and the daily digest in the same run, not an hour later.
    try {
      await reconcileUnrecordedPayments()
    } catch (err: any) {
      console.error('[order-monitor] reconcileUnrecordedPayments threw:', err?.message || err)
    }
    await alertStalledOrders()
    await alertAiJobFailureSpike()
    await sendDailySummaryIfDue()
  } catch (err: any) {
    console.error('[order-monitor] monitorHealthAndOrders error:', err?.message || err)
  }
}

// Abandoned-checkout recovery: the worker-facing half.
//
// This is the DB + email layer that feeds backend/lib/abandoned-cart.ts (the
// dependency-free decision layer, unit-tested in lib/abandoned-cart.test.ts).
// Together they implement the two-nudge sequence:
//     first  — 4h after abandonment   second — 24h after abandonment
// and stop entirely past 7 days (see lib/abandoned-cart.ts for the reasoning).
//
// DETECTION
//
// No new capture path is needed. backend/routes/stripe.ts inserts an `orders`
// row at payment-intent creation with status='pending', payment_status=
// 'pending', customer_email and metadata.items (the cart snapshot). A row still
// sitting in that state hours later is a customer who reached checkout and did
// not pay. See supabase/migrations/20260728140100_abandoned_cart_reminders.sql.
//
// IDEMPOTENCY (the part that actually matters for a cron)
//
// The dedupe key is the PRIMARY KEY (order_id, stage) on
// abandoned_cart_reminders. The sender INSERTS the row BEFORE sending and
// treats a unique violation as "another tick already sent it" — never a
// check-then-send, which two overlapping cron ticks can both pass and then
// double-mail the customer. If the send itself then fails (transient Resend
// error), the row is deleted so a later sweep retries. A suppression is NOT
// retried: the address is on the suppression list and the row is left in place
// so we never reconsider a hard-bounced address on every hourly tick.

import { supabase } from '../lib/supabase.js'
import { decideReminderStage, type ReminderStage } from '../lib/abandoned-cart.js'
import { sendEmailWithTracking } from '../utils/email.js'

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://imaginethisprinted.com'

// The order statuses that still count as "abandoned" (unpaid, recoverable).
// Must stay in lockstep with lib/abandoned-cart.ts's constants — that module
// holds the authoritative delay math; this module only runs the query that
// feeds it.
const ABANDONABLE_STATUS = 'pending'
const ABANDONABLE_PAYMENT_STATUS = 'pending'

interface CandidateRow {
  id: string
  customer_email: string | null
  created_at: string
  order_number?: string | null
  total?: number | null
}

/** Row shape of a reminder already sent for a candidate order. */
interface SentReminderRow {
  order_id: string
  stage: string
}

export interface SweepStats {
  scanned: number
  sent: number
  skipped: number
  failures: number
}

function isUniqueViolation(err: unknown): boolean {
  // Postgres unique_violation is code 23505. PostgREST surfaces it in
  // err.code; a raw pg error carries it in err.code too.
  return (err as { code?: string } | null)?.code === '23505'
}

/**
 * Load every unpaid checkout still within the recovery window, together with
 * the stages already mailed. The window itself is enforced by the decision
 * layer (MAX_RECOVERY_AGE_MS); the query only pre-filters to orders created in
 * the last ~7 days so the decision layer isn't handed the entire orders table.
 */
async function loadCandidates(): Promise<CandidateRow[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('orders')
    .select('id, customer_email, created_at, order_number, total')
    .eq('status', ABANDONABLE_STATUS)
    .eq('payment_status', ABANDONABLE_PAYMENT_STATUS)
    .not('customer_email', 'is', null)
    .gt('created_at', sevenDaysAgo)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data || []) as CandidateRow[]
}

async function loadSentStages(orderIds: string[]): Promise<Map<string, Set<ReminderStage>>> {
  const map = new Map<string, Set<ReminderStage>>()
  if (orderIds.length === 0) return map

  const { data, error } = await supabase
    .from('abandoned_cart_reminders')
    .select('order_id, stage')
    .in('order_id', orderIds)

  if (error) throw error
  for (const row of (data || []) as SentReminderRow[]) {
    if (row.stage !== 'first' && row.stage !== 'second') continue
    const set = map.get(row.order_id) ?? new Set<ReminderStage>()
    set.add(row.stage)
    map.set(row.order_id, set)
  }
  return map
}

/** Insert the reminder row. Returns true when THIS caller won the dedupe race. */
async function claimReminder(orderId: string, stage: ReminderStage): Promise<boolean> {
  const { error } = await supabase
    .from('abandoned_cart_reminders')
    .insert({ order_id: orderId, stage })

  if (!error) return true
  if (isUniqueViolation(error)) return false // another tick already sent it
  console.error(`[abandoned-cart] claim insert failed for ${orderId}/${stage}:`, (error as Error).message)
  return false
}

async function releaseReminder(orderId: string, stage: ReminderStage): Promise<void> {
  const { error } = await supabase
    .from('abandoned_cart_reminders')
    .delete()
    .eq('order_id', orderId)
    .eq('stage', stage)
  if (error) {
    console.error(`[abandoned-cart] failed to release ${orderId}/${stage} after failed send:`, error.message)
  }
}

function buildReminderEmail(
  candidate: CandidateRow,
  stage: ReminderStage
): { subject: string; html: string; text: string } {
  const resumeUrl = `${FRONTEND_URL}/checkout?order=${candidate.id}`
  const total = typeof candidate.total === 'number' && candidate.total > 0
    ? `$${candidate.total.toFixed(2)}`
    : null

  const subject =
    stage === 'first'
      ? 'Your cart is waiting — did something hold you up?'
      : 'Still thinking it over? Your cart is about to head out.'

  // Minimal, honest marketing mail. No countdown timers, no fake urgency, no
  // "your items are selling out" — those are the exact dark patterns that get
  // a commercial domain burned. A plain line + one clear action.
  const body =
    stage === 'first'
      ? `We noticed you started checking out but didn't quite finish${total ? ` — your cart at ${total} is still saved` : ''}. ` +
        `No pressure: it's all still there, exactly how you left it.`
      : `Your cart is still saved from the other day. If you were on the fence, now's a good time — it's all there waiting for you.`

  const html = `
    <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1C1917;">
      <p style="font-size: 16px; line-height: 1.5;">${body}</p>
      <p style="margin: 24px 0;">
        <a href="${resumeUrl}"
           style="background: #9333EA; color: #ffffff; text-decoration: none;
                  padding: 12px 24px; border-radius: 8px; font-weight: bold;
                  display: inline-block;">Pick up where you left off</a>
      </p>
      <p style="font-size: 13px; color: #78716C;">
        Don't want these reminders? Reply and we'll stop them. If you've already
        completed your order, you can safely ignore this.
      </p>
    </div>`

  return {
    subject,
    html,
    text: `${body}\n\nResume your checkout: ${resumeUrl}\n\nDon't want these reminders? Reply and we'll stop them.`
  }
}

async function processOne(candidate: CandidateRow, sentStages: Set<ReminderStage>, stats: SweepStats): Promise<void> {
  const decision = decideReminderStage(
    {
      orderId: candidate.id,
      email: candidate.customer_email,
      createdAt: candidate.created_at,
      sentStages: [...sentStages]
    },
    new Date()
  )

  if (!decision.send) {
    stats.skipped += 1
    return
  }

  const stage = decision.stage

  // Idempotency guard BEFORE the send — see the module header. This is the
  // point that makes two overlapping hourly ticks (or two worker replicas)
  // safe: only one of them can insert the (order_id, stage) primary key.
  if (!(await claimReminder(candidate.id, stage))) {
    stats.skipped += 1
    return
  }

  const { subject, html, text } = buildReminderEmail(candidate, stage)
  const result = await sendEmailWithTracking({
    to: candidate.customer_email as string,
    subject,
    htmlContent: html,
    textContent: text
  })

  if (result.success && result.messageId) {
    await supabase
      .from('abandoned_cart_reminders')
      .update({ provider_email_id: result.messageId })
      .eq('order_id', candidate.id)
      .eq('stage', stage)
    stats.sent += 1
    console.log(`[abandoned-cart] ✅ sent ${stage} reminder to ${candidate.customer_email} (order ${candidate.id})`)
  } else if (result.suppressed) {
    // Address is on the suppression list — leave the row so we don't reconsider
    // it every sweep. Logged as a skip, not a failure.
    stats.skipped += 1
    console.warn(`[abandoned-cart] 🚫 suppressed ${candidate.customer_email} — reminder skipped`)
  } else {
    // Transient failure — release the claim so a later sweep retries.
    stats.failures += 1
    await releaseReminder(candidate.id, stage)
  }
}

/**
 * Run one full abandoned-cart sweep. Called from the worker's hourly cleanup
 * loop (see backend/worker/ai-jobs-worker.ts runCleanupSweeps). Idempotent and
 * safe to run from multiple replicas: the reminders table's primary key makes
 * double-sends impossible.
 */
export async function sweepAbandonedCarts(): Promise<SweepStats> {
  const stats: SweepStats = { scanned: 0, sent: 0, skipped: 0, failures: 0 }

  let candidates: CandidateRow[]
  try {
    candidates = await loadCandidates()
  } catch (err) {
    console.error('[abandoned-cart] candidate query failed:', (err as Error)?.message || err)
    return stats
  }

  if (candidates.length === 0) return stats
  stats.scanned = candidates.length

  let sentStages: Map<string, Set<ReminderStage>>
  try {
    sentStages = await loadSentStages(candidates.map((c) => c.id))
  } catch (err) {
    console.error('[abandoned-cart] sent-stage query failed:', (err as Error)?.message || err)
    return stats
  }

  for (const candidate of candidates) {
    try {
      await processOne(candidate, sentStages.get(candidate.id) ?? new Set(), stats)
    } catch (err) {
      // Never let one bad candidate take down the sweep (the worker's cleanup
      // loop already wraps the whole call, but a single row must not abort the
      // remaining candidates either).
      stats.failures += 1
      console.error(`[abandoned-cart] candidate ${candidate.id} failed:`, (err as Error)?.message || err)
    }
  }

  if (stats.sent > 0 || stats.failures > 0) {
    console.log(`[abandoned-cart] sweep done: ${stats.scanned} scanned, ${stats.sent} sent, ${stats.skipped} skipped, ${stats.failures} failed`)
  }
  return stats
}

// Abandoned-checkout recovery: the decision layer.
//
// Dependency-free (no Supabase, no env, no email) so the "who gets mailed, and
// when" rules are unit-testable without a database or a live send. The query
// that feeds it lives in backend/services/abandoned-cart.ts.
//
// WHAT COUNTS AS ABANDONED
//
// backend/routes/stripe.ts:399-434 writes an `orders` row at payment-intent
// creation with status='pending', payment_status='pending', a customer_email
// and metadata.items (the cart snapshot). A row still sitting in that state
// hours later is a customer who reached checkout and did not pay. No new
// capture path is needed — see 20260728140100_abandoned_cart_reminders.sql.
//
// THE SCHEDULE
//
// Two nudges, then silence:
//   first  — 4h after abandonment. Long enough that we are not mailing someone
//            who is still on the payment screen or whose 3DS challenge is in
//            flight; short enough that the intent is still warm.
//   second — 24h after abandonment, only if `first` was sent and they still
//            have not paid.
// A third mail is where abandoned-cart recovery turns into nagging, and every
// additional commercial send is more spam-complaint risk against the sending
// domain — which is shared with the transactional order mail that actually
// has to land. Two is the whole sequence.
//
// COMMERCIAL EMAIL RULES (not optional)
//
// These are marketing emails, not transactional ones. Every candidate must be
// checked against `email_suppressions` (hard bounces + complaints) and every
// send must carry an unsubscribe path. That filtering happens in the service
// layer, which has the DB; this module only decides timing and stage.

export type ReminderStage = 'first' | 'second'

export const FIRST_REMINDER_DELAY_MS = 4 * 60 * 60 * 1000
export const SECOND_REMINDER_DELAY_MS = 24 * 60 * 60 * 1000

// Do not chase a checkout that was abandoned a week ago — the cart contents,
// the coupon and the stock are all likely stale, and the recipient has
// forgotten the session entirely.
export const MAX_RECOVERY_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Order statuses that mean "still unpaid, still recoverable". */
export const ABANDONABLE_ORDER_STATUS = 'pending'
export const ABANDONABLE_PAYMENT_STATUS = 'pending'

export interface AbandonedCandidate {
  orderId: string
  email: string | null
  createdAt: string
  /** Stages already mailed for this order. */
  sentStages: readonly ReminderStage[]
}

export type StageDecision =
  | { send: true; stage: ReminderStage }
  | { send: false; reason: string }

/**
 * Decide whether a pending checkout is due for a reminder, and which one.
 *
 * `now` is injected rather than read from the clock so the schedule is
 * testable and so a batch run evaluates every candidate against one instant.
 */
export function decideReminderStage(candidate: AbandonedCandidate, now: Date): StageDecision {
  if (!candidate.email || candidate.email.trim().length === 0) {
    return { send: false, reason: 'no email captured at checkout' }
  }

  const createdAt = new Date(candidate.createdAt).getTime()
  if (!Number.isFinite(createdAt)) {
    return { send: false, reason: 'unreadable created_at' }
  }

  const age = now.getTime() - createdAt
  if (age < 0) {
    return { send: false, reason: 'created in the future — clock skew' }
  }
  if (age > MAX_RECOVERY_AGE_MS) {
    return { send: false, reason: 'abandoned too long ago to be worth recovering' }
  }

  const sent = new Set(candidate.sentStages)

  if (!sent.has('first')) {
    return age >= FIRST_REMINDER_DELAY_MS
      ? { send: true, stage: 'first' }
      : { send: false, reason: 'too soon for the first reminder' }
  }

  if (!sent.has('second')) {
    return age >= SECOND_REMINDER_DELAY_MS
      ? { send: true, stage: 'second' }
      : { send: false, reason: 'too soon for the second reminder' }
  }

  return { send: false, reason: 'both reminders already sent' }
}

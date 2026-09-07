// Is this row a real order, or a checkout somebody walked away from?
//
// WHY THIS MODULE EXISTS
//
// POST /api/stripe/checkout-payment-intent writes an `orders` row at
// payment-intent creation time — before any money moves — because the row id
// has to ride in the PaymentIntent metadata for the webhook and the hourly
// reconciler to find it later. That is deliberate and load bearing. It also
// means the `orders` table holds two completely different kinds of thing:
//
//   1. orders    — somebody paid; the crew has to make and ship this.
//   2. drafts    — somebody reached the payment screen and left. No money.
//
// On 2026-09-07 David reported two "orders" the shop was preparing to ship.
// Neither had ever been paid: both PaymentIntents were sitting at
// `requires_payment_method` in live Stripe. The rows looked identical to real
// orders on every admin surface because NOTHING on the fulfilment side filtered
// on payment_status — GET /api/orders returned every row, OrderManagement put
// them in the "Pending" tab with Buy Label wired up, and AdminDashboard summed
// their totals into reported revenue.
//
// The rest of the codebase already agrees that an unpaid row is not an order:
//   - lib/order-status.ts       — 'pending' is documented "nothing has been
//                                 paid for yet" and cannot jump to 'completed'
//   - services/order-refunds.ts — EVER_PAID_STATUSES deliberately excludes it
//   - lib/abandoned-cart.ts     — pending/pending IS the abandonment signal
//
// So the fix is not a new status value or a migration. It is to make that
// existing contract enforceable from ONE place, so a future admin surface
// cannot quietly forget it the way these three did.
//
// THE RULE: `payment_status` decides. Not `status`.
//
// status is the fulfilment lifecycle (pending -> processing -> shipped -> ...)
// and an admin can drag it around. payment_status is set by Stripe money
// events and by nothing else, which is exactly the property a "did we actually
// get paid" test needs.

/**
 * payment_status values that mean money genuinely changed hands at some point.
 *
 * 'refunded' and 'partially_refunded' stay in: the order was real, it was
 * made, it may well have shipped. It belongs in order history and in the
 * customer's record — it is simply not owed fulfilment any more, which is what
 * `status` says. Dropping refunds from "real orders" would silently rewrite
 * revenue history every time support issued a refund.
 */
export const PAID_PAYMENT_STATUSES = ['paid', 'refunded', 'partially_refunded'] as const

/**
 * The one payment_status a never-paid checkout draft carries. Written by
 * routes/stripe.ts, routes/kiosk.ts and routes/storefront.ts at intent/order
 * creation, and only ever moved off it by a Stripe money event.
 */
export const UNPAID_PAYMENT_STATUS = 'pending'

/** The subset of a row this module needs. Deliberately narrow so callers can pass anything order-shaped. */
export interface PaymentStateLike {
  payment_status?: string | null
  status?: string | null
}

function normalize(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * True when money actually reached us for this order.
 *
 * A NULL/absent payment_status counts as NOT paid. That is the safe direction:
 * the failure mode of a false negative is an order missing from a list someone
 * is watching, and the failure mode of a false positive is the shop printing
 * and shipping goods nobody paid for — which is the bug this module exists to
 * stop.
 */
export function isPaidOrder(order: PaymentStateLike | null | undefined): boolean {
  if (!order) return false
  return (PAID_PAYMENT_STATUSES as readonly string[]).includes(normalize(order.payment_status))
}

/**
 * True when this row is a checkout somebody started and never paid for — the
 * thing that must never appear on a fulfilment screen or in a revenue figure.
 *
 * Note this is NOT simply `!isPaidOrder`. A row can be unpaid for reasons that
 * are not abandonment: 'failed' after a declined card, or 'cancelled'. Those
 * are their own situations and are not chased with "did you forget something?"
 * mail. Only `pending` — we asked Stripe for money and heard nothing back —
 * means abandoned.
 */
export function isAbandonedCheckout(order: PaymentStateLike | null | undefined): boolean {
  if (!order) return false
  if (isPaidOrder(order)) return false
  if (normalize(order.payment_status) !== UNPAID_PAYMENT_STATUS) return false
  // An admin who cancelled a draft has made a decision about it; leave it out
  // of both the fulfilment list and the recovery mail.
  const status = normalize(order.status)
  return status !== 'cancelled' && status !== 'refunded'
}

/**
 * Split a mixed list the way every admin surface actually needs it.
 * One pass, so a caller can't apply the two rules inconsistently.
 */
export function partitionOrders<T extends PaymentStateLike>(rows: readonly T[]): {
  paid: T[]
  abandoned: T[]
  other: T[]
} {
  const paid: T[] = []
  const abandoned: T[] = []
  const other: T[] = []
  for (const row of rows) {
    if (isPaidOrder(row)) paid.push(row)
    else if (isAbandonedCheckout(row)) abandoned.push(row)
    else other.push(row)
  }
  return { paid, abandoned, other }
}

/**
 * Sum of order totals that represent money we actually took.
 *
 * AdminDashboard used to sum `total` across every row, so the two abandoned
 * checkouts David flagged were reporting $55.60 of revenue that never existed
 * — 62% of the shop's headline number.
 */
export function paidRevenueTotal(rows: readonly (PaymentStateLike & { total?: number | string | null })[]): number {
  return rows.reduce((sum, row) => (isPaidOrder(row) ? sum + (Number(row.total) || 0) : sum), 0)
}

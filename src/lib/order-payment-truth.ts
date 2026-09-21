// "Was money ever actually taken?" — the one question the admin order board and
// the customer's own order list both have to ask about a row in `orders`.
//
// An `orders` row is written when the Stripe payment intent is CREATED
// (backend/routes/stripe.ts), not when it succeeds. A customer who reaches the
// payment screen and walks away therefore leaves a complete-looking order
// behind: real name, real items, real total, status 'pending'. Two live bugs
// came from reading those rows as orders:
//   - the admin Pending queue listed an abandoned checkout next to a Refund
//     button (the refund route 409s on it — nothing was ever captured), and
//   - `payment_status !== 'paid'` on the customer's My Orders page filed a
//     REFUNDED order under "Drafts — awaiting payment" with a Pay Now button.
//
// Mirrors EVER_PAID_STATUSES in backend/services/order-refunds.ts: a refund or
// a dispute both mean the money did land at some point, so those rows are real
// orders with a payment history — not drafts.

export const EVER_PAID_PAYMENT_STATUSES = [
  'paid',
  'refunded',
  'partially_refunded',
  'disputed'
] as const

/** True when this order captured money at some point in its life. */
export function wasEverPaid(paymentStatus: string | null | undefined): boolean {
  const normalised = String(paymentStatus ?? '').trim().toLowerCase()
  return (EVER_PAID_PAYMENT_STATUSES as readonly string[]).includes(normalised)
}

/**
 * True for an abandoned checkout: an order row that never took a payment.
 * Never produce, count, ship or refund one.
 */
export function isUnpaidDraft(paymentStatus: string | null | undefined): boolean {
  return !wasEverPaid(paymentStatus)
}

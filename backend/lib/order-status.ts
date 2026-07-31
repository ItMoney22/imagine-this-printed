// Order status state machine — the single source of truth for which order
// status changes an admin mutation is allowed to make.
//
// Before this existed, every admin path wrote `orders.status` unconditionally:
// OrderManagement.tsx wrote it straight from the browser, POST
// /api/orders/:orderId/complete forced 'completed' regardless of where the
// order was, and PATCH /api/stripe/orders/:orderId/status accepted any value
// off a flat allow-list. That let an order jump pending -> completed (awarding
// rewards for an unpaid order) and let a cancelled/refunded order be dragged
// back out of its terminal state.
//
// The status column is plain TEXT with no CHECK constraint (see
// supabase/migrations/001_initial_schema.sql:207), so this table is the only
// thing enforcing a legal order lifecycle.
//
// NOTE: payment webhooks deliberately do NOT go through this module. They are
// driven by Stripe, already idempotent via claimOnce(), and must be able to
// set 'paid'/'refunded' from wherever the order happens to be.

export const ORDER_STATUSES = [
  'pending',
  'paid',
  'processing',
  'printed',
  'shipped',
  'delivered',
  'completed',
  'on_hold',
  'cancelled',
  'refunded'
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

// Which statuses each status may move to. Empty array = terminal.
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  // Nothing has been paid for yet, so an order cannot be completed from here —
  // that is the jump that was silently awarding rewards on unpaid orders.
  pending: ['paid', 'processing', 'on_hold', 'cancelled'],
  paid: ['processing', 'printed', 'shipped', 'completed', 'on_hold', 'cancelled', 'refunded'],
  processing: ['printed', 'shipped', 'completed', 'on_hold', 'cancelled'],
  printed: ['shipped', 'completed', 'on_hold', 'cancelled'],
  shipped: ['delivered', 'completed', 'on_hold', 'refunded'],
  delivered: ['completed', 'refunded'],
  completed: ['refunded'],
  // A hold is resolved by putting the order back into the fulfilment flow, or
  // by killing it. It cannot skip straight to shipped/completed.
  on_hold: ['pending', 'processing', 'printed', 'cancelled'],
  cancelled: [],
  refunded: []
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value)
}

export type TransitionResult =
  // `noop` means from === to: the caller should persist nothing and, crucially,
  // fire no side effects (no duplicate shipped email, no second referral bonus).
  | { ok: true; kind: 'noop' | 'move'; unknownFrom: boolean }
  | { ok: false; reason: string }

/**
 * Decide whether an order may move from `from` to `to`.
 *
 * `from` is whatever the database currently holds, which may be null (legacy
 * rows) or a value this module does not know. An unrecognised current status
 * is allowed to move anywhere valid — there is no lifecycle to protect for a
 * state we cannot place — but it is reported via `unknownFrom` so the route can
 * log it. An unrecognised *target* is always rejected.
 */
export function checkOrderTransition(from: string | null | undefined, to: string): TransitionResult {
  if (!isOrderStatus(to)) {
    return { ok: false, reason: `Unknown order status "${to}". Valid statuses: ${ORDER_STATUSES.join(', ')}` }
  }

  if (!isOrderStatus(from)) {
    return { ok: true, kind: 'move', unknownFrom: true }
  }

  if (from === to) {
    return { ok: true, kind: 'noop', unknownFrom: false }
  }

  const allowed = ORDER_STATUS_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    const detail = allowed.length === 0
      ? `"${from}" is a terminal status and cannot be changed`
      : `allowed from "${from}": ${allowed.join(', ')}`
    return { ok: false, reason: `Cannot change order status from "${from}" to "${to}" — ${detail}` }
  }

  return { ok: true, kind: 'move', unknownFrom: false }
}

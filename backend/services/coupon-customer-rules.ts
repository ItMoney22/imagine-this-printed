// ---------------------------------------------------------------------------
// Per-CUSTOMER coupon rules — "one use per customer" and "first order only".
//
// Until now per_user_limit was only ever checked against coupon_usage.user_id,
// which is NULL for every guest checkout (verified live 2026-10-07: the one
// real redemption on record, TRINIDAD, has user_id null). Etsy buyers who
// scan the bag insert (Watchtower task 8cde2a1d) will mostly check out as
// guests, so a guest could reuse a "one per customer" code forever.
//
// A customer here is a signed-in account OR a checkout email. Both rules read
// the `orders` table directly (not coupon_usage), because that is the one
// place a guest's email and the codes they used live side by side. Only orders
// that actually took money count: an abandoned checkout leaves an unpaid draft
// row behind (see src/lib/order-payment-truth.ts), and that must never burn a
// customer's first-order coupon.
//
// Known limit: a guest can type a different email. Nothing short of an
// account can stop that; this closes the easy hole, not the determined one.
// ---------------------------------------------------------------------------

/** Mirrors EVER_PAID_PAYMENT_STATUSES (src/lib/order-payment-truth.ts) and
 *  EVER_PAID_STATUSES (backend/services/order-refunds.ts). */
export const EVER_PAID_PAYMENT_STATUSES = ['paid', 'refunded', 'partially_refunded', 'disputed'] as const

export const FIRST_ORDER_ONLY_ERROR = 'This code is for a first order on our site. Thanks for coming back!'
export const ALREADY_USED_ERROR = 'You have already used this coupon'

export interface CustomerCouponRow {
  id: string
  code: string
  per_user_limit: number | null
  metadata?: Record<string, unknown> | null
}

export interface CustomerRef {
  /** Signed-in account id. Callers on a money path must pass a TRUSTED id
   *  (the JWT subject), never a body-supplied one. */
  userId?: string | null
  /** Checkout email, as typed. Normalised here. */
  email?: string | null
}

/** Paid-order lookups — injected so tests never touch Supabase. */
export interface CustomerOrderLookups {
  /** Ever-paid orders placed by this customer (any code, or none). */
  countPaidOrders: (customer: { userId: string | null; email: string | null }) => Promise<number>
  /** Ever-paid orders placed by this customer that carried `code`. */
  countPaidOrdersWithCode: (customer: { userId: string | null; email: string | null }, code: string) => Promise<number>
}

/** Set `metadata.first_order_only = true` on a discount_codes row to make it
 *  refuse anyone who has already paid for an order on the site. */
export function isFirstOrderOnly(coupon: Pick<CustomerCouponRow, 'metadata'> | null | undefined): boolean {
  return coupon?.metadata?.first_order_only === true
}

export function normaliseEmail(email: string | null | undefined): string | null {
  const trimmed = String(email ?? '').trim().toLowerCase()
  // Not a full validator — just enough to never query on junk.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null
}

/**
 * Apply the per-customer rules for one coupon. `usageCountForUser` is the
 * existing coupon_usage count for a signed-in account (0 for a guest); the
 * email lookups add what that count can't see.
 */
export async function checkCustomerCouponRules(
  coupon: CustomerCouponRow,
  customer: CustomerRef,
  lookups: CustomerOrderLookups,
  usageCountForUser = 0
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ref = { userId: customer.userId || null, email: normaliseEmail(customer.email) }
  const known = ref.userId != null || ref.email != null

  try {
    if (known && isFirstOrderOnly(coupon)) {
      const prior = await lookups.countPaidOrders(ref)
      if (prior > 0) return { ok: false, error: FIRST_ORDER_ONLY_ERROR }
    }

    if (coupon.per_user_limit != null) {
      let used = usageCountForUser
      if (known) used = Math.max(used, await lookups.countPaidOrdersWithCode(ref, coupon.code))
      if (used >= coupon.per_user_limit) return { ok: false, error: ALREADY_USED_ERROR }
    }
  } catch (err) {
    // Refuse the CODE, never the checkout: a failed lookup must not hand a
    // repeat customer a first-order discount, and must not block the sale.
    console.error('[coupons] customer rule lookup failed:', (err as Error)?.message)
    return { ok: false, error: "We couldn't check this code right now. Please try again in a minute." }
  }

  return { ok: true }
}

// Escape LIKE wildcards so an email is matched literally (case-insensitively).
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, ch => `\\${ch}`)
}

type OrdersDb = { from: (table: string) => any }

/** Default lookups against the real `orders` table (service-role client). */
export function supabaseCustomerOrderLookups(db: OrdersDb): CustomerOrderLookups {
  // An account and an email are two ways to recognise the same customer; a
  // match on either counts. Max, not sum: a signed-in order usually matches
  // both. Two plain queries rather than one PostgREST or() string, so an
  // email with a comma or bracket can't break the filter.
  async function count(customer: { userId: string | null; email: string | null }, code?: string): Promise<number> {
    let total = 0
    const run = async (column: 'user_id' | 'customer_email', value: string) => {
      let query = db
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .in('payment_status', EVER_PAID_PAYMENT_STATUSES as unknown as string[])
      query = column === 'user_id' ? query.eq('user_id', value) : query.ilike('customer_email', likeLiteral(value))
      if (code) query = query.contains('discount_codes', [code])
      const { count: n, error } = await query
      if (error) throw new Error(`Failed to check prior orders: ${error.message}`)
      return n ?? 0
    }
    if (customer.userId) total = Math.max(total, await run('user_id', customer.userId))
    if (customer.email) total = Math.max(total, await run('customer_email', customer.email))
    return total
  }

  return {
    countPaidOrders: customer => count(customer),
    countPaidOrdersWithCode: (customer, code) => count(customer, code.toUpperCase())
  }
}

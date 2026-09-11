// ============================================================================
// The thank-you coupon a delivered order earns its buyer.
//
// David: "it should auto change when delivered with a nice email to the cust
// maybe giving them a 10% coupon on next order."
//
// One single-use percentage code per delivered order, minted into the existing
// `discount_codes` table (so checkout validates and redeems it through exactly
// the same path as every hand-made coupon — nothing new to trust). The code is
// written back onto the order, which is what makes this idempotent: the
// background delivery sweep and an admin clicking "Delivered" can both run
// against the same order and the customer still ends up with one code.
//
// Everything here fails soft and returns null. A coupon is a bonus; it must
// never be the reason a buyer doesn't get their delivery email.
// ============================================================================

const DEFAULT_PERCENT = 10
const DEFAULT_DAYS = 60

// No I/O/0/1 — these codes get read off a phone screen and typed by hand.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_PREFIX = 'THANKS'
const MAX_ATTEMPTS = 3

export interface DeliveryCoupon {
  code: string
  percent: number
  /** ISO expiry, or null when reusing a code minted by an earlier run. */
  expiresAt: string | null
  /** True when this code already existed on the order. */
  reused: boolean
}

export interface CouponOrder {
  id: string
  order_number?: string | null
  customer_email?: string | null
  delivery_coupon_code?: string | null
}

export interface DeliveryCouponDeps {
  /** Insert into discount_codes. `duplicate` means the code was taken. */
  insertCoupon: (row: Record<string, any>) => Promise<{ ok: boolean; duplicate?: boolean; error?: string }>
  /** Stamp the code onto orders.delivery_coupon_code. Returns false if it didn't stick. */
  saveCodeOnOrder: (orderId: string, code: string) => Promise<boolean>
  randomSuffix: () => string
  now: () => Date
}

export interface DeliveryCouponConfig {
  enabled?: boolean
  percent?: number
  days?: number
}

export function randomCouponSuffix(length = 6): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return out
}

const envNumber = (name: string, fallback: number): number => {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

/** Config as the running service sees it (env-tunable, on by default). */
export function deliveryCouponConfig(): Required<DeliveryCouponConfig> {
  return {
    enabled: process.env.DELIVERY_COUPON_ENABLED !== 'false',
    percent: envNumber('DELIVERY_COUPON_PERCENT', DEFAULT_PERCENT),
    days: envNumber('DELIVERY_COUPON_DAYS', DEFAULT_DAYS),
  }
}

/**
 * Mint (or re-hand) the thank-you coupon for a delivered order.
 * Returns null when the perk is off, or when the coupon couldn't be created —
 * callers send the delivery email either way.
 */
export async function issueDeliveryCoupon(
  order: CouponOrder,
  deps: DeliveryCouponDeps,
  config: DeliveryCouponConfig = {}
): Promise<DeliveryCoupon | null> {
  const { enabled, percent, days } = { ...deliveryCouponConfig(), ...config }

  if (!enabled) return null

  const existing = (order.delivery_coupon_code || '').trim()
  if (existing) {
    return { code: existing, percent, expiresAt: null, reused: true }
  }

  const issuedAt = deps.now()
  const expiresAt = new Date(issuedAt.getTime() + days * 24 * 60 * 60 * 1000).toISOString()

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = `${CODE_PREFIX}${percent}-${deps.randomSuffix()}`.toUpperCase()

    const result = await deps.insertCoupon({
      code,
      type: 'percentage',
      value: percent,
      description: `Thank-you ${percent}% off — delivered order ${order.order_number || order.id}`,
      max_uses: 1,
      current_uses: 0,
      per_user_limit: 1,
      min_order_amount: 0,
      applies_to: 'usd',
      is_active: true,
      expires_at: expiresAt,
      metadata: {
        source: 'order_delivered',
        order_id: order.id,
        order_number: order.order_number || null,
        customer_email: order.customer_email || null,
        issued_at: issuedAt.toISOString(),
      },
    })

    if (result.ok) {
      // Best effort: if this write is lost the customer still has their code,
      // and the worst case is a later sweep minting a spare.
      await deps.saveCodeOnOrder(order.id, code).catch(() => false)
      return { code, percent, expiresAt, reused: false }
    }

    if (!result.duplicate) {
      console.error(`[delivery-coupon] Could not create ${code} for order ${order.id}: ${result.error || 'unknown error'}`)
      return null
    }
  }

  console.error(`[delivery-coupon] Gave up after ${MAX_ATTEMPTS} code collisions for order ${order.id}`)
  return null
}

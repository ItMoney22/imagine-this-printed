import { describe, it, expect } from 'vitest'

// backend/lib/supabase.ts (transitively reachable) creates its client eagerly
// at module load, so these must exist before coupons.ts is evaluated. Every
// case below injects a fake `db` — never touches a real Supabase client — so
// dummy values are fine. Dynamic import after setting the env vars (rather
// than a static import, which ESM hoists ahead of any code in this file) is
// what makes the ordering work — same pattern as
// backend/services/order-pricing.test.ts and
// backend/worker/ai-jobs-worker.claim.test.ts.
process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { validateCouponForOrder, recordCouponUsage } = await import('./coupons.js')

/**
 * Fake discount_codes + coupon_usage tables with real mutable row state, so
 * validateCouponForOrder re-reading current_uses after recordCouponUsage
 * increments it actually exercises the max_uses guard end-to-end — exactly
 * like two requests hitting real Postgres would.
 */
function makeFakeCouponDb(initialCoupon: Record<string, any>) {
  const coupon: Record<string, any> = { ...initialCoupon }
  const usageRows: Array<Record<string, any>> = []

  return {
    from(table: string) {
      if (table === 'discount_codes') {
        const filters: Array<[string, any]> = []
        const builder: any = {
          select() {
            return builder
          },
          eq(col: string, val: any) {
            filters.push([col, val])
            return builder
          },
          single: async () => {
            const match = filters.every(([col, val]) => coupon[col] === val)
            return { data: match ? { ...coupon } : null, error: match ? null : { message: 'not found' } }
          },
          update(patch: Record<string, any>) {
            return {
              eq: async (col: string, val: any) => {
                if (coupon[col] === val) Object.assign(coupon, patch)
                return { error: null }
              }
            }
          }
        }
        return builder
      }
      if (table === 'coupon_usage') {
        const filters: Array<[string, any]> = []
        const builder: any = {
          select(_cols?: string, _opts?: any) {
            return builder
          },
          eq(col: string, val: any) {
            filters.push([col, val])
            return builder
          },
          insert: async (row: Record<string, any>) => {
            usageRows.push(row)
            return { error: null }
          },
          // Makes `await db.from('coupon_usage').select(...).eq(...).eq(...)`
          // (no `.single()`) resolve like the real count-style Supabase call.
          then: (resolve: (v: { count: number; error: null }) => void) => {
            const count = usageRows.filter(row => filters.every(([col, val]) => row[col] === val)).length
            resolve({ count, error: null })
          }
        }
        return builder
      }
      throw new Error(`fake db: unexpected table "${table}"`)
    },
    // increment_coupon_usage RPC deliberately "not installed" so
    // recordCouponUsage exercises its fetch-then-update fallback path.
    rpc: async () => ({ error: { message: 'function increment_coupon_usage() does not exist', code: 'PGRST202' } }),
    _coupon: () => coupon
  }
}

describe('coupon single-use enforcement (Watchtower task 402932ab)', () => {
  it('a coupon with max_uses=1 validates once, then refuses a second redemption after usage is recorded', async () => {
    const db = makeFakeCouponDb({
      id: 'coupon-1',
      code: 'ONETIME',
      is_active: true,
      type: 'fixed',
      value: 10,
      max_uses: 1,
      current_uses: 0,
      min_order_amount: null,
      max_discount_amount: null,
      per_user_limit: null,
      expires_at: null
    })

    const first = await validateCouponForOrder({ code: 'onetime', orderTotal: 50 }, db as any)
    expect(first.valid).toBe(true)
    expect(first.discountAmount).toBe(10)
    expect(first.coupon?.id).toBe('coupon-1')

    const recordResult = await recordCouponUsage(
      { couponId: 'coupon-1', orderId: 'order-1', discountApplied: 10 },
      db as any
    )
    expect(recordResult.success).toBe(true)
    expect(db._coupon().current_uses).toBe(1)

    // Same coupon, same fake DB — the redemption above must be visible here.
    const second = await validateCouponForOrder({ code: 'ONETIME', orderTotal: 50 }, db as any)
    expect(second.valid).toBe(false)
    expect(second.error).toBe('Coupon usage limit reached')
  })

  it('rejects an expired coupon', async () => {
    const db = makeFakeCouponDb({
      id: 'coupon-2',
      code: 'EXPIRED',
      is_active: true,
      type: 'fixed',
      value: 5,
      max_uses: null,
      current_uses: 0,
      min_order_amount: null,
      max_discount_amount: null,
      per_user_limit: null,
      expires_at: '2020-01-01T00:00:00Z'
    })
    const result = await validateCouponForOrder({ code: 'EXPIRED', orderTotal: 20 }, db as any)
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Coupon has expired')
  })

  it('rejects when the cart total has dropped below min_order_amount (revalidation-on-cart-change guard)', async () => {
    const db = makeFakeCouponDb({
      id: 'coupon-3',
      code: 'BIGCART',
      is_active: true,
      type: 'percentage',
      value: 20,
      max_uses: null,
      current_uses: 0,
      min_order_amount: 100,
      max_discount_amount: null,
      per_user_limit: null,
      expires_at: null
    })

    const onLargeCart = await validateCouponForOrder({ code: 'BIGCART', orderTotal: 200 }, db as any)
    expect(onLargeCart.valid).toBe(true)
    expect(onLargeCart.discountAmount).toBe(40) // 20% of 200

    // Customer removed items — same coupon code, much smaller cart.
    const afterItemsRemoved = await validateCouponForOrder({ code: 'BIGCART', orderTotal: 30 }, db as any)
    expect(afterItemsRemoved.valid).toBe(false)
    expect(afterItemsRemoved.error).toMatch(/Minimum order amount/)
  })
})

import { describe, it, expect } from 'vitest'
import {
  ALREADY_USED_ERROR,
  FIRST_ORDER_ONLY_ERROR,
  checkCustomerCouponRules,
  isFirstOrderOnly,
  normaliseEmail,
  supabaseCustomerOrderLookups,
  type CustomerOrderLookups
} from './coupon-customer-rules.js'

// ETSYBAG as it sits in discount_codes (Watchtower task 8cde2a1d).
const ETSYBAG = { id: 'c-etsy', code: 'ETSYBAG', per_user_limit: 1, metadata: { first_order_only: true } }

/** In-memory paid orders, keyed the way the real lookups match them. */
function fakeLookups(orders: Array<{ user_id?: string | null; email?: string | null; codes?: string[] }>) {
  const calls: string[] = []
  const matches = (o: (typeof orders)[number], c: { userId: string | null; email: string | null }) =>
    (c.userId != null && o.user_id === c.userId) || (c.email != null && (o.email || '').toLowerCase() === c.email)
  const lookups: CustomerOrderLookups = {
    countPaidOrders: async c => {
      calls.push('paid')
      return orders.filter(o => matches(o, c)).length
    },
    countPaidOrdersWithCode: async (c, code) => {
      calls.push(`code:${code}`)
      return orders.filter(o => matches(o, c) && (o.codes || []).includes(code)).length
    }
  }
  return { lookups, calls }
}

describe('checkCustomerCouponRules — Etsy bag coupon', () => {
  it('lets a brand-new guest use ETSYBAG on a first order', async () => {
    const { lookups } = fakeLookups([])
    expect(await checkCustomerCouponRules(ETSYBAG, { email: 'new@buyer.com' }, lookups)).toEqual({ ok: true })
  })

  it('refuses a second ETSYBAG redemption by the same guest email, whatever its case', async () => {
    const { lookups } = fakeLookups([{ email: 'buyer@etsy.example', codes: ['ETSYBAG'] }])
    const second = await checkCustomerCouponRules(ETSYBAG, { email: '  Buyer@Etsy.Example ' }, lookups)
    expect(second).toEqual({ ok: false, error: FIRST_ORDER_ONLY_ERROR })
  })

  it('refuses a guest who already bought on the site without the code (first order only)', async () => {
    const { lookups } = fakeLookups([{ email: 'repeat@buyer.com', codes: [] }])
    expect(await checkCustomerCouponRules(ETSYBAG, { email: 'repeat@buyer.com' }, lookups)).toEqual({
      ok: false,
      error: FIRST_ORDER_ONLY_ERROR
    })
  })

  it('recognises a signed-in customer by account even under a new email', async () => {
    const { lookups } = fakeLookups([{ user_id: 'u-1', email: 'old@buyer.com' }])
    const result = await checkCustomerCouponRules(ETSYBAG, { userId: 'u-1', email: 'new@buyer.com' }, lookups)
    expect(result).toEqual({ ok: false, error: FIRST_ORDER_ONLY_ERROR })
  })

  it('does not decide anything before it knows who the customer is', async () => {
    const { lookups, calls } = fakeLookups([{ email: 'x@y.com' }])
    expect(await checkCustomerCouponRules(ETSYBAG, { email: '' }, lookups)).toEqual({ ok: true })
    expect(calls).toEqual([])
  })

  it('refuses the code (not the checkout) when the lookup fails', async () => {
    const lookups: CustomerOrderLookups = {
      countPaidOrders: async () => {
        throw new Error('db down')
      },
      countPaidOrdersWithCode: async () => 0
    }
    const result = await checkCustomerCouponRules(ETSYBAG, { email: 'a@b.com' }, lookups)
    expect(result.ok).toBe(false)
  })
})

describe('checkCustomerCouponRules — one use per customer on ordinary coupons', () => {
  const ONCE = { id: 'c-1', code: 'TRINIDAD', per_user_limit: 1, metadata: {} }

  it('now catches a GUEST reusing a per_user_limit=1 code by email (used to slip through)', async () => {
    const { lookups } = fakeLookups([{ email: 'guest@x.com', codes: ['TRINIDAD'] }])
    expect(await checkCustomerCouponRules(ONCE, { email: 'guest@x.com' }, lookups)).toEqual({
      ok: false,
      error: ALREADY_USED_ERROR
    })
  })

  it('still lets a repeat customer use a code that is NOT first-order-only', async () => {
    const { lookups } = fakeLookups([{ email: 'guest@x.com', codes: [] }])
    expect(await checkCustomerCouponRules(ONCE, { email: 'guest@x.com' }, lookups)).toEqual({ ok: true })
  })

  it('keeps honouring the coupon_usage count for signed-in accounts', async () => {
    const { lookups } = fakeLookups([])
    expect(await checkCustomerCouponRules(ONCE, { userId: 'u-9' }, lookups, 1)).toEqual({
      ok: false,
      error: ALREADY_USED_ERROR
    })
  })

  it('skips the per-customer check for an unlimited coupon', async () => {
    const { lookups, calls } = fakeLookups([{ email: 'g@x.com', codes: ['OPEN'] }])
    const open = { id: 'c-2', code: 'OPEN', per_user_limit: null, metadata: null }
    expect(await checkCustomerCouponRules(open, { email: 'g@x.com' }, lookups)).toEqual({ ok: true })
    expect(calls).toEqual([])
  })
})

describe('helpers', () => {
  it('isFirstOrderOnly reads metadata.first_order_only === true only', () => {
    expect(isFirstOrderOnly(ETSYBAG)).toBe(true)
    expect(isFirstOrderOnly({ metadata: { first_order_only: 'yes' } })).toBe(false)
    expect(isFirstOrderOnly({ metadata: null })).toBe(false)
    expect(isFirstOrderOnly(null)).toBe(false)
  })

  it('normaliseEmail trims, lowercases and drops junk', () => {
    expect(normaliseEmail('  A@B.Co ')).toBe('a@b.co')
    expect(normaliseEmail('not-an-email')).toBeNull()
    expect(normaliseEmail(undefined)).toBeNull()
  })
})

describe('supabaseCustomerOrderLookups — query shape', () => {
  function recordingDb(countFor: (filters: string[]) => number) {
    const queries: string[][] = []
    const db = {
      from(table: string) {
        const filters: string[] = [`from:${table}`]
        queries.push(filters)
        const builder: any = {
          select: (_c: string, opts: any) => (filters.push(`select:${opts?.head ? 'head' : 'rows'}`), builder),
          in: (col: string, vals: string[]) => (filters.push(`in:${col}=${vals.join('|')}`), builder),
          eq: (col: string, val: string) => (filters.push(`eq:${col}=${val}`), builder),
          ilike: (col: string, val: string) => (filters.push(`ilike:${col}=${val}`), builder),
          contains: (col: string, val: string[]) => (filters.push(`contains:${col}=${val.join(',')}`), builder),
          then: (resolve: (v: { count: number; error: null }) => void) => resolve({ count: countFor(filters), error: null })
        }
        return builder
      }
    }
    return { db, queries }
  }

  it('counts only ever-paid orders, matches email literally, and filters on the code', async () => {
    const { db, queries } = recordingDb(() => 1)
    const n = await supabaseCustomerOrderLookups(db).countPaidOrdersWithCode({ userId: null, email: 'a_b%c@x.com' }, 'etsybag')
    expect(n).toBe(1)
    expect(queries).toHaveLength(1)
    expect(queries[0]).toEqual([
      'from:orders',
      'select:head',
      'in:payment_status=paid|refunded|partially_refunded|disputed',
      'ilike:customer_email=a\\_b\\%c@x.com',
      'contains:discount_codes=ETSYBAG'
    ])
  })

  it('checks the account and the email separately and takes the larger count', async () => {
    const { db, queries } = recordingDb(f => (f.some(x => x.startsWith('eq:user_id')) ? 2 : 1))
    const n = await supabaseCustomerOrderLookups(db).countPaidOrders({ userId: 'u-1', email: 'a@b.com' })
    expect(n).toBe(2)
    expect(queries.map(q => q[3])).toEqual(['eq:user_id=u-1', 'ilike:customer_email=a@b.com'])
    expect(queries.every(q => !q.some(x => x.startsWith('contains:')))).toBe(true)
  })
})

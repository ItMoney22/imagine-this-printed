import { describe, it, expect, beforeEach } from 'vitest'

// Crystal's referral cut (task 1a699ba8). What must hold:
//   * her link's code stamps the order at checkout; a paused store or her own purchase doesn't;
//   * once the order is paid, her cut (percent of products after discounts) is a Stripe transfer
//     to HER account, tied to the order's charge, idempotent on the order;
//   * no percent from David, or payouts not ready: the cut waits on the order and a settle pays it;
//   * a refund reverses a paid cut and cancels a waiting one.

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
const {
  normalizeStoreReferralCode,
  referralBaseCents,
  storeReferralCutCents,
  storeReferralCodeFromSlug,
  resolveStoreReferral,
  isStoreReferralCode,
  ensureStoreReferralCode,
  payStoreReferralCut,
  settleWaitingStoreReferrals,
  storeReferralOrders,
  reverseStoreReferralCut
} = await import('./store-referral.js')

// ---- an in-memory Supabase: enough of the query builder for this module ----
let tables: Record<string, any[]> = {}
const get = (row: any, col: string) =>
  col.split(/->>?/).reduce((v, k) => (v == null ? undefined : v[k]), row)
function from(table: string) {
  let op: 'select' | 'update' = 'select'
  let payload: any
  const filters: Array<(r: any) => boolean> = []
  const rows = () => (tables[table] ??= []).filter(r => filters.every(f => f(r)))
  const run = (one: boolean) => {
    if (op === 'update') {
      for (const r of rows()) Object.assign(r, structuredClone(payload))
      return { data: null, error: null }
    }
    const out = structuredClone(rows())
    return one ? { data: out[0] ?? null, error: null } : { data: out, error: null }
  }
  const b: any = {
    select: () => b,
    update: (p: any) => { op = 'update'; payload = p; return b },
    eq: (c: string, v: any) => { filters.push(r => String(get(r, c)) === String(v)); return b },
    in: (c: string, v: any[]) => { filters.push(r => v.includes(get(r, c))); return b },
    is: (c: string, v: any) => { filters.push(r => (get(r, c) ?? null) === v); return b },
    order: () => b,
    limit: () => b,
    single: async () => run(true),
    maybeSingle: async () => run(true),
    then: (ok: any, err: any) => Promise.resolve(run(false)).then(ok, err)
  }
  return b
}
const db = { from }

// ---- a fake Stripe that records what it was asked to move ----
let transfersCapability = 'active'
let transfers: Array<{ params: any; opts: any }> = []
let reversals: Array<{ id: string; opts: any }> = []
let failNext: string | null = null
const stripe: any = {
  accounts: { retrieve: async (id: string) => ({ id, capabilities: { transfers: transfersCapability } }) },
  transfers: {
    create: async (params: any, opts: any) => {
      if (failNext) { const m = failNext; failNext = null; throw new Error(m) }
      transfers.push({ params, opts })
      return { id: `tr_${transfers.length}` }
    },
    createReversal: async (id: string, _p: any, opts: any) => {
      reversals.push({ id, opts })
      return { id: `trr_${reversals.length}` }
    }
  }
}
const deps = { db, stripe }

const STORE = 'store-crystal'
const store = (over: Record<string, any> = {}) => ({
  id: STORE, slug: 'crystal', status: 'draft', owner_user_id: 'crystal-user', stripe_account_id: 'acct_crystal',
  referral_code: 'CRYSTAL', referral_percent: 10, ...over
})
const stamp = { storefront_id: STORE, slug: 'crystal', code: 'CRYSTAL', recorded_at: '2026-10-26T15:00:00.000Z' }
const order = (over: Record<string, any> = {}) => ({
  id: 'order-1', order_number: 'ITP-TEST-1', user_id: null, subtotal: 50, discount_amount: 10, total: 49.99,
  payment_status: 'paid', charge_id: 'ch_1', created_at: '2026-10-26T15:05:00.000Z', metadata: { items: [], store_referral: { ...stamp } }, ...over
})
const cutOf = (id = 'order-1') => tables.orders.find(o => o.id === id)?.metadata?.store_referral?.cut

beforeEach(() => {
  transfersCapability = 'active'
  transfers = []
  reversals = []
  failNext = null
  tables = { vendor_storefronts: [store()], orders: [order()], referral_codes: [{ id: 'rc-1', code: 'REFR9449Q' }] }
})

describe('pure rules', () => {
  it('reads a code the way the site stores it', () => {
    expect(normalizeStoreReferralCode(' crystal ')).toBe('CRYSTAL')
    expect(normalizeStoreReferralCode('cr-1')).toBeNull()
    expect(normalizeStoreReferralCode(undefined)).toBeNull()
  })

  it('takes her percent of the products after discounts, never shipping or tax, rounded down', () => {
    expect(referralBaseCents({ subtotal: 50, discount_amount: 10 })).toBe(4000)
    expect(referralBaseCents({ subtotal: '24.99', discount_amount: null })).toBe(2499)
    expect(referralBaseCents({ subtotal: 5, discount_amount: 9 })).toBe(0)
    expect(storeReferralCutCents(2499, 10)).toBe(249)
    expect(storeReferralCutCents(4000, null)).toBe(0)
    expect(storeReferralCutCents(4000, 0)).toBe(0)
  })

  it('makes a store code from the slug', () => {
    expect(storeReferralCodeFromSlug('crystal')).toBe('CRYSTAL')
    expect(storeReferralCodeFromSlug('jo-b')).toBeNull()
    expect(storeReferralCodeFromSlug('jo-b', '123')).toBe('JOB123')
  })
})

describe('checkout stamps the order', () => {
  it('stamps her store for her code, from a guest or another account', async () => {
    expect(await resolveStoreReferral('crystal', null, db)).toMatchObject({ storefront_id: STORE, slug: 'crystal', code: 'CRYSTAL' })
    expect(await resolveStoreReferral('CRYSTAL', 'someone-else', db)).toMatchObject({ slug: 'crystal' })
  })

  it('ignores a friend code, a junk code, a paused store and her own purchase', async () => {
    expect(await resolveStoreReferral('REFR9449Q', null, db)).toBeNull()
    expect(await resolveStoreReferral('x', null, db)).toBeNull()
    expect(await resolveStoreReferral('CRYSTAL', 'crystal-user', db)).toBeNull()
    tables.vendor_storefronts[0].status = 'paused'
    expect(await resolveStoreReferral('CRYSTAL', null, db)).toBeNull()
  })

  it('tells the sign-in step her code is a store code, and a friend code is not', async () => {
    expect(await isStoreReferralCode('crystal', db)).toBe(true)
    expect(await isStoreReferralCode('REFR9449Q', db)).toBe(false)
  })

  it('gives a store without a code its slug, unless a person already has that code', async () => {
    tables.vendor_storefronts = [store({ referral_code: null }), store({ id: 's2', slug: 'refr9449q', referral_code: null })]
    expect(await ensureStoreReferralCode(tables.vendor_storefronts[0], db)).toBe('CRYSTAL')
    expect(tables.vendor_storefronts[0].referral_code).toBe('CRYSTAL')
    const taken = await ensureStoreReferralCode(tables.vendor_storefronts[1], db)
    expect(taken).toMatch(/^REFR9449Q\d{3}$/)
  })
})

describe('paid order pays her cut', () => {
  it('transfers her percent of the products to HER account, tied to the charge, once', async () => {
    const cut = await payStoreReferralCut('order-1', undefined, deps)
    expect(cut).toMatchObject({ status: 'paid', base_cents: 4000, percent: 10, amount_cents: 400, transfer_id: 'tr_1' })
    expect(transfers).toHaveLength(1)
    expect(transfers[0].params).toMatchObject({
      amount: 400, currency: 'usd', destination: 'acct_crystal', source_transaction: 'ch_1', transfer_group: 'ITP-TEST-1',
      metadata: { purpose: 'store_referral', vendor_store: 'crystal', order_id: 'order-1' }
    })
    expect(transfers[0].opts).toEqual({ idempotencyKey: 'store-referral-cut-order-1' })
    // Recorded on the order, other metadata kept.
    expect(cutOf()).toMatchObject({ status: 'paid', amount_cents: 400, transfer_id: 'tr_1' })
    expect(tables.orders[0].metadata.items).toEqual([])

    // The webhook retrying, or a settle, never pays twice.
    await payStoreReferralCut('order-1', undefined, deps)
    expect(transfers).toHaveLength(1)
  })

  it('never sends more than the card was charged', async () => {
    tables.orders = [order({ subtotal: 100, discount_amount: 0, total: 3 })]
    tables.vendor_storefronts[0].referral_percent = 50
    await payStoreReferralCut('order-1', undefined, deps)
    expect(transfers[0].params.amount).toBe(300)
  })

  it('does nothing for an order with no store link, or one not paid yet', async () => {
    tables.orders = [order({ metadata: {} }), order({ id: 'order-2', payment_status: 'pending' })]
    expect(await payStoreReferralCut('order-1', undefined, deps)).toBeNull()
    expect(await payStoreReferralCut('order-2', undefined, deps)).toBeNull()
    expect(transfers).toHaveLength(0)
  })

  it('waits for David’s percent, then a settle pays it', async () => {
    tables.vendor_storefronts[0].referral_percent = null
    expect(await payStoreReferralCut('order-1', undefined, deps)).toMatchObject({ status: 'waiting_percent', base_cents: 4000, amount_cents: 0 })
    expect(transfers).toHaveLength(0)

    tables.vendor_storefronts[0].referral_percent = 15
    expect(await settleWaitingStoreReferrals(STORE, undefined, deps)).toBe(1)
    expect(transfers[0].params.amount).toBe(600)
    expect(cutOf()).toMatchObject({ status: 'paid', percent: 15, amount_cents: 600 })
  })

  it('waits for her payouts, then a settle pays it', async () => {
    transfersCapability = 'inactive'
    expect(await payStoreReferralCut('order-1', undefined, deps)).toMatchObject({ status: 'waiting_payouts', amount_cents: 400 })
    transfersCapability = 'active'
    expect(await settleWaitingStoreReferrals(STORE, undefined, deps)).toBe(1)
    expect(cutOf()).toMatchObject({ status: 'paid', transfer_id: 'tr_1' })
  })

  it('pays nothing on her own order or an order with no products left after discounts', async () => {
    tables.orders = [order({ user_id: 'crystal-user' }), order({ id: 'order-2', subtotal: 10, discount_amount: 10 })]
    expect(await payStoreReferralCut('order-1', undefined, deps)).toMatchObject({ status: 'own_order', amount_cents: 0 })
    expect(await payStoreReferralCut('order-2', undefined, deps)).toMatchObject({ status: 'nothing' })
    expect(transfers).toHaveLength(0)
  })

  it('records a Stripe refusal and a later settle retries it', async () => {
    failNext = 'Insufficient funds in Stripe account'
    expect(await payStoreReferralCut('order-1', undefined, deps)).toMatchObject({ status: 'failed', error: 'Insufficient funds in Stripe account' })
    expect(await settleWaitingStoreReferrals(STORE, undefined, deps)).toBe(1)
    expect(cutOf()?.status).toBe('paid')
  })

  it('lists the orders through her link for her store page', async () => {
    await payStoreReferralCut('order-1', undefined, deps)
    expect(await storeReferralOrders(STORE, db)).toEqual([
      { orderNumber: 'ITP-TEST-1', createdAt: '2026-10-26T15:05:00.000Z', productsCents: 4000, cutCents: 400, status: 'paid' }
    ])
  })
})

describe('refund takes it back', () => {
  it('reverses a paid cut on Stripe', async () => {
    await payStoreReferralCut('order-1', undefined, deps)
    const r = await reverseStoreReferralCut('order-1', undefined, deps)
    expect(r).toMatchObject({ ok: true, skipped: false, details: { transfer: 'tr_1', amount_cents: 400 } })
    expect(reversals).toEqual([{ id: 'tr_1', opts: { idempotencyKey: 'store-referral-reversal-order-1' } }])
    expect(cutOf()?.status).toBe('reversed')
    // Twice is a no-op.
    expect(await reverseStoreReferralCut('order-1', undefined, deps)).toMatchObject({ ok: true, skipped: true })
    expect(reversals).toHaveLength(1)
  })

  it('cancels a waiting cut so a later settle never pays it', async () => {
    tables.vendor_storefronts[0].referral_percent = null
    await payStoreReferralCut('order-1', undefined, deps)
    await reverseStoreReferralCut('order-1', undefined, deps)
    expect(cutOf()?.status).toBe('cancelled')
    tables.vendor_storefronts[0].referral_percent = 10
    expect(await settleWaitingStoreReferrals(STORE, undefined, deps)).toBe(0)
    expect(transfers).toHaveLength(0)
  })

  it('skips an order that never came through a store link', async () => {
    tables.orders = [order({ metadata: {} })]
    expect(await reverseStoreReferralCut('order-1', undefined, deps)).toMatchObject({ ok: true, skipped: true })
  })
})

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'

// Crystal's discount codes (David 2026-10-26: "she should be able to give a discount to her peeps but whatever she
// does cuts at her own cost"). Runs the REAL vendor-store router (requireStoreManager, the cart, the split, the
// checkout) on an ephemeral port; only Supabase, auth, roles, Stripe and GCS are faked. What must hold:
//   * she (and ITP admins) make, edit and switch codes; a manager-less shopper or another seller never can;
//   * a buyer with her code pays less, and the application fee (ITP's take) is the same to the cent as without it;
//   * a code that is off, past its last day, unknown, or would reach into ITP's share is refused: no order, no
//     Stripe coupon, no Checkout Session.

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.STRIPE_SECRET_KEY ||= 'sk_test_fake'

const STORE_ID = 'store-1'
const CANDLE = '43d607e5-e8e1-4b57-a52f-110a5cd6a1c3'
const CRYSTAL = 'user-crystal'

let tables: Record<string, any[]> = {}
let writes: { table: string; op: string; payload?: any }[] = []
let nextId = 1

function builder(table: string) {
  let op = 'select'
  let payload: any
  const filters: [string, any][] = []
  const match = (r: any) => filters.every(([col, val]) => (Array.isArray(val) ? val.includes(r[col]) : r[col] === val))
  const result = (one: boolean) => {
    const rows = tables[table] ?? (tables[table] = [])
    if (op === 'insert') {
      const list = (Array.isArray(payload) ? payload : [payload]).map((p: any) => ({ id: table === 'orders' ? 'order-1' : `row-${nextId++}`, created_at: new Date().toISOString(), ...p }))
      // The table's unique (storefront_id, code).
      if (table === 'vendor_store_discount_codes' && list.some((n: any) => rows.some(r => r.storefront_id === n.storefront_id && r.code === n.code))) {
        return { data: null, error: { code: '23505', message: 'duplicate key' } }
      }
      rows.push(...list)
      return { data: one ? list[0] : list, error: null }
    }
    if (op === 'update') {
      const hit = rows.filter(match)
      if (table === 'vendor_store_discount_codes' && payload.code && rows.some(r => !hit.includes(r) && r.storefront_id === hit[0]?.storefront_id && r.code === payload.code)) {
        return { data: null, error: { code: '23505', message: 'duplicate key' } }
      }
      hit.forEach(r => Object.assign(r, payload))
      return { data: one ? hit[0] ?? null : hit, error: null }
    }
    const found = rows.filter(match)
    return one ? { data: found[0] ?? null, error: null } : { data: found, error: null }
  }
  const b: any = {
    select: () => b,
    insert: (p: any) => { op = 'insert'; payload = p; writes.push({ table, op, payload: p }); return b },
    update: (p: any) => { op = 'update'; payload = p; writes.push({ table, op, payload: p }); return b },
    delete: () => { op = 'delete'; return b },
    eq: (col: string, val: any) => { filters.push([col, val]); return b },
    in: (col: string, vals: any[]) => { filters.push([col, vals]); return b },
    is: () => b,
    or: () => b,
    order: () => b,
    limit: () => b,
    single: async () => result(true),
    maybeSingle: async () => result(true),
    then: (ok: any, err: any) => Promise.resolve(result(false)).then(ok, err),
  }
  return b
}

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: (t: string) => builder(t),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email_confirmed_at: null } } }) } },
  },
}))
// Who is signed in: the x-test-user header (id|email).
vi.mock('../middleware/supabaseAuth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const h = req.header('x-test-user')
    if (!h) return res.status(401).json({ error: 'sign in' })
    const [sub, email] = h.split('|')
    req.user = { sub, email }
    next()
  },
}))
const roles: Record<string, string> = {}
vi.mock('../lib/role-cache.js', () => ({ getCachedRole: async (id: string) => roles[id] ?? null, invalidateCachedRole: () => {} }))
vi.mock('../services/google-cloud-storage.js', () => ({ uploadImageFromBuffer: async () => ({ publicUrl: '', path: '' }), getSignedUrl: async () => '' }))
vi.mock('../services/print-files.js', () => ({ getPrintFileRefsFor: async () => ({}) }))

// Stripe: every Checkout Session and coupon the route asks for, exactly as sent.
const sessions: any[] = []
const coupons: any[] = []
vi.mock('stripe', () => ({
  default: class {
    accounts = { retrieve: async (id: string) => ({ id, capabilities: { transfers: 'active' } }) }
    coupons = { create: async (p: any) => { const c = { id: `co_test_${coupons.length + 1}`, ...p }; coupons.push(c); return c } }
    checkout = { sessions: { create: async (p: any) => { sessions.push(p); return { id: `cs_test_${sessions.length}`, url: `https://checkout.stripe.test/cs_test_${sessions.length}` } } } }
  },
}))

const { default: router } = await import('./vendor-store.js')

let base = ''
let server: ReturnType<ReturnType<typeof express>['listen']>
beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/vendor-store', router)
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()) })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server?.close() })

const yesterday = () => new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
const nextMonth = () => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
const code = (over: Record<string, any>) => ({ id: `code-${over.code}`, storefront_id: STORE_ID, kind: 'percent', amount: 20, ends_on: null, active: true, created_at: '2026-10-26T12:00:00Z', ...over })

beforeEach(() => {
  sessions.length = 0
  coupons.length = 0
  writes = []
  for (const k of Object.keys(roles)) delete roles[k]
  roles[CRYSTAL] = 'vendor'
  roles['user-david'] = 'admin'
  roles['user-other-seller'] = 'vendor'
  roles['user-shopper'] = 'customer'
  tables = {
    vendor_storefronts: [{
      id: STORE_ID, slug: 'crystal', name: 'Crystal’s Shirts and More', status: 'live', fee_percent: 10, theme: {},
      own_shipping_cents: 599, itp_shipping_cents: 699, stripe_account_id: 'acct_crystal',
      owner_user_id: CRYSTAL, owner_email: 'crystal@imaginethisprinted.com',
    }],
    vendor_store_items: [
      { id: 'tee', storefront_id: STORE_ID, product_id: null, name: 'Craft Queen Tee', images: [], sizes: ['M'], colors: [], price_cents: 2500, itp_cost_cents: 0, active: true },
      { id: 'candle', storefront_id: STORE_ID, product_id: CANDLE, name: 'Ghost Face Candle Holder', images: [], sizes: [], colors: [], price_cents: 2600, itp_cost_cents: 1400, active: true },
    ],
    products: [{ id: CANDLE, status: 'active', is_active: true }],
    vendor_store_discount_codes: [
      code({ code: 'CRYSTAL20', kind: 'percent', amount: 20 }),
      code({ code: 'FIVEOFF', kind: 'amount', amount: 500, ends_on: nextMonth() }),
      code({ code: 'SLEEPING', active: false }),
      code({ code: 'SUMMER', ends_on: yesterday() }),
      code({ code: 'HALFOFF', amount: 50 }),
    ],
  }
})

const manage = (user: string, path = '', init: RequestInit = {}) =>
  fetch(`${base}/api/vendor-store/manage/crystal/discounts${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-test-user': `${user}|${user}@example.com`, ...(init.headers || {}) },
  })
const send = (user: string, method: string, body: any, path = '') => manage(user, path, { method, body: JSON.stringify(body) })

// Two Craft Queen Tees (hers) and one candle holder (ours): 7600 of items, plus both packages' shipping.
const CART = [{ itemId: 'tee', quantity: 2, size: 'M' }, { itemId: 'candle', quantity: 1 }]
const SHIP_TO = { name: 'Pat Buyer', street1: '1 Main St', city: 'Atlanta', state: 'GA', zip: '30303', phone: '4045550100' }
/**
 * The cart's way through (Mia's shipping, task 41551288): price shipping for the address, take the cheapest choice,
 * check out with its signed quote. No Shippo key in tests, so the quote is the weight-aware estimate.
 */
const buy = async (body: Record<string, any>, items: any[] = CART) => {
  const rated = await fetch(`${base}/api/vendor-store/crystal/shipping-rates`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, shipTo: SHIP_TO }),
  })
  const shippingQuote = (await rated.json()).options?.[0]?.token
  return fetch(`${base}/api/vendor-store/crystal/checkout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, shipTo: SHIP_TO, shippingQuote, ...body }),
  })
}
const check = (body: Record<string, any>) =>
  fetch(`${base}/api/vendor-store/crystal/discount`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: CART, ...body }) })

/** What Stripe charges the buyer for a session: items plus shipping, less the coupon on it. */
const charged = (s: any) =>
  s.line_items.reduce((n: number, l: any) => n + l.price_data.unit_amount * l.quantity, 0) +
  s.shipping_options[0].shipping_rate_data.fixed_amount.amount -
  (s.discounts ? coupons.find(c => c.id === s.discounts[0].coupon).amount_off : 0)
const orderInserts = () => writes.filter(w => w.table === 'orders' && w.op === 'insert').map(w => w.payload)

describe('her discount codes in the store manager', () => {
  it('she makes a percent-off code and a dollars-off code with an end date, then edits and switches them', async () => {
    tables.vendor_store_discount_codes = []
    let res = await send(CRYSTAL, 'POST', { code: 'peeps 15', kind: 'percent', amount: 15 })
    expect(res.status).toBe(200)
    const pct = (await res.json()).code
    expect(pct).toMatchObject({ code: 'PEEPS15', kind: 'percent', amount: 15, endsOn: null, active: true })

    res = await send(CRYSTAL, 'POST', { code: 'TENOFF', kind: 'amount', amount: 1000, endsOn: nextMonth() })
    expect(res.status).toBe(200)
    const dollars = (await res.json()).code
    expect(dollars).toMatchObject({ code: 'TENOFF', kind: 'amount', amount: 1000, endsOn: nextMonth(), active: true })

    // Switch one off, clear the other's end date, change an amount.
    expect((await send(CRYSTAL, 'PATCH', { active: false }, `/${pct.id}`)).status).toBe(200)
    expect((await send(CRYSTAL, 'PATCH', { endsOn: null, amount: 800 }, `/${dollars.id}`)).status).toBe(200)
    const list = await (await manage(CRYSTAL)).json()
    expect(list.codes.find((c: any) => c.code === 'PEEPS15').active).toBe(false)
    expect(list.codes.find((c: any) => c.code === 'TENOFF')).toMatchObject({ endsOn: null, amount: 800 })
    expect(list.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // Every code saved belongs to her store.
    expect(tables.vendor_store_discount_codes.every(r => r.storefront_id === STORE_ID)).toBe(true)
  })

  it('refuses a bad code, a duplicate name, a bad amount and a past end date, in plain words', async () => {
    const bad = async (body: any, path = '', method = 'POST') => {
      const r = await send(CRYSTAL, method, body, path)
      return { status: r.status, error: (await r.json()).error as string }
    }
    expect((await bad({ code: 'X', kind: 'percent', amount: 10 })).status).toBe(400)
    expect(await bad({ code: 'crystal20', kind: 'percent', amount: 10 })).toEqual({ status: 409, error: 'You already have a code called CRYSTAL20.' })
    expect((await bad({ code: 'BIG', kind: 'percent', amount: 101 })).status).toBe(400)
    expect((await bad({ code: 'TINY', kind: 'amount', amount: 50 })).status).toBe(400)
    expect((await bad({ code: 'OLD', kind: 'percent', amount: 10, endsOn: yesterday() })).error).toBe('Pick an end date from today on.')
    // Switching a 20% code to dollars off needs a dollar amount, not "20 cents".
    expect((await bad({ kind: 'amount' }, '/code-CRYSTAL20', 'PATCH')).status).toBe(400)
    expect((await bad({ code: 'FIVEOFF' }, '/code-CRYSTAL20', 'PATCH')).status).toBe(409)
  })

  it('an ITP admin can manage her codes; another seller and a shopper cannot', async () => {
    expect((await manage('user-david')).status).toBe(200)
    expect((await send('user-david', 'POST', { code: 'FRIENDS', kind: 'percent', amount: 10 })).status).toBe(200)
    for (const u of ['user-other-seller', 'user-shopper']) {
      expect((await manage(u)).status).toBe(403)
      expect((await send(u, 'POST', { code: 'MINE', kind: 'percent', amount: 90 })).status).toBe(403)
      expect((await send(u, 'PATCH', { active: true }, '/code-SLEEPING')).status).toBe(403)
    }
    expect((await fetch(`${base}/api/vendor-store/manage/crystal/discounts`)).status).toBe(401)
    expect(tables.vendor_store_discount_codes.find(r => r.code === 'SLEEPING').active).toBe(false)
  })
})

describe('a buyer using her code', () => {
  it('pays less, and ITP’s application fee is the same to the cent as without a code', async () => {
    expect((await buy({})).status).toBe(200)
    expect((await buy({ code: 'crystal20' })).status).toBe(200)
    expect((await buy({ code: 'FIVEOFF' })).status).toBe(200)
    const [plain, pct, dollars] = sessions

    // ITP: 10% of her 5000 (500) + our candle price 1400 + both packages' shipping (ITP's Shippo buys both labels),
    // every time.
    const shipping = plain.shipping_options[0].shipping_rate_data.fixed_amount.amount
    expect(shipping).toBeGreaterThan(0)
    expect(plain.payment_intent_data.application_fee_amount).toBe(500 + 1400 + shipping)
    expect(pct.payment_intent_data.application_fee_amount).toBe(plain.payment_intent_data.application_fee_amount)
    expect(dollars.payment_intent_data.application_fee_amount).toBe(plain.payment_intent_data.application_fee_amount)
    expect(pct.payment_intent_data.transfer_data).toEqual({ destination: 'acct_crystal' })

    // The buyer: 7600 + shipping without a code; 20% of the items (1520) off; $5 off. Shipping is never discounted.
    expect(plain.discounts).toBeUndefined()
    expect(charged(plain)).toBe(7600 + shipping)
    expect(charged(pct)).toBe(7600 + shipping - 1520)
    expect(charged(dollars)).toBe(7600 + shipping - 500)
    // Same items at the same prices, same shipping: the code is its own line on Stripe's page.
    expect(pct.line_items).toEqual(plain.line_items)
    expect(pct.shipping_options).toEqual(plain.shipping_options)
    expect(coupons.map(c => [c.name, c.amount_off, c.currency, c.duration, c.max_redemptions])).toEqual([
      ['CRYSTAL20', 1520, 'usd', 'once', 1],
      ['FIVEOFF', 500, 'usd', 'once', 1],
    ])

    // The order rows: what the buyer pays, and her share (the only number the code moved).
    const [o0, o1, o2] = orderInserts()
    expect([o0.total, o1.total, o2.total]).toEqual([7600 + shipping, 7600 + shipping - 1520, 7600 + shipping - 500].map(c => c / 100))
    expect([o0.discount_amount, o1.discount_amount, o2.discount_amount]).toEqual([0, 15.2, 5])
    expect(o1.metadata.vendor_store.split.itpShareCents).toBe(o0.metadata.vendor_store.split.itpShareCents)
    expect(o1.metadata.vendor_store.split.vendorShareCents).toBe(o0.metadata.vendor_store.split.vendorShareCents - 1520)
    expect(o1.metadata.vendor_store.discount).toEqual({ id: 'code-CRYSTAL20', code: 'CRYSTAL20', kind: 'percent', amount: 20 })
    // Her code never lands where the paid-order step looks up ITP's own coupons.
    expect(o1.discount_codes).toEqual([])
  })

  it('refuses a code that is off, ended, unknown, or would reach into ITP’s share: no order, no coupon, no session', async () => {
    const tries: Array<[string, RegExp]> = [
      ['SLEEPING', /switched off/],
      ['SUMMER', /ended on/],
      ['NOPE', /don’t know that code/],
    ]
    for (const [c, why] of tries) {
      const res = await buy({ code: c })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(why)
    }
    // One candle holder: ITP's share is 1400 + our shipping, she keeps 1200. Half off (1300) needs our money.
    const res = await buy({ code: 'HALFOFF' }, [{ itemId: 'candle', quantity: 1 }])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/takes off more than this order allows/)
    expect(sessions).toHaveLength(0)
    expect(coupons).toHaveLength(0)
    expect(orderInserts()).toHaveLength(0)
  })

  it('the cart’s Apply shows the same discount the checkout charges, and the same refusals', async () => {
    let res = await check({ code: ' crystal20 ' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ code: 'CRYSTAL20', label: '20% off', subtotalCents: 7600, discountCents: 1520 })
    res = await check({ code: 'FIVEOFF' })
    expect((await res.json()).label).toBe('$5.00 off')
    expect((await check({ code: 'SUMMER' })).status).toBe(400)
    expect((await check({ code: '' })).status).toBe(400)
    // Applying a code saves nothing and opens nothing.
    expect(writes).toHaveLength(0)
    expect(sessions).toHaveLength(0)
  })
})

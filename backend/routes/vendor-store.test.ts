import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'

// Vendor storefront checkout (David 2026-10-26, Crystal's store). Runs the REAL router on an
// ephemeral port; only Supabase, Stripe, GCS and auth are faked. What must hold:
//   * the Checkout pays her Express account by destination charge, ITP's share is the fee;
//   * prices come from the store's rows, never the browser;
//   * checkout stays shut until David sets the store live AND her payouts can take transfers.

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.STRIPE_SECRET_KEY ||= 'sk_test_fake'

const STORE_ID = 'store-1'
const CANDLE = '43d607e5-e8e1-4b57-a52f-110a5cd6a1c3'

let tables: Record<string, any[]> = {}
const writes: { table: string; op: string; payload?: any }[] = []

function builder(table: string) {
  let op = 'select'
  let payload: any
  const filters: [string, any][] = []
  const result = (one: boolean) => {
    if (op === 'insert') {
      const row = Array.isArray(payload) ? payload[0] : payload
      const out = { id: table === 'orders' ? 'order-1' : 'row-1', ...row }
      return { data: one ? out : [out], error: null }
    }
    if (op !== 'select') return { data: null, error: null }
    let rows = tables[table] ?? []
    for (const [col, val] of filters) rows = rows.filter(r => (Array.isArray(val) ? val.includes(r[col]) : r[col] === val))
    return one ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }
  }
  const b: any = {
    select: () => b,
    insert: (p: any) => { op = 'insert'; payload = p; writes.push({ table, op, payload: p }); return b },
    update: (p: any) => { op = 'update'; payload = p; writes.push({ table, op, payload: p }); return b },
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

vi.mock('../lib/supabase.js', () => ({ supabase: { from: (t: string) => builder(t) } }))
vi.mock('../middleware/supabaseAuth.js', () => ({ requireAuth: (q: any, _s: any, n: any) => { q.user = { sub: 'user-1', email: 'someone@example.com' }; n() } }))
let role: string | null = null
vi.mock('../lib/role-cache.js', () => ({ getCachedRole: async () => role }))
vi.mock('../services/google-cloud-storage.js', () => ({ uploadImageFromBuffer: async () => ({ publicUrl: '', path: '' }) }))
vi.mock('../services/print-files.js', () => ({ getPrintFileRefsFor: async () => ({}) }))

let transfers = 'active'
const sessions: any[] = []
vi.mock('stripe', () => ({
  default: class {
    accounts = { retrieve: async (id: string) => ({ id, capabilities: { transfers } }) }
    checkout = { sessions: { create: async (p: any) => { sessions.push(p); return { id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1' } } } }
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

const store = (over: Record<string, any> = {}) => ({
  id: STORE_ID, slug: 'crystal', name: 'Crystal’s Shirts and More', status: 'live', fee_percent: 10,
  own_shipping_cents: 599, itp_shipping_cents: 699, stripe_account_id: 'acct_crystal', theme: {}, ...over,
})

beforeEach(() => {
  transfers = 'active'
  sessions.length = 0
  writes.length = 0
  role = null
  tables = {
    vendor_storefronts: [store()],
    vendor_store_items: [
      { id: 'tee', storefront_id: STORE_ID, product_id: null, name: 'Craft Queen Tee', images: [], sizes: ['M', '2XL'], colors: [], price_cents: 2500, itp_cost_cents: 0, active: true },
      { id: 'candle', storefront_id: STORE_ID, product_id: CANDLE, name: 'Ghost Face Candle Holder', images: [], sizes: [], colors: [], price_cents: 2600, itp_cost_cents: 1400, active: true },
    ],
    products: [{ id: CANDLE, status: 'active', is_active: true }],
  }
})

const buy = (items: any[]) =>
  fetch(`${base}/api/vendor-store/crystal/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) })

describe('vendor store checkout', () => {
  it('pays her account by destination charge and keeps ITP’s share as the fee', async () => {
    const res = await buy([{ itemId: 'tee', quantity: 2, size: 'M', priceCents: 1 }, { itemId: 'candle', quantity: 1 }])
    expect(res.status).toBe(200)
    expect(sessions).toHaveLength(1)
    const s = sessions[0]
    // Prices come from the rows: the browser's priceCents: 1 is ignored.
    expect(s.line_items.map((l: any) => l.price_data.unit_amount)).toEqual([2500, 2600])
    expect(s.shipping_options[0].shipping_rate_data.fixed_amount.amount).toBe(599 + 699)
    // ITP: 10% of 5000 (500) + candle cost 1400 + ITP shipping 699.
    expect(s.payment_intent_data.application_fee_amount).toBe(500 + 1400 + 699)
    expect(s.payment_intent_data.transfer_data).toEqual({ destination: 'acct_crystal' })
    expect(s.payment_intent_data.metadata.orderId).toBe('order-1')
    const order = writes.find(w => w.table === 'orders' && w.op === 'insert')!.payload
    expect(order.source).toBe('store:crystal')
    expect(order.total).toBe((5000 + 2600 + 1298) / 100)
    expect(order.metadata.vendor_store.split.vendorShareCents).toBe(5000 + 2600 + 1298 - 2599)
    const items = writes.find(w => w.table === 'order_items')!.payload
    expect(items.map((i: any) => i.metadata.maker)).toEqual(['vendor', 'itp'])
  })

  it('sells the QR stand as an ITP line that carries the buyer’s link, words and logo for the builder', async () => {
    tables.vendor_store_items.push({ id: 'stand', storefront_id: STORE_ID, product_id: null, name: 'Custom QR Counter Stand', images: ['/business/qr-stand-shop.webp'], sizes: [], colors: [], price_cents: 2500, itp_cost_cents: 1795, active: true, metadata: { line_type: 'qr-stand' } })
    expect((await buy([{ itemId: 'stand', quantity: 1, personalization: { qr_caption: 'Pay Here' } }])).status).toBe(400)
    const res = await buy([{ itemId: 'stand', quantity: 2, personalization: { qr_link: 'crystal.imaginethisprinted.com', qr_caption: 'Shop My Store' } }])
    expect(res.status).toBe(200)
    expect(sessions[0].payment_intent_data.application_fee_amount).toBe(1795 * 2 + 699)
    const line = writes.find(w => w.table === 'order_items')!.payload[0]
    expect(line.metadata.maker).toBe('itp')
    expect(line.metadata.qr_stand).toEqual({ line_index: 0, link: 'https://crystal.imaginethisprinted.com', caption: 'Shop My Store', logo_path: null })
  })

  it('stays shut while the store is a draft', async () => {
    tables.vendor_storefronts = [store({ status: 'draft' })]
    const res = await buy([{ itemId: 'tee', quantity: 1, size: 'M' }])
    expect(res.status).toBe(409)
    expect(sessions).toHaveLength(0)
  })

  it('stays shut until her payouts can take transfers', async () => {
    transfers = 'pending'
    expect((await buy([{ itemId: 'tee', quantity: 1, size: 'M' }])).status).toBe(409)
    tables.vendor_storefronts = [store({ stripe_account_id: null })]
    transfers = 'active'
    expect((await buy([{ itemId: 'tee', quantity: 1, size: 'M' }])).status).toBe(409)
    expect(sessions).toHaveLength(0)
  })

  it('refuses an item that is off, a missing size, and an ITP product ITP stopped selling', async () => {
    tables.vendor_store_items[0].active = false
    expect((await buy([{ itemId: 'tee', quantity: 1, size: 'M' }])).status).toBe(400)
    tables.vendor_store_items[0].active = true
    expect((await buy([{ itemId: 'tee', quantity: 1 }])).status).toBe(400)
    tables.products = [{ id: CANDLE, status: 'draft', is_active: true }]
    expect((await buy([{ itemId: 'candle', quantity: 1 }])).status).toBe(400)
    expect(sessions).toHaveLength(0)
  })
})

// Her own link (task 1a699ba8): the manager page gets the link, and only an ITP admin sets her cut.
describe('store manager: her link', () => {
  const manage = (init?: RequestInit) => fetch(`${base}/api/vendor-store/manage/crystal`, { headers: { 'Content-Type': 'application/json' }, ...init })

  it('hands her the site link with her store code; the cut waits until it is set', async () => {
    role = 'admin'
    tables.vendor_storefronts = [store({ referral_code: 'CRYSTAL', referral_percent: null })]
    const body = await (await manage()).json()
    expect(body.referral).toEqual({ code: 'CRYSTAL', link: expect.stringMatching(/\/\?ref=CRYSTAL$/), percent: null, orders: [] })
  })

  it('lets an ITP admin set her cut, and not the seller', async () => {
    role = 'admin'
    const res = await manage({ method: 'PATCH', body: JSON.stringify({ referralPercent: 10 }) })
    expect(res.status).toBe(200)
    expect(writes.find(w => w.table === 'vendor_storefronts' && w.op === 'update')?.payload).toMatchObject({ referral_percent: 10 })

    writes.length = 0
    role = 'vendor'
    tables.vendor_storefronts = [store({ owner_user_id: 'user-1' })]
    expect((await manage({ method: 'PATCH', body: JSON.stringify({ referralPercent: 50 }) })).status).toBe(400)
    expect(writes.some(w => w.payload?.referral_percent !== undefined)).toBe(false)
  })
})

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
      const rows = (Array.isArray(payload) ? payload : [payload]).map((row, i) => ({ id: table === 'orders' ? 'order-1' : `row-${i + 1}`, ...row }))
      return { data: one ? rows[0] : rows, error: null }
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
vi.mock('../middleware/supabaseAuth.js', () => ({ requireAuth: (q: any, _s: any, n: any) => { q.user = { id: 'crystal-user', sub: 'crystal-user' }; n() } }))
let role: string | null = null
vi.mock('../lib/role-cache.js', () => ({ getCachedRole: async () => role, invalidateCachedRole: () => {} }))
// The assistant's brain (services/store-assistant.ts) is faked: these tests are about what the route hands it and keeps.
const brainCalls: any[] = []
let brainAnswer: any = null
vi.mock('../services/store-assistant.js', () => ({
  askStoreAssistant: async (...args: any[]) => { brainCalls.push(args); return brainAnswer },
}))
vi.mock('../services/google-cloud-storage.js', () => ({
  uploadImageFromBuffer: async () => ({ publicUrl: '', path: '' }),
  // Signed links point back at this test server's /__gcs/<path>, which plays the bucket.
  getSignedUrl: async (path: string) => `${base}/__gcs/${path}`,
}))
vi.mock('../services/print-files.js', () => ({ getPrintFileRefsFor: async () => ({}) }))

let transfers = 'active'
const sessions: any[] = []
vi.mock('stripe', () => ({
  default: class {
    accounts = { retrieve: async (id: string) => ({ id, capabilities: { transfers } }) }
    checkout = { sessions: { create: async (p: any) => { sessions.push(p); return { id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1' } } } }
  },
}))

// Shippo is faked at the network edge (services/shippo.ts is the real client): a shipment from her ZIP (30120) or
// Rockmart's (30153) gets fixed carrier rates, a transaction is a bought label, and the label file is a tiny PDF.
process.env.SHIPPO_API_TOKEN = 'shippo_test_fake'
const shippoCalls: Array<{ url: string; body: any }> = []
const CARRIER_RATES: Record<string, Array<[string, string, string, string]>> = {
  '30120': [['USPS', 'usps_ground_advantage', 'Ground Advantage', '7.43'], ['USPS', 'usps_priority', 'Priority Mail', '9.33']],
  '30153': [['USPS', 'usps_ground_advantage', 'Ground Advantage', '5.58'], ['USPS', 'usps_priority', 'Priority Mail', '8.95'], ['UPS', 'ups_ground', 'Ground', '11.20']],
}
const asJson = (json: any, status = 201) => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } })
const realFetch = globalThis.fetch
globalThis.fetch = (async (url: any, init: any) => {
  const u = String(url)
  if (u.startsWith('https://api.goshippo.com/')) {
    const body = JSON.parse(init.body)
    shippoCalls.push({ url: u, body })
    if (u.endsWith('/shipments/')) {
      const from = body.address_from.zip
      return asJson({ rates: (CARRIER_RATES[from] || []).map(([provider, token, name, amount]) =>
        ({ object_id: `rate_${from}_${token}`, provider, servicelevel: { token, name }, amount, currency: 'USD', estimated_days: 3 })) })
    }
    return asJson({ object_id: 'tx_1', status: 'SUCCESS', label_url: 'https://deliver.goshippo.com/tx_1.pdf', tracking_number: '9400111', tracking_url_provider: 'https://tools.usps.com/t/9400111' })
  }
  if (u === 'https://deliver.goshippo.com/tx_1.pdf') return new Response(Buffer.from('%PDF-1.4 shippo label'), { status: 200, headers: { 'Content-Type': 'application/pdf' } })
  return realFetch(url, init)
}) as any

const { default: router } = await import('./vendor-store.js')

let base = ''
let server: ReturnType<ReturnType<typeof express>['listen']>
beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.get('/__gcs/*', (_req, res) => { res.type('image/png').send(Buffer.from('89504e470d0a1a0a', 'hex')) })
  app.use('/api/vendor-store', router)
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()) })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server?.close(); globalThis.fetch = realFetch })

const store = (over: Record<string, any> = {}) => ({
  id: STORE_ID, slug: 'crystal', name: 'Crystal’s Shirts and More', status: 'live', fee_percent: 10,
  own_shipping_cents: 599, itp_shipping_cents: 699, stripe_account_id: 'acct_crystal', theme: {},
  ship_from: { name: 'Crystal Trinidad', street1: '12 Craft Ln', street2: '', city: 'Cartersville', state: 'GA', zip: '30120', phone: '7705551234' },
  ...over,
})

beforeEach(() => {
  role = null
  brainCalls.length = 0
  brainAnswer = { heard: null, reply: 'Hi Crystal!', remember: [], makeProduct: false, usage: null }
  transfers = 'active'
  sessions.length = 0
  writes.length = 0
  shippoCalls.length = 0
  tables = {
    vendor_storefronts: [store()],
    vendor_store_items: [
      { id: 'tee', storefront_id: STORE_ID, product_id: null, name: 'Craft Queen Tee', images: [], sizes: ['M', '2XL'], colors: [], price_cents: 2500, itp_cost_cents: 0, active: true },
      { id: 'candle', storefront_id: STORE_ID, product_id: CANDLE, name: 'Ghost Face Candle Holder', images: [], sizes: [], colors: [], price_cents: 2600, itp_cost_cents: 1400, active: true },
    ],
    products: [{ id: CANDLE, status: 'active', is_active: true }],
  }
})

const SHIP_TO = { name: 'Pat Buyer', street1: '1 Main St', city: 'Atlanta', state: 'GA', zip: '30303', phone: '4045550100' }
const post = (path: string, body: any) =>
  fetch(`${base}/api/vendor-store/crystal${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const rates = (items: any[], shipTo: any = SHIP_TO) => post('/shipping-rates', { items, shipTo })
/** The cart's way through: price shipping for the address, take the cheapest choice, check out with it. */
const buy = async (items: any[], opts: { token?: string | null; shipTo?: any } = {}) => {
  let token = opts.token
  if (token === undefined) token = (await (await rates(items, opts.shipTo || SHIP_TO)).json()).options?.[0]?.token
  return post('/checkout', { items, shipTo: opts.shipTo || SHIP_TO, shippingQuote: token })
}

describe('vendor store checkout', () => {
  it('pays her account by destination charge and keeps ITP’s share as the fee', async () => {
    const res = await buy([{ itemId: 'tee', quantity: 2, size: 'M', priceCents: 1 }, { itemId: 'candle', quantity: 1 }])
    expect(res.status).toBe(200)
    expect(sessions).toHaveLength(1)
    const s = sessions[0]
    // Prices come from the rows: the browser's priceCents: 1 is ignored.
    expect(s.line_items.map((l: any) => l.price_data.unit_amount)).toEqual([2500, 2600])
    // Real rates with ITP's 5%: her box 7.43 -> 7.80 from Cartersville, ITP's 5.58 -> 5.86 from Rockmart.
    expect(s.shipping_options[0].shipping_rate_data.fixed_amount.amount).toBe(780 + 586)
    expect(s.shipping_options[0].shipping_rate_data.display_name).toBe('USPS Ground Advantage (ships in two packages)')
    // ITP: 10% of 5000 (500) + candle cost 1400 + both packages' shipping (both labels bought on ITP's Shippo).
    expect(s.payment_intent_data.application_fee_amount).toBe(500 + 1400 + 586 + 780)
    expect(s.payment_intent_data.transfer_data).toEqual({ destination: 'acct_crystal' })
    expect(s.payment_intent_data.metadata.orderId).toBe('order-1')
    // The address the rate was quoted for goes to Stripe; Stripe doesn't ask for another.
    expect(s.shipping_address_collection).toBeUndefined()
    expect(s.payment_intent_data.shipping).toEqual({ name: 'Pat Buyer', phone: '4045550100', address: { line1: '1 Main St', city: 'Atlanta', state: 'GA', postal_code: '30303', country: 'US' } })
    const order = writes.find(w => w.table === 'orders' && w.op === 'insert')!.payload
    expect(order.source).toBe('store:crystal')
    expect(order.total).toBe((5000 + 2600 + 780 + 586) / 100)
    expect(order.shipping_amount).toBe((780 + 586) / 100)
    expect(order.shipping_address).toMatchObject({ firstName: 'Pat', lastName: 'Buyer', address: '1 Main St', city: 'Atlanta', state: 'GA', zipCode: '30303' })
    const split = order.metadata.vendor_store.split
    // Her package on her side, ITP's on ours, each with the label it pays for and ITP's usual cut.
    expect([split.ownShippingCents, split.ownLabelCents, split.ownShippingCutCents]).toEqual([780, 743, 37])
    expect([split.itpShippingCents, split.itpLabelCents, split.itpShippingCutCents]).toEqual([586, 558, 28])
    expect(split.vendorShareCents).toBe(4500 + 1200)
    expect(order.metadata.vendor_store.shipping.own).toMatchObject({ chargeCents: 780, service: 'usps_ground_advantage', weightLb: 1, source: 'shippo' })
    expect(order.metadata.vendor_store.shipping.itp).toMatchObject({ chargeCents: 586, service: 'usps_ground_advantage', weightLb: 0.5 })
    // Her box was rated from her ship-from address, ITP's from the warehouse.
    expect(shippoCalls.filter(c => c.url.endsWith('/shipments/')).map(c => [c.body.address_from.zip, c.body.address_to.zip, c.body.parcels[0].weight]).sort())
      .toEqual([['30120', '30303', '1.00'], ['30153', '30303', '0.50']])
    const items = writes.find(w => w.table === 'order_items')!.payload
    expect(items.map((i: any) => i.metadata.maker)).toEqual(['vendor', 'itp'])
  })

  it('the cart gets one choice per service both boxes can ship by, and never sees her address or the label cost', async () => {
    const res = await rates([{ itemId: 'tee', quantity: 2, size: 'M' }, { itemId: 'candle', quantity: 1 }])
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.source).toBe('shippo')
    expect(body.options.map((o: any) => [o.name, o.amountCents, o.packages])).toEqual([['USPS Ground Advantage', 780 + 586, 2], ['USPS Priority Mail', 980 + 940, 2]])
    const text = JSON.stringify(body) + JSON.stringify(body.options.map((o: any) => Buffer.from(o.token.split('.')[0], 'base64url').toString('utf8')))
    expect(text).not.toMatch(/Craft Ln|Cartersville|30120|743|558/)
    expect(JSON.stringify(await (await fetch(`${base}/api/vendor-store/crystal`)).json())).not.toMatch(/Craft Ln|30120/)
  })

  it('charges the signed quote only: an edited, missing, stale-cart or other-address quote is refused', async () => {
    const cart = [{ itemId: 'tee', quantity: 1, size: 'M' }]
    const token: string = (await (await rates(cart)).json()).options[0].token
    const [payload, sig] = token.split('.')
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    claims.own.chargeCents = 1
    const edited = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${sig}`
    for (const r of [
      await buy(cart, { token: edited }),
      await buy(cart, { token: null }),
      await buy([{ itemId: 'tee', quantity: 3, size: 'M' }], { token }),
      await buy(cart, { token, shipTo: { ...SHIP_TO, zip: '10001' } }),
      await buy(cart, { token, shipTo: { ...SHIP_TO, state: 'Georgia' } }),
    ]) expect(r.status).toBe(400)
    expect(sessions).toHaveLength(0)
    expect((await buy(cart, { token })).status).toBe(200)
  })

  it('a store with no ship-from address yet prices her box from the main site’s estimates, never a flat rate', async () => {
    tables.vendor_storefronts = [store({ ship_from: null })]
    const body = await (await rates([{ itemId: 'tee', quantity: 1, size: 'M' }])).json()
    expect(body.source).toBe('estimate')
    // USPS Ground Advantage estimate for 0.5 lb: (6.49 + 0.55 x 0.5) x 1.05 = 7.10.
    expect(body.options[0]).toMatchObject({ name: 'USPS Ground Advantage', amountCents: 710, packages: 1 })
    expect(shippoCalls).toHaveLength(0)
  })

  it('sells the QR stand as an ITP line that carries the buyer’s link, words and logo for the builder', async () => {
    tables.vendor_store_items.push({ id: 'stand', storefront_id: STORE_ID, product_id: null, name: 'Custom QR Counter Stand', images: ['/business/qr-stand-shop.webp'], sizes: [], colors: [], price_cents: 2500, itp_cost_cents: 1795, active: true, metadata: { line_type: 'qr-stand' } })
    expect((await buy([{ itemId: 'stand', quantity: 1, personalization: { qr_caption: 'Pay Here' } }])).status).toBe(400)
    const res = await buy([{ itemId: 'stand', quantity: 2, personalization: { qr_link: 'crystal.imaginethisprinted.com', qr_caption: 'Shop My Store' } }])
    expect(res.status).toBe(200)
    expect(sessions[0].payment_intent_data.application_fee_amount).toBe(1795 * 2 + 586)
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
    tables.vendor_storefronts = [store({ owner_user_id: 'crystal-user' })]
    expect((await manage({ method: 'PATCH', body: JSON.stringify({ referralPercent: 50 }) })).status).toBe(400)
    expect(writes.some(w => w.payload?.referral_percent !== undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Her labels (task 41551288, David 2026-10-26: "her own items ship from HER: give her the Shippo label to print from
// her store manager"). Bought on ITP's Shippo account from her ship-from address, once per order, downloaded as a PDF.
// ---------------------------------------------------------------------------
describe('her Print label', () => {
  const paidOrder = (over: Record<string, any> = {}) => ({
    id: 'order-9', order_number: 'ITP-9', source: 'store:crystal', payment_status: 'paid',
    customer_email: 'pat@example.com', customer_name: 'Pat Buyer',
    shipping_address: { firstName: 'Pat', lastName: 'Buyer', address: '1 Main St', address2: '', city: 'Atlanta', state: 'GA', zipCode: '30303', country: 'US', phone: '' },
    metadata: {
      items: [{ maker: 'vendor', quantity: 2, name: 'Craft Queen Tee' }, { maker: 'itp', quantity: 1, name: 'Ghost Face Candle Holder' }],
      vendor_store: { split: { vendorShareCents: 5700 }, shipping: { own: { chargeCents: 980, carrier: 'USPS', service: 'usps_priority', name: 'USPS Priority Mail', weightLb: 1, source: 'shippo' } } }
    },
    ...over,
  })
  const asOwner = () => {
    role = 'vendor'
    tables.vendor_storefronts = [store({ owner_user_id: 'crystal-user' })]
  }
  const print = () => fetch(`${base}/api/vendor-store/manage/crystal/orders/ITP-9/label`, { method: 'POST' })

  it('buys her label from her address on the service the buyer paid for, saves it, and never buys twice', async () => {
    asOwner()
    tables.orders = [paidOrder()]
    const res = await print()
    expect(res.status).toBe(200)
    expect((await res.json()).label).toMatchObject({ trackingNumber: '9400111', carrier: 'USPS', service: 'Priority Mail' })
    const [shipment, tx] = shippoCalls
    expect([shipment.body.address_from.zip, shipment.body.address_from.phone, shipment.body.address_to.zip, shipment.body.parcels[0].weight]).toEqual(['30120', '7705551234', '30303', '1.00'])
    expect(tx.body).toMatchObject({ rate: 'rate_30120_usps_priority', label_file_type: 'PDF', metadata: 'ITP-9 crystal' })
    const saved = writes.find(w => w.table === 'orders' && w.op === 'update')!.payload
    expect(saved.metadata.vendor_store.label).toMatchObject({ label_url: 'https://deliver.goshippo.com/tx_1.pdf', tracking_number: '9400111', cost_cents: 933 })
    // The rest of the order's record is kept, and ITP's own package isn't marked shipped.
    expect(saved.metadata.vendor_store.shipping.own.service).toBe('usps_priority')
    expect(saved.status).toBeUndefined()

    tables.orders = [paidOrder({ metadata: saved.metadata })]
    shippoCalls.length = 0
    const again = await (await print()).json()
    expect(again.alreadyPurchased).toBe(true)
    expect(shippoCalls).toHaveLength(0)

    const pdf = await fetch(`${base}/api/vendor-store/manage/crystal/orders/ITP-9/label.pdf`)
    expect(pdf.status).toBe(200)
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    expect(pdf.headers.get('content-disposition')).toBe('attachment; filename="label-ITP-9.pdf"')
    expect((await pdf.text()).startsWith('%PDF')).toBe(true)
  })

  it('asks for her ship-from address first, and has no label for an order ITP ships alone or one not paid', async () => {
    role = 'vendor'
    tables.vendor_storefronts = [store({ owner_user_id: 'crystal-user', ship_from: null })]
    tables.orders = [paidOrder()]
    const res = await print()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('ship_from')
    asOwner()
    tables.orders = [paidOrder({ metadata: { items: [{ maker: 'itp', quantity: 1 }], vendor_store: {} } })]
    expect((await print()).status).toBe(400)
    tables.orders = [paidOrder({ payment_status: 'pending' })]
    expect((await print()).status).toBe(404)
    expect((await fetch(`${base}/api/vendor-store/manage/crystal/orders/ITP-9/label.pdf`)).status).toBe(404)
    expect(shippoCalls).toHaveLength(0)
  })

  it('is hers alone: another seller can’t print or download it', async () => {
    role = 'vendor'
    tables.vendor_storefronts = [store({ owner_user_id: 'someone-else' })]
    tables.orders = [paidOrder()]
    expect((await print()).status).toBe(403)
    expect((await fetch(`${base}/api/vendor-store/manage/crystal/orders/ITP-9/label.pdf`)).status).toBe(403)
    expect(shippoCalls).toHaveLength(0)
  })

  it('her manager shows her ship-from address and each order’s label; she saves the address with a phone', async () => {
    asOwner()
    tables.orders = [paidOrder()]
    const data = await (await fetch(`${base}/api/vendor-store/manage/crystal`)).json()
    expect(data.store.shipFrom).toMatchObject({ zip: '30120' })
    expect(data.orders[0]).toMatchObject({ orderNumber: 'ITP-9', shipping: { chargeCents: 980, service: 'USPS Priority Mail' }, label: null })
    const patch = (shipFrom: any) => fetch(`${base}/api/vendor-store/manage/crystal`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shipFrom }) })
    const noPhone = await patch({ name: 'Crystal', street1: '12 Craft Ln', city: 'Cartersville', state: 'GA', zip: '30120' })
    expect(noPhone.status).toBe(400)
    expect((await patch({ name: ' Crystal ', street1: '12 Craft Ln', city: 'Cartersville', state: 'ga', zip: '30120', phone: '(770) 555-1234' })).status).toBe(200)
    // Opening her manager also saves her referral code, so look for the update that carries the address.
    expect(writes.find(w => w.table === 'vendor_storefronts' && w.op === 'update' && w.payload.ship_from)!.payload.ship_from)
      .toEqual({ name: 'Crystal', street1: '12 Craft Ln', street2: '', city: 'Cartersville', state: 'GA', zip: '30120', phone: '(770) 555-1234' })
  })
})

// ---------------------------------------------------------------------------
// Her store assistant (task 44f16c24, David 2026-10-26: "needs to have memory built in" ... "she should be able to
// upload images and the assistant can assess the design to create a product out of it"). The chat and what the
// assistant remembers live in the database; a picture is measured like a printer would before the brain sees it.
// ---------------------------------------------------------------------------
describe('store assistant: pictures, memory and history', () => {
  const asOwner = () => {
    role = 'vendor'
    tables.vendor_storefronts = [store({ status: 'draft', owner_user_id: 'crystal-user', theme: { ownerFirst: 'Crystal' } })]
  }
  const turn = (form: FormData) => fetch(`${base}/api/vendor-store/manage/crystal/assistant`, { method: 'POST', body: form })
  const png = async (w: number, h: number, alpha: number) => {
    const sharp = (await import('sharp')).default
    return sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 30, b: 90, alpha } } }).png().toBuffer()
  }

  it('measures her picture, saves both turns with it, and keeps what is new to remember', async () => {
    asOwner()
    tables.vendor_store_assistant_memory = [{ storefront_id: STORE_ID, fact: 'Crystal loves neon colours.' }]
    tables.vendor_store_assistant_messages = [
      { id: 'm2', storefront_id: STORE_ID, role: 'assistant', text: 'Love it!', image_url: null, created_at: '2026-10-26T10:00:01Z' },
      { id: 'm1', storefront_id: STORE_ID, role: 'user', text: 'I make shirts for nurses', image_url: null, created_at: '2026-10-26T10:00:00Z' },
    ]
    brainAnswer = {
      heard: null,
      reply: 'A bold dragon, sharp at 1200 by 900, with a clear background. It would sell well on a black tee.',
      remember: ['Crystal loves neon colours.', 'Crystal is making a dragon line for October.'],
      makeProduct: true,
      usage: null,
    }
    const form = new FormData()
    form.append('text', 'Can this be a shirt?')
    form.append('image', new Blob([await png(1200, 900, 0)], { type: 'image/png' }), 'dragon.png')
    const res = await turn(form)
    expect(res.status).toBe(200)
    const body = await res.json()

    // What the brain got: her store, what it remembers, the chat so far from the database, her picture measured.
    const [facts, turns, audio, image] = brainCalls[0]
    expect(facts.memories).toEqual(['Crystal loves neon colours.'])
    expect(turns).toEqual([
      { role: 'user', text: 'I make shirts for nurses' },
      { role: 'assistant', text: 'Love it!' },
      { role: 'user', text: 'Can this be a shirt?' },
    ])
    expect(audio).toBeUndefined()
    expect(image).toMatchObject({ mimeType: 'image/jpeg', widthPx: 1200, heightPx: 900, transparent: true })
    expect(image.data.length).toBeGreaterThan(100)

    // Saved: her turn with the picture, the reply carrying the design it offers to make, one new memory.
    const chat = writes.find(w => w.table === 'vendor_store_assistant_messages')!.payload
    expect(chat.map((r: any) => [r.role, r.text])).toEqual([['user', 'Can this be a shirt?'], ['assistant', brainAnswer.reply]])
    expect(chat[0].image_url).toMatch(/^https:\/\/.+\/products\/vendor-stores\/crystal\/assistant\/[\w-]{12}\.png$/)
    expect(chat[1].image_url).toBe(chat[0].image_url)
    expect(chat[1].created_at > chat[0].created_at).toBe(true)
    const memory = writes.filter(w => w.table === 'vendor_store_assistant_memory')
    expect(memory).toHaveLength(1)
    expect(memory[0].payload).toEqual([{ storefront_id: STORE_ID, fact: 'Crystal is making a dragon line for October.' }])

    expect(body.makeProduct).toBe(true)
    expect(body.imageUrl).toBe(chat[0].image_url)
    expect(body.messages.map((m: any) => [m.role, m.makeProduct])).toEqual([['user', false], ['assistant', true]])
  })

  it('says a solid picture is solid, and offers nothing when the reply does not', async () => {
    asOwner()
    const form = new FormData()
    form.append('image', new Blob([await png(640, 480, 1)], { type: 'image/png' }), 'photo.png')
    const res = await turn(form)
    expect(res.status).toBe(200)
    expect(brainCalls[0][3]).toMatchObject({ widthPx: 640, heightPx: 480, transparent: false })
    const chat = writes.find(w => w.table === 'vendor_store_assistant_messages')!.payload
    expect(chat[0].text).toBe('')
    expect(chat[0].image_url).toBeTruthy()
    expect(chat[1].image_url).toBeNull()
  })

  it('refuses a file that is not a picture, and an empty turn', async () => {
    asOwner()
    const bad = new FormData()
    bad.append('image', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'design.pdf')
    const res = await turn(bad)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/PNG, JPG or WEBP/)
    expect((await turn(new FormData())).status).toBe(400)
    expect(brainCalls).toHaveLength(0)
  })

  it('is hers alone: another seller cannot read or write her assistant', async () => {
    role = 'vendor'
    tables.vendor_storefronts = [store({ owner_user_id: 'someone-else' })]
    const form = new FormData()
    form.append('text', 'hi')
    expect((await turn(form)).status).toBe(403)
    expect((await fetch(`${base}/api/vendor-store/manage/crystal/assistant/history`)).status).toBe(403)
  })

  it('hands the panel her chat oldest first, with Make it a product on the replies that offered it', async () => {
    asOwner()
    tables.vendor_store_assistant_messages = [
      { id: 'b', storefront_id: STORE_ID, role: 'assistant', text: 'Great design!', image_url: 'https://x/d.png', created_at: '2026-10-26T10:00:01Z' },
      { id: 'a', storefront_id: STORE_ID, role: 'user', text: '', image_url: 'https://x/d.png', created_at: '2026-10-26T10:00:00Z' },
    ]
    const res = await fetch(`${base}/api/vendor-store/manage/crystal/assistant/history`)
    expect(res.status).toBe(200)
    expect((await res.json()).messages).toEqual([
      { id: 'a', role: 'user', text: '', imageUrl: 'https://x/d.png', makeProduct: false, createdAt: '2026-10-26T10:00:00Z' },
      { id: 'b', role: 'assistant', text: 'Great design!', imageUrl: 'https://x/d.png', makeProduct: true, createdAt: '2026-10-26T10:00:01Z' },
    ])
  })
})

describe('store assistant: Make it a product reads back the saved design', () => {
  it('hands her design back as a data URL, and never another store’s', async () => {
    role = 'vendor'
    tables.vendor_storefronts = [store({ status: 'draft', owner_user_id: 'crystal-user' })]
    tables.vendor_store_assistant_messages = [
      { id: 'reply-1', storefront_id: STORE_ID, role: 'assistant', text: 'Great!', image_url: 'https://api.imaginethisprinted.com/api/media/products/vendor-stores/crystal/assistant/abc123def456.png' },
      { id: 'theirs', storefront_id: 'store-2', role: 'assistant', text: 'Nice', image_url: 'https://api.imaginethisprinted.com/api/media/products/vendor-stores/other/assistant/zzz.png' },
      { id: 'no-picture', storefront_id: STORE_ID, role: 'assistant', text: 'Hi', image_url: null },
    ]
    const get = (id: string) => fetch(`${base}/api/vendor-store/manage/crystal/assistant/design/${id}`)
    const res = await get('reply-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ image: 'data:image/png;base64,iVBORw0KGgo=', filename: 'design.png' })
    expect((await get('theirs')).status).toBe(404)
    expect((await get('no-picture')).status).toBe(404)
  })
})

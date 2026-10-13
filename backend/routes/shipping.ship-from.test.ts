import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Origin phone on every Shippo request (task 710472ca).
//
// The ship-from address used for checkout rate quotes AND admin label
// purchases carried the fake phone (770) 000-0000. It now comes from
// BUSINESS_PHONE. What is under test is the request body each route actually
// sends Shippo, captured off a stubbed fetch. Handlers are pulled straight off
// the Express routers' stacks, as orders.notify.test.ts does.
// ---------------------------------------------------------------------------

const REAL_PHONE = '(401) 323-9983'

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.BUSINESS_PHONE = `  ${REAL_PHONE} `
process.env.SHIPPO_API_TOKEN = 'shippo_test_ship_from'

const orderRow = {
  id: 'ord-1',
  order_number: 'ITP-2001',
  status: 'processing',
  customer_email: 'buyer@example.com',
  customer_name: 'Dana Reyes',
  shipping_address: { address: '1 Main St', city: 'Atlanta', state: 'GA', zipCode: '30303' },
  metadata: {},
}

function makeQuery() {
  const result = (data: any) => ({ data, error: null })
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    update: () => chain,
    insert: async () => result(null),
    single: async () => result({ ...orderRow }),
    maybeSingle: async () => result({ ...orderRow }),
    then: (ok: any, err?: any) => Promise.resolve(result([])).then(ok, err),
  }
  return chain
}

vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => makeQuery() } }))
vi.mock('../middleware/supabaseAuth.js', () => ({
  requireAuth: (_r: any, _s: any, n: any) => n(),
  requireRole: () => (_r: any, _s: any, n: any) => n(),
}))
vi.mock('../utils/email.js', () => ({
  sendOrderShippedEmail: vi.fn(async () => true),
  sendOrderDeliveredEmail: vi.fn(async () => true),
}))

const sent: Array<{ url: string; body: any }> = []
const fetchMock = vi.fn(async (url: any, init?: any) => {
  const body = init?.body ? JSON.parse(init.body) : null
  sent.push({ url: String(url), body })
  if (String(url).endsWith('/shipments/')) {
    return new Response(JSON.stringify({
      address_from: body.address_from,
      rates: [{
        object_id: 'rate-1', provider: 'USPS', amount: '5.58', currency: 'USD', estimated_days: 3,
        servicelevel: { token: 'usps_ground_advantage', name: 'Ground Advantage' },
      }],
    }), { status: 201 })
  }
  if (String(url).endsWith('/transactions/')) {
    return new Response(JSON.stringify({
      object_id: 'tx-1', status: 'SUCCESS', label_url: 'https://example.test/label.pdf',
      tracking_number: '9400100000000000000000', tracking_url_provider: 'https://example.test/track',
    }), { status: 201 })
  }
  throw new Error(`unexpected fetch ${url}`)
})
const realFetch = globalThis.fetch
globalThis.fetch = fetchMock as any
afterAll(() => { globalThis.fetch = realFetch })

const shippingRouter = (await import('./shipping.js')).default
const { WAREHOUSE_ADDRESS_FROM } = await import('./shipping.js')
const ordersRouter = (await import('./orders.js')).default

function handler(router: any, path: string, method: 'post') {
  const layer = router.stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method])
  if (!layer) throw new Error(`No ${method.toUpperCase()} ${path} route`)
  const stack = layer.route.stack
  return stack[stack.length - 1].handle as (req: any, res: any) => Promise<any>
}

function makeRes() {
  const res: any = { statusCode: 200 }
  res.status = (c: number) => { res.statusCode = c; return res }
  res.json = (b: any) => { res.body = b; return res }
  return res
}

beforeEach(() => { sent.length = 0 })

describe('ship-from origin phone', () => {
  it('reads BUSINESS_PHONE (trimmed) into the shared ship-from address', () => {
    expect(WAREHOUSE_ADDRESS_FROM.phone).toBe(REAL_PHONE)
  })

  it('sends the real phone as the origin on a checkout rate quote', async () => {
    const res = makeRes()
    await handler(shippingRouter, '/rates', 'post')({
      body: { addressTo: { street1: '1 Main St', city: 'Atlanta', state: 'GA', zip: '30303' }, items: [{ weight: 0.5, quantity: 1 }] },
    }, res)

    expect(res.statusCode).toBe(200)
    const shipment = sent.find(s => s.url.endsWith('/shipments/'))
    expect(shipment?.body.address_from.phone).toBe(REAL_PHONE)
    expect(shipment?.body.address_from.street1).toBe('640 Goodyear Ave')
  })

  it('sends the real phone as the origin when buying a label', async () => {
    const res = makeRes()
    await handler(ordersRouter, '/:orderId/shipping-label', 'post')({
      params: { orderId: 'ord-1' }, body: {}, user: { sub: 'admin-1' },
    }, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.mock).toBe(false)
    const shipment = sent.find(s => s.url.endsWith('/shipments/'))
    expect(shipment?.body.address_from.phone).toBe(REAL_PHONE)
    // The label is bought off that shipment's rate, so its origin is that address.
    expect(sent.find(s => s.url.endsWith('/transactions/'))?.body.rate).toBe('rate-1')
  })

  it('leaves no fake (770) 000-0000 phone anywhere in the shipping label path', () => {
    for (const rel of ['./shipping.ts', './orders.ts', '../../src/config/ship-from.ts']) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
      expect(src, rel).not.toContain('000-0000')
    }
  })
})

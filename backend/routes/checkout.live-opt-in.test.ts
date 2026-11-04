import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'

// ---------------------------------------------------------------------------
// The checkout box reaches the order (Watchtower task 528180f9).
//
// /api/print-bridge/queue reads orders.metadata.live_opt_in, so what matters is
// that all three ways an order gets written leave it right: a new card order, an
// update to one (the customer ticking the box after the card form opened), and a
// full ITC payment. Runs the REAL routers; Supabase, Stripe and the price engine
// are fake.
// ---------------------------------------------------------------------------

const JWT_SECRET = 'test-only-secret-do-not-use-in-prod-0123456789'
const SUPABASE_URL = 'https://test-project.supabase.co'
process.env.SUPABASE_URL = SUPABASE_URL
process.env.SUPABASE_JWT_SECRET = JWT_SECRET
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.STRIPE_SECRET_KEY ||= 'sk_test_live_opt_in'

const USER = 'aaaaaaaa-0000-4000-8000-000000000001'
const ORDER = '11111111-1111-4111-8111-111111111111'

let order: Record<string, any> | null
let wallet: { itc_balance: number }

function query(table: string) {
  let pending: Record<string, any> | null = null
  const result = () => {
    if (table === 'user_wallets') return { data: wallet, error: null }
    if (table !== 'orders') return { data: table === 'order_items' ? [] : null, error: null }
    if (pending) order = { ...(order ?? { id: ORDER }), ...pending }
    return { data: order, error: null }
  }
  const b: any = {
    select: () => b,
    eq: () => b,
    is: () => b,
    in: () => b,
    order: () => b,
    limit: () => b,
    delete: () => b,
    upsert: () => b,
    insert: (row: Record<string, any>) => {
      pending = row
      return b
    },
    update: (row: Record<string, any>) => {
      pending = row
      return b
    },
    single: async () => result(),
    maybeSingle: async () => result(),
    then: (resolve: any) => resolve(result()),
  }
  return b
}

vi.mock('../lib/supabase.js', () => ({ supabase: { from: (t: string) => query(t), rpc: async () => ({ data: null, error: null }) } }))

vi.mock('stripe', () => ({
  default: class {
    paymentIntents = {
      create: async () => ({ id: 'pi_test', client_secret: 'pi_test_secret' }),
      update: async () => ({ id: 'pi_test', client_secret: 'pi_test_secret' }),
    }
  },
}))

vi.mock('../services/order-pricing.js', async importOriginal => ({
  ...(await importOriginal<any>()),
  calculateOrderPricing: async () => ({
    errors: [],
    totalCents: 6000,
    productSubtotalCents: 5000,
    discountCents: 0,
    shippingCents: 500,
    rushFeeCents: 0,
    taxCents: 500,
    taxRate: 0.1,
    freeShippingApplied: false,
  }),
}))

let server: ReturnType<ReturnType<typeof express>['listen']>
let base = ''
let token = ''

beforeAll(async () => {
  const [{ default: stripeRouter }, { default: walletRouter }, { jose }] = await Promise.all([
    import('./stripe.js'),
    import('./wallet.js'),
    import('../lib/jose.js'),
  ])
  const { SignJWT } = await jose()
  token = await new SignJWT({ email: 'owner@example.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(USER)
    .setIssuer(`https://${new URL(SUPABASE_URL).host}/auth/v1`)
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET))

  const app = express()
  app.use(express.json())
  app.use('/api/stripe', stripeRouter)
  app.use('/api/wallet', walletRouter)
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
}, 60_000)

afterAll(() => new Promise(resolve => server.close(resolve)))

beforeEach(() => {
  order = null
  wallet = { itc_balance: 100_000 }
})

const items = [{ quantity: 1, product: { id: '3d-print-abc', name: 'Custom figurine', price: 50, images: [] } }]
const shipping = { firstName: 'A', lastName: 'Customer', email: 'owner@example.com', address: '1 Main St', city: 'Rome', state: 'GA', zipCode: '30161', country: 'US' }

const post = (path: string, body: Record<string, any>) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

const card = (extra: Record<string, any>) =>
  post('/stripe/checkout-payment-intent', { amount: 6000, currency: 'usd', items, shipping, shippingCost: 5, ...extra })

const itc = (extra: Record<string, any>) =>
  post('/wallet/process-full-itc-payment', { items, itcAmount: 5000, usdEquivalent: '50.00', shipping, ...extra })

describe('a new card order', () => {
  it.each([true, false])('keeps what the box said: %s', async value => {
    expect((await card({ liveOptIn: value })).status).toBe(200)
    expect(order?.metadata.live_opt_in).toBe(value)
  })

  it('writes nothing from an older page that does not send it', async () => {
    expect((await card({})).status).toBe(200)
    expect(order?.metadata).not.toHaveProperty('live_opt_in')
  })
})

describe('an update to a card order', () => {
  const again = (extra: Record<string, any>) => card({ existingPaymentIntentId: 'pi_test', existingOrderId: ORDER, ...extra })

  beforeEach(() => {
    order = { id: ORDER, user_id: USER, metadata: { live_opt_in: true, print: { status: 'received' } } }
  })

  it('takes the box being unticked', async () => {
    expect((await again({ liveOptIn: false })).status).toBe(200)
    expect(order?.metadata.live_opt_in).toBe(false)
  })

  it('takes the box being ticked after the card form opened', async () => {
    order!.metadata.live_opt_in = false
    expect((await again({ liveOptIn: true })).status).toBe(200)
    expect(order?.metadata.live_opt_in).toBe(true)
  })

  it('keeps the answer through an update from an older page, and the rest of the metadata', async () => {
    expect((await again({})).status).toBe(200)
    expect(order?.metadata).toMatchObject({ live_opt_in: true, print: { status: 'received' } })
  })
})

describe('a full ITC order', () => {
  it.each([true, false])('keeps what the box said: %s', async value => {
    expect((await itc({ liveOptIn: value })).status).toBe(200)
    expect(order?.metadata.live_opt_in).toBe(value)
  })
})

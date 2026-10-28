import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'

// ---------------------------------------------------------------------------
// Task 14ce738b: POST /api/storefront/orders/:externalRef/cancel runs behind the
// REAL storefront key check, the same one POST /orders uses: no key or a wrong
// key never reaches the cancel, and the key decides which vendor is asking.
// The cancel itself is services/vendor-prepaid-orders.test.ts; here it is a
// recorder that answers like the real one.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.STRIPE_SECRET_KEY ||= 'sk_test_fake'

const ZENTRESS_KEY = 'zentress-storefront-key-0123456789'
const DARRELL_KEY = 'darrell-storefront-key-0123456789'

vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => { throw new Error('the route must not read the DB itself') } } }))
vi.mock('../services/google-cloud-storage.js', () => ({}))
vi.mock('stripe', () => ({ default: class {} }))

const cancelCalls: any[] = []
let cancelAnswer: () => Promise<any> = async () => ({ orderId: 'o-1', orderNumber: 'ITP-1', status: 'cancelled', alreadyCancelled: false })
vi.mock('../services/vendor-prepaid-orders.js', async (importOriginal) => {
  const real: any = await importOriginal()
  return {
    ...real,
    cancelPrepaidVendorOrder: async (input: any) => { cancelCalls.push(input); return cancelAnswer() },
  }
})

const { PrepaidOrderError } = await import('../services/vendor-prepaid-orders.js')
const { resetStorefrontKeyCache } = await import('../middleware/requireStorefrontSecret.js')
const { default: storefrontRouter } = await import('./storefront.js')

let base = ''
let server: ReturnType<ReturnType<typeof express>['listen']>
beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/storefront', storefrontRouter)
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()) })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server?.close() })

beforeEach(() => {
  delete process.env.STOREFRONT_API_KEY
  process.env.STOREFRONT_CREATOR_KEYS = JSON.stringify({
    zentress: { key: ZENTRESS_KEY, creatorUserId: 'zentress-user' },
    darrell: { key: DARRELL_KEY, creatorUserId: 'darrell-user' },
  })
  resetStorefrontKeyCache()
  cancelCalls.length = 0
  cancelAnswer = async () => ({ orderId: 'o-1', orderNumber: 'ITP-1', status: 'cancelled', alreadyCancelled: false })
})

const cancel = async (ref: string, auth?: string, body: unknown = { reason: 'refunded' }) => {
  const r = await fetch(`${base}/api/storefront/orders/${encodeURIComponent(ref)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body),
  })
  return { status: r.status, body: (await r.json()) as any }
}

describe('POST /api/storefront/orders/:externalRef/cancel', () => {
  it('turns away a call with no key, a wrong key, or the key not sent as Bearer', async () => {
    expect((await cancel('zt-1')).status).toBe(401)
    expect((await cancel('zt-1', 'Bearer not-the-key-at-all-000000')).status).toBe(401)
    expect((await cancel('zt-1', ZENTRESS_KEY)).status).toBe(401)
    expect(cancelCalls).toHaveLength(0)
  })

  it('the storefront key decides the vendor; the reference comes from the path', async () => {
    const r = await cancel('6b0d7c1e-0000-4000-8000-000000000001', `Bearer ${ZENTRESS_KEY}`, { reason: 'refunded', refund: { chargeId: 'ch_1' } })
    expect(r).toEqual({ status: 200, body: { orderId: 'o-1', orderNumber: 'ITP-1', status: 'cancelled', alreadyCancelled: false } })
    expect(cancelCalls[0]).toEqual({ vendor: 'zentress', externalRef: '6b0d7c1e-0000-4000-8000-000000000001', body: { reason: 'refunded', refund: { chargeId: 'ch_1' } } })

    await cancel('zt-1', `Bearer ${DARRELL_KEY}`)
    expect(cancelCalls[1].vendor).toBe('darrell')
  })

  it('a shipped order comes back 409 with the reason and shipped: true', async () => {
    cancelAnswer = async () => {
      throw new PrepaidOrderError(409, 'Order ITP-1 has already shipped and can no longer be cancelled', { orderNumber: 'ITP-1', status: 'shipped', shipped: true })
    }
    const r = await cancel('zt-1', `Bearer ${ZENTRESS_KEY}`)
    expect(r).toEqual({
      status: 409,
      body: { error: 'Order ITP-1 has already shipped and can no longer be cancelled', orderNumber: 'ITP-1', status: 'shipped', shipped: true },
    })
  })

  it('an unexpected failure is a plain 500, never a stack', async () => {
    cancelAnswer = async () => { throw new Error('db down: secret detail') }
    const r = await cancel('zt-1', `Bearer ${ZENTRESS_KEY}`)
    expect(r).toEqual({ status: 500, body: { error: 'Failed to cancel order' } })
  })
})

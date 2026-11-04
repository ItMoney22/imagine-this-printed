import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'

// ---------------------------------------------------------------------------
// GET /api/orders/:orderId/live: the live printer view is the owner's alone
// (Watchtower task 528180f9).
//
// Runs the REAL orders router and the REAL requireAuth on an ephemeral port, with
// real signed tokens, so a change to either one is caught here. Only Supabase is
// fake.
// ---------------------------------------------------------------------------

const SUPABASE_URL = 'https://test-project.supabase.co'
const JWT_SECRET = 'test-only-secret-do-not-use-in-prod-0123456789'
process.env.SUPABASE_URL = SUPABASE_URL
process.env.SUPABASE_JWT_SECRET = JWT_SECRET
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001'
const STRANGER = 'aaaaaaaa-0000-4000-8000-000000000002'
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000003'
const ORDER = '11111111-1111-4111-8111-111111111111'
const GUEST_ORDER = '22222222-2222-4222-8222-222222222222'
const NO_SUCH_ORDER = '33333333-3333-4333-8333-333333333333'

let tables: Record<string, any[]> = {}

function builder(table: string) {
  const filters: ((r: any) => boolean)[] = []
  const rows = () => (tables[table] ?? []).filter(r => filters.every(f => f(r)))
  const b: any = {
    select: () => b,
    order: () => b,
    eq: (c: string, v: any) => {
      filters.push(r => r[c] === v)
      return b
    },
    single: async () => ({ data: rows()[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: any) => resolve({ data: rows(), error: null }),
  }
  return b
}

vi.mock('../lib/supabase.js', () => ({ supabase: { from: (t: string) => builder(t) } }))

let server: ReturnType<ReturnType<typeof express>['listen']>
let base = ''
let sign: (sub: string, opts?: { secret?: string; expired?: boolean }) => Promise<string>

beforeAll(async () => {
  const { default: router } = await import('./orders.js')
  const { jose } = await import('../lib/jose.js')
  const { SignJWT } = await jose()
  sign = (sub, { secret = JWT_SECRET, expired = false } = {}) =>
    new SignJWT({ email: 'someone@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuer(`https://${new URL(SUPABASE_URL).host}/auth/v1`)
      .setExpirationTime(expired ? '-1h' : '1h')
      .sign(new TextEncoder().encode(secret))
  const app = express()
  app.use('/api/orders', router)
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/orders`
}, 30_000)

afterAll(() => new Promise(resolve => server.close(resolve)))

const liveRow = (order_id: string, live: Record<string, any> = {}) => ({
  order_id,
  line_item_id: '',
  updated_at: new Date().toISOString(),
  live: {
    state: 'printing',
    printerName: 'Printer 2',
    headline: 'Your Mini-Me is on Printer 2: layer 412/830, 2h10m left',
    layer: 412,
    totalLayers: 830,
    progress: 49,
    minutesLeftLabel: '2h10m left',
    frameUrl: 'https://frames.example/a.jpg',
    frameAt: new Date().toISOString(),
    frameStale: false,
    timelapseUrl: null,
    liveOptIn: false,
    ...live,
  },
})

beforeEach(() => {
  tables = {
    orders: [
      { id: ORDER, user_id: OWNER },
      { id: GUEST_ORDER, user_id: null },
    ],
    user_profiles: [{ id: ADMIN, role: 'admin' }],
    order_print_live: [liveRow(ORDER), liveRow(GUEST_ORDER)],
  }
})

const read = (orderId: string, token?: string) =>
  fetch(`${base}/${orderId}/live`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })

describe('GET /api/orders/:orderId/live', () => {
  it('gives the signed-in owner the headline and frame', async () => {
    const res = await read(ORDER, await sign(OWNER))
    expect(res.status).toBe(200)
    const { lines } = await res.json()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      lineItemId: '',
      state: 'printing',
      headline: 'Your Mini-Me is on Printer 2: layer 412/830, 2h10m left',
      frameUrl: 'https://frames.example/a.jpg',
      isLive: true,
    })
  })

  it('is told when the frame is stale', async () => {
    tables.order_print_live = [liveRow(ORDER, { frameStale: true })]
    const { lines } = await (await read(ORDER, await sign(OWNER))).json()
    expect(lines[0]).toMatchObject({ isLive: false, frameUrl: 'https://frames.example/a.jpg' })
  })

  it('never lets a shared cache keep the signed links', async () => {
    const res = await read(ORDER, await sign(OWNER))
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  it('answers an owner whose print has not started with no lines', async () => {
    tables.order_print_live = []
    const res = await read(ORDER, await sign(OWNER))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ lines: [] })
  })

  it('refuses an anonymous visitor', async () => {
    const res = await read(ORDER)
    expect(res.status).toBe(401)
    expect(await res.text()).not.toContain('frames.example')
  })

  it.each([
    ['signed with the wrong secret', { secret: 'x'.repeat(46) }],
    ['expired', { expired: true }],
  ])('refuses a token that is %s', async (_name, opts) => {
    expect((await read(ORDER, await sign(OWNER, opts))).status).toBe(401)
  })

  it('hides the order from a different signed-in customer', async () => {
    const res = await read(ORDER, await sign(STRANGER))
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('frames.example')
  })

  it('gives an admin no way in either: this view is the owner\'s alone', async () => {
    expect((await read(ORDER, await sign(ADMIN))).status).toBe(404)
  })

  it('shows a guest order to no one, since it has no owner to sign in', async () => {
    expect((await read(GUEST_ORDER, await sign(OWNER))).status).toBe(404)
  })

  it('answers the same for a stranger\'s order and one that does not exist', async () => {
    const token = await sign(STRANGER)
    const theirs = await read(ORDER, token)
    const missing = await read(NO_SUCH_ORDER, token)
    expect(missing.status).toBe(theirs.status)
    expect(await missing.text()).toBe(await theirs.text())
  })

  it('answers 404 for an id that is not an order id', async () => {
    expect((await read('not-a-uuid', await sign(OWNER))).status).toBe(404)
  })
})

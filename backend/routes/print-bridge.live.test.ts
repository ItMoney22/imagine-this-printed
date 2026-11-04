import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'

// ---------------------------------------------------------------------------
// Live printer cam, ITP side (Watchtower task 528180f9).
//
// Runs the REAL print-bridge router on an ephemeral port. The fake Supabase
// enforces what the database would: the (order_id, line_item_id) key, so a second
// push overwrites, and the orders foreign key, so an unknown order is refused.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.PRINT_BRIDGE_TOKEN = 'bridge-test-token'

const ORDER = '11111111-1111-4111-8111-111111111111'
const UNKNOWN_ORDER = '22222222-2222-4222-8222-222222222222'
const MODEL = '33333333-3333-4333-8333-333333333333'
const TOY = '44444444-4444-4444-8444-444444444444'

let tables: Record<string, any[]> = {}

function builder(table: string) {
  const filters: ((r: any) => boolean)[] = []
  const run = () => ({ data: (tables[table] ?? []).filter(r => filters.every(f => f(r))), error: null })
  const b: any = {
    select: () => b,
    order: () => b,
    limit: () => b,
    gt: () => b,
    gte: () => b,
    lte: () => b,
    eq: (c: string, v: any) => {
      filters.push(r => r[c] === v)
      return b
    },
    in: (c: string, vals: any[]) => {
      filters.push(r => vals.includes(r[c]))
      return b
    },
    single: async () => ({ data: run().data[0] ?? null, error: null }),
    then: (resolve: any) => resolve(run()),
    upsert: async (row: any) => {
      if (!(tables.orders ?? []).some(o => o.id === row.order_id)) {
        return { error: { code: '23503', message: 'violates foreign key constraint' } }
      }
      const rows = tables[table] ?? (tables[table] = [])
      const at = rows.findIndex(r => r.order_id === row.order_id && r.line_item_id === row.line_item_id)
      if (at >= 0) rows[at] = row
      else rows.push(row)
      return { error: null }
    },
  }
  return b
}

vi.mock('../lib/supabase.js', () => ({ supabase: { from: (t: string) => builder(t) } }))
vi.mock('../services/model-files.js', () => ({
  signOwnModelFile: async () => 'https://signed.example/model.glb',
  meshLinkFor: async () => 'https://signed.example/toy.glb',
}))

let server: ReturnType<ReturnType<typeof express>['listen']>
let base = ''

beforeAll(async () => {
  const { default: router } = await import('./print-bridge.js')
  const app = express()
  app.use(express.json())
  app.use('/api/print-bridge', router)
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/print-bridge`
}, 30_000)

afterAll(() => new Promise(resolve => server.close(resolve)))

beforeEach(() => {
  tables = { orders: [{ id: ORDER, metadata: {} }], order_print_live: [] }
})

const body = (over: Record<string, any> = {}) => ({
  itpOrderId: ORDER,
  lineItemId: TOY,
  live: {
    state: 'printing',
    printerName: 'Printer 2',
    headline: 'Your Mini-Me is on Printer 2: layer 412/830, 2h10m left',
    layer: 412,
    totalLayers: 830,
    progress: 49,
    minutesLeftLabel: '2h10m left',
    frameUrl: 'https://frames.example/a.jpg',
    frameAt: '2026-11-04T14:59:40.000Z',
    frameStale: false,
    timelapseUrl: null,
    liveOptIn: false,
  },
  sentAt: '2026-11-04T14:59:50.000Z',
  ...over,
})

const post = (payload: unknown, token: string | null = 'bridge-test-token') =>
  fetch(`${base}/live`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(payload),
  })

describe('POST /api/print-bridge/live', () => {
  it('stores the push against its order line', async () => {
    const res = await post(body())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(tables.order_print_live).toHaveLength(1)
    expect(tables.order_print_live[0]).toMatchObject({
      order_id: ORDER,
      line_item_id: TOY,
      sent_at: '2026-11-04T14:59:50.000Z',
      live: body().live,
    })
  })

  it('overwrites the last view of that line instead of adding one', async () => {
    await post(body())
    await post(body({ live: { ...body().live, layer: 500, headline: 'Your Mini-Me is on Printer 2: layer 500/830' } }))
    expect(tables.order_print_live).toHaveLength(1)
    expect(tables.order_print_live[0].live).toMatchObject({ layer: 500, headline: 'Your Mini-Me is on Printer 2: layer 500/830' })
  })

  it('keeps two lines of one order apart', async () => {
    await post(body())
    await post(body({ lineItemId: `${TOY}:emma` }))
    expect(tables.order_print_live.map(r => r.line_item_id).sort()).toEqual([TOY, `${TOY}:emma`])
  })

  it('takes the push of a custom print, which has no lineItemId, and overwrites it too', async () => {
    const { lineItemId: _gone, ...noLine } = body()
    expect((await post(noLine)).status).toBe(200)
    expect((await post(noLine)).status).toBe(200)
    expect(tables.order_print_live).toHaveLength(1)
    expect(tables.order_print_live[0].line_item_id).toBe('')
  })

  it.each([
    ['missing', null],
    ['wrong', 'not-the-token'],
  ])('refuses a %s token and stores nothing', async (_name, token) => {
    const res = await post(body(), token)
    expect(res.status).toBe(401)
    expect(tables.order_print_live).toHaveLength(0)
  })

  it('answers 404 for an order ITP does not have', async () => {
    const res = await post(body({ itpOrderId: UNKNOWN_ORDER }))
    expect(res.status).toBe(404)
    expect(tables.order_print_live).toHaveLength(0)
  })

  it('answers 400 for a body that is not a live view', async () => {
    expect((await post({ itpOrderId: ORDER })).status).toBe(400)
    expect((await post(body({ itpOrderId: 'not-a-uuid' }))).status).toBe(400)
  })
})

describe('GET /api/print-bridge/queue carries liveOptIn', () => {
  const queue = async () => {
    const res = await fetch(`${base}/queue`, { headers: { Authorization: 'Bearer bridge-test-token' } })
    expect(res.status).toBe(200)
    return (await res.json()).orders as any[]
  }

  const paidOrder = (metadata: Record<string, any>) => ({
    id: ORDER,
    payment_status: 'paid',
    paid_at: '2026-11-04T12:00:00.000Z',
    created_at: '2026-11-04T11:59:00.000Z',
    total: 90,
    customer_email: 'a@example.com',
    customer_name: 'A Customer',
    metadata,
  })

  const seed = (metadata: Record<string, any>) => {
    tables.orders = [paidOrder(metadata)]
    tables.order_items = [
      { order_id: ORDER, product_id: null, product_name: 'Custom figurine', quantity: 1, unit_price: 60, subtotal: 60, metadata: { client_product_id: `3d-print-${MODEL}` } },
      { order_id: ORDER, product_id: TOY, product_name: 'Shadow Raptor', quantity: 1, unit_price: 30, subtotal: 30, metadata: {} },
    ]
    tables.user_3d_models = [{ id: MODEL, prompt: 'me', style: 'cartoon', metadata: {} }]
    tables.products = [{ id: TOY, name: 'Shadow Raptor', category: '3d-prints', images: [], metadata: { print3d: { enabled: true } } }]
  }

  it('is true on every print line when the customer ticked the box', async () => {
    seed({ live_opt_in: true })
    const lines = await queue()
    expect(lines.map(l => l.line).sort()).toEqual(['custom-mini', 'custom-toy'])
    expect(lines.every(l => l.liveOptIn === true)).toBe(true)
  })

  it.each([
    ['left the box empty', { live_opt_in: false }],
    ['paid before the box existed', {}],
  ])('is false, and present, when the customer %s', async (_name, metadata) => {
    seed(metadata)
    const lines = await queue()
    expect(lines).toHaveLength(2)
    expect(lines.every(l => l.liveOptIn === false)).toBe(true)
  })
})

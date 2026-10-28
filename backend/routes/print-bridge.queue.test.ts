import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'

// ---------------------------------------------------------------------------
// Watchtower task b17dc9f6 (2026-10-28): an order paid after a newer order was
// paid was skipped forever.
//
// Checkout writes the order row as 'pending' when the customer opens the
// payment page; the Stripe webhook flips it to 'paid' later. GET /queue used to
// walk created_at, so: A opened 10:00 (customer still paying), B opened 10:01
// and paid 10:02, a pull at 10:03 moved the cursor to 10:01, A paid at 10:04,
// and no later pull ever looked behind 10:01 again. A paid name gift that never
// reaches review.
//
// These run the REAL print-bridge router on an ephemeral port, with a fake
// Supabase that applies the route's own filters, order and limit to rows.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.PRINT_BRIDGE_TOKEN = 'bridge-test-token'

const TOY = 'aaaaaaaa-0000-4000-8000-0000000000aa'

let tables: Record<string, any[]> = {}

const ms = (v: any) => (v == null ? null : Date.parse(v))

// PostgREST applies every filter, then the order, then the limit, whatever
// order the builder calls came in (the route adds .gt() after .limit()).
function builder(table: string) {
  const filters: ((r: any) => boolean)[] = []
  let sortCol: string | null = null
  let ascending = true
  let max = Infinity
  const run = () => {
    let rows = (tables[table] ?? []).filter(r => filters.every(f => f(r)))
    if (sortCol) {
      const col = sortCol
      rows = [...rows].sort((a, b) => {
        const x = ms(a[col])
        const y = ms(b[col])
        if (x === y) return 0
        if (x === null) return 1 // nulls last, as Postgres sorts ascending
        if (y === null) return -1
        return ascending ? x - y : y - x
      })
    }
    return { data: rows.slice(0, max), error: null }
  }
  const b: any = {
    select: () => b,
    eq: (c: string, v: any) => { filters.push(r => r[c] === v); return b },
    gt: (c: string, v: any) => { filters.push(r => r[c] != null && ms(r[c])! > ms(v)!); return b },
    gte: (c: string, v: any) => { filters.push(r => r[c] != null && ms(r[c])! >= ms(v)!); return b },
    lt: (c: string, v: any) => { filters.push(r => r[c] != null && ms(r[c])! < ms(v)!); return b },
    lte: (c: string, v: any) => { filters.push(r => r[c] != null && ms(r[c])! <= ms(v)!); return b },
    in: (c: string, vals: any[]) => { filters.push(r => vals.includes(r[c])); return b },
    order: (c: string, o?: { ascending?: boolean }) => { sortCol = c; ascending = o?.ascending !== false; return b },
    limit: (n: number) => { max = n; return b },
    single: async () => { const { data } = run(); return { data: data[0] ?? null, error: data[0] ? null : { message: 'not found' } } },
    then: (ok: any, err: any) => Promise.resolve(run()).then(ok, err),
  }
  return b
}

vi.mock('../lib/supabase.js', () => ({ supabase: { from: (t: string) => builder(t) } }))

let base = ''
let server: any

beforeAll(async () => {
  const { default: router } = await import('./print-bridge.js')
  const app = express()
  app.use('/api/print-bridge', router)
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()) })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  vi.useRealTimers()
  server?.close()
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  tables = {
    orders: [],
    order_items: [],
    products: [{ id: TOY, name: 'Name Ornament', category: '3d-prints', images: [], metadata: {} }],
  }
})

/** Checkout opens: the order row exists, still unpaid. */
function openCheckout(id: string, at: string) {
  tables.orders.push({
    id, order_number: `ORD-${id}`, customer_email: `${id}@example.com`, customer_name: id, total: 25,
    created_at: at, payment_status: 'pending', paid_at: null, metadata: {},
  })
  tables.order_items.push({ order_id: id, product_id: TOY, product_name: 'Name Ornament', quantity: 1, unit_price: 25, subtotal: 25, metadata: {} })
}

/** The webhook marks it paid (the DB trigger stamps paid_at in that same write). */
function pay(id: string, at: string) {
  const o = tables.orders.find(r => r.id === id)!
  o.payment_status = 'paid'
  o.paid_at = at
}

async function pull(at: string, since: string): Promise<{ ids: string[]; cursor: string }> {
  vi.setSystemTime(new Date(at))
  const res = await fetch(`${base}/api/print-bridge/queue?since=${encodeURIComponent(since)}&limit=50`, {
    headers: { Authorization: 'Bearer bridge-test-token' },
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { orders: { itpOrderId: string }[]; cursor: string }
  return { ids: body.orders.map(o => o.itpOrderId), cursor: body.cursor }
}

describe('GET /queue cursor — an order paid after a newer one is still pulled', () => {
  it('A opened 10:00, B opened 10:01 + paid 10:02, pull 10:03, A paid 10:04: the next pull brings A', async () => {
    const seed = '2026-12-10T09:00:00.000Z'
    openCheckout('order-a', '2026-12-10T10:00:00.000Z')
    openCheckout('order-b', '2026-12-10T10:01:00.000Z')
    pay('order-b', '2026-12-10T10:02:00.000Z')

    const first = await pull('2026-12-10T10:03:30.000Z', seed)
    expect(first.ids).toEqual(['order-b'])

    pay('order-a', '2026-12-10T10:04:00.000Z')

    const second = await pull('2026-12-10T10:08:30.000Z', first.cursor)
    expect(second.ids).toEqual(['order-a'])

    // And nothing comes twice after that.
    const third = await pull('2026-12-10T10:13:30.000Z', second.cursor)
    expect(third.ids).toEqual([])
    expect(third.cursor).toBe(second.cursor)
  })

  it('walks orders in the order they were paid, not opened', async () => {
    openCheckout('slow', '2026-12-10T10:00:00.000Z')
    openCheckout('fast', '2026-12-10T10:01:00.000Z')
    pay('fast', '2026-12-10T10:02:00.000Z')
    pay('slow', '2026-12-10T10:04:00.000Z')

    const r = await pull('2026-12-10T10:08:30.000Z', '2026-12-10T09:00:00.000Z')
    expect(r.ids).toEqual(['fast', 'slow'])
    expect(r.cursor).toBe('2026-12-10T10:04:00.000Z')
  })

  it('leaves a payment from the last minute for the next pull, so the cursor never passes a stamp still committing', async () => {
    openCheckout('just-paid', '2026-12-10T10:00:00.000Z')
    pay('just-paid', '2026-12-10T10:04:50.000Z')

    const now = await pull('2026-12-10T10:05:00.000Z', '2026-12-10T09:00:00.000Z')
    expect(now.ids).toEqual([])
    expect(now.cursor).toBe('2026-12-10T09:00:00.000Z')

    const later = await pull('2026-12-10T10:10:00.000Z', now.cursor)
    expect(later.ids).toEqual(['just-paid'])
  })

  it('an unpaid checkout is never pulled and never holds the cursor back', async () => {
    openCheckout('abandoned', '2026-12-10T10:00:00.000Z')
    openCheckout('paid', '2026-12-10T10:01:00.000Z')
    pay('paid', '2026-12-10T10:02:00.000Z')

    const r = await pull('2026-12-10T10:08:30.000Z', '2026-12-10T09:00:00.000Z')
    expect(r.ids).toEqual(['paid'])
    expect(r.cursor).toBe('2026-12-10T10:02:00.000Z')
  })

  it("the bridge's seeded cursor still holds back the old orders the backfill stamped paid_at = created_at", async () => {
    // Live 2026-10-28: the newest paid order (delivered 9/19) and the seeded bridge-cursor.json.
    const seeded = '2026-09-12T14:07:56.865Z'
    openCheckout('delivered-sept', seeded)
    pay('delivered-sept', seeded)

    const r = await pull('2026-10-28T22:00:00.000Z', seeded)
    expect(r.ids).toEqual([])
    expect(r.cursor).toBe(seeded)
  })
})

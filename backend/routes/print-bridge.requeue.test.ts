import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'

// ---------------------------------------------------------------------------
// Watchtower task 4ef9db82 (2026-11-01): a held Etsy pet ornament line, fixed
// by the team's re-run (scripts/etsy-pet-order.ts --photo --apply), never
// reached the printer: GET /queue walks orders.paid_at after the factory's
// cursor, and the cursor had passed the order when it was pulled held.
//
// The fix: --apply stamps the order_items row (metadata.print_requeued_at) and
// /queue sends stamped lines on every pull whatever the cursor, until POST
// /status says the order is printing (or the stamp is a week old).
//
// These run the REAL print-bridge router on an ephemeral port, with a fake
// Supabase that applies the route's own filters (JSON paths included), and the
// REAL applyEtsyPetLine writing the stamp.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.PRINT_BRIDGE_TOKEN = 'bridge-test-token'

const PET = 'dff53dc2-0000-4000-8000-0000000000aa'
const SPEC = 'users/pet-ornaments/geo-v1/abc123/print-spec.json'
const CURSOR = '2026-10-31T12:00:00.000Z' // the factory has pulled everything paid before this

let tables: Record<string, any[]> = {}

// 'metadata->>print_requeued_at' reads a jsonb key as text, as PostgREST does.
const col = (r: any, c: string) => {
  const m = /^(\w+)->>(\w+)$/.exec(c)
  if (!m) return r[c]
  const v = r[m[1]]?.[m[2]]
  return v == null ? null : String(v)
}
const ms = (v: any) => (v == null ? null : Date.parse(v))

function builder(table: string) {
  const filters: ((r: any) => boolean)[] = []
  let sortCol: string | null = null
  let max = Infinity
  let patch: any = null
  const run = () => {
    let rows = (tables[table] ?? []).filter(r => filters.every(f => f(r)))
    if (patch) {
      for (const r of rows) Object.assign(r, structuredClone(patch))
      return { data: null, error: null }
    }
    if (sortCol) rows = [...rows].sort((a, b) => ms(col(a, sortCol!))! - ms(col(b, sortCol!))!)
    return { data: structuredClone(rows.slice(0, max)), error: null }
  }
  const b: any = {
    select: () => b,
    update: (p: any) => { patch = p; return b },
    eq: (c: string, v: any) => { filters.push(r => col(r, c) === v); return b },
    gt: (c: string, v: any) => { filters.push(r => col(r, c) != null && ms(col(r, c))! > ms(v)!); return b },
    // Text comparison, as Postgres compares ->> output (the stamps are ISO strings).
    gte: (c: string, v: any) => { filters.push(r => col(r, c) != null && String(col(r, c)) >= String(v)); return b },
    lte: (c: string, v: any) => { filters.push(r => col(r, c) != null && ms(col(r, c))! <= ms(v)!); return b },
    in: (c: string, vals: any[]) => { filters.push(r => vals.includes(col(r, c))); return b },
    order: (c: string) => { sortCol = c; return b },
    limit: (n: number) => { max = n; return b },
    single: async () => { const { data } = run(); return { data: data?.[0] ?? null, error: data?.[0] ? null : { message: 'not found' } } },
    maybeSingle: async () => { const { data } = run(); return { data: data?.[0] ?? null, error: null } },
    then: (ok: any, err: any) => Promise.resolve(run()).then(ok, err),
  }
  return b
}

const fakeDb = { from: (t: string) => builder(t) }
vi.mock('../lib/supabase.js', () => ({ supabase: fakeDb }))
vi.mock('../services/pet-ornament/store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/pet-ornament/store.js')>()),
  signedPetParts: async (specPath: string) => [
    { key: 'plate', slot: 1, filament: 'black', stl: specPath.replace('print-spec.json', 'plate.stl'), stlUrl: 'https://signed.test/plate.stl' },
    { key: 'ink', slot: 4, filament: 'white', stl: specPath.replace('print-spec.json', 'ink.stl'), stlUrl: 'https://signed.test/ink.stl' },
  ],
}))

let base = ''
let server: any
let applyEtsyPetLine: typeof import('../services/pet-ornament/etsy-order.js').applyEtsyPetLine

beforeAll(async () => {
  const { default: router } = await import('./print-bridge.js')
  ;({ applyEtsyPetLine } = await import('../services/pet-ornament/etsy-order.js'))
  const app = express()
  app.use(express.json())
  app.use('/api/print-bridge', router)
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()) })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}, 30_000)

afterAll(() => {
  vi.useRealTimers()
  server?.close()
})

/** What the receipt poller wrote for an Etsy pet sale whose photo could not be used. */
function heldEtsyOrder(id: string, paidAt: string) {
  tables.orders.push({
    id, order_number: `ETSY-${id}`, customer_email: null, customer_name: 'Pat Buyer', total: 24.99,
    created_at: paidAt, paid_at: paidAt, payment_status: 'paid', metadata: { etsy_receipt_id: id, items: [{ id: PET, name: 'Pet ornament', quantity: 1, price: 24.99 }] },
  })
  tables.order_items.push({
    id: `${id}-item`, order_id: id, product_id: PET, product_name: 'Custom pet ornament', quantity: 1, unit_price: 24.99, subtotal: 24.99,
    metadata: {
      etsy_transaction_id: 9001, etsy_listing_id: 4607572810, size: null, color: null,
      personalization: { pet: 'cat', name: 'Sunny', portrait: '' }, print_file_path: null,
      print_file_error: "The buyer's photo is missing from the Etsy order: message them for one, then re-run with --photo",
      print_file_status: 'failed', personalization_flags: null, etsy_pet: { transactionId: 9001 },
    },
  })
}

/** The team's re-run built the line (buildEtsyPetLine's shape). */
const fixedLine = () => ({
  values: { pet: 'dog', name: 'Sunny', portrait: 'a1b2c3d4e5f6a1b2c3d4e5f6' },
  path: SPEC, status: 'ready' as const,
  etsy: { transactionId: 9001, listingId: 4607572810, nameAnswer: 'Sunny', photoUrl: 'operator', photoCandidates: 0, photo: null, pet: null, portraitId: 'a1b2c3d4e5f6a1b2c3d4e5f6' },
})

async function pull(at: string, since = CURSOR): Promise<{ orders: any[]; cursor: string }> {
  vi.setSystemTime(new Date(at))
  const res = await fetch(`${base}/api/print-bridge/queue?since=${encodeURIComponent(since)}&limit=50`, {
    headers: { Authorization: 'Bearer bridge-test-token' },
  })
  expect(res.status).toBe(200)
  return (await res.json()) as { orders: any[]; cursor: string }
}

async function status(id: string, s: string) {
  const res = await fetch(`${base}/api/print-bridge/status`, {
    method: 'POST',
    headers: { Authorization: 'Bearer bridge-test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ itpOrderId: id, status: s, railStatus: s }),
  })
  expect(res.status).toBe(200)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  tables = {
    orders: [],
    order_items: [],
    products: [{
      id: PET, name: 'Custom pet ornament', category: '3d-prints', images: [],
      metadata: {
        print3d: { enabled: true },
        pet_ornament: { version: 1, font: 'brush-script', photo: true, pets: [{ id: 'cat', label: 'Cat' }, { id: 'dog', label: 'Dog' }, { id: 'bunny', label: 'Bunny' }], field: { key: 'name', label: "Your pet's name", max: 12 } },
      },
    }],
  }
})

describe('GET /queue — a fixed line comes back although its order is behind the cursor', () => {
  it('a held line, fixed with --apply, is sent with petOrnamentParts; the cursor does not move', async () => {
    heldEtsyOrder('o1', '2026-10-31T09:00:00.000Z') // paid (and pulled, held) before the cursor

    // Before the fix: the cursor has passed the order, nothing comes back.
    expect((await pull('2026-11-01T18:00:00.000Z')).orders).toEqual([])

    await applyEtsyPetLine(fakeDb, 'o1', 9001, fixedLine(), new Date('2026-11-01T18:01:00.000Z'))
    const row = tables.order_items[0]
    expect(row.metadata.print_file_path).toBe(SPEC)
    expect(row.metadata.print_requeued_at).toBe('2026-11-01T18:01:00.000Z')

    const after = await pull('2026-11-01T18:05:00.000Z')
    expect(after.cursor).toBe(CURSOR)
    expect(after.orders).toHaveLength(1)
    expect(after.orders[0]).toMatchObject({
      itpOrderId: 'o1',
      // A new lineItemId (the line's own print folder): the factory takes it as a new print,
      // not a re-poll of the held one it already has.
      lineItemId: `${PET}:abc123`,
      line: 'custom-toy',
      personalization: { pet: 'dog', name: 'Sunny', portrait: 'a1b2c3d4e5f6a1b2c3d4e5f6' },
      petOrnamentParts: [{ key: 'plate', stlUrl: 'https://signed.test/plate.stl' }, { key: 'ink', stlUrl: 'https://signed.test/ink.stl' }],
      requeuedAt: '2026-11-01T18:01:00.000Z',
    })
    expect(after.orders[0].printFileError).toBeUndefined()
    expect(after.orders[0].stlUrl).toBeUndefined()

    // Sent again on the next pull (the factory dedupes on itpOrderId + lineItemId).
    expect((await pull('2026-11-01T18:10:00.000Z')).orders.map((o: any) => o.lineItemId)).toEqual([`${PET}:abc123`])
  })

  it('stops once the order is printing; a status before the printer keeps it', async () => {
    heldEtsyOrder('o1', '2026-10-31T09:00:00.000Z')
    await applyEtsyPetLine(fakeDb, 'o1', 9001, fixedLine(), new Date('2026-11-01T18:01:00.000Z'))

    await status('o1', 'received')
    expect((await pull('2026-11-01T18:05:00.000Z')).orders).toHaveLength(1)

    await status('o1', 'printing')
    const meta = tables.order_items[0].metadata
    expect(meta).not.toHaveProperty('print_requeued_at')
    expect(meta.print_requeue_cleared).toMatchObject({ requeuedAt: '2026-11-01T18:01:00.000Z', status: 'printing' })
    expect(meta.print_file_path).toBe(SPEC)
    expect((await pull('2026-11-01T18:10:00.000Z')).orders).toEqual([])
  })

  it('stops after a week with no print status', async () => {
    heldEtsyOrder('o1', '2026-10-31T09:00:00.000Z')
    await applyEtsyPetLine(fakeDb, 'o1', 9001, fixedLine(), new Date('2026-11-01T18:01:00.000Z'))
    expect((await pull('2026-11-08T18:00:00.000Z')).orders).toHaveLength(1)
    expect((await pull('2026-11-08T18:02:00.000Z')).orders).toEqual([])
  })

  it('sends a re-queued line once when its order is also in the paid window', async () => {
    heldEtsyOrder('o2', '2026-11-01T17:00:00.000Z') // paid after the cursor, not pulled yet
    await applyEtsyPetLine(fakeDb, 'o2', 9001, fixedLine(), new Date('2026-11-01T17:30:00.000Z'))
    const { orders, cursor } = await pull('2026-11-01T18:00:00.000Z')
    expect(orders.map((o: any) => o.lineItemId)).toEqual([`${PET}:abc123`])
    expect(cursor).toBe('2026-11-01T17:00:00.000Z')
  })

  it('never sends an unpaid order, or a stamp on a line of an order that is not paid', async () => {
    heldEtsyOrder('o3', '2026-10-31T09:00:00.000Z')
    await applyEtsyPetLine(fakeDb, 'o3', 9001, fixedLine(), new Date('2026-11-01T18:01:00.000Z'))
    tables.orders[0].payment_status = 'refunded'
    expect((await pull('2026-11-01T18:05:00.000Z')).orders).toEqual([])
  })

  it('a held line that was never fixed stays out of the queue', async () => {
    heldEtsyOrder('o4', '2026-10-31T09:00:00.000Z')
    expect((await pull('2026-11-01T18:05:00.000Z')).orders).toEqual([])
  })
})

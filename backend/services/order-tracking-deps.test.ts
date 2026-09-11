import { describe, it, expect, vi, beforeEach } from 'vitest'

// The deps module talks to Supabase directly, so the client is faked here. What
// is under test is exactly the part unit tests of the sync logic can't see:
//   1. delivery is CLAIMED with a conditional update (no double emails), and
//   2. every write survives 20260911000000_order_live_tracking.sql not being
//      applied yet, because Render deploys code and migrations separately.
process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

interface Call { table: string; op: string; payload?: any; filters: Array<[string, ...any[]]> }
let calls: Call[] = []
let responder: (call: Call) => any = () => ({ data: [{ id: 'o1' }], error: null })

const makeChain = (table: string) => {
  const call: Call = { table, op: 'select', filters: [] }
  const chain: any = {
    select: (_cols?: string) => chain,
    update: (p: any) => { call.op = 'update'; call.payload = p; return chain },
    insert: (p: any) => { call.op = 'insert'; call.payload = p; calls.push(call); return Promise.resolve(responder(call)) },
    eq: (...a: any[]) => { call.filters.push(['eq', ...a]); return chain },
    neq: (...a: any[]) => { call.filters.push(['neq', ...a]); return chain },
    then: (ok: any, err?: any) => {
      calls.push(call)
      return Promise.resolve(responder(call)).then(ok, err)
    }
  }
  return chain
}

vi.mock('../lib/supabase.js', () => ({ supabase: { from: (t: string) => makeChain(t) } }))
vi.mock('../utils/email.js', () => ({ sendOrderDeliveredEmail: vi.fn(async () => true) }))

const { makeTrackingSyncDeps, isMissingColumnError } = await import('./order-tracking-deps.js')

beforeEach(() => {
  calls = []
  responder = () => ({ data: [{ id: 'o1' }], error: null })
})

describe('isMissingColumnError', () => {
  it('recognises the shapes PostgREST and Postgres use for an unknown column', () => {
    expect(isMissingColumnError({ code: 'PGRST204' })).toBe(true)
    expect(isMissingColumnError({ code: '42703' })).toBe(true)
    expect(isMissingColumnError({ message: 'column orders.tracking_status does not exist' })).toBe(true)
    expect(isMissingColumnError({ code: '23505', message: 'duplicate key value' })).toBe(false)
  })
})

describe('claimDelivered', () => {
  it('only claims an order that is not already delivered', async () => {
    const deps = makeTrackingSyncDeps()
    const claimed = await deps.claimDelivered('o1', '2026-09-16T18:00:00.000Z')

    expect(claimed).toBe(true)
    const call = calls[0]
    expect(call.op).toBe('update')
    expect(call.payload.status).toBe('delivered')
    expect(call.payload.fulfillment_status).toBe('delivered')
    // The carrier's delivery time, not "whenever the sweep happened to run".
    expect(call.payload.delivered_at).toBe('2026-09-16T18:00:00.000Z')
    expect(call.filters).toContainEqual(['neq', 'status', 'delivered'])
  })

  it('reports a lost race as not-claimed so the customer is mailed once', async () => {
    responder = () => ({ data: [], error: null })
    const claimed = await makeTrackingSyncDeps().claimDelivered('o1', null)
    expect(claimed).toBe(false)
  })

  it('falls back to now() when the carrier gave no delivery timestamp', async () => {
    await makeTrackingSyncDeps().claimDelivered('o1', null)
    expect(calls[0].payload.delivered_at).toBeTruthy()
  })

  it('treats a failed write as not-claimed rather than mailing on a lie', async () => {
    responder = () => ({ data: null, error: { message: 'boom' } })
    expect(await makeTrackingSyncDeps().claimDelivered('o1', null)).toBe(false)
  })
})

describe('saveSnapshot', () => {
  it('writes the full snapshot when the columns exist', async () => {
    const ok = await makeTrackingSyncDeps().saveSnapshot('o1', {
      tracking_status: 'in_transit',
      tracking_checked_at: '2026-09-11T12:00:00.000Z'
    })
    expect(ok).toBe(true)
    expect(calls).toHaveLength(1)
  })

  // Pre-migration API: the snapshot is dropped, not the whole request.
  it('retries without the new columns when the migration has not been applied', async () => {
    let first = true
    responder = () => {
      if (first) { first = false; return { data: null, error: { code: 'PGRST204', message: "Could not find the 'tracking_status' column" } } }
      return { data: null, error: null }
    }

    const ok = await makeTrackingSyncDeps().saveSnapshot('o1', {
      tracking_status: 'in_transit',
      tracking_error: null,
      updated_at: '2026-09-11T12:00:00.000Z'
    })

    expect(ok).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[1].payload).toEqual({ updated_at: '2026-09-11T12:00:00.000Z' })
  })

  it('gives up quietly when there is nothing left to write', async () => {
    responder = () => ({ data: null, error: { code: 'PGRST204', message: 'no such column' } })
    const ok = await makeTrackingSyncDeps().saveSnapshot('o1', { tracking_status: 'in_transit' })
    expect(ok).toBe(false)
    expect(calls).toHaveLength(1)
  })
})

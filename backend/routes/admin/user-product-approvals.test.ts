import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// GET /api/admin/user-products/pending with the Jev pre-sort wired in.
//
// What is pinned here is the contract the reviewer relies on: every pending
// item carries a jev_presort block (verdict, confidence, reason code), the
// queue sorts by it when asked (or when JEV_PRESORT=on), and — the rule that
// matters most — reading the queue NEVER writes to the database. Jev suggests;
// only an admin click changes a status.
//
// The handler is pulled off the Router directly (same approach as
// ai-products-step-flow.test.ts); supabase is a tiny recording fake and the
// Jev transport is replaced so no network call is made.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const writes: { table: string; op: string }[] = []
let pendingRows: any[] = []

function makeQuery(table: string) {
  const chain: any = {}
  let result: any = { data: [], error: null }
  for (const m of ['select', 'eq', 'in', 'order', 'single', 'range', 'limit']) {
    chain[m] = () => chain
  }
  for (const op of ['update', 'insert', 'upsert', 'delete']) {
    chain[op] = () => { writes.push({ table, op }); return chain }
  }
  if (table === 'products') result = { data: pendingRows, error: null }
  if (table === 'user_profiles') result = { data: [{ id: 'creator-1', username: 'maker', email: 'm@example.com' }], error: null }
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject)
  return chain
}

vi.mock('../../lib/supabase.js', () => ({ supabase: { from: (t: string) => makeQuery(t) } }))
vi.mock('../../middleware/supabaseAuth.js', () => ({ requireAuth: (_q: any, _s: any, n: any) => n() }))
vi.mock('../../utils/email.js', () => ({ sendEmail: vi.fn(), sendProductApprovalEmail: vi.fn() }))
vi.mock('../../services/seo-pack.js', () => ({ generateSeoPackForProduct: vi.fn() }))

// Jev answers keyed by product title: triage vs IP told apart by their criteria.
const triageByTitle: Record<string, any> = {}
const jevFetch = vi.fn(async (state: Record<string, string>, questions: Record<string, any>) => {
  const out: Record<string, any> = {}
  for (const [label, q] of Object.entries(questions)) {
    const title = /title: ([^|]+)/.exec(state[label])?.[1]?.trim() ?? ''
    out[label] = 'reject_quality' in q.criteria
      ? triageByTitle[title]
      : { type: 'choice', choice: 'clean', confidence: 0.96, probabilities: { clean: 0.96, generic_theme: 0.02 } }
  }
  return out
})
vi.mock('../../services/jev-ip-gate.js', async (orig) => {
  const real: any = await orig()
  return { ...real, defaultJevFetch: (s: any, q: any) => jevFetch(s, q) }
})

const router = (await import('./user-product-approvals.js')).default
const { resetPresortCache } = await import('../../services/jev-approval-presort.js')
const { resetJevIpCache } = await import('../../services/jev-ip-gate.js')

function handler(method: string, path: string) {
  const layer = (router as any).stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method])
  const handlers = layer.route.stack.map((s: any) => s.handle)
  return handlers[handlers.length - 1]
}

function makeRes() {
  const res: any = { statusCode: 200 }
  res.status = (c: number) => { res.statusCode = c; return res }
  res.json = (b: any) => { res.body = b; return res }
  return res
}

const row = (id: string, name: string, created_at: string) => ({
  id, name, created_at,
  description: 'desc',
  status: 'pending_approval',
  images: [`https://cdn/${id}.png`],
  product_assets: [{ id: `a-${id}`, url: `https://cdn/${id}.png`, kind: 'source' }],
  product_tags: [{ tag: 'art' }],
  metadata: { user_submitted: true, creator_id: 'creator-1', mockup_url: 'm', assets: { clean: 'c', halftone: 'h', dtf: 'd' } }
})

const sure = (choice: string, confidence = 0.95) => ({ type: 'choice', choice, confidence, probabilities: { [choice]: confidence } })

beforeEach(() => {
  writes.length = 0
  jevFetch.mockClear()
  resetPresortCache()
  resetJevIpCache()
  delete process.env.JEV
  delete process.env.JEV_PRESORT
  delete process.env.OPENROUTER_API_KEY // the fake transport must be the only way out
  pendingRows = [
    row('newest', 'Odd Blob Thing', '2026-09-22T00:00:00Z'),
    row('tm', 'Pokemon Party', '2026-09-21T00:00:00Z'),
    row('good', 'Mountain Wolf Howl', '2026-09-20T00:00:00Z'),
    row('fix', 'cool shirt best shirt', '2026-09-19T00:00:00Z')
  ]
  Object.assign(triageByTitle, {
    'Odd Blob Thing': sure('approve', 0.3),
    'Mountain Wolf Howl': sure('approve', 0.97),
    'cool shirt best shirt': sure('needs_fix', 0.9),
    'Pokemon Party': sure('approve', 0.9)
  })
})

describe('GET /pending with Jev pre-sort', () => {
  it('returns a classification, confidence and reason code on every item', async () => {
    const res = makeRes()
    await handler('get', '/pending')({ query: {}, user: { sub: 'admin' } }, res)
    expect(res.statusCode).toBe(200)
    const byId = Object.fromEntries(res.body.products.map((p: any) => [p.id, p.jev_presort]))
    expect(byId.good).toMatchObject({ recommendation: 'approve', reasonCode: 'jev_approve' })
    expect(byId.good.confidence).toBeCloseTo(0.97)
    expect(byId.tm).toMatchObject({ recommendation: 'reject_ip', reasonCode: 'floor_trademark', confidence: 1 })
    expect(byId.newest).toMatchObject({ recommendation: null, reasonCode: 'jev_low_confidence', lowConfidence: true })
    expect(byId.fix).toMatchObject({ recommendation: 'needs_fix', reasonCode: 'jev_needs_fix' })
    for (const p of Object.values(byId) as any[]) expect(typeof p.rationale).toBe('string')
    // Both Jev questions went through the fake transport, not the network.
    expect(jevFetch).toHaveBeenCalledTimes(2)
    // Creator join still there.
    expect(res.body.products[0].creator).toMatchObject({ username: 'maker' })
  })

  it('shadow (the default) keeps newest-first; ?sort=jev orders by triage priority', async () => {
    const shadow = makeRes()
    await handler('get', '/pending')({ query: {}, user: { sub: 'admin' } }, shadow)
    expect(shadow.body.presort).toEqual({ mode: 'shadow', sort: 'created' })
    expect(shadow.body.products.map((p: any) => p.id)).toEqual(['newest', 'tm', 'good', 'fix'])

    const sorted = makeRes()
    await handler('get', '/pending')({ query: { sort: 'jev' }, user: { sub: 'admin' } }, sorted)
    expect(sorted.body.products.map((p: any) => p.id)).toEqual(['good', 'newest', 'fix', 'tm'])
  })

  it('JEV_PRESORT=on makes the Jev order the default; ?sort=created still overrides', async () => {
    process.env.JEV_PRESORT = 'on'
    const on = makeRes()
    await handler('get', '/pending')({ query: {}, user: { sub: 'admin' } }, on)
    expect(on.body.presort).toEqual({ mode: 'on', sort: 'jev' })
    expect(on.body.products[0].id).toBe('good')

    const created = makeRes()
    await handler('get', '/pending')({ query: { sort: 'created' }, user: { sub: 'admin' } }, created)
    expect(created.body.products[0].id).toBe('newest')
  })

  it('never writes: no status (or anything else) is mutated by reading the queue', async () => {
    process.env.JEV_PRESORT = 'on'
    await handler('get', '/pending')({ query: {}, user: { sub: 'admin' } }, makeRes())
    expect(writes).toEqual([])
  })

  it('serves the queue on the floor alone when Jev is down', async () => {
    jevFetch.mockImplementation(async () => { throw new Error('lane down') })
    const res = makeRes()
    await handler('get', '/pending')({ query: { sort: 'jev' }, user: { sub: 'admin' } }, res)
    expect(res.statusCode).toBe(200)
    const byId = Object.fromEntries(res.body.products.map((p: any) => [p.id, p.jev_presort]))
    expect(byId.tm.reasonCode).toBe('floor_trademark')
    expect(byId.good).toMatchObject({ recommendation: null, reasonCode: 'jev_unavailable', lowConfidence: true })
    expect(writes).toEqual([])
  })
})

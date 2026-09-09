import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// backend/routes/studio-flow.ts — the customer lane's own gate.
//
// The step logic itself is the admin router's and is tested there; what is
// under test here is everything this file adds around it, because that is the
// part that decides whether a customer can reach someone else's product or
// spend ITC they didn't get anything for.
//
// The two heavy neighbours (the shared step-flow router and the 500-line
// create handler) are mocked to stubs — this file's middleware is reached
// directly off the Express router's stack, the same technique
// ai-products-step-flow.test.ts uses, so no HTTP server is involved.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

type Row = Record<string, any>
let db: Record<string, Row[]> = { products: [], user_wallets: [], product_assets: [], ai_jobs: [] }

function makeQuery(table: string) {
  let mode: 'select' | 'delete' | 'update' = 'select'
  let payload: any = null
  const filters: Array<(r: Row) => boolean> = []
  const exec = () => {
    const rows = db[table] || (db[table] = [])
    if (mode === 'delete') {
      db[table] = rows.filter((r) => !filters.every((f) => f(r)))
      return { data: null, error: null }
    }
    if (mode === 'update') {
      db[table] = rows.map((r) => (filters.every((f) => f(r)) ? { ...r, ...payload } : r))
      return { data: null, error: null }
    }
    return { data: rows.filter((r) => filters.every((f) => f(r))), error: null }
  }
  const chain: any = {
    select: () => chain,
    update: (p: any) => {
      mode = 'update'
      payload = p
      return chain
    },
    delete: () => {
      mode = 'delete'
      return chain
    },
    eq: (k: string, v: any) => {
      filters.push((row) => row[k] === v)
      return chain
    },
    maybeSingle: async () => {
      const { data } = exec()
      return { data: (data as Row[])?.[0] ?? null, error: null }
    },
    then: (onOk: any, onErr?: any) => Promise.resolve(exec()).then(onOk, onErr),
  }
  return chain
}

vi.mock('../lib/supabase.js', () => ({ supabase: { from: (t: string) => makeQuery(t) } }))
vi.mock('../middleware/supabaseAuth.js', () => ({ requireAuth: (_r: any, _s: any, n: any) => n() }))
vi.mock('../middleware/requireCreator.js', () => ({ requireCreator: (_r: any, _s: any, n: any) => n() }))

const deductITC = vi.fn(async () => {})
const refundITC = vi.fn(async () => {})
vi.mock('../services/imagination-pricing.js', () => ({
  pricingService: {
    getPricing: async () => ({ current_cost: 10 }),
    deductITC: (...a: any[]) => deductITC(...(a as [])),
    refundITC: (...a: any[]) => refundITC(...(a as [])),
  },
}))

// The shared step-flow router — a bare router is enough; mounting it is what
// the last `router.use` does, and nothing here asserts on its routes.
vi.mock('./admin/ai-products-step-flow.js', async () => {
  const { Router } = await import('express')
  return { default: Router() }
})

const handleAIProductCreate = vi.fn(async (_req: any, res: any) => res.json({ productId: 'new-1' }))
vi.mock('./admin/ai-products.js', () => ({
  handleAIProductCreate: (...a: any[]) => handleAIProductCreate(...(a as [])),
}))

const studioRouter = (await import('./studio-flow.js')).default

/** A named `router.use(fn)` middleware, found by name rather than by position
 *  so adding another one to the chain can't silently point these tests at the
 *  wrong function (it did: index 0 was the mocked requireAuth, so the first
 *  run of this suite asserted on a middleware that does nothing). */
function useMiddleware(name: string) {
  const layer = (studioRouter as any).stack.find((l: any) => !l.route && l.handle?.name === name)
  if (!layer) throw new Error(`No middleware named ${name} on the studio router`)
  return layer.handle as (req: any, res: any, next: any) => any
}

function routeHandlers(method: string, path: string) {
  const layer = (studioRouter as any).stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method])
  if (!layer) throw new Error(`No route for ${method.toUpperCase()} ${path}`)
  return layer.route.stack.map((s: any) => s.handle) as Array<(req: any, res: any, next: any) => any>
}

function makeRes() {
  const res: any = { statusCode: 200, listeners: [] as Array<() => void> }
  res.status = (c: number) => {
    res.statusCode = c
    return res
  }
  res.json = (b: any) => {
    res.body = b
    res.listeners.forEach((fn: () => void) => fn())
    return res
  }
  res.on = (_evt: string, fn: () => void) => {
    res.listeners.push(fn)
    return res
  }
  return res
}

const req = (over: Record<string, any> = {}) => ({
  user: { id: 'u1', sub: 'u1' },
  params: {},
  body: {},
  query: {},
  path: '/',
  ...over,
})

beforeEach(() => {
  db = { products: [], user_wallets: [{ user_id: 'u1', itc_balance: 500 }], product_assets: [], ai_jobs: [] }
  deductITC.mockClear()
  refundITC.mockClear()
  handleAIProductCreate.mockClear()
  handleAIProductCreate.mockImplementation(async (_r: any, res: any) => res.json({ productId: 'new-1' }))
})

describe('the lane flag', () => {
  it('is stamped on the request so the shared router skips its admin check', async () => {
    const r = req()
    const next = vi.fn()
    await useMiddleware('markCustomerLane')(r, makeRes(), next)
    expect((r as any).studioLane).toBe('customer')
    expect(next).toHaveBeenCalled()
  })
})

describe('ownership', () => {
  const guard = () => useMiddleware('requireOwnBuild')

  it('lets a pre-product step through — there is nothing to own yet', async () => {
    const next = vi.fn()
    await guard()(req({ path: '/step/brief' }), makeRes(), next)
    expect(next).toHaveBeenCalled()
  })

  // Regression: keying the guard on the FIRST path segment sent /pricing off
  // to look up a product called "pricing", 404-ing the page's own price call.
  it("lets the lane's own non-product routes through", async () => {
    const next = vi.fn()
    await guard()(req({ path: '/pricing' }), makeRes(), next)
    expect(next).toHaveBeenCalled()
  })

  it('lets the owner into their own build', async () => {
    db.products.push({ id: 'p1', created_by_user_id: 'u1' })
    const next = vi.fn()
    await guard()(req({ path: '/p1/step/shots' }), makeRes(), next)
    expect(next).toHaveBeenCalled()
  })

  it("answers 404 — not 403 — for somebody else's build", async () => {
    db.products.push({ id: 'p1', created_by_user_id: 'someone-else' })
    const res = makeRes()
    const next = vi.fn()
    await guard()(req({ path: '/p1/step' }), res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(404)
  })
})

describe('ITC metering', () => {
  const create = () => routeHandlers('post', '/step/create')

  it('charges before generating and hands the owner to the shared create handler', async () => {
    const [, meter, handler] = create()
    const r = req()
    const res = makeRes()
    await meter(r, res, () => {})
    await handler(r, res, () => {})
    expect(deductITC).toHaveBeenCalledWith('u1', 10, 'studio_flow_generate')
    expect((r as any).studioOwnerId).toBe('u1')
    expect(res.body.productId).toBe('new-1')
    expect(refundITC).not.toHaveBeenCalled()
  })

  it('refuses with 402 rather than starting a build it cannot pay for', async () => {
    db.user_wallets = [{ user_id: 'u1', itc_balance: 3 }]
    const [, meter] = create()
    const res = makeRes()
    const next = vi.fn()
    await meter(req(), res, next)
    expect(res.statusCode).toBe(402)
    expect(next).not.toHaveBeenCalled()
    expect(deductITC).not.toHaveBeenCalled()
  })

  // The handlers answer 4xx/5xx instead of throwing, so the refund has to hang
  // off the response — a try/catch would never see the failure and the
  // customer would eat the charge for a step that did nothing.
  it('refunds when the step it paid for answers an error', async () => {
    handleAIProductCreate.mockImplementation(async (_r: any, res: any) => res.status(500).json({ error: 'nope' }))
    const [, meter, handler] = create()
    const r = req()
    const res = makeRes()
    await meter(r, res, () => {})
    await handler(r, res, () => {})
    expect(deductITC).toHaveBeenCalled()
    expect(refundITC).toHaveBeenCalledWith('u1', 10, 'studio_flow_generate_failed')
  })
})

describe('DELETE /:id/step/draft', () => {
  const discard = () => routeHandlers('delete', '/:id/step/draft').slice(-1)[0]

  it('discards a scratch draft', async () => {
    db.products.push({ id: 'p1', status: 'draft', created_by_user_id: 'u1' })
    const res = makeRes()
    await discard()(req({ params: { id: 'p1' } }), res, () => {})
    expect(res.statusCode).toBe(200)
    expect(db.products).toHaveLength(0)
  })

  it('refuses to erase a build that is already in review', async () => {
    db.products.push({ id: 'p1', status: 'pending_approval', created_by_user_id: 'u1' })
    const res = makeRes()
    await discard()(req({ params: { id: 'p1' } }), res, () => {})
    expect(res.statusCode).toBe(400)
    expect(db.products).toHaveLength(1)
  })
})

describe('the mockup fan-out is charged once per build', () => {
  const shots = () => routeHandlers('post', '/:id/step/shots').slice(-1)[0]

  /** Runs the meter and reports whether it let the request through. */
  const fire = async (id: string) => {
    const res = makeRes()
    let passed = false
    await shots()(req({ params: { id } }), res, () => {
      passed = true
      // The shared router would answer here; the billing stamp hangs off it.
      res.json({ jobs: [{ key: 'product', jobId: 'j1' }] })
    })
    return { res, passed }
  }

  it('charges the first fan-out and nothing on the ones that follow', async () => {
    db.products.push({ id: 'p1', created_by_user_id: 'u1', metadata: {} })

    const first = await fire('p1')
    expect(first.passed).toBe(true)
    expect(deductITC).toHaveBeenCalledTimes(1)
    expect(deductITC).toHaveBeenCalledWith('u1', 50, 'studio_flow_shots')

    // An extra colour approved later adds a shot — one more render, not a
    // second whole fan-out to pay for.
    const second = await fire('p1')
    expect(second.passed).toBe(true)
    expect(deductITC).toHaveBeenCalledTimes(1)
    expect(refundITC).not.toHaveBeenCalled()
  })

  it('does not record the charge when the fan-out failed', async () => {
    db.products.push({ id: 'p1', created_by_user_id: 'u1', metadata: {} })
    const res = makeRes()
    await shots()(req({ params: { id: 'p1' } }), res, () => {
      res.status(500).json({ error: 'nope' })
    })
    expect(refundITC).toHaveBeenCalledWith('u1', 50, 'studio_flow_shots_failed')
    expect((db.products[0].metadata as any).studio_billing).toBeUndefined()
  })
})

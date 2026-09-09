import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for backend/routes/admin/ai-products-step-flow.ts's
// POST /:id/step/select-design — specifically the 2026-09-02 fix that makes
// its background-removal job render inline in this API process instead of
// sitting 'queued' for the production Render worker (which was still running
// old code) to pick up.
//
// Backed by the SAME tiny in-memory supabase fake used by
// services/step-flow/shots.test.ts. Every module select-design's import
// graph transitively touches gets mocked here too (etsy-model-shots,
// details-card, ai-jobs-worker, the writing-brain/color-advice services, and
// the auth middleware, which throws at import time without
// SUPABASE_JWT_SECRET) so this test never makes a real network/API call.
//
// Reaches the actual route handler via Express Router internals (the LAST
// function registered on the `/:id/step/select-design` POST route) rather
// than spinning up an HTTP server — no supertest dependency in this repo, and
// the auth/role-check middleware ahead of the handler isn't what's under
// test here.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.REPLICATE_API_TOKEN ||= 'test-replicate-token'
process.env.OPENAI_API_KEY ||= 'test-openai-key'

// --- fake supabase (mirrors services/step-flow/shots.test.ts's makeQuery) --
type Row = Record<string, any>
let db: Record<string, Row[]> = { products: [], ai_jobs: [], product_assets: [] }
let idCounter = 0

function resetDb() {
  db = { products: [], ai_jobs: [], product_assets: [] }
  idCounter = 0
}

type Predicate = (row: Row) => boolean

function matches(row: Row, filters: Predicate[]): boolean {
  return filters.every((f) => f(row))
}

/** Resolve a PostgREST jsonb path ("metadata->step_flow->approvals->design",
 *  "metadata->>collection") the way the real column filter would — every
 *  missing level collapses to undefined, which is how SQL NULL reads here. */
function resolvePath(row: Row, path: string): any {
  const [head, ...rest] = path.split(/->>?/)
  let value: any = row[head as string]
  for (const key of rest) {
    if (value == null) return undefined
    value = value[key]
  }
  return value
}

function makeQuery(table: string) {
  let mode: 'select' | 'insert' | 'update' | 'delete' | null = null
  let payload: any = null
  const filters: Predicate[] = []
  let orderBy: { col: string; asc: boolean } | null = null
  let limitN: number | null = null

  const exec = (): { data: any; error: any } => {
    const rows = db[table] || (db[table] = [])
    if (mode === 'insert') {
      const items = Array.isArray(payload) ? payload : [payload]
      const created = items.map((it: any) => ({ id: it.id || `id-${++idCounter}`, created_at: new Date().toISOString(), ...it }))
      db[table] = [...rows, ...created]
      return { data: created.length === 1 ? created[0] : created, error: null }
    }
    if (mode === 'update') {
      db[table] = rows.map((r) => (matches(r, filters) ? { ...r, ...payload } : r))
      return { data: db[table].filter((r) => matches(r, filters)), error: null }
    }
    if (mode === 'delete') {
      db[table] = rows.filter((r) => !matches(r, filters))
      return { data: null, error: null }
    }
    let matched = rows.filter((r) => matches(r, filters))
    if (orderBy) {
      const { col, asc } = orderBy
      matched = [...matched].sort((a, b) => (asc ? 1 : -1) * String(a[col] ?? '').localeCompare(String(b[col] ?? '')))
    }
    if (limitN != null) matched = matched.slice(0, limitN)
    return { data: matched, error: null }
  }

  const chain: any = {
    select: () => {
      mode = mode ?? 'select'
      return chain
    },
    insert: (p: any) => {
      mode = 'insert'
      payload = p
      return chain
    },
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
      filters.push((row) => resolvePath(row, k) === v)
      return chain
    },
    neq: (k: string, v: any) => {
      filters.push((row) => resolvePath(row, k) !== v)
      return chain
    },
    in: (k: string, vals: any[]) => {
      filters.push((row) => vals.includes(resolvePath(row, k)))
      return chain
    },
    is: (k: string, v: any) => {
      // Only `is(col, null)` is used; PostgREST's null means "absent too".
      filters.push((row) => (v === null ? resolvePath(row, k) == null : resolvePath(row, k) === v))
      return chain
    },
    not: (k: string, op: string, v: any) => {
      filters.push((row) => (op === 'is' && v === null ? resolvePath(row, k) != null : resolvePath(row, k) !== v))
      return chain
    },
    order: (col: string, opts?: { ascending?: boolean }) => {
      orderBy = { col, asc: opts?.ascending !== false }
      return chain
    },
    limit: (n: number) => {
      limitN = n
      return chain
    },
    single: async () => {
      const { data } = exec()
      const row = Array.isArray(data) ? data[0] : data
      return { data: row ?? null, error: row ? null : { message: `${table}: not found` } }
    },
    maybeSingle: async () => {
      const { data } = exec()
      const row = Array.isArray(data) ? data[0] ?? null : data
      return { data: row, error: null }
    },
    then: (onOk: any, onErr?: any) => Promise.resolve(exec()).then(onOk, onErr),
  }
  return chain
}

vi.mock('../../lib/supabase.js', () => ({
  supabase: { from: (table: string) => makeQuery(table) },
}))

// Auth middleware throws at import time without SUPABASE_JWT_SECRET, and its
// jose/role-cache dependencies aren't relevant here — the handler under test
// is reached directly (bypassing requireAuth/requireAdminOrManager), so a
// bare stand-in is enough.
vi.mock('../../middleware/supabaseAuth.js', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}))

// shots.js's own transitive imports — mocked the same way
// services/step-flow/shots.test.ts mocks them, so loading the real shots.js
// (for its real getStepFlow/saveStepFlow/loadProductRow used by
// select-design) never reaches real Replicate/OpenAI/GCS calls.
vi.mock('../../services/etsy-model-shots.js', () => ({
  shootOneModelShot: vi.fn(),
  startModelShots: vi.fn(),
}))
vi.mock('../../services/step-flow/details-card.js', () => ({ renderDetailsCard: vi.fn(), renderMetalDetailsCard: vi.fn() }))
vi.mock('../../services/step-flow/brief.js', () => ({ writeStepBrief: vi.fn() }))
const adviseColorsForMetal = vi.fn()
vi.mock('../../services/step-flow/color-advice.js', () => ({
  adviseColors: vi.fn(),
  adviseColorsForMetal: (...args: any[]) => adviseColorsForMetal(...args),
}))

const processRemoveBgJob = vi.fn()
const processMockupJob = vi.fn()
vi.mock('../../worker/ai-jobs-worker.js', () => ({
  processRemoveBgJob: (...args: any[]) => processRemoveBgJob(...args),
  processMockupJob: (...args: any[]) => processMockupJob(...args),
}))

// product-build.js pulls in sharp + GCS + Replicate at import; the route only
// needs its createWatermarkedDesignAsset, which the tests below assert on.
const createWatermarkedDesignAsset = vi.fn(async () => {})
vi.mock('../../services/product-build.js', () => ({
  createWatermarkedDesignAsset: (...args: any[]) => createWatermarkedDesignAsset(...args),
}))

const stepFlowRouter = (await import('./ai-products-step-flow.js')).default

/** Pulls the actual async handler off a registered route, skipping its auth/role-check middleware. */
function getRouteHandler(method: string, path: string): (req: any, res: any) => Promise<any> {
  const layer = (stepFlowRouter as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method]
  )
  if (!layer) throw new Error(`No route registered for ${method.toUpperCase()} ${path}`)
  const handlers = layer.route.stack.map((s: any) => s.handle)
  return handlers[handlers.length - 1]
}

function makeRes() {
  const res: any = { statusCode: 200 }
  res.status = (code: number) => {
    res.statusCode = code
    return res
  }
  res.json = (body: any) => {
    res.body = body
    return res
  }
  return res
}

async function waitUntil(fn: () => boolean, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 0))
  }
  throw new Error('waitUntil timed out')
}

function seedProduct(): void {
  db.products.push({
    id: 'p1',
    category: 't-shirts',
    metadata: {
      step_flow: { version: 1, idea: '', brief: null, shots: {}, approvals: {} },
    },
  })
}

/** Same shape as seedProduct but for the metal wall-art lane (design doc §14). */
function seedMetalProduct(over: Record<string, any> = {}): void {
  db.products.push({
    id: 'p1',
    category: 'metal-art',
    metadata: {
      step_flow: { version: 1, idea: 'aurora wolf', brief: { title: 'Aurora Wolf', productKind: 'metal' }, shots: {}, approvals: {} },
      ...over,
    },
  })
}

beforeEach(() => {
  resetDb()
  processRemoveBgJob.mockReset()
  processMockupJob.mockReset()
  adviseColorsForMetal.mockReset()
  createWatermarkedDesignAsset.mockReset()
  createWatermarkedDesignAsset.mockResolvedValue(undefined)
})

describe('POST /:id/step/select-design — background removal renders inline (2026-09-02)', () => {
  it('inserts the rembg job pre-claimed as running (not queued) and fires processRemoveBgJob once', async () => {
    seedProduct()
    db.product_assets.push({
      id: 'asset-1',
      product_id: 'p1',
      kind: 'source',
      url: 'https://cdn/design.png',
      metadata: {},
    })
    processRemoveBgJob.mockResolvedValue(undefined)

    const handler = getRouteHandler('post', '/:id/step/select-design')
    const req = { params: { id: 'p1' }, body: { assetId: 'asset-1' }, user: { id: 'u1', sub: 'u1' }, log: undefined }
    const res = makeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body?.ok).toBe(true)
    const rembgJob = res.body?.rembgJob
    expect(rembgJob).toBeDefined()
    expect(rembgJob.type).toBe('replicate_rembg') // job type name stays stable — the frontend filters on it
    expect(rembgJob.status).toBe('running') // pre-claimed, never left 'queued' for the worker

    const savedJob = db.ai_jobs.find((j) => j.id === rembgJob.id)
    expect(savedJob?.status).toBe('running')
    expect(savedJob?.input?.selected_asset_id).toBe('asset-1')

    await waitUntil(() => processRemoveBgJob.mock.calls.length === 1)
    expect(processRemoveBgJob).toHaveBeenCalledTimes(1)
    expect(processRemoveBgJob).toHaveBeenCalledWith(expect.objectContaining({ id: rembgJob.id, product_id: 'p1' }))
  })

  it('marks the ai_jobs row failed when processRemoveBgJob throws (safety net past its own internal handling)', async () => {
    seedProduct()
    db.product_assets.push({
      id: 'asset-1',
      product_id: 'p1',
      kind: 'source',
      url: 'https://cdn/design.png',
      metadata: {},
    })
    processRemoveBgJob.mockRejectedValueOnce(new Error('851-labs refused'))

    const handler = getRouteHandler('post', '/:id/step/select-design')
    const req = { params: { id: 'p1' }, body: { assetId: 'asset-1' }, user: { id: 'u1', sub: 'u1' }, log: undefined }
    const res = makeRes()

    await handler(req, res)
    const rembgJobId = res.body?.rembgJob?.id

    await waitUntil(() => db.ai_jobs.find((j) => j.id === rembgJobId)?.status === 'failed')
    const failedJob = db.ai_jobs.find((j) => j.id === rembgJobId)
    expect(failedJob?.error).toBe('851-labs refused')
  })
})

// ---------------------------------------------------------------------------
// Metal prints lane (design doc §14, David 2026-09-02).
// ---------------------------------------------------------------------------

describe('POST /:id/step/select-design — metal skips rembg entirely', () => {
  it('marks the design primary, stamps approvals.design, and never queues a rembg job', async () => {
    seedMetalProduct()
    db.product_assets.push({
      id: 'asset-1',
      product_id: 'p1',
      kind: 'source',
      url: 'https://cdn/design.png',
      metadata: {},
    })

    const handler = getRouteHandler('post', '/:id/step/select-design')
    const req = { params: { id: 'p1' }, body: { assetId: 'asset-1' }, user: { id: 'u1', sub: 'u1' }, log: undefined }
    const res = makeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body?.ok).toBe(true)
    expect(res.body?.rembgJob).toBeNull()
    expect(db.ai_jobs.filter((j) => j.type === 'replicate_rembg')).toHaveLength(0)
    expect(processRemoveBgJob).not.toHaveBeenCalled()

    const savedProduct = db.products.find((p) => p.id === 'p1')!
    expect(savedProduct.metadata.step_flow.approvals.design).toBeTruthy()
  })
})

describe('POST /:id/step/color-advice — metal returns empty advice', () => {
  it('calls adviseColorsForMetal (not adviseColors) and returns an empty advice list', async () => {
    seedMetalProduct()
    db.product_assets.push({
      id: 'asset-1',
      product_id: 'p1',
      kind: 'source',
      is_primary: true,
      url: 'https://cdn/design.png',
      metadata: {},
    })
    adviseColorsForMetal.mockResolvedValueOnce({ advice: [], artwork: { meanLuma: 0.2, darkShare: 0.8, lightShare: 0, coverage: 0.9, dominantHue: null } })

    const handler = getRouteHandler('post', '/:id/step/color-advice')
    const req = { params: { id: 'p1' }, body: {}, user: { id: 'u1', sub: 'u1' }, log: undefined }
    const res = makeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body?.advice).toEqual([])
    expect(res.body?.artwork).toBeTruthy()
    expect(adviseColorsForMetal).toHaveBeenCalledWith('https://cdn/design.png')
  })
})

describe('POST /:id/step/sizes', () => {
  it('rejects an empty or missing sizes array', async () => {
    seedMetalProduct()
    const handler = getRouteHandler('post', '/:id/step/sizes')

    const res1 = makeRes()
    await handler({ params: { id: 'p1' }, body: {}, user: { id: 'u1', sub: 'u1' }, log: undefined }, res1)
    expect(res1.statusCode).toBe(400)

    const res2 = makeRes()
    await handler({ params: { id: 'p1' }, body: { sizes: [] }, user: { id: 'u1', sub: 'u1' }, log: undefined }, res2)
    expect(res2.statusCode).toBe(400)
  })

  it('rejects a sizes array with no valid entries', async () => {
    seedMetalProduct()
    const handler = getRouteHandler('post', '/:id/step/sizes')
    const res = makeRes()
    await handler({ params: { id: 'p1' }, body: { sizes: ['8x11', 'poster'] }, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body?.error).toMatch(/4x6/)
  })

  it('accepts both sizes, prices at the SMALLEST, and stamps metal_size at the LARGEST', async () => {
    seedMetalProduct()
    const handler = getRouteHandler('post', '/:id/step/sizes')
    const req = { params: { id: 'p1' }, body: { sizes: ['8x10', '4x6'] }, user: { id: 'u1', sub: 'u1' }, log: undefined }
    const res = makeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body?.ok).toBe(true)
    expect(res.body?.step_flow?.sizes).toEqual(['4x6', '8x10'])
    expect(res.body?.step_flow?.approvals?.garments).toBeTruthy()

    const savedProduct = db.products.find((p) => p.id === 'p1')!
    expect(savedProduct.price).toBe(8.95) // smallest selected size's price
    expect(savedProduct.metadata.metal_size).toBe('8x10') // largest selected size
    expect(savedProduct.metadata.metal_sizes).toEqual(['4x6', '8x10'])
    expect(savedProduct.metadata.metal_prices).toEqual({ '4x6': 8.95, '8x10': 16.95 })
    // The sizes COLUMN is what the storefront picker + admin editor read.
    expect(savedProduct.sizes).toEqual(['4x6', '8x10'])
  })

  it('prices at the single selected size when only one is picked', async () => {
    seedMetalProduct()
    const handler = getRouteHandler('post', '/:id/step/sizes')
    const req = { params: { id: 'p1' }, body: { sizes: ['8x10'] }, user: { id: 'u1', sub: 'u1' }, log: undefined }
    const res = makeRes()

    await handler(req, res)

    const savedProduct = db.products.find((p) => p.id === 'p1')!
    expect(savedProduct.price).toBe(16.95)
    expect(savedProduct.metadata.metal_size).toBe('8x10')
    expect(savedProduct.metadata.metal_sizes).toEqual(['8x10'])
  })

  it('de-dupes a repeated size and ignores an unknown one alongside a valid one', async () => {
    seedMetalProduct()
    const handler = getRouteHandler('post', '/:id/step/sizes')
    const req = { params: { id: 'p1' }, body: { sizes: ['4x6', '4x6', 'poster'] }, user: { id: 'u1', sub: 'u1' }, log: undefined }
    const res = makeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body?.step_flow?.sizes).toEqual(['4x6'])
  })
})

// ---------------------------------------------------------------------------
// GET /:id/step — productKind must land NESTED on step_flow (not as a
// sibling of it in the response body): the frontend's stepFlowReducer HYDRATE
// reads `action.response.step_flow?.productKind` first (falling back to
// `step_flow.brief?.productKind`), never a top-level `response.productKind`.
// ---------------------------------------------------------------------------
describe('GET /:id/step — productKind', () => {
  it('nests productKind:"metal" on step_flow for a metal-art product, derived from category', async () => {
    seedMetalProduct()
    const handler = getRouteHandler('get', '/:id/step')
    const req = { params: { id: 'p1' }, user: { id: 'u1', sub: 'u1' }, log: undefined }
    const res = makeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body?.step_flow?.productKind).toBe('metal')
    expect(res.body?.productKind).toBeUndefined() // never a sibling of step_flow
  })

  it('nests productKind:"garment" on step_flow for a non-metal product', async () => {
    seedProduct()
    const handler = getRouteHandler('get', '/:id/step')
    const req = { params: { id: 'p1' }, user: { id: 'u1', sub: 'u1' }, log: undefined }
    const res = makeRes()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.body?.step_flow?.productKind).toBe('garment')
  })
})

// ---------------------------------------------------------------------------
// POST /:id/step/select-design — the watermarked design (gallery contract
// slot) is made for BOTH kinds. The Step Flow never created it before, so a
// metal print's storefront gallery had no artwork at all.
// ---------------------------------------------------------------------------
describe('POST /:id/step/select-design — watermarked design copy', () => {
  it('kicks off createWatermarkedDesignAsset for the picked source on a metal product', async () => {
    seedMetalProduct()
    db.product_assets.push({ id: 'src1', product_id: 'p1', kind: 'source', url: 'https://cdn/raw.png', metadata: {} })
    const handler = getRouteHandler('post', '/:id/step/select-design')
    const res = makeRes()
    await handler({ params: { id: 'p1' }, body: { assetId: 'src1' }, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)
    expect(res.statusCode).toBe(200)
    await waitUntil(() => createWatermarkedDesignAsset.mock.calls.length === 1)
    expect(createWatermarkedDesignAsset).toHaveBeenCalledWith('p1', { id: 'src1', url: 'https://cdn/raw.png' })
  })

  it('kicks it off for a garment too (contract slot #10)', async () => {
    seedProduct()
    db.product_assets.push({ id: 'src1', product_id: 'p1', kind: 'source', url: 'https://cdn/raw.png', metadata: {} })
    processRemoveBgJob.mockResolvedValue(undefined)
    const handler = getRouteHandler('post', '/:id/step/select-design')
    const res = makeRes()
    await handler({ params: { id: 'p1' }, body: { assetId: 'src1' }, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)
    expect(res.statusCode).toBe(200)
    await waitUntil(() => createWatermarkedDesignAsset.mock.calls.length === 1)
  })
})

// ---------------------------------------------------------------------------
// POST /:id/step/publish — metal print (David 2026-09-02, Golden Gate):
//   * the price is OWNED by shared/metal-art.ts — the Listing step's $25 Etsy
//     anchor must not overwrite the Sizes step's $8.95
//   * the sizes column + metal_* metadata are (re)stamped
//   * the gallery leads with the watermarked artwork, made at publish if the
//     select-design background run never landed
// ---------------------------------------------------------------------------
describe('POST /:id/step/publish — metal print', () => {
  function seedPublishableMetal(withWatermark: boolean) {
    seedMetalProduct({
      step_flow: {
        version: 1,
        idea: 'golden gate',
        brief: { title: 'Golden Gate', productKind: 'metal' },
        productKind: 'metal',
        sizes: ['4x6', '8x10'],
        shots: {
          'scene:4x6': { approved: true, status: 'done', assetId: 's4', url: 'desk.png' },
          'scene:8x10': { approved: true, status: 'done', assetId: 's8', url: 'wall.png' },
          details: { approved: true, status: 'done', assetId: 'd1', url: 'details.png' },
        },
        approvals: { design: 'x', garments: 'x', mockups: 'x' },
      },
      metal_sizes: ['4x6', '8x10'],
    })
    const p = db.products.find((r) => r.id === 'p1')!
    p.price = 8.95
    p.sizes = []
    db.product_assets.push(
      { id: 'src1', product_id: 'p1', kind: 'source', asset_role: 'design', is_primary: true, url: 'raw.png', created_at: '2026-01-01', metadata: {} },
      { id: 's8', product_id: 'p1', kind: 'mockup', asset_role: 'mockup_metal_8x10', url: 'wall.png', created_at: '2026-01-01' },
      { id: 's4', product_id: 'p1', kind: 'mockup', asset_role: 'mockup_metal_4x6', url: 'desk.png', created_at: '2026-01-01' },
      { id: 'd1', product_id: 'p1', kind: 'mockup', asset_role: 'mockup_details', url: 'details.png', created_at: '2026-01-01' },
    )
    if (withWatermark) {
      db.product_assets.push({ id: 'w1', product_id: 'p1', kind: 'design_preview', asset_role: 'design_watermarked', url: 'art-wm.png', created_at: '2026-01-02' })
    }
  }

  it('ignores the $25 client price, keeps the 4x6 entry price, and stamps sizes + metal metadata', async () => {
    seedPublishableMetal(true)
    const handler = getRouteHandler('post', '/:id/step/publish')
    const res = makeRes()
    await handler(
      { params: { id: 'p1' }, body: { title: 'Golden Gate Metal Print', description: 'd', tags: ['metal'], price: 25 }, user: { id: 'u1', sub: 'u1' }, log: undefined },
      res
    )
    expect(res.statusCode).toBe(200)
    const saved = db.products.find((r) => r.id === 'p1')!
    expect(saved.price).toBe(8.95)
    expect(saved.sizes).toEqual(['4x6', '8x10'])
    expect(saved.metadata.metal_prices).toEqual({ '4x6': 8.95, '8x10': 16.95 })
    expect(saved.metadata.metal_size).toBe('8x10')
    expect(saved.status).toBe('active')
  })

  it('leads the gallery with the watermarked artwork, then wall, desk, details', async () => {
    seedPublishableMetal(true)
    const handler = getRouteHandler('post', '/:id/step/publish')
    const res = makeRes()
    await handler({ params: { id: 'p1' }, body: { title: 't', description: 'd', tags: [] }, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)
    expect(res.statusCode).toBe(200)
    const saved = db.products.find((r) => r.id === 'p1')!
    expect(saved.images).toEqual(['art-wm.png', 'wall.png', 'desk.png', 'details.png'])
    expect(createWatermarkedDesignAsset).not.toHaveBeenCalled()
  })

  it('makes the watermarked copy synchronously at publish when it is missing, and re-reads the assets', async () => {
    seedPublishableMetal(false)
    createWatermarkedDesignAsset.mockImplementation(async (productId: string) => {
      db.product_assets.push({ id: 'w-new', product_id: productId, kind: 'design_preview', asset_role: 'design_watermarked', url: 'art-wm-new.png', created_at: '2026-01-03' })
    })
    const handler = getRouteHandler('post', '/:id/step/publish')
    const res = makeRes()
    await handler({ params: { id: 'p1' }, body: { title: 't', description: 'd', tags: [] }, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)
    expect(res.statusCode).toBe(200)
    expect(createWatermarkedDesignAsset).toHaveBeenCalledWith('p1', { id: 'src1', url: 'raw.png' })
    const saved = db.products.find((r) => r.id === 'p1')!
    expect(saved.images[0]).toBe('art-wm-new.png')
    expect(saved.images).not.toContain('raw.png')
  })

  it('still honours a client price for a GARMENT publish', async () => {
    seedProduct()
    const p = db.products.find((r) => r.id === 'p1')!
    p.price = 20
    p.metadata.step_flow = {
      version: 1, idea: '', brief: null, garment: 'tshirt', colors: { primary: 'black', extras: [] },
      shots: { product: { approved: true, status: 'done', assetId: 'a1', url: 'ghost.png' } },
      approvals: { design: 'x', garments: 'x', mockups: 'x' },
    }
    db.product_assets.push(
      { id: 'a1', product_id: 'p1', kind: 'mockup', asset_role: 'mockup_ghost_mannequin', url: 'ghost.png', created_at: '2026-01-01' },
      { id: 'w1', product_id: 'p1', kind: 'design_preview', asset_role: 'design_watermarked', url: 'wm.png', created_at: '2026-01-01' },
    )
    const handler = getRouteHandler('post', '/:id/step/publish')
    const res = makeRes()
    await handler({ params: { id: 'p1' }, body: { title: 't', description: 'd', tags: [], price: 27.5 }, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)
    expect(res.statusCode).toBe(200)
    const saved = db.products.find((r) => r.id === 'p1')!
    expect(saved.price).toBe(27.5)
    expect(saved.images).toEqual(['ghost.png', 'wm.png'])
  })
})

// ---------------------------------------------------------------------------
// POST /:id/step/adopt — bring an already-drawn design-library design into the
// flow (David 2026-09-08). The library importer writes the artwork ONLY to
// products.images, so without this the Step Flow's Design step is empty for
// all ~2,700 of them.
// ---------------------------------------------------------------------------
describe('POST /:id/step/adopt — design library into the Step Flow', () => {
  // The route fires the rembg job inline and attaches a .catch to it, so the
  // mocked worker has to hand back a real promise (same as the select-design
  // suites above, which this route shares its implementation with).
  beforeEach(() => {
    processRemoveBgJob.mockResolvedValue(undefined)
  })

  /** A design-library row exactly as scripts/import-designs.mjs writes it: an
   *  image on the product, measured dimensions, and NO product_assets row. */
  function seedLibraryDesign(over: Record<string, any> = {}): void {
    db.products.push({
      id: 'p1',
      name: 'Avocado Cat Cuddle',
      category: 'shirts',
      price: 24.99,
      status: 'draft',
      images: ['https://api.example.test/api/media/design-library/cats/avogato.png'],
      metadata: {
        import_source: 'design-library',
        import_key: 'Cats/avogato',
        collection: 'Cats',
        gcs_path: 'design-library/cats/avogato.png',
        image: { width_px: 4500, height_px: 5400, has_alpha: true },
        ...over,
      },
    })
  }

  it('creates the missing source asset from products.images and selects it', async () => {
    seedLibraryDesign()
    const handler = getRouteHandler('post', '/:id/step/adopt')
    const res = makeRes()
    await handler({ params: { id: 'p1' }, body: {}, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.alreadyAdopted).toBe(false)

    const assets = db.product_assets.filter((a) => a.product_id === 'p1')
    expect(assets).toHaveLength(1)
    expect(assets[0].kind).toBe('source')
    expect(assets[0].asset_role).toBe('design')
    expect(assets[0].url).toBe('https://api.example.test/api/media/design-library/cats/avogato.png')
    // Points at the SAME GCS object the catalog image does — no duplicate upload.
    expect(assets[0].path).toBe('design-library/cats/avogato.png')
    expect(assets[0].width).toBe(4500)
    // Selected, so the Design step opens on it rather than an empty grid.
    expect(assets[0].is_primary).toBe(true)
  })

  it('stamps approvals.design and seeds the idea from the design name', async () => {
    seedLibraryDesign()
    const handler = getRouteHandler('post', '/:id/step/adopt')
    await handler({ params: { id: 'p1' }, body: {}, user: { id: 'u1', sub: 'u1' }, log: undefined }, makeRes())

    const flow = db.products.find((r) => r.id === 'p1')!.metadata.step_flow
    expect(flow.idea).toBe('Avocado Cat Cuddle')
    // No prompt drew this design, so there is no brief to fake.
    expect(flow.brief).toBeNull()
    expect(flow.approvals.design).toBeTruthy()
  })

  it('runs background removal inline on the adopted design', async () => {
    seedLibraryDesign()
    const handler = getRouteHandler('post', '/:id/step/adopt')
    const res = makeRes()
    await handler({ params: { id: 'p1' }, body: {}, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)

    const jobs = db.ai_jobs.filter((j) => j.product_id === 'p1')
    expect(jobs).toHaveLength(1)
    expect(jobs[0].type).toBe('replicate_rembg')
    // Pre-claimed, so the Render worker never double-processes it.
    expect(jobs[0].status).toBe('running')
    await waitUntil(() => processRemoveBgJob.mock.calls.length === 1)
  })

  it('blocks a design that is too small to print, with the reason', async () => {
    seedLibraryDesign({ image: { width_px: 400, height_px: 400, has_alpha: true } })
    const handler = getRouteHandler('post', '/:id/step/adopt')
    const res = makeRes()
    await handler({ params: { id: 'p1' }, body: {}, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)

    // 422, not a silent pass: /step/publish activates directly and never
    // re-runs the design-library grid's print gate.
    expect(res.statusCode).toBe(422)
    expect(res.body.blocked[0].gate).toBe('print')
    expect(res.body.error).toMatch(/print/i)
    expect(db.product_assets).toHaveLength(0)
    expect(db.ai_jobs).toHaveLength(0)
  })

  it('lets a released (knowingly overridden) low-res design through', async () => {
    seedLibraryDesign({
      image: { width_px: 400, height_px: 400, has_alpha: true },
      quarantine: { reason: 'too small', released_at: '2026-09-01T00:00:00.000Z', override_reason: 'sold small only' },
    })
    const handler = getRouteHandler('post', '/:id/step/adopt')
    const res = makeRes()
    await handler({ params: { id: 'p1' }, body: {}, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)
    expect(res.statusCode).toBe(200)
    expect(db.product_assets).toHaveLength(1)
  })

  it('is idempotent — a second adopt makes no second take and no second rembg', async () => {
    seedLibraryDesign()
    const handler = getRouteHandler('post', '/:id/step/adopt')
    await handler({ params: { id: 'p1' }, body: {}, user: { id: 'u1', sub: 'u1' }, log: undefined }, makeRes())
    await waitUntil(() => processRemoveBgJob.mock.calls.length === 1)
    // The cut landed — the second press has nothing left to do.
    db.product_assets.push({ id: 'nobg1', product_id: 'p1', kind: 'nobg', url: 'clear.png', created_at: '2026-01-02' })

    const res = makeRes()
    await handler({ params: { id: 'p1' }, body: {}, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.alreadyAdopted).toBe(true)
    expect(db.product_assets.filter((a) => a.kind === 'source')).toHaveLength(1)
    expect(db.ai_jobs).toHaveLength(1)
  })

  it('re-runs the cut when a previous background removal never produced one', async () => {
    seedLibraryDesign()
    const handler = getRouteHandler('post', '/:id/step/adopt')
    await handler({ params: { id: 'p1' }, body: {}, user: { id: 'u1', sub: 'u1' }, log: undefined }, makeRes())
    await waitUntil(() => processRemoveBgJob.mock.calls.length === 1)
    // No nobg asset ever landed (the cut failed): pressing the button again is
    // the retry — otherwise the Design step dead-ends with nothing to approve.
    const res = makeRes()
    await handler({ params: { id: 'p1' }, body: {}, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)
    expect(res.statusCode).toBe(200)
    expect(db.product_assets.filter((a) => a.kind === 'source')).toHaveLength(1)
    expect(db.ai_jobs).toHaveLength(2)
    await waitUntil(() => processRemoveBgJob.mock.calls.length === 2)
  })

  it('finishes a half-adopted product by selecting the source it already has', async () => {
    seedLibraryDesign()
    db.product_assets.push({
      id: 'src-orphan', product_id: 'p1', kind: 'source', asset_role: 'design',
      url: 'raw.png', is_primary: false, created_at: '2026-01-01',
    })
    const handler = getRouteHandler('post', '/:id/step/adopt')
    const res = makeRes()
    await handler({ params: { id: 'p1' }, body: {}, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.assetId).toBe('src-orphan')
    expect(db.product_assets.filter((a) => a.kind === 'source')).toHaveLength(1)
    expect(db.product_assets.find((a) => a.id === 'src-orphan')!.is_primary).toBe(true)
    expect(db.products.find((r) => r.id === 'p1')!.metadata.step_flow.approvals.design).toBeTruthy()
  })

  it('refuses a product with no design image at all', async () => {
    db.products.push({ id: 'p1', name: 'Empty', category: 'shirts', images: [], metadata: { image: { width_px: 4500, height_px: 5400 } } })
    const handler = getRouteHandler('post', '/:id/step/adopt')
    const res = makeRes()
    await handler({ params: { id: 'p1' }, body: {}, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)
    expect(res.statusCode).toBe(400)
    expect(db.product_assets).toHaveLength(0)
  })
})

describe('POST /:id/step/select-design — status contract after the selectDesignForFlow extraction', () => {
  it('still answers 404 (not 400) for an asset that is not on this product', async () => {
    seedProduct()
    const handler = getRouteHandler('post', '/:id/step/select-design')
    const res = makeRes()
    await handler({ params: { id: 'p1' }, body: { assetId: 'nope' }, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)
    expect(res.statusCode).toBe(404)
  })

  it('still answers 400 when the asset exists but is not a source design', async () => {
    seedProduct()
    db.product_assets.push({ id: 'm1', product_id: 'p1', kind: 'mockup', url: 'mock.png', created_at: '2026-01-01' })
    const handler = getRouteHandler('post', '/:id/step/select-design')
    const res = makeRes()
    await handler({ params: { id: 'p1' }, body: { assetId: 'm1' }, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toMatch(/source design/i)
  })
})

// ---------------------------------------------------------------------------
// GET /step/in-progress — the resume list (David 2026-09-08: "idk where to
// pick up the step flow i already am doing"). A design that has been pulled
// into the flow leaves the Designs grid's to-do view, so this is the list that
// has to be able to find it again.
// ---------------------------------------------------------------------------
describe('GET /step/in-progress — builds waiting to be picked back up', () => {
  const build = (over: Record<string, any>) => ({
    id: 'x', name: 'A design', status: 'draft', images: ['art.png'], category: 'shirts',
    updated_at: '2026-09-08T00:00:00.000Z', metadata: {}, ...over,
  })

  it('lists a build with the step to resume on, and skips untouched designs', async () => {
    db.products.push(
      build({ id: 'started', name: 'Avocado Cat Cuddle', metadata: { collection: 'Cats', import_source: 'design-library', step_flow: { shots: {}, approvals: { design: 'x' } } } }),
      // Never pulled in — still fresh work in the Designs grid, not a build.
      build({ id: 'untouched', metadata: { import_source: 'design-library', collection: 'Cats' } }),
    )
    db.product_assets.push({ id: 'n1', product_id: 'started', kind: 'nobg', url: 'clear.png', created_at: '2026-01-01' })

    const handler = getRouteHandler('get', '/step/in-progress')
    const res = makeRes()
    await handler({ params: {}, query: {}, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)

    expect(res.statusCode).toBe(200)
    expect(res.body.builds).toHaveLength(1)
    expect(res.body.builds[0]).toMatchObject({
      id: 'started',
      name: 'Avocado Cat Cuddle',
      // The cut landed, so the next thing to do is pick a shirt.
      stage: 'garments',
      stageLabel: 'Garment & Color',
      collection: 'Cats',
      fromLibrary: true,
      image: 'art.png',
    })
  })

  it('says Design while the background is still coming off', async () => {
    db.products.push(build({ id: 'cutting', metadata: { step_flow: { shots: {}, approvals: { design: 'x' } } } }))
    const handler = getRouteHandler('get', '/step/in-progress')
    const res = makeRes()
    await handler({ params: {}, query: {}, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)
    expect(res.body.builds[0].stage).toBe('design')
  })

  it('drops a build once it is published — it belongs in the catalog now', async () => {
    db.products.push(
      build({ id: 'live', status: 'active', metadata: { step_flow: { shots: {}, approvals: { design: 'x', listing: 'x' } } } }),
      build({ id: 'still-going', metadata: { step_flow: { garment: 'tshirt', shots: {}, approvals: { design: 'x', garments: 'x' } } } }),
    )
    const handler = getRouteHandler('get', '/step/in-progress')
    const res = makeRes()
    await handler({ params: {}, query: {}, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)
    expect(res.body.builds.map((b: any) => b.id)).toEqual(['still-going'])
    expect(res.body.builds[0].stage).toBe('mockups')
  })

  it('marks a generated (non-library) build as such', async () => {
    db.products.push(build({ id: 'gen', metadata: { step_flow: { brief: { title: 'X' }, shots: {}, approvals: { design: 'x' } } } }))
    const handler = getRouteHandler('get', '/step/in-progress')
    const res = makeRes()
    await handler({ params: {}, query: {}, user: { id: 'u1', sub: 'u1' }, log: undefined }, res)
    expect(res.body.builds[0].fromLibrary).toBe(false)
    expect(res.body.builds[0].collection).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The customer lane (David 2026-09-08). Same router, marked `studioLane:
// 'customer'` by routes/studio-flow.ts once it has authenticated the caller,
// confirmed the creator opt-in, and proven ownership. These cover the two
// places that marking changes behaviour.
// ---------------------------------------------------------------------------
describe('the customer lane', () => {
  function seedPublishableGarment(): void {
    db.products.push({
      id: 'p1',
      category: 't-shirts',
      price: 24,
      metadata: {
        step_flow: {
          version: 1,
          idea: 'hip-hop street monkey',
          brief: { title: 'Street Monkey' },
          garment: 'tshirt',
          shots: { product: { approved: true, status: 'done', assetId: 'm1', url: 'front.png' } },
          approvals: { design: 'x', garments: 'x', mockups: 'x' },
        },
      },
    })
    db.product_assets.push(
      { id: 'src1', product_id: 'p1', kind: 'source', asset_role: 'design', is_primary: true, url: 'raw.png', created_at: '2026-01-01', metadata: {} },
      { id: 'w1', product_id: 'p1', kind: 'design_preview', asset_role: 'design_watermarked', url: 'art-wm.png', created_at: '2026-01-02' },
      { id: 'm1', product_id: 'p1', kind: 'mockup', asset_role: 'mockup_product', url: 'front.png', created_at: '2026-01-01' },
    )
  }

  const finish = async (over: Record<string, any>) => {
    seedPublishableGarment()
    const handler = getRouteHandler('post', '/:id/step/publish')
    const res = makeRes()
    await handler(
      { params: { id: 'p1' }, body: { title: 'Street Monkey Tee', description: 'd', tags: ['tee'], price: 26 }, user: { id: 'u9', sub: 'u9' }, log: undefined, ...over },
      res
    )
    return res
  }

  it('an admin finishing the flow publishes live', async () => {
    const res = await finish({})
    expect(res.statusCode).toBe(200)
    const saved = db.products.find((r) => r.id === 'p1')!
    expect(saved.status).toBe('active')
    expect(saved.is_active).toBe(true)
    expect(saved.metadata.user_submitted).toBeUndefined()
  })

  it('a customer finishing the flow submits for review instead of publishing', async () => {
    const res = await finish({ studioLane: 'customer', creator: { royaltyPercent: 15 } })
    expect(res.statusCode).toBe(200)
    const saved = db.products.find((r) => r.id === 'p1')!
    expect(saved.status).toBe('pending_approval')
    expect(saved.is_active).toBe(false)
  })

  // The review queue (GET /api/admin/user-products/pending) matches on
  // metadata.user_submitted AND the status — a submission carrying only the
  // status would be invisible to the people meant to review it.
  it("stamps the fields the shop's review queue actually filters on", async () => {
    await finish({ studioLane: 'customer', creator: { royaltyPercent: 20 } })
    const saved = db.products.find((r) => r.id === 'p1')!
    expect(saved.metadata.user_submitted).toBe(true)
    expect(saved.metadata.creator_id).toBe('u9')
    expect(saved.metadata.creator_royalty_percent).toBe(20)
    expect(typeof saved.metadata.submitted_at).toBe('string')
    // The listing itself still lands exactly as the admin lane writes it.
    expect(saved.name).toBe('Street Monkey Tee')
    expect(saved.price).toBe(26)
    expect(saved.images.length).toBeGreaterThan(0)
  })

  it("lists only the caller's own unfinished builds", async () => {
    db.products.push(
      { id: 'mine', name: 'Mine', status: 'draft', created_by_user_id: 'u9', updated_at: '2026-01-02', metadata: { step_flow: { brief: { title: 'M' }, shots: {}, approvals: { design: 'x' } } } },
      { id: 'theirs', name: 'Theirs', status: 'draft', created_by_user_id: 'u2', updated_at: '2026-01-03', metadata: { step_flow: { brief: { title: 'T' }, shots: {}, approvals: { design: 'x' } } } }
    )
    const handler = getRouteHandler('get', '/step/in-progress')
    const res = makeRes()
    await handler({ params: {}, query: {}, studioLane: 'customer', user: { id: 'u9', sub: 'u9' }, log: undefined }, res)
    expect(res.body.builds.map((b: any) => b.id)).toEqual(['mine'])
  })
})

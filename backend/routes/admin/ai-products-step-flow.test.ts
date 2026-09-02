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

function matches(row: Row, filters: [string, any][]): boolean {
  return filters.every(([k, v]) => row[k] === v)
}

function makeQuery(table: string) {
  let mode: 'select' | 'insert' | 'update' | 'delete' | null = null
  let payload: any = null
  const filters: [string, any][] = []
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
      filters.push([k, v])
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

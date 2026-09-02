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
    const matched = rows.filter((r) => matches(r, filters))
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
vi.mock('../../services/step-flow/details-card.js', () => ({ renderDetailsCard: vi.fn() }))
vi.mock('../../services/step-flow/brief.js', () => ({ writeStepBrief: vi.fn() }))
vi.mock('../../services/step-flow/color-advice.js', () => ({ adviseColors: vi.fn() }))

const processRemoveBgJob = vi.fn()
const processMockupJob = vi.fn()
vi.mock('../../worker/ai-jobs-worker.js', () => ({
  processRemoveBgJob: (...args: any[]) => processRemoveBgJob(...args),
  processMockupJob: (...args: any[]) => processMockupJob(...args),
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

beforeEach(() => {
  resetDb()
  processRemoveBgJob.mockReset()
  processMockupJob.mockReset()
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

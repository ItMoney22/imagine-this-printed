import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for the Step Flow mockup pipeline (backend/services/step-flow/shots.ts).
//
// Backed by a tiny in-memory fake of `products` / `ai_jobs` / `product_assets`
// so the real job-conventions logic (asset_role pinning via input.mockupRole,
// "old asset kept" on redo, one-approve-per-step gating on approveShot, the
// job-status -> shot-status sync on resolveStepFlow) is exercised without a
// live Supabase project.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.REPLICATE_API_TOKEN ||= 'test-replicate-token'

// --- fake supabase --------------------------------------------------------
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

const shootOneModelShot = vi.fn()
vi.mock('../etsy-model-shots.js', () => ({ shootOneModelShot: (...args: any[]) => shootOneModelShot(...args) }))

const renderDetailsCard = vi.fn()
const renderMetalDetailsCard = vi.fn()
vi.mock('./details-card.js', () => ({
  renderDetailsCard: (...args: any[]) => renderDetailsCard(...args),
  renderMetalDetailsCard: (...args: any[]) => renderMetalDetailsCard(...args),
}))

// Track B (2026-09-02): shots.ts now calls the worker's mockup renderer
// directly/inline instead of leaving the job 'queued' for the worker's poll
// loop to pick up. Mocked here the same way the other real-model/network
// calls above are — a real ai-jobs-worker.js import would pull in Replicate/
// GCS/etc. calls this test file never wants to make.
const processMockupJob = vi.fn()
vi.mock('../../worker/ai-jobs-worker.js', () => ({ processMockupJob: (...args: any[]) => processMockupJob(...args) }))

const {
  queueStepShots,
  redoShot,
  approveShot,
  approveShotsBatch,
  resolveStepFlow,
  defaultShotKeys,
  defaultMetalShotKeys,
  roleForShotKey,
  buildApprovedGallery,
  getStepFlow,
  StepFlowValidationError,
} = await import('./shots.js')

async function waitUntil(fn: () => boolean, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 0))
  }
  throw new Error('waitUntil timed out')
}

function seedProduct(over: Partial<Row> = {}): Row {
  const product = {
    id: 'p1',
    category: 't-shirts',
    metadata: {
      step_flow: {
        version: 1,
        idea: 'street monkey',
        brief: { title: 'Street Monkey' },
        garment: 'tshirt',
        colors: { primary: 'black', extras: ['white'] },
        shots: {},
        approvals: {},
      },
      ...over.metadata,
    },
    ...over,
  }
  db.products.push(product)
  return product
}

/** Same shape as seedProduct but for the metal wall-art lane (design doc §14) — no garment/colors, brief.productKind:'metal', sizes from step/sizes. */
function seedMetalProduct(over: Partial<Row> = {}): Row {
  const product = {
    id: 'p1',
    category: 'metal-art',
    metadata: {
      step_flow: {
        version: 1,
        idea: 'aurora wolf',
        brief: { title: 'Aurora Wolf', productKind: 'metal' },
        sizes: ['4x6', '8x10'],
        shots: {},
        approvals: {},
      },
      ...over.metadata,
    },
    ...over,
  }
  db.products.push(product)
  return product
}

beforeEach(() => {
  resetDb()
  renderMetalDetailsCard.mockReset()
  shootOneModelShot.mockReset()
  renderDetailsCard.mockReset()
  processMockupJob.mockReset()
})

describe('defaultShotKeys', () => {
  it('is product/hanger/model/details plus one color:<id> per extra', () => {
    expect(defaultShotKeys({ primary: 'black', extras: ['white', 'navy'] })).toEqual([
      'product',
      'hanger',
      'model',
      'details',
      'color:white',
      'color:navy',
    ])
  })

  it('excludes the primary from the extras list even if duplicated', () => {
    expect(defaultShotKeys({ primary: 'black', extras: ['black', 'white'] })).toEqual([
      'product',
      'hanger',
      'model',
      'details',
      'color:white',
    ])
  })

  it('is just the four base keys with no extra colors', () => {
    expect(defaultShotKeys({ primary: 'black', extras: [] })).toEqual(['product', 'hanger', 'model', 'details'])
  })
})

describe('roleForShotKey', () => {
  it('maps every key to its gallery asset_role', () => {
    expect(roleForShotKey('product', 'tshirt')).toBe('mockup_ghost_mannequin')
    expect(roleForShotKey('hanger', 'tshirt')).toBe('mockup_hanger')
    expect(roleForShotKey('model', 'tshirt')).toBe('mockup_model_1')
    expect(roleForShotKey('details', 'tshirt')).toBe('mockup_details')
    expect(roleForShotKey('color:navy', 'tshirt')).toBe('mockup_color_navy')
  })
})

describe('buildApprovedGallery', () => {
  // SHOULD-FIX #4/#5: built from the shared backend/shared/product-gallery.ts
  // ROLE_ORDER, but ONLY over assets whose step-flow shot was approved — a
  // rendered-but-unapproved (or since-redone) asset under a tracked role must
  // never reach the storefront just because a product_assets row exists.
  const flowWith = (shots: Record<string, any>): any => ({
    version: 1,
    idea: '',
    brief: null,
    garment: 'tshirt' as const,
    colors: { primary: 'black' as const, extras: [] },
    shots,
    approvals: {},
  })

  it('includes an approved shot and excludes an unapproved one under the same tracked role type', () => {
    const sf = flowWith({
      product: { approved: true, status: 'done', assetId: 'a1', url: 'ghost.png' },
      hanger: { approved: false, status: 'done', assetId: 'a2', url: 'hanger.png' },
    })
    const assets = [
      { id: 'a1', asset_role: 'mockup_ghost_mannequin', url: 'ghost.png', created_at: '2026-01-01' },
      { id: 'a2', asset_role: 'mockup_hanger', url: 'hanger.png', created_at: '2026-01-01' },
    ]
    const { images, approvedFlowCount } = buildApprovedGallery(sf, assets)
    expect(images).toEqual(['ghost.png'])
    expect(approvedFlowCount).toBe(1)
  })

  it('passes non-flow roles (design_watermarked, mr_imagine, pocket) through unfiltered', () => {
    const sf = flowWith({ product: { approved: true, status: 'done', assetId: 'a1', url: 'ghost.png' } })
    const assets = [
      { id: 'a1', asset_role: 'mockup_ghost_mannequin', url: 'ghost.png', created_at: '2026-01-01' },
      { id: 'w1', asset_role: 'design_watermarked', url: 'wm.png', created_at: '2026-01-01' },
    ]
    const { images } = buildApprovedGallery(sf, assets)
    expect(images).toEqual(['ghost.png', 'wm.png'])
  })

  it('reports zero approvedFlowCount when nothing is approved, even if a tracked-role asset exists', () => {
    const sf = flowWith({ product: { approved: false, status: 'done', assetId: 'a1', url: 'ghost.png' } })
    const assets = [{ id: 'a1', asset_role: 'mockup_ghost_mannequin', url: 'ghost.png', created_at: '2026-01-01' }]
    const { images, approvedFlowCount } = buildApprovedGallery(sf, assets)
    expect(images).toEqual([])
    expect(approvedFlowCount).toBe(0)
  })

  it('orders the approved set by the shared ROLE_ORDER (ghost -> hanger -> color -> mr imagine)', () => {
    const sf = flowWith({
      product: { approved: true, status: 'done', assetId: 'a1', url: 'ghost.png' },
      hanger: { approved: true, status: 'done', assetId: 'a2', url: 'hanger.png' },
      'color:navy': { approved: true, status: 'done', assetId: 'a3', url: 'navy.png' },
    })
    const assets = [
      { id: 'a3', asset_role: 'mockup_color_navy', url: 'navy.png', created_at: '2026-01-01' },
      { id: 'mri', asset_role: 'mockup_mr_imagine', url: 'mri.png', created_at: '2026-01-01' },
      { id: 'a2', asset_role: 'mockup_hanger', url: 'hanger.png', created_at: '2026-01-01' },
      { id: 'a1', asset_role: 'mockup_ghost_mannequin', url: 'ghost.png', created_at: '2026-01-01' },
    ]
    const { images } = buildApprovedGallery(sf, assets)
    expect(images).toEqual(['ghost.png', 'hanger.png', 'navy.png', 'mri.png'])
  })
})

describe('queueStepShots', () => {
  it('queues product/hanger/color jobs with mockupRole pinning, defers details, and self-manages the model shot', async () => {
    seedProduct()
    // Real shoots take real seconds; a small macrotask delay here (rather
    // than an instantly-resolved mock) keeps the test honest about ordering —
    // step_flow writes for the OTHER keys in this same queueStepShots() call
    // land first, exactly like production, instead of racing them.
    shootOneModelShot.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ url: 'https://cdn/model.png', check: { ok: true } }), 5))
    )

    const { jobs } = await queueStepShots('p1', 'user-1')
    const keys = jobs.map((j) => j.key)
    expect(keys).toEqual(['product', 'hanger', 'model', 'details', 'color:white'])

    const details = jobs.find((j) => j.key === 'details')!
    expect(details.jobId).toBeNull()

    const hangerJob = db.ai_jobs.find((j) => j.input?.stepKey === 'hanger')
    expect(hangerJob?.type).toBe('replicate_mockup_v2')
    expect(hangerJob?.input?.template).toBe('hanger')
    expect(hangerJob?.input?.mockupRole).toBe('mockup_hanger')

    const colorJob = db.ai_jobs.find((j) => j.input?.stepKey === 'color:white')
    expect(colorJob?.input?.mockupRole).toBe('mockup_color_white')
    expect(colorJob?.input?.shirtColor).toBe('white')

    const productJob = db.ai_jobs.find((j) => j.input?.stepKey === 'product')
    expect(productJob?.input?.mockupRole).toBeUndefined()
    expect(productJob?.input?.shirtColor).toBe('black')

    // Pre-claimed as 'running' at insert time so the worker never touches it;
    // with the mocked shootOneModelShot resolving immediately, the
    // fire-and-forget continuation may already have flipped it to
    // 'succeeded' by the time we check — either is correct, 'queued' is not.
    const modelJob = db.ai_jobs.find((j) => j.type === 'step_flow_model_shot')
    expect(['running', 'succeeded']).toContain(modelJob?.status)

    // Pre-claimed as 'running' at insert, same as the mockup ai_jobs rows
    // above — never 'queued', so the production worker's polling loop never
    // sees these.
    const savedProduct = db.products.find((p) => p.id === 'p1')!
    const sf = getStepFlow(savedProduct)
    expect(sf.shots.product?.status).toBe('running')
    expect(sf.shots.hanger?.approved).toBe(false)
    expect(sf.shots.details).toEqual({ status: 'queued', error: undefined, approved: false })

    // processMockupJob fired inline for each of the 3 mockup-type shots
    // (product/hanger/color:white) — never for 'model' (its own
    // shootOneModelShot path) or 'details' (deferred, no job at all).
    await waitUntil(() => processMockupJob.mock.calls.length === 3)
    expect(hangerJob).toBeDefined()
    expect(colorJob).toBeDefined()
    expect(productJob).toBeDefined()
    const calledIds = processMockupJob.mock.calls.map((args: any[]) => args[0]?.id)
    expect(calledIds.sort()).toEqual([hangerJob!.id, colorJob!.id, productJob!.id].sort())

    // The model shot resolves asynchronously (fire-and-forget) — wait for its
    // continuation to mirror the result into product_assets AND finish
    // patching step_flow (asset-insert and step_flow-patch are two separate
    // awaited writes in that order, so wait on the LATTER).
    await waitUntil(() => getStepFlow(db.products.find((p) => p.id === 'p1')!).shots.model?.status === 'done')
    const finalProduct = db.products.find((p) => p.id === 'p1')!
    const finalSf = getStepFlow(finalProduct)
    expect(db.product_assets.some((a) => a.asset_role === 'mockup_model_1')).toBe(true)
    expect(finalSf.shots.model?.status).toBe('done')
    expect(finalSf.shots.model?.url).toBe('https://cdn/model.png')
  })

  it('throws a StepFlowValidationError when garment/colors are not approved yet', async () => {
    seedProduct({ metadata: { step_flow: { version: 1, idea: '', brief: null, shots: {}, approvals: {} } } })
    await expect(queueStepShots('p1', 'user-1')).rejects.toBeInstanceOf(StepFlowValidationError)
  })

  it('honours an explicit keys[] subset', async () => {
    seedProduct()
    shootOneModelShot.mockResolvedValue({ url: 'https://cdn/model.png', check: { ok: true } })
    const { jobs } = await queueStepShots('p1', 'user-1', ['hanger'])
    expect(jobs.map((j) => j.key)).toEqual(['hanger'])
  })

  // SHOULD-FIX #9
  it('is idempotent for the default fan-out: a shot already queued/running/done is never re-queued', async () => {
    seedProduct({
      metadata: {
        step_flow: {
          version: 1,
          idea: '',
          brief: null,
          garment: 'tshirt',
          colors: { primary: 'black', extras: [] },
          shots: {
            product: { approved: false, status: 'done', assetId: 'a1', url: 'https://cdn/a1.png' },
            hanger: { approved: false, status: 'running', jobId: 'existing-job' },
          },
          approvals: {},
        },
      },
    })
    shootOneModelShot.mockResolvedValue({ url: 'https://cdn/model.png', check: { ok: true } })

    const { jobs } = await queueStepShots('p1', 'user-1')
    const keys = jobs.map((j) => j.key)
    expect(keys).not.toContain('product') // already 'done'
    expect(keys).not.toContain('hanger') // already 'running'
    expect(keys).toContain('model')
    expect(keys).toContain('details')
  })

  it('returns an empty jobs[] (not an error) when the default fan-out finds nothing left to queue', async () => {
    seedProduct({
      metadata: {
        step_flow: {
          version: 1,
          idea: '',
          brief: null,
          garment: 'tshirt',
          colors: { primary: 'black', extras: [] },
          shots: {
            product: { approved: true, status: 'done', assetId: 'a1', url: 'https://cdn/a1.png' },
            hanger: { approved: true, status: 'done', assetId: 'a2', url: 'https://cdn/a2.png' },
            model: { approved: true, status: 'done', assetId: 'a3', url: 'https://cdn/a3.png' },
            details: { approved: true, status: 'done', assetId: 'a4', url: 'https://cdn/a4.png' },
          },
          approvals: {},
        },
      },
    })
    const { jobs } = await queueStepShots('p1', 'user-1')
    expect(jobs).toEqual([])
  })
})

// MUST-FIX #3
describe('runModelShot (via queueStepShots) — design-fidelity QA gating', () => {
  it('marks the model shot failed and does NOT mirror into product_assets when the shot fails QA', async () => {
    seedProduct()
    shootOneModelShot.mockResolvedValue({ url: 'https://cdn/rejected.png', check: { ok: false, reason: 'text was redrawn' } })

    await queueStepShots('p1', 'user-1', ['model'])
    await waitUntil(() => getStepFlow(db.products.find((p) => p.id === 'p1')!).shots.model?.status === 'failed')

    const sf = getStepFlow(db.products.find((p) => p.id === 'p1')!)
    expect(sf.shots.model).toMatchObject({ status: 'failed', error: 'text was redrawn' })
    expect(db.product_assets.some((a) => a.asset_role === 'mockup_model_1')).toBe(false)
  })

  it('still mirrors and marks done when the shot passes QA', async () => {
    seedProduct()
    shootOneModelShot.mockResolvedValue({ url: 'https://cdn/good.png', check: { ok: true } })

    await queueStepShots('p1', 'user-1', ['model'])
    await waitUntil(() => getStepFlow(db.products.find((p) => p.id === 'p1')!).shots.model?.status === 'done')

    expect(db.product_assets.some((a) => a.asset_role === 'mockup_model_1' && a.url === 'https://cdn/good.png')).toBe(true)
  })
})

// Track B (2026-09-02): mockup jobs are pre-claimed 'running' and rendered
// inline via processMockupJob (mirroring processImageJobInline for design
// jobs), with a per-product concurrency cap so a multi-color fan-out doesn't
// burst every render at Replicate at once.
describe('processMockupJob wiring — inline render, never the worker queue', () => {
  it('marks the shot (and the ai_jobs row) failed when processMockupJob throws', async () => {
    seedProduct()
    processMockupJob.mockRejectedValueOnce(new Error('replicate refused'))

    await queueStepShots('p1', 'user-1', ['hanger'])
    await waitUntil(() => getStepFlow(db.products.find((p) => p.id === 'p1')!).shots.hanger?.status === 'failed')

    const sf = getStepFlow(db.products.find((p) => p.id === 'p1')!)
    expect(sf.shots.hanger).toMatchObject({ status: 'failed', error: 'replicate refused' })

    const hangerJob = db.ai_jobs.find((j) => j.input?.stepKey === 'hanger')
    expect(hangerJob?.status).toBe('failed')
    expect(hangerJob?.error).toBe('replicate refused')
  })

  it('caps concurrent mockup renders at 3 per product; extra shots queue for a free slot', async () => {
    seedProduct({
      metadata: {
        step_flow: {
          version: 1,
          idea: '',
          brief: null,
          garment: 'tshirt',
          colors: { primary: 'black', extras: ['white', 'navy', 'red'] },
          shots: {},
          approvals: {},
        },
      },
    })
    shootOneModelShot.mockResolvedValue({ url: 'https://cdn/model.png', check: { ok: true } })

    // Each call parks on an unresolved promise until the test releases it —
    // lets us observe exactly how many are in flight at once.
    const resolvers: Array<() => void> = []
    processMockupJob.mockImplementation(() => new Promise<void>((resolve) => resolvers.push(resolve)))

    // Default fan-out = product, hanger, model, details, color:white,
    // color:navy, color:red — 5 of those 7 are mockup-type (go through
    // processMockupJob); model/details don't.
    await queueStepShots('p1', 'user-1')

    await waitUntil(() => resolvers.length === 3)
    // Give any 4th call a chance to sneak in before asserting it didn't.
    await new Promise((r) => setTimeout(r, 5))
    expect(resolvers.length).toBe(3)
    expect(processMockupJob).toHaveBeenCalledTimes(3)

    // Release the 3 in-flight renders — the 2 queued ones should backfill.
    resolvers.splice(0).forEach((resolve) => resolve())
    await waitUntil(() => processMockupJob.mock.calls.length === 5)

    // Drain the last 2 so no state leaks into another test via the
    // module-level per-product slot map.
    resolvers.splice(0).forEach((resolve) => resolve())
  })
})

describe('redoShot', () => {
  it('keeps the old asset visible and resets approved=false, with a fresh job', async () => {
    seedProduct({
      metadata: {
        step_flow: {
          version: 1,
          idea: '',
          brief: null,
          garment: 'tshirt',
          colors: { primary: 'black', extras: [] },
          shots: {
            hanger: { jobId: 'old-job', assetId: 'old-asset', url: 'https://cdn/old-hanger.png', approved: true, status: 'done' },
          },
          approvals: {},
        },
      },
    })

    const { job } = await redoShot('p1', 'user-1', 'hanger')
    expect(job.id).not.toBe('old-job')
    expect(job.status).toBe('running') // pre-claimed, not left 'queued' for the worker

    const sf = getStepFlow(db.products.find((p) => p.id === 'p1')!)
    expect(sf.shots.hanger?.approved).toBe(false)
    expect(sf.shots.hanger?.assetId).toBe('old-asset') // old asset kept until the redo lands
    expect(sf.shots.hanger?.jobId).toBe(job.id)
  })

  it('renders details synchronously when the product shot is done', async () => {
    // MUST-FIX #8: renderDetailsShot reads the mockup URL straight off
    // step_flow.shots.product (not a separate product_assets-by-role query)
    // so the "ready?" gate and the render use the SAME source of truth.
    seedProduct({
      metadata: {
        step_flow: {
          version: 1,
          idea: '',
          brief: { title: 'Street Monkey' },
          garment: 'tshirt',
          colors: { primary: 'black', extras: [] },
          shots: {
            product: { approved: true, status: 'done', assetId: 'product-asset-1', url: 'https://cdn/ghost.png' },
            details: { approved: false, status: 'queued' },
          },
          approvals: {},
        },
      },
    })
    renderDetailsCard.mockResolvedValue({ buffer: Buffer.from(''), url: 'https://cdn/details.png', path: 'x', assetId: 'details-1' })

    const { job } = await redoShot('p1', 'user-1', 'details')
    expect(job.id).toBeNull()
    expect(job.status).toBe('done')
    expect(renderDetailsCard).toHaveBeenCalledWith(expect.objectContaining({ mockupUrl: 'https://cdn/ghost.png', garment: 'tshirt' }))

    const sf = getStepFlow(db.products.find((p) => p.id === 'p1')!)
    expect(sf.shots.details?.assetId).toBe('details-1')
    // MUST-FIX #8: stamps which product-shot assetId the card was built from.
    expect(sf.shots.details?.sourceAssetId).toBe('product-asset-1')
  })

  it('rejects redoing details before the product shot exists', async () => {
    seedProduct({
      metadata: {
        step_flow: {
          version: 1,
          idea: '',
          brief: null,
          garment: 'tshirt',
          colors: { primary: 'black', extras: [] },
          shots: { details: { approved: false, status: 'queued' } },
          approvals: {},
        },
      },
    })
    await expect(redoShot('p1', 'user-1', 'details')).rejects.toBeInstanceOf(StepFlowValidationError)
  })
})

describe('approveShot', () => {
  it('validates that assetId belongs to the product', async () => {
    seedProduct()
    db.product_assets.push({ id: 'other-asset', product_id: 'OTHER-PRODUCT', url: 'https://cdn/x.png' })
    await expect(approveShot('p1', 'hanger', true, 'other-asset')).rejects.toBeInstanceOf(StepFlowValidationError)
  })

  it('stamps approvals.mockups once every tracked shot is approved or failed', async () => {
    seedProduct({
      metadata: {
        step_flow: {
          version: 1,
          idea: '',
          brief: null,
          garment: 'tshirt',
          colors: { primary: 'black', extras: [] },
          shots: {
            product: { approved: false, status: 'done', assetId: 'a1', url: 'https://cdn/a1.png' },
            hanger: { approved: false, status: 'done', assetId: 'a2', url: 'https://cdn/a2.png' },
            model: { approved: false, status: 'failed', error: 'boom' },
            details: { approved: false, status: 'done', assetId: 'a3', url: 'https://cdn/a3.png' },
          },
          approvals: {},
        },
      },
    })

    await approveShot('p1', 'product', true)
    await approveShot('p1', 'hanger', true)
    const { step_flow } = await approveShot('p1', 'details', true)

    // model is 'failed' (skippable) — approving the other three should be
    // enough to stamp the group approval.
    expect(step_flow.approvals.mockups).toBeTruthy()
  })

  // MUST-FIX #2
  it('treats an explicitly skipped shot as settled for the group approval, without marking it approved', async () => {
    seedProduct({
      metadata: {
        step_flow: {
          version: 1,
          idea: '',
          brief: null,
          garment: 'tshirt',
          colors: { primary: 'black', extras: [] },
          shots: {
            product: { approved: false, status: 'done', assetId: 'a1', url: 'https://cdn/a1.png' },
            hanger: { approved: false, status: 'failed', error: 'design flagged' },
            model: { approved: false, status: 'done', assetId: 'a3', url: 'https://cdn/a3.png' },
            details: { approved: false, status: 'done', assetId: 'a4', url: 'https://cdn/a4.png' },
          },
          approvals: {},
        },
      },
    })

    await approveShot('p1', 'product', true)
    await approveShot('p1', 'hanger', false, undefined, true) // explicit skip — the admin looked at the QA flag and moved on
    await approveShot('p1', 'model', true)
    const { step_flow } = await approveShot('p1', 'details', true)

    expect(step_flow.shots.hanger).toMatchObject({ approved: false, skipped: true })
    expect(step_flow.approvals.mockups).toBeTruthy()
  })

  // MUST-FIX #1a/#1b — this is exactly the "Approve all" race: N calls fire
  // in parallel for DIFFERENT keys on the SAME product. Under the old
  // read-modify-write-with-no-lock implementation, every call read the same
  // starting snapshot and only the last write survived — this would have
  // failed with only one of the four approvals persisted.
  it('persists every key from N parallel approveShot calls (simulates "Approve all")', async () => {
    seedProduct({
      metadata: {
        step_flow: {
          version: 1,
          idea: '',
          brief: null,
          garment: 'tshirt',
          colors: { primary: 'black', extras: [] },
          shots: {
            product: { approved: false, status: 'done', assetId: 'a1', url: 'https://cdn/a1.png' },
            hanger: { approved: false, status: 'done', assetId: 'a2', url: 'https://cdn/a2.png' },
            model: { approved: false, status: 'done', assetId: 'a3', url: 'https://cdn/a3.png' },
            details: { approved: false, status: 'done', assetId: 'a4', url: 'https://cdn/a4.png' },
          },
          approvals: {},
        },
      },
    })

    await Promise.all([
      approveShot('p1', 'product', true),
      approveShot('p1', 'hanger', true),
      approveShot('p1', 'model', true),
      approveShot('p1', 'details', true),
    ])

    const sf = getStepFlow(db.products.find((p) => p.id === 'p1')!)
    expect(sf.shots.product?.approved).toBe(true)
    expect(sf.shots.hanger?.approved).toBe(true)
    expect(sf.shots.model?.approved).toBe(true)
    expect(sf.shots.details?.approved).toBe(true)
    expect(sf.approvals.mockups).toBeTruthy()
  })

  // MUST-FIX #1c: the new batch route's underlying function, exercised
  // directly — "Approve all" is meant to call this ONCE instead of firing N
  // parallel approveShot calls.
  it('approveShotsBatch approves every listed key in one locked write', async () => {
    seedProduct({
      metadata: {
        step_flow: {
          version: 1,
          idea: '',
          brief: null,
          garment: 'tshirt',
          colors: { primary: 'black', extras: [] },
          shots: {
            product: { approved: false, status: 'done', assetId: 'a1', url: 'https://cdn/a1.png' },
            hanger: { approved: false, status: 'done', assetId: 'a2', url: 'https://cdn/a2.png' },
          },
          approvals: {},
        },
      },
    })

    const { step_flow } = await approveShotsBatch('p1', [
      { key: 'product', approved: true },
      { key: 'hanger', approved: true },
    ])
    expect(step_flow.shots.product?.approved).toBe(true)
    expect(step_flow.shots.hanger?.approved).toBe(true)
  })
})

describe('resolveStepFlow', () => {
  // Every mutation now goes through patchShotState's lock (re-reads/writes
  // the real `db.products` row), so — unlike the old blind-whole-object-save
  // version — these fixtures must actually be seeded into `db.products`
  // whenever the test expects a write (a "touched" case).

  it('promotes a shot to done once its job succeeds and the asset has landed', async () => {
    const product = { id: 'p1', category: 't-shirts', metadata: { step_flow: {
      version: 1, idea: '', brief: null, garment: 'tshirt' as const, colors: { primary: 'black' as const, extras: [] },
      shots: { hanger: { jobId: 'job-1', approved: false, status: 'queued' as const } }, approvals: {},
    } } }
    db.products.push(product)
    const jobs = [{ id: 'job-1', status: 'succeeded' }]
    const assets = [{ id: 'asset-1', asset_role: 'mockup_hanger', url: 'https://cdn/hanger.png', created_at: '2026-01-01' }]

    const sf = await resolveStepFlow(product as any, assets, jobs)
    expect(sf.shots.hanger).toMatchObject({ status: 'done', assetId: 'asset-1', url: 'https://cdn/hanger.png' })
  })

  it('marks a shot failed when its job failed', async () => {
    const product = { id: 'p1', category: 't-shirts', metadata: { step_flow: {
      version: 1, idea: '', brief: null, garment: 'tshirt' as const, colors: { primary: 'black' as const, extras: [] },
      shots: { hanger: { jobId: 'job-1', approved: false, status: 'queued' as const } }, approvals: {},
    } } }
    db.products.push(product)
    const jobs = [{ id: 'job-1', status: 'failed', error: 'model refused' }]
    const sf = await resolveStepFlow(product as any, [], jobs)
    expect(sf.shots.hanger).toMatchObject({ status: 'failed', error: 'model refused' })
  })

  // MUST-FIX #11
  it('fails a job that succeeded but landed no asset under its role', async () => {
    const product = { id: 'p1', category: 't-shirts', metadata: { step_flow: {
      version: 1, idea: '', brief: null, garment: 'tshirt' as const, colors: { primary: 'black' as const, extras: [] },
      shots: { hanger: { jobId: 'job-1', approved: false, status: 'queued' as const } }, approvals: {},
    } } }
    db.products.push(product)
    const jobs = [{ id: 'job-1', status: 'succeeded' }]
    const sf = await resolveStepFlow(product as any, [], jobs) // no matching asset in `assets`
    expect(sf.shots.hanger).toMatchObject({ status: 'failed', error: 'render finished, no asset landed' })
  })

  // MUST-FIX #11
  it('fails a shot stuck running for more than 15 minutes', async () => {
    const product = { id: 'p1', category: 't-shirts', metadata: { step_flow: {
      version: 1, idea: '', brief: null, garment: 'tshirt' as const, colors: { primary: 'black' as const, extras: [] },
      shots: { hanger: { jobId: 'job-1', approved: false, status: 'running' as const } }, approvals: {},
    } } }
    db.products.push(product)
    const staleCreatedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    const jobs = [{ id: 'job-1', status: 'running', created_at: staleCreatedAt }]
    const sf = await resolveStepFlow(product as any, [], jobs)
    expect(sf.shots.hanger).toMatchObject({ status: 'failed', error: 'stale — no result after 15 minutes, redo this shot' })
  })

  it('leaves details queued (not failed) when the product shot has not landed yet', async () => {
    const product = { id: 'p1', category: 't-shirts', metadata: { step_flow: {
      version: 1, idea: '', brief: null, garment: 'tshirt' as const, colors: { primary: 'black' as const, extras: [] },
      shots: { details: { approved: false, status: 'queued' as const } }, approvals: {},
    } } }
    const sf = await resolveStepFlow(product as any, [], [])
    expect(sf.shots.details?.status).toBe('queued')
    expect(renderDetailsCard).not.toHaveBeenCalled()
  })

  it('renders details once the product shot is done, and stamps sourceAssetId', async () => {
    const product = { id: 'p1', category: 't-shirts', metadata: { step_flow: {
      version: 1, idea: '', brief: { title: 'x' }, garment: 'tshirt' as const, colors: { primary: 'black' as const, extras: [] },
      shots: {
        product: { approved: true, status: 'done' as const, assetId: 'ga1', url: 'https://cdn/ghost.png' },
        details: { approved: false, status: 'queued' as const },
      },
      approvals: {},
    } } }
    db.products.push(product)
    renderDetailsCard.mockResolvedValue({ buffer: Buffer.from(''), url: 'https://cdn/details.png', path: 'x', assetId: 'd1' })

    const sf = await resolveStepFlow(product as any, [], [])
    expect(sf.shots.details).toMatchObject({ status: 'done', assetId: 'd1', url: 'https://cdn/details.png', sourceAssetId: 'ga1' })
  })

  // MUST-FIX #8: a redo of the product shot (new assetId) must re-render an
  // already-'done' details card instead of leaving it showing the old take.
  it('re-renders details when the product shot has been redone (assetId changed)', async () => {
    const product = { id: 'p1', category: 't-shirts', metadata: { step_flow: {
      version: 1, idea: '', brief: { title: 'x' }, garment: 'tshirt' as const, colors: { primary: 'black' as const, extras: [] },
      shots: {
        product: { approved: true, status: 'done' as const, assetId: 'ga2-new', url: 'https://cdn/ghost-new.png' },
        details: { approved: true, status: 'done' as const, assetId: 'd1', url: 'https://cdn/details.png', sourceAssetId: 'ga1-old' },
      },
      approvals: {},
    } } }
    db.products.push(product)
    renderDetailsCard.mockResolvedValue({ buffer: Buffer.from(''), url: 'https://cdn/details-2.png', path: 'x', assetId: 'd2' })

    const sf = await resolveStepFlow(product as any, [], [])
    expect(renderDetailsCard).toHaveBeenCalledWith(expect.objectContaining({ mockupUrl: 'https://cdn/ghost-new.png' }))
    expect(sf.shots.details).toMatchObject({ assetId: 'd2', sourceAssetId: 'ga2-new' })
  })

  // MUST-FIX #2
  it('marks details failed, without attempting to render, when the product shot itself failed', async () => {
    const product = { id: 'p1', category: 't-shirts', metadata: { step_flow: {
      version: 1, idea: '', brief: null, garment: 'tshirt' as const, colors: { primary: 'black' as const, extras: [] },
      shots: {
        product: { approved: false, status: 'failed' as const, error: 'model refused' },
        details: { approved: false, status: 'queued' as const },
      },
      approvals: {},
    } } }
    db.products.push(product)

    const sf = await resolveStepFlow(product as any, [], [])
    expect(sf.shots.details).toMatchObject({ status: 'failed', error: 'source shot failed — nothing to render' })
    expect(renderDetailsCard).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Metal prints lane (design doc §14, David 2026-09-02) — a completely
// different shot set from garments: scene:<size> per SELECTED panel size
// (no product/hanger/model/color:* keys) plus a metal-variant details card,
// composed from the largest selected size's scene.
// ---------------------------------------------------------------------------

describe('defaultMetalShotKeys', () => {
  it('is one scene:<size> per selected size, smallest first, plus details', () => {
    expect(defaultMetalShotKeys(['8x10', '4x6'])).toEqual(['scene:4x6', 'scene:8x10', 'details'])
  })

  it('is just the one selected size plus details', () => {
    expect(defaultMetalShotKeys(['4x6'])).toEqual(['scene:4x6', 'details'])
  })

  it('is just details when no sizes are selected', () => {
    expect(defaultMetalShotKeys([])).toEqual(['details'])
  })
})

describe('roleForShotKey — metal', () => {
  it('maps scene:<size> to mockup_metal_<size>, with no garment needed', () => {
    expect(roleForShotKey('scene:4x6')).toBe('mockup_metal_4x6')
    expect(roleForShotKey('scene:8x10')).toBe('mockup_metal_8x10')
    expect(roleForShotKey('details')).toBe('mockup_details')
  })

  it('still throws for a "product" key with no garment', () => {
    expect(() => roleForShotKey('product')).toThrow(/garment is required/)
  })
})

describe('queueStepShots — metal', () => {
  it('queues one scene job per selected size with mockupRole pinning, and defers details', async () => {
    seedMetalProduct()

    const { jobs } = await queueStepShots('p1', 'user-1')
    const keys = jobs.map((j) => j.key)
    expect(keys).toEqual(['scene:4x6', 'scene:8x10', 'details'])

    const details = jobs.find((j) => j.key === 'details')!
    expect(details.jobId).toBeNull()

    const smallJob = db.ai_jobs.find((j) => j.input?.stepKey === 'scene:4x6')
    expect(smallJob?.type).toBe('replicate_mockup_v2')
    expect(smallJob?.input?.template).toBe('metal_shelf')
    expect(smallJob?.input?.metalSize).toBe('4x6')
    expect(smallJob?.input?.mockupRole).toBe('mockup_metal_4x6')
    expect(smallJob?.input?.printPlacement).toBe('not-applicable')

    const largeJob = db.ai_jobs.find((j) => j.input?.stepKey === 'scene:8x10')
    expect(largeJob?.input?.template).toBe('metal_wall')
    expect(largeJob?.input?.metalSize).toBe('8x10')
    expect(largeJob?.input?.mockupRole).toBe('mockup_metal_8x10')

    // Never a garment-flow key.
    expect(keys).not.toContain('product')
    expect(keys).not.toContain('hanger')
    expect(keys).not.toContain('model')
    expect(keys.some((k) => k.startsWith('color:'))).toBe(false)

    const savedProduct = db.products.find((p) => p.id === 'p1')!
    const sf = getStepFlow(savedProduct)
    expect(sf.shots['scene:4x6' as any]?.status).toBe('running')
    expect(sf.shots.details).toEqual({ status: 'queued', error: undefined, approved: false })

    await waitUntil(() => processMockupJob.mock.calls.length === 2)
    const calledIds = processMockupJob.mock.calls.map((args: any[]) => args[0]?.id)
    expect(calledIds.sort()).toEqual([smallJob!.id, largeJob!.id].sort())
  })

  it('queues only the one selected size when just one is picked', async () => {
    seedMetalProduct({ metadata: { step_flow: { version: 1, idea: 'x', brief: { title: 'x', productKind: 'metal' }, sizes: ['4x6'], shots: {}, approvals: {} } } })
    const { jobs } = await queueStepShots('p1', 'user-1')
    expect(jobs.map((j) => j.key)).toEqual(['scene:4x6', 'details'])
  })

  it('throws a StepFlowValidationError when no sizes have been selected yet', async () => {
    seedMetalProduct({ metadata: { step_flow: { version: 1, idea: 'x', brief: { title: 'x', productKind: 'metal' }, shots: {}, approvals: {} } } })
    await expect(queueStepShots('p1', 'user-1')).rejects.toThrow(StepFlowValidationError)
  })
})

describe('redoShot — metal', () => {
  it('re-queues a single scene job, keeping the old asset in place until the redo lands', async () => {
    seedMetalProduct({
      metadata: {
        step_flow: {
          version: 1, idea: 'x', brief: { title: 'x', productKind: 'metal' }, sizes: ['4x6', '8x10'],
          shots: { 'scene:4x6': { approved: true, status: 'done', assetId: 'old-1', url: 'https://cdn/old-4x6.png' } },
          approvals: {},
        },
      },
    })

    const { job } = await redoShot('p1', 'user-1', 'scene:4x6' as any)
    expect(job.status).toBe('running')

    const sf = getStepFlow(db.products.find((p) => p.id === 'p1')!)
    // Old asset/url survive until the (mocked, async) render lands.
    expect(sf.shots['scene:4x6' as any]?.assetId).toBe('old-1')
    expect(sf.shots['scene:4x6' as any]?.approved).toBe(false)
  })

  it('rejects an unknown key for the currently selected sizes', async () => {
    seedMetalProduct({ metadata: { step_flow: { version: 1, idea: 'x', brief: { title: 'x', productKind: 'metal' }, sizes: ['4x6'], shots: {}, approvals: {} } } })
    await expect(redoShot('p1', 'user-1', 'scene:8x10' as any)).rejects.toThrow(/Unknown shot key/)
  })
})

describe('resolveStepFlow — metal details card', () => {
  it('renders the metal details card from the LARGEST selected size once it is done', async () => {
    const product = {
      id: 'p1',
      category: 'metal-art',
      metadata: {
        step_flow: {
          version: 1, idea: 'x', brief: { title: 'Aurora Wolf', productKind: 'metal' }, sizes: ['4x6', '8x10'],
          shots: {
            'scene:4x6': { approved: true, status: 'done', assetId: 's46', url: 'https://cdn/4x6.png' },
            'scene:8x10': { approved: true, status: 'done', assetId: 's810', url: 'https://cdn/8x10.png' },
            details: { approved: false, status: 'queued' },
          },
          approvals: {},
        },
      },
    }
    db.products.push(product)
    renderMetalDetailsCard.mockResolvedValue({ buffer: Buffer.from(''), url: 'https://cdn/details.png', path: 'x', assetId: 'd1' })

    const sf = await resolveStepFlow(product as any, [], [])

    expect(renderMetalDetailsCard).toHaveBeenCalledWith(
      expect.objectContaining({ mockupUrl: 'https://cdn/8x10.png', sizes: ['4x6', '8x10'], title: 'Aurora Wolf' })
    )
    expect(sf.shots.details).toMatchObject({ status: 'done', assetId: 'd1', url: 'https://cdn/details.png', sourceAssetId: 's810' })
  })

  it('falls back to the smaller size when only it is done', async () => {
    const product = {
      id: 'p1',
      category: 'metal-art',
      metadata: {
        step_flow: {
          version: 1, idea: 'x', brief: { title: 'Aurora Wolf', productKind: 'metal' }, sizes: ['4x6', '8x10'],
          shots: {
            'scene:4x6': { approved: true, status: 'done', assetId: 's46', url: 'https://cdn/4x6.png' },
            'scene:8x10': { approved: false, status: 'running' },
            details: { approved: false, status: 'queued' },
          },
          approvals: {},
        },
      },
    }
    db.products.push(product)
    renderMetalDetailsCard.mockResolvedValue({ buffer: Buffer.from(''), url: 'https://cdn/details.png', path: 'x', assetId: 'd1' })

    await resolveStepFlow(product as any, [], [])
    expect(renderMetalDetailsCard).toHaveBeenCalledWith(expect.objectContaining({ mockupUrl: 'https://cdn/4x6.png' }))
  })

  it('never touches renderDetailsCard (the garment card) for a metal product', async () => {
    const product = {
      id: 'p1',
      category: 'metal-art',
      metadata: {
        step_flow: {
          version: 1, idea: 'x', brief: { title: 'x', productKind: 'metal' }, sizes: ['4x6'],
          shots: {
            'scene:4x6': { approved: true, status: 'done', assetId: 's46', url: 'https://cdn/4x6.png' },
            details: { approved: false, status: 'queued' },
          },
          approvals: {},
        },
      },
    }
    db.products.push(product)
    renderMetalDetailsCard.mockResolvedValue({ buffer: Buffer.from(''), url: 'https://cdn/details.png', path: 'x', assetId: 'd1' })

    await resolveStepFlow(product as any, [], [])
    expect(renderDetailsCard).not.toHaveBeenCalled()
  })
})

describe('buildApprovedGallery — metal ordering', () => {
  const metalFlowWith = (shots: Record<string, any>): any => ({
    version: 1,
    idea: '',
    brief: { title: 'x', productKind: 'metal' },
    sizes: ['4x6', '8x10'],
    shots,
    approvals: {},
  })

  it('orders 8x10 before 4x6 before details, per the shared ROLE_ORDER', () => {
    const sf = metalFlowWith({
      'scene:4x6': { approved: true, status: 'done', assetId: 'a1', url: 'small.png' },
      'scene:8x10': { approved: true, status: 'done', assetId: 'a2', url: 'large.png' },
      details: { approved: true, status: 'done', assetId: 'a3', url: 'details.png' },
    })
    const assets = [
      { id: 'a3', asset_role: 'mockup_details', url: 'details.png', created_at: '2026-01-01' },
      { id: 'a1', asset_role: 'mockup_metal_4x6', url: 'small.png', created_at: '2026-01-01' },
      { id: 'a2', asset_role: 'mockup_metal_8x10', url: 'large.png', created_at: '2026-01-01' },
    ]
    const { images, approvedFlowCount } = buildApprovedGallery(sf, assets)
    expect(images).toEqual(['large.png', 'small.png', 'details.png'])
    expect(approvedFlowCount).toBe(3)
  })

  it('excludes an unapproved metal scene the same way a garment shot is excluded', () => {
    const sf = metalFlowWith({
      'scene:4x6': { approved: false, status: 'done', assetId: 'a1', url: 'small.png' },
      'scene:8x10': { approved: true, status: 'done', assetId: 'a2', url: 'large.png' },
    })
    const assets = [
      { id: 'a1', asset_role: 'mockup_metal_4x6', url: 'small.png', created_at: '2026-01-01' },
      { id: 'a2', asset_role: 'mockup_metal_8x10', url: 'large.png', created_at: '2026-01-01' },
    ]
    const { images } = buildApprovedGallery(sf, assets)
    expect(images).toEqual(['large.png'])
  })
})

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
vi.mock('./details-card.js', () => ({ renderDetailsCard: (...args: any[]) => renderDetailsCard(...args) }))

const {
  queueStepShots,
  redoShot,
  approveShot,
  resolveStepFlow,
  defaultShotKeys,
  roleForShotKey,
  buildStepFlowGallery,
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

beforeEach(() => {
  resetDb()
  shootOneModelShot.mockReset()
  renderDetailsCard.mockReset()
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

describe('buildStepFlowGallery', () => {
  it('orders fixed roles first, then color roles, then the tail roles', () => {
    const images = buildStepFlowGallery([
      { asset_role: 'design_watermarked', url: 'w.png', created_at: '2026-01-01' },
      { asset_role: 'mockup_color_navy', url: 'navy.png', created_at: '2026-01-01' },
      { asset_role: 'mockup_flat_lay', url: 'flat.png', created_at: '2026-01-01' },
      { asset_role: 'mockup_ghost_mannequin', url: 'ghost.png', created_at: '2026-01-01' },
      { asset_role: 'mockup_hanger', url: 'hanger.png', created_at: '2026-01-01' },
    ])
    expect(images).toEqual(['ghost.png', 'flat.png', 'hanger.png', 'navy.png', 'w.png'])
  })

  it('newest asset wins when a role has duplicates', () => {
    const images = buildStepFlowGallery([
      { asset_role: 'mockup_hanger', url: 'old.png', created_at: '2026-01-01' },
      { asset_role: 'mockup_hanger', url: 'new.png', created_at: '2026-01-02' },
    ])
    expect(images).toEqual(['new.png'])
  })

  it('falls back to display-order mockups when no asset_role matches the whitelist', () => {
    const images = buildStepFlowGallery([
      { kind: 'mockup', asset_role: null, url: 'legacy2.png', display_order: 2 },
      { kind: 'mockup', asset_role: null, url: 'legacy1.png', display_order: 1 },
    ])
    expect(images).toEqual(['legacy1.png', 'legacy2.png'])
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

    const savedProduct = db.products.find((p) => p.id === 'p1')!
    const sf = getStepFlow(savedProduct)
    expect(sf.shots.product?.status).toBe('queued')
    expect(sf.shots.hanger?.approved).toBe(false)
    expect(sf.shots.details).toEqual({ status: 'queued', error: undefined, approved: false })

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
    expect(job.status).toBe('queued')

    const sf = getStepFlow(db.products.find((p) => p.id === 'p1')!)
    expect(sf.shots.hanger?.approved).toBe(false)
    expect(sf.shots.hanger?.assetId).toBe('old-asset') // old asset kept until the redo lands
    expect(sf.shots.hanger?.jobId).toBe(job.id)
  })

  it('renders details synchronously when the product asset already exists', async () => {
    seedProduct({
      metadata: {
        step_flow: {
          version: 1,
          idea: '',
          brief: { title: 'Street Monkey' },
          garment: 'tshirt',
          colors: { primary: 'black', extras: [] },
          shots: { details: { approved: false, status: 'queued' } },
          approvals: {},
        },
      },
    })
    db.product_assets.push({
      id: 'product-asset-1',
      product_id: 'p1',
      asset_role: 'mockup_ghost_mannequin',
      url: 'https://cdn/ghost.png',
      created_at: '2026-01-01',
    })
    renderDetailsCard.mockResolvedValue({ buffer: Buffer.from(''), url: 'https://cdn/details.png', path: 'x', assetId: 'details-1' })

    const { job } = await redoShot('p1', 'user-1', 'details')
    expect(job.id).toBeNull()
    expect(job.status).toBe('done')
    expect(renderDetailsCard).toHaveBeenCalledWith(expect.objectContaining({ mockupUrl: 'https://cdn/ghost.png', garment: 'tshirt' }))

    const sf = getStepFlow(db.products.find((p) => p.id === 'p1')!)
    expect(sf.shots.details?.assetId).toBe('details-1')
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
})

describe('resolveStepFlow', () => {
  it('promotes a shot to done once its job succeeds and the asset has landed', async () => {
    const product = { id: 'p1', category: 't-shirts', metadata: { step_flow: {
      version: 1, idea: '', brief: null, garment: 'tshirt' as const, colors: { primary: 'black' as const, extras: [] },
      shots: { hanger: { jobId: 'job-1', approved: false, status: 'queued' as const } }, approvals: {},
    } } }
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
    const jobs = [{ id: 'job-1', status: 'failed', error: 'model refused' }]
    const sf = await resolveStepFlow(product as any, [], jobs)
    expect(sf.shots.hanger).toMatchObject({ status: 'failed', error: 'model refused' })
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

  it('renders details once the product asset exists', async () => {
    const product = { id: 'p1', category: 't-shirts', metadata: { step_flow: {
      version: 1, idea: '', brief: { title: 'x' }, garment: 'tshirt' as const, colors: { primary: 'black' as const, extras: [] },
      shots: { details: { approved: false, status: 'queued' as const } }, approvals: {},
    } } }
    db.product_assets.push({ id: 'ga1', product_id: 'p1', asset_role: 'mockup_ghost_mannequin', url: 'https://cdn/ghost.png', created_at: '2026-01-01' })
    renderDetailsCard.mockResolvedValue({ buffer: Buffer.from(''), url: 'https://cdn/details.png', path: 'x', assetId: 'd1' })

    const sf = await resolveStepFlow(product as any, [], [])
    expect(sf.shots.details).toMatchObject({ status: 'done', assetId: 'd1', url: 'https://cdn/details.png' })
  })
})

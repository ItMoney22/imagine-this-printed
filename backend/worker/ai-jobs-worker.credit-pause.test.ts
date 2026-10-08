import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

// End-to-end: the REAL worker loop (processQueuedJobs -> startJob ->
// processMockupJob -> image-flow -> runReplicate) against an in-memory Supabase,
// with Replicate answered at the network edge. Nothing between the HTTP 402 and
// the ai_jobs row is mocked, so this proves the whole chain the 65 failed
// mockups went through now pauses instead of failing (task dbce13a8).
//
// Mocked: the Supabase client (in-memory tables below), GCS uploads, the
// mockup QA vision call, the team email sender, the Flare print-true renderer
// and the OpenAI probe. Global fetch plays Replicate, Becky's and Jessica's
// endpoints, and the design file.

const h = vi.hoisted(() => {
  type Row = Record<string, any>
  const PK: Record<string, string> = { admin_settings: 'key' }
  const tables: Record<string, Row[]> = {}
  let seq = 0
  const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))
  const rowsOf = (t: string) => (tables[t] ||= [])

  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
    let payload: any
    let returning = false
    let order: [string, boolean] | null = null
    let limit: number | null = null
    let mode: 'many' | 'single' | 'maybeSingle' = 'many'
    const val = (r: Row, c: string) => (r[c] === undefined ? null : r[c])

    const exec = () => {
      const all = rowsOf(table)
      const pk = PK[table] ?? 'id'
      const now = new Date().toISOString()
      let out: Row[] = []
      if (op === 'insert' || op === 'upsert') {
        for (const item of Array.isArray(payload) ? payload : [payload]) {
          const row = { created_at: now, updated_at: now, ...clone(item) }
          if (pk === 'id' && !row.id) row.id = `row-${++seq}`
          const existing = all.findIndex((r) => r[pk] === row[pk])
          if (existing >= 0 && op === 'insert') {
            return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${table}_pkey"` } }
          }
          if (existing >= 0) all[existing] = { ...all[existing], ...row }
          else all.push(row)
          out.push(row)
        }
      } else {
        out = all.filter((r) => filters.every((f) => f(r)))
        if (op === 'update') for (const r of out) Object.assign(r, clone(payload))
        if (op === 'delete') tables[table] = all.filter((r) => !out.includes(r))
        if (op === 'select') {
          if (order) {
            const [c, asc] = order
            out = [...out].sort((a, b) => (val(a, c) < val(b, c) ? -1 : val(a, c) > val(b, c) ? 1 : 0) * (asc ? 1 : -1))
          }
          if (limit != null) out = out.slice(0, limit)
        }
      }
      const data = clone(out)
      if (op !== 'select' && !returning) return { data: null, error: null }
      if (mode === 'single') return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'not one row' } }
      if (mode === 'maybeSingle') return { data: data[0] ?? null, error: null }
      return { data, error: null }
    }

    const b: any = {
      select() { if (op !== 'select') returning = true; return b },
      insert(p: any) { op = 'insert'; payload = p; return b },
      upsert(p: any) { op = 'upsert'; payload = p; return b },
      update(p: any) { op = 'update'; payload = p; return b },
      delete() { op = 'delete'; return b },
      eq(c: string, v: any) { filters.push((r) => val(r, c) === v); return b },
      neq(c: string, v: any) { filters.push((r) => val(r, c) !== v); return b },
      in(c: string, vs: any[]) { filters.push((r) => vs.includes(val(r, c))); return b },
      is(c: string, v: any) { filters.push((r) => val(r, c) === v); return b },
      not(c: string, o: string, v: any) { if (o === 'is') filters.push((r) => val(r, c) !== v); return b },
      lt(c: string, v: any) { filters.push((r) => val(r, c) !== null && val(r, c) < v); return b },
      gt(c: string, v: any) { filters.push((r) => val(r, c) !== null && val(r, c) > v); return b },
      order(c: string, o?: { ascending?: boolean }) { order = [c, o?.ascending !== false]; return b },
      limit(n: number) { limit = n; return b },
      single() { mode = 'single'; return b },
      maybeSingle() { mode = 'maybeSingle'; return b },
      then(res: any, rej: any) { return Promise.resolve().then(exec).then(res, rej) },
    }
    return b
  }

  const INSUFFICIENT =
    '{"title":"Insufficient credit","detail":"You have insufficient credit to run this model. Go to https://replicate.com/account/billing#billing to purchase credit. Once you purchase credit, please wait a few minutes before trying again.","status":402}\n'

  const state = {
    replicateCredit: true,
    replicateBroken: false,
    openaiCredit: true,
    counts: { generations: 0, probes: 0, cancels: 0, becky: 0, jessica: 0 },
  }

  const fetchStub = async (url: string, init: any = {}) => {
    const headers = init.headers || {}
    if (url.startsWith('https://api.replicate.com/v1/models/') && init.method === 'POST') {
      const isProbe = !headers.Prefer
      if (isProbe) state.counts.probes++
      else state.counts.generations++
      if (!state.replicateCredit) return new Response(INSUFFICIENT, { status: 402 })
      if (state.replicateBroken) return new Response('{"detail":"internal error"}', { status: 500 })
      if (isProbe) {
        return Response.json({ id: 'probe-1', status: 'starting', urls: { cancel: 'https://api.replicate.com/v1/predictions/probe-1/cancel' } }, { status: 201 })
      }
      return Response.json({ id: `pred-${state.counts.generations}`, status: 'succeeded', output: 'https://replicate.delivery/out.png' }, { status: 201 })
    }
    if (url.endsWith('/cancel')) { state.counts.cancels++; return new Response('{}', { status: 200 }) }
    if (url.endsWith('/api/phone/ops-ping')) { state.counts.becky++; return new Response('{}', { status: 200 }) }
    if (url.endsWith('/api/notify/household')) { state.counts.jessica++; return new Response('{}', { status: 200 }) }
    if (url.startsWith('https://cdn.test/')) return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 })
    throw new Error(`unexpected fetch ${url}`)
  }

  return {
    db: { from },
    tables,
    rowsOf,
    reset() { for (const k of Object.keys(tables)) delete tables[k]; seq = 0 },
    state,
    fetchStub,
    sendEmail: null as any,
    INSUFFICIENT,
  }
})

vi.mock('../lib/supabase.js', () => ({ supabase: h.db }))
vi.mock('../services/google-cloud-storage.js', () => ({
  uploadImageFromUrl: async (_url: string, path: string) => ({ publicUrl: `https://gcs.test/${path}`, path }),
  uploadImageFromBuffer: async (_buf: Buffer, path: string) => ({ publicUrl: `https://gcs.test/${path}`, path }),
  uploadImageFromBase64: async (_b64: string, path: string) => ({ publicUrl: `https://gcs.test/${path}`, path }),
}))
vi.mock('../services/mockup-qa.js', () => ({
  verifyWithOneRetry: async (_design: string, url: string) => ({ url, check: { ok: true } }),
}))
vi.mock('../utils/email.js', async (orig) => {
  const { vi: v } = await import('vitest')
  h.sendEmail = v.fn(async () => true)
  return { ...(await orig<any>()), sendEmail: h.sendEmail }
})
vi.mock('../services/print-true-mockup.js', async () => {
  const { ProviderOutOfCreditError } = await import('../services/provider-credit.js')
  return {
    supportsPrintTrue: () => true,
    renderPrintTrueMockup: async () => {
      if (!h.state.openaiCredit) {
        // What the OpenAI SDK actually throws on an empty wallet.
        throw Object.assign(new Error('429 You have no credits remaining. Add credits to continue using the API.'), {
          status: 429,
          code: 'insufficient_quota',
        })
      }
      void ProviderOutOfCreditError
      return { buffer: Buffer.from('png'), modelId: 'openai/gpt-image-2.5-flare' }
    },
  }
})
vi.mock('../services/image-flow/providers/openai-image.js', async (orig) => ({
  ...(await orig<any>()),
  probeOpenAIImageCredit: async () =>
    h.state.openaiCredit ? { outcome: 'ok', detail: 'test image rendered' } : { outcome: 'out_of_credit', detail: '429 no credits' },
}))

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.REPLICATE_API_TOKEN = 'test-replicate-token'
process.env.PRINT_BRIDGE_TOKEN = 'test-bridge'
process.env.WATCHTOWER_INTERNAL_SECRET = 'test-secret'
process.env.WATCHTOWER_URL = 'https://dt.test'
delete process.env.MOCKUP_FLUX2_SINGLE_CALL

const { processQueuedJobs, processMockupJob } = await import('./ai-jobs-worker.js')
const { createImageCreditGate } = await import('../services/image-credit-outage.js')
const { ProviderOutOfCreditError } = await import('../services/provider-credit.js')

const PRODUCT = 'prod-1'
let clock = Date.parse('2026-10-07T12:00:00Z')

function at(minutes: number) {
  clock += minutes * 60_000
  vi.setSystemTime(clock)
}

function seedProduct() {
  h.rowsOf('products').push({ id: PRODUCT, slug: 'walk-by-faith', name: 'Walk By Faith', metadata: {}, images: ['https://cdn.test/design.png'] })
}

let jobSeq = 0
function queueMockup(input: Record<string, any> = {}, status = 'queued') {
  const id = `job-${++jobSeq}`
  const created = new Date(clock + jobSeq).toISOString()
  h.rowsOf('ai_jobs').push({
    id,
    product_id: PRODUCT,
    type: 'replicate_mockup_v2',
    status,
    input: { template: 'flat_lay', design_url: 'https://cdn.test/design.png', ...input },
    output: null,
    error: null,
    prediction_id: null,
    created_at: created,
    updated_at: created,
  })
  return id
}

const job = (id: string) => h.rowsOf('ai_jobs').find((j) => j.id === id)!
const statuses = () => Object.fromEntries(h.rowsOf('ai_jobs').map((j) => [j.id, j.status]))
const alerts = () => ({
  bell: h.rowsOf('admin_notifications').length,
  email: h.sendEmail.mock.calls.length,
  becky: h.state.counts.becky,
  jessica: h.state.counts.jessica,
})
const outage = (p: string) => h.rowsOf('admin_settings').find((r) => r.key === `image_credit_outage:${p}`)

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(clock)
  vi.stubGlobal('fetch', h.fetchStub)
})

afterAll(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('a Replicate credit outage, start to finish, through the real worker loop', () => {
  let a: string, b: string, flare: string, d: string, inline: string

  it('402 pauses: the job is blocked (not failed), the queue behind it is held, ONE alert goes out', async () => {
    h.reset()
    seedProduct()
    h.state.replicateCredit = false
    a = queueMockup()
    b = queueMockup()
    flare = queueMockup({ engine: 'print-true' }) // OpenAI path — has money, must keep running

    await processQueuedJobs()

    expect(statuses()).toEqual({ [a]: 'blocked', [b]: 'blocked', [flare]: 'succeeded' })
    expect(job(a).error).toMatch(/^Paused, not failed/)
    expect(job(a).output.blocked).toMatchObject({ provider: 'replicate' })
    expect(job(a).output.blocked.detail).toMatch(/402.*Insufficient credit/)
    expect(job(b).output.blocked).toMatchObject({ provider: 'replicate' })

    // Exactly one Replicate call was spent finding out: the flux single-call
    // did NOT fall through to the 2-step chain, and B was never attempted.
    expect(h.state.counts.generations).toBe(1)

    expect(alerts()).toEqual({ bell: 1, email: 1, becky: 1, jessica: 1 })
    expect(h.rowsOf('admin_notifications')[0]).toMatchObject({ type: 'health_alert', title: 'Image queue paused: Replicate is out of credit' })
    expect(h.sendEmail.mock.calls[0][0].subject).toBe('Image queue paused: Replicate is out of credit')
    expect(outage('replicate')?.value).toMatchObject({
      provider: 'replicate',
      first_job_id: a,
      held_jobs: 1,
      alert: { bell: true, email: true, becky: true, jessica: true },
    })
    expect(h.rowsOf('ai_jobs').filter((j) => j.status === 'failed')).toHaveLength(0)
  })

  it('while paused the queue spends nothing: a new job is held without a Replicate call', async () => {
    at(1)
    d = queueMockup()
    await processQueuedJobs()

    expect(job(d).status).toBe('blocked')
    expect(h.state.counts.generations).toBe(1)
    expect(h.state.counts.probes).toBe(0) // first probe is due 5 min after the outage opened
    expect(alerts()).toEqual({ bell: 1, email: 1, becky: 1, jessica: 1 })
  })

  it('a second 402 while paused (an inline Step Flow render in the API process) blocks without re-alerting', async () => {
    inline = queueMockup({ stepKey: 'product' }, 'running')
    await processMockupJob(job(inline))

    expect(job(inline).status).toBe('blocked')
    expect(h.state.counts.generations).toBe(2)
    expect(alerts()).toEqual({ bell: 1, email: 1, becky: 1, jessica: 1 })
  })

  it('a probe that still finds no credit keeps everything paused and says so on the outage row', async () => {
    at(5)
    await processQueuedJobs()

    expect(h.state.counts.probes).toBe(1)
    expect(outage('replicate')?.value).toMatchObject({ probes: 1, last_probe: { outcome: 'out_of_credit' } })
    expect(statuses()).toMatchObject({ [a]: 'blocked', [b]: 'blocked', [d]: 'blocked', [inline]: 'blocked' })
    expect(alerts()).toEqual({ bell: 1, email: 1, becky: 1, jessica: 1 })
  })

  it('credit comes back: the next probe resumes the queue and every held job renders, no manual re-queue', async () => {
    h.state.replicateCredit = true
    at(2)
    await processQueuedJobs()
    expect(h.state.counts.probes).toBe(1) // not due yet — 5 min since the last probe

    at(4)
    await processQueuedJobs()

    expect(h.state.counts.probes).toBe(2)
    expect(h.state.counts.cancels).toBe(1) // the probe's prediction was cancelled, not rendered
    expect(outage('replicate')).toBeUndefined()
    expect(h.rowsOf('admin_settings').find((r) => r.key === 'image_credit_outage_last:replicate')?.value).toMatchObject({
      provider: 'replicate',
      closed_by: { outcome: 'ok' },
    })
    expect(statuses()).toEqual({ [a]: 'succeeded', [b]: 'succeeded', [flare]: 'succeeded', [d]: 'succeeded', [inline]: 'succeeded' })
    for (const id of [a, b, d, inline]) {
      expect(job(id).error).toBeNull()
      expect(job(id).output.url).toMatch(/^https:\/\/gcs\.test\/mockups\//)
    }
    expect(job(a).output).toBeTruthy()
    expect(h.rowsOf('product_assets').filter((p) => p.kind === 'mockup').length).toBeGreaterThan(0)
    // Still exactly the one alert for the whole outage.
    expect(alerts()).toEqual({ bell: 1, email: 1, becky: 1, jessica: 1 })
  })
})

describe('an empty OpenAI wallet pauses only the OpenAI work', () => {
  it('blocks the Flare mockup, keeps rendering Replicate mockups, and resumes on the probe', async () => {
    h.reset()
    h.sendEmail.mockClear()
    h.state.counts = { generations: 0, probes: 0, cancels: 0, becky: 0, jessica: 0 }
    seedProduct()
    h.state.replicateCredit = true
    h.state.openaiCredit = false
    const flare = queueMockup({ engine: 'print-true' })
    const flux = queueMockup()

    await processQueuedJobs()

    expect(statuses()).toEqual({ [flare]: 'blocked', [flux]: 'succeeded' })
    expect(job(flare).output.blocked.provider).toBe('openai')
    expect(outage('openai')?.value.alert.bell).toBe(true)
    expect(outage('replicate')).toBeUndefined()
    expect(alerts()).toEqual({ bell: 1, email: 1, becky: 1, jessica: 1 })
    expect(h.rowsOf('admin_notifications')[0].title).toBe('Image queue paused: OpenAI is out of credit')

    h.state.openaiCredit = true
    at(6)
    await processQueuedJobs()

    expect(job(flare).status).toBe('succeeded')
    expect(outage('openai')).toBeUndefined()
    expect(alerts()).toEqual({ bell: 1, email: 1, becky: 1, jessica: 1 })
  })
})

describe('ordinary failures are untouched', () => {
  it('a genuine generation error still fails the job, with no pause and no alert', async () => {
    h.reset()
    h.sendEmail.mockClear()
    h.state.counts = { generations: 0, probes: 0, cancels: 0, becky: 0, jessica: 0 }
    seedProduct()
    h.state.replicateCredit = true
    h.state.replicateBroken = true
    const id = queueMockup()

    await processQueuedJobs()
    h.state.replicateBroken = false

    expect(job(id).status).toBe('failed')
    expect(job(id).error).toMatch(/500/)
    expect(job(id).output?.blocked).toBeUndefined()
    expect(h.rowsOf('admin_settings')).toHaveLength(0)
    expect(alerts()).toEqual({ bell: 0, email: 0, becky: 0, jessica: 0 })
  })
})

describe('one alert even when two processes hit the 402 at the same moment', () => {
  it('the worker and the API process race; the admin_settings primary key lets exactly one alert', async () => {
    h.reset()
    seedProduct()
    const x = queueMockup({}, 'running')
    const y = queueMockup({}, 'running')
    const sendAlert = vi.fn(async () => ({ email: true, bell: true, becky: true, jessica: true, errors: [] }))
    const deps = { db: h.db, now: () => new Date(), sendAlert, probe: vi.fn() }
    const worker = createImageCreditGate(deps)
    const api = createImageCreditGate(deps)
    const err = new ProviderOutOfCreditError('replicate', `replicate black-forest-labs/flux-2-pro 402: ${h.INSUFFICIENT}`, { status: 402 })

    const [p, q] = await Promise.all([
      worker.handleFailure(job(x), err),
      api.handleFailure(job(y), err),
    ])

    expect([p, q]).toEqual([true, true])
    expect(statuses()).toEqual({ [x]: 'blocked', [y]: 'blocked' })
    expect(sendAlert).toHaveBeenCalledTimes(1)
  })

  it('a non-image job type with a 402 is left to its own failure path', async () => {
    const sendAlert = vi.fn()
    const gate = createImageCreditGate({ db: h.db, now: () => new Date(), sendAlert, probe: vi.fn() })
    const handled = await gate.handleFailure({ id: 'tripo-1', type: '3d_model_tripo' }, new ProviderOutOfCreditError('replicate', 'x'))
    expect(handled).toBe(false)
    expect(sendAlert).not.toHaveBeenCalled()
  })

  it('a blocked job whose outage row is gone (closed by a crashed process, or deleted by hand) goes back in the queue', async () => {
    h.reset()
    seedProduct()
    const orphan = queueMockup({}, 'blocked')
    job(orphan).output = { blocked: { provider: 'replicate', since: new Date().toISOString() } }
    job(orphan).error = 'Paused, not failed'
    const gate = createImageCreditGate({ db: h.db, now: () => new Date(), sendAlert: vi.fn(), probe: vi.fn() })

    await gate.tick()

    expect(job(orphan).status).toBe('queued')
    expect(job(orphan).error).toBeNull()
    expect(job(orphan).output.credit_hold).toMatchObject({ provider: 'replicate' })
  })
})

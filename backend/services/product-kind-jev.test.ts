// Jev's read of what a product is (task 28ab467c): what it is shown, when it
// is asked at all, and that every failure falls back to the floor.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const jevFetch = vi.fn()
vi.stubGlobal('fetch', (...args: any[]) => jevFetch(...args))

const {
  buildProductKindQuestions,
  buildProductKindState,
  hasKindWords,
  productKindMinConfidence,
  productKindMode,
  readProductKind,
  resolveProductKind,
} = await import('./product-kind-jev.js')

const answer = (choice: string, confidence: number) => ({
  answers: { product_kind: { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } } },
})

const env = { ...process.env }
beforeEach(() => {
  jevFetch.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  process.env = { ...env }
  vi.restoreAllMocks()
})

describe('what Jev is shown', () => {
  it('reads the WORDS only — never the category, product_type or garment it is checked against', () => {
    const state = buildProductKindState({
      name: 'Toy: Robo Rascal',
      category: 'shirts',
      description: 'A chunky robot figure.',
      search_keywords: 'robot toy, desk figure',
      metadata: { product_type: 'tshirt', garment: 'tshirt', step_flow: { idea: 'a robot toy for kids' } },
    })
    expect(state).toEqual({
      product_name: 'Toy: Robo Rascal',
      design_idea: 'a robot toy for kids',
      description: 'A chunky robot figure.',
      keywords: 'robot toy, desk figure',
    })
    expect(JSON.stringify(state)).not.toMatch(/shirts|tshirt/)
  })

  it('asks one multi-option choice with a description per option', () => {
    const q = buildProductKindQuestions().product_kind
    expect(q.type).toBe('choice')
    expect(Object.keys(q.criteria)).toEqual(['hoodie', 'tee', 'youth_tee', 'metal', 'transfer', '3d', 'tumbler', 'other'])
    expect(q.instructions).toMatch(/SUBJECT never decides it/)
  })

  it('reads an answer strictly: off-menu or malformed is no answer', () => {
    expect(readProductKind(answer('3d', 0.9) as any)).toEqual({ choice: '3d', confidence: 0.9 })
    expect(readProductKind(answer('mug', 0.99) as any)).toBeNull()
    expect(readProductKind({ answers: { product_kind: { type: 'choice', choice: 'tee' } } } as any)).toBeNull()
    expect(readProductKind(null)).toBeNull()
  })
})

describe('rollout switches', () => {
  it('defaults to shadow and a 0.85 bar', () => {
    delete process.env.PRODUCT_KIND_JEV
    delete process.env.PRODUCT_KIND_JEV_MIN_CONFIDENCE
    expect(productKindMode()).toBe('shadow')
    expect(productKindMinConfidence()).toBe(0.85)
    process.env.PRODUCT_KIND_JEV = 'ON'
    process.env.PRODUCT_KIND_JEV_MIN_CONFIDENCE = '0.9'
    expect(productKindMode()).toBe('on')
    expect(productKindMinConfidence()).toBe(0.9)
    process.env.PRODUCT_KIND_JEV_MIN_CONFIDENCE = '7'
    expect(productKindMinConfidence()).toBe(0.85)
  })
})

describe('resolveProductKind', () => {
  const tee = { id: 'p1', name: 'Neon Koi Galaxy T-Shirt', category: 'shirts' }

  it('never asks Jev about an admin-set category', async () => {
    const ask = vi.fn(async () => answer('hoodie', 0.99) as any)
    const d = await resolveProductKind({ ...tee, metadata: { category_source: 'admin' } }, { mode: 'on', ask })
    expect(ask).not.toHaveBeenCalled()
    expect(d).toMatchObject({ kind: 'tee', source: 'admin' })
  })

  it('does not ask when off, or when the product has no words to read', async () => {
    const ask = vi.fn(async () => answer('tee', 0.99) as any)
    await resolveProductKind(tee, { mode: 'off', ask })
    expect(hasKindWords({ category: 'shirts' })).toBe(false)
    const wordless = await resolveProductKind({ category: 'shirts' }, { mode: 'on', ask })
    expect(ask).not.toHaveBeenCalled()
    expect(wordless).toMatchObject({ kind: 'tee', source: 'floor', needsReview: false })
  })

  it('routes a sure contradiction to review in on mode, and only logs it in shadow', async () => {
    const ask = vi.fn(async () => answer('transfer', 0.93) as any)
    expect(await resolveProductKind(tee, { mode: 'on', ask })).toMatchObject({ kind: 'tee', needsReview: true })
    expect(await resolveProductKind(tee, { mode: 'shadow', ask })).toMatchObject({ kind: 'tee', needsReview: false })
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/\[product-kind\] shadow "Neon Koi Galaxy T-Shirt" p1: floor=tee.*jev=transfer@0\.93 status=disagrees/))
  })

  it('fails open when the ask throws', async () => {
    const d = await resolveProductKind(tee, { mode: 'on', ask: async () => { throw new Error('boom') } })
    expect(d).toMatchObject({ kind: 'tee', source: 'floor', needsReview: false })
    expect(d.jev.status).toBe('unavailable')
  })

  it('fails open through the real client: no key, an HTTP error, or a timeout all mean "no answer"', async () => {
    delete process.env.OPENROUTER_API_KEY
    expect((await resolveProductKind(tee, { mode: 'on' })).jev.status).toBe('unavailable')
    expect(jevFetch).not.toHaveBeenCalled()

    process.env.OPENROUTER_API_KEY = 'test-key'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    jevFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
    expect(await resolveProductKind(tee, { mode: 'on' })).toMatchObject({ kind: 'tee', source: 'floor', needsReview: false })

    jevFetch.mockResolvedValueOnce({ ok: true, json: async () => answer('tee', 0.97) })
    expect(await resolveProductKind(tee, { mode: 'on' })).toMatchObject({ kind: 'tee', source: 'jev' })
    const [url, init] = jevFetch.mock.calls.at(-1)!
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions')
    const body = JSON.parse(init.body)
    expect(body.questions.product_kind.type).toBe('choice')
    expect(body.state).not.toHaveProperty('category')
  })
})

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// ---------------------------------------------------------------------------
// The Jev copy pass and the vision gate (Watchtower task 728d9207).
//
// What must hold:
//   1. The unfulfillable-claim FLOOR catches every NOT_OFFERED product and is
//      never cleared by Jev — but does not fire on a design SUBJECT (a Sherman
//      tank, Marco Polo) or on metal art, which really is sublimated.
//   2. Every Jev question is a multi-option choice or a rubric score with a
//      written description per option — never the mushy yes/no type.
//   3. Under the confidence bar is "no opinion": a person reads it.
//   4. Shadow mode changes no verdict and never skips vision.
//   5. Enforce mode skips vision ONLY when the submission is already certain to
//      fail — never because the copy looks fine.
//   6. Jev down = the gate behaves exactly as it did before Jev.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  process.env.OPENAI_API_KEY = 'test-openai'
  process.env.OPENROUTER_API_KEY = 'test-openrouter'
  const visionCreate = { calls: 0, impl: null as null | (() => unknown) }
  return { visionCreate }
})

vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: async () => {
          h.visionCreate.calls++
          return h.visionCreate.impl?.() ?? {
            choices: [{ message: { content: JSON.stringify({
              realistic: true, centered: true, hasText: false, typographyOk: true,
              backgroundPanel: false, printOnFabric: true
            }) } }]
          }
        }
      }
    }
  }
}))

const metricsState = vi.hoisted(() => ({ sharpness: 900 }))
vi.mock('./image-metrics.js', async (orig) => ({
  ...(await orig<typeof import('./image-metrics.js')>()),
  measureImages: async (urls: string[]) => urls.map(url => ({
    url, ok: true, width: 2000, height: 2000, shortEdge: 2000, longEdge: 2000, sharpness: metricsState.sharpness
  })),
  measureOpacity: async (url: string) => ({
    url, ok: true, hasAlphaChannel: true, transparentFraction: 0.4, opaqueBorderFraction: 0.05,
    borderMeanLuma: 250, checkerboardBackground: false, borderPattern: null
  })
}))
vi.mock('./mockup-qa.js', async (orig) => ({
  ...(await orig<typeof import('./mockup-qa.js')>()),
  checkMockup: async () => ({ ok: true })
}))

const {
  findUnfulfillableClaims, buildCopyQuestions, interpretCopyReview, decideVision, runPresentationQa,
  UNFULFILLABLE_PATTERNS, JEV_BLOCK_CONFIDENCE, TAG_RELEVANCE_RUBRIC, COPY_CLASSES
} = await import('./presentation-qa.js')
const { setJevTransport } = await import('./jev.js')
const { NOT_OFFERED } = await import('../shared/catalog-capability.js')
type PresentationInput = import('./presentation-qa.js').PresentationInput

const tags = [
  'sherman tank tee', 'army history shirt', 'ww2 veteran gift', 'military dad gift', 'vintage army tee',
  'tank lover gift', 'history buff shirt', 'patriotic graphic', 'armor enthusiast', 'war history tee',
  'military tee men', 'veteran day gift', 'army graphic tee'
]
const input = (over: Partial<PresentationInput> = {}): PresentationInput => ({
  productId: 'p1',
  name: 'Sherman Tank Tee',
  channel: 'etsy',
  category: 'shirts',
  designUrl: 'https://cdn/designs/sherman.png',
  mockupUrls: [
    'https://cdn/mockups/sherman/ghost_mannequin/1.png',
    'https://cdn/mockups/sherman/flat_lay/2.png',
    'https://cdn/mockups/sherman/lifestyle/3.png'
  ],
  placement: 'front-center',
  printSizeInches: 11,
  title: 'Sherman Tank WW2 History Tee | Vintage Army Graphic Shirt',
  description:
    'A vintage-style Sherman tank graphic for the history buff who can name every variant.\n' +
    'THE DESIGN: a distressed side profile of the M4 with stencilled lettering.\n' +
    'THE SHIRT: soft unisex crew-neck tee with a vibrant DTF print that will not crack.\n' +
    'SIZING: true to size; size up for an oversized fit. Youth sizes on the same listing.\n' +
    'Made to order and printed in Rockmart, Georgia. CARE: wash cold inside out.',
  tags,
  price: 24.95,
  ...over
})

/** A Jev body answering copy_class / title / every tag. */
const jevBody = (copyClass: string, confidence: number, tagScore = 2.8, tagCount = tags.length) => {
  const answers: Record<string, unknown> = {
    copy_class: { type: 'choice', choice: copyClass, confidence },
    title_quality: { type: 'score', score: 2.7, confidence: 0.9 }
  }
  for (let i = 0; i < tagCount; i++) answers[`tag_${i}`] = { type: 'score', score: tagScore, confidence: 0.9 }
  return { answers, usage: { input_tokens: 800, output_tokens: 90, cost: 0.00003 }, model: 'typesafe/jev-1.13' }
}
const jevResult = (copyClass: string, confidence: number, tagScore = 2.8) => ({
  ...jevBody(copyClass, confidence, tagScore), durationMs: 300
}) as any

let jevCalls = 0
const serveJev = (body: unknown | 'down') => setJevTransport((async () => {
  jevCalls++
  if (body === 'down') throw new Error('ECONNRESET')
  return new Response(JSON.stringify(body), { status: 200 })
}) as typeof fetch)

beforeEach(() => {
  h.visionCreate.calls = 0
  h.visionCreate.impl = null
  metricsState.sharpness = 900
  jevCalls = 0
  delete process.env.PRESENTATION_QA_JEV
  delete process.env.JEV
})
afterAll(() => setJevTransport(null))

describe('findUnfulfillableClaims — the deterministic floor', () => {
  it('has a pattern for every NOT_OFFERED entry, so the list and the floor cannot drift', () => {
    expect(Object.keys(UNFULFILLABLE_PATTERNS).sort()).toEqual([...NOT_OFFERED].sort())
  })

  it.each([
    ['Embroidered Floral Tee', 'embroidery'],
    ['Retro Sunset Tank Top', 'tank top'],
    ['Golf Club Polo Shirt', 'polo shirt'],
    ['Vivid Sublimated Graphic Tee', 'sublimation printing'],
    ['Summer racerback tank', 'tank top'],
    ['Sleeveless Gym Graphic Top', 'tank top']
  ])('flags "%s" on apparel', (title, label) => {
    expect(findUnfulfillableClaims({ category: 'shirts', title, description: '', tags: [] }).map(x => x.label)).toContain(label)
  })

  it.each([
    'Sherman Tank WW2 History Tee',
    'Marco Polo Explorer Map Shirt',
    'Fish Tank Aquarium Lover Tee',
    'Polo Pony Sketch Graphic Tee'
  ])('does not flag a design SUBJECT: "%s"', title => {
    expect(findUnfulfillableClaims({ category: 'shirts', title, description: '', tags: [] })).toEqual([])
  })

  it('does not flag sublimation on metal art, which really is sublimated — but still flags embroidery there', () => {
    const metal = { category: 'metal-art', title: 'Dye-Sublimated Aluminium Wolf Print', description: 'vivid sublimated print', tags: [] }
    expect(findUnfulfillableClaims(metal)).toEqual([])
    expect(findUnfulfillableClaims({ ...metal, description: 'embroidered look' }).map(x => x.label)).toEqual(['embroidery'])
  })

  it('checks tags and the description, not just the title', () => {
    const hits = findUnfulfillableClaims({ category: 'hoodies', title: 'Wolf Hoodie', description: 'Also comes embroidered.', tags: ['tank top gift'] })
    expect(hits.map(x => x.field).sort()).toEqual(['description', 'tags'])
  })
})

describe('buildCopyQuestions — conforms to the jev-decisions rules', () => {
  const { questions, state, tagKeys } = buildCopyQuestions(input())

  it('asks the copy class as a four-way choice with a description per option', () => {
    const q = questions.copy_class
    expect(q.type).toBe('choice')
    expect(Object.keys(q.criteria).sort()).toEqual([...COPY_CLASSES].sort())
    for (const text of Object.values(q.criteria as Record<string, string>)) expect(text.length).toBeGreaterThan(40)
  })

  it('scores the title and every tag on a four-rung rubric (answer is an index 0-3)', () => {
    expect(questions.title_quality).toMatchObject({ type: 'score' })
    expect((questions.title_quality.criteria as string[]).length).toBe(4)
    expect(tagKeys.length).toBe(tags.length)
    for (const k of tagKeys) expect(questions[k]).toMatchObject({ type: 'score', criteria: TAG_RELEVANCE_RUBRIC })
  })

  it('never uses the yes/no type', () => {
    for (const q of Object.values(questions)) expect(['choice', 'score']).toContain(q.type)
  })

  it('tells the model what the shop makes and does NOT make for this category', () => {
    expect(String(state.product)).toMatch(/DTF/)
    expect(String(state.not_made_by_this_shop)).toMatch(/embroidery/)
    expect(String(buildCopyQuestions(input({ category: 'metal-art' })).state.not_made_by_this_shop)).not.toMatch(/sublimation/)
  })

  it('tells the model a "<Garment> — Blank" apparel listing has no design (task e0a39743)', () => {
    const blankState = buildCopyQuestions(input({ name: 'Classic Tee — Blank', title: 'Classic Unisex Blank Tee — Black', description: 'Soft 100% cotton crew-neck blank, true to size.' })).state
    expect(String(blankState.product)).toMatch(/BLANK/)
    expect(String(blankState.product)).toMatch(/NO printed design/)
  })

  it('does not add the blank fact to a normal printed listing', () => {
    expect(String(state.product)).not.toMatch(/BLANK/)
  })

  it('only treats "blank" in the name as a blank on apparel categories', () => {
    const nonApparel = buildCopyQuestions(input({ category: 'tumblers', name: 'Blank Tumbler 20oz' })).state
    expect(String(nonApparel.product)).not.toMatch(/BLANK/)
  })

  it('matches "blank" case-insensitively and as part of a longer name', () => {
    const hoodie = buildCopyQuestions(input({ category: 'hoodies', name: 'Heavyweight Hoodie — blank', title: 'Heavyweight Blank Hoodie' })).state
    expect(String(hoodie.product)).toMatch(/BLANK/)
  })
})

describe('interpretCopyReview', () => {
  it('blocks on a confident unfulfillable claim in enforce mode', () => {
    const r = interpretCopyReview(input(), jevResult('unfulfillable_claim', 0.97), 'enforce')
    expect(r.jevBlocks).toBe(true)
    expect(r.findings.some(f => f.severity === 'block' && (f.evidence as any)?.source === 'jev')).toBe(true)
  })

  it('records but does not apply the same answer in shadow mode', () => {
    const r = interpretCopyReview(input(), jevResult('unfulfillable_claim', 0.97), 'shadow')
    expect(r.findings).toEqual([])
    expect((r.measured.jev as any).shadow_findings[0]).toMatch(/^block:/)
  })

  it('does not block below the block bar', () => {
    const r = interpretCopyReview(input(), jevResult('wrong_product_noun', JEV_BLOCK_CONFIDENCE - 0.05), 'enforce')
    expect(r.jevBlocks).toBe(false)
    expect(r.findings.filter(f => f.severity === 'block')).toEqual([])
  })

  it('routes an unsure answer to a human instead of defaulting', () => {
    const r = interpretCopyReview(input(), jevResult('copy_ok', 0.5), 'enforce')
    expect(r.needsHumanReview).toBe(true)
    expect(r.copyClass).toBeNull()
    expect(r.findings.find(f => (f.evidence as any)?.review === 'human')?.severity).toBe('warn')
  })

  it('warns on tags Jev scores as unrelated or generic', () => {
    const r = interpretCopyReview(input(), jevResult('copy_ok', 0.95, 0.6), 'enforce')
    const weak = r.findings.find(f => (f.evidence as any)?.weak_tags)
    expect(weak?.severity).toBe('warn')
    expect((weak?.evidence as any).weak_tags.length).toBe(tags.length)
  })

  it('never lets a confident copy_ok clear the deterministic floor', () => {
    const r = interpretCopyReview(input({ title: 'Sherman Tank Embroidered Tee' }), jevResult('copy_ok', 0.99), 'enforce')
    expect(r.findings.some(f => f.severity === 'block' && (f.evidence as any)?.source === 'deterministic')).toBe(true)
  })

  it('with Jev down, still applies the floor', () => {
    const r = interpretCopyReview(input({ title: 'Golf Polo Shirt Classic' }), null, 'enforce')
    expect(r.measured.jev).toBe('unavailable')
    expect(r.findings[0].severity).toBe('block')
  })
})

describe('decideVision', () => {
  const noBlock = { jevBlocks: false }
  it('always runs vision when nothing is certain yet', () => {
    expect(decideVision([], noBlock, 'enforce')).toMatchObject({ run: true, wouldSkip: false })
  })
  it('skips in enforce when a deterministic block already fails the submission', () => {
    expect(decideVision([{ criterion: 'image_sharpness', issue: 'blurry' }], noBlock, 'enforce')).toMatchObject({ run: false, wouldSkip: true })
  })
  it('skips in enforce on a confident Jev block', () => {
    expect(decideVision([], { jevBlocks: true }, 'enforce')).toMatchObject({ run: false, wouldSkip: true })
  })
  it('never skips in shadow or off', () => {
    expect(decideVision([{ criterion: 'seo', issue: 'x' }], { jevBlocks: true }, 'shadow')).toMatchObject({ run: true, wouldSkip: true })
    expect(decideVision([{ criterion: 'seo', issue: 'x' }], { jevBlocks: true }, 'off')).toMatchObject({ run: true, wouldSkip: false })
  })
})

describe('runPresentationQa — ordering and the vision gate', () => {
  it('enforce + clean copy: Jev runs, vision still runs (it grades the photo), and the listing passes', async () => {
    process.env.PRESENTATION_QA_JEV = 'enforce'
    serveJev(jevBody('copy_ok', 0.96))
    const v = await runPresentationQa(input())
    expect(jevCalls).toBe(1)
    expect(h.visionCreate.calls).toBe(1)
    expect(v.status).toBe('passed')
    expect(v.copyReview).toMatchObject({ mode: 'enforce', copyClass: 'copy_ok', visionSkipped: false })
  })

  it('enforce + a confident unfulfillable claim: vision is skipped and the verdict fails on the copy', async () => {
    process.env.PRESENTATION_QA_JEV = 'enforce'
    serveJev(jevBody('unfulfillable_claim', 0.98))
    const v = await runPresentationQa(input())
    expect(h.visionCreate.calls).toBe(0)
    expect(v.status).toBe('failed')
    expect(v.copyReview?.visionSkipped).toBe(true)
    expect(v.rework.find(r => r.severity === 'block')?.criterion).toBe('seo')
    // The skipped criteria say "deferred", not "infrastructure outage".
    expect(v.criteria.typography.findings[0]).toMatchObject({ severity: 'warn' })
    expect(v.criteria.typography.findings[0].fix).not.toMatch(/infrastructure/i)
  })

  it('enforce + unsure Jev: vision runs and the copy goes to a human', async () => {
    process.env.PRESENTATION_QA_JEV = 'enforce'
    serveJev(jevBody('unfulfillable_claim', 0.55))
    const v = await runPresentationQa(input())
    expect(h.visionCreate.calls).toBe(1)
    expect(v.copyReview?.needsHumanReview).toBe(true)
    expect(v.status).toBe('passed')
  })

  it('shadow (the default): same Jev answer changes nothing and vision runs — but the saving is recorded', async () => {
    serveJev(jevBody('unfulfillable_claim', 0.98))
    const v = await runPresentationQa(input())
    expect(h.visionCreate.calls).toBe(1)
    expect(v.status).toBe('passed')
    expect(v.copyReview).toMatchObject({ mode: 'shadow', visionSkipped: false, visionWouldSkip: true })
    expect((v.criteria.seo.measured as any).jev.copy_class).toBe('unfulfillable_claim')
  })

  it('Jev down: fails open, vision runs, verdict identical to the pre-Jev gate', async () => {
    process.env.PRESENTATION_QA_JEV = 'enforce'
    serveJev('down')
    const v = await runPresentationQa(input())
    expect(h.visionCreate.calls).toBe(1)
    expect(v.status).toBe('passed')
    expect((v.criteria.seo.measured as any).jev).toBe('unavailable')
  })

  it('JEV=off is a kill switch — no Jev call at all', async () => {
    process.env.PRESENTATION_QA_JEV = 'enforce'
    process.env.JEV = 'off'
    serveJev(jevBody('unfulfillable_claim', 0.98))
    await runPresentationQa(input())
    expect(jevCalls).toBe(0)
    expect(h.visionCreate.calls).toBe(1)
  })

  it('the deterministic sharpness floor still blocks, and in enforce saves the vision call', async () => {
    process.env.PRESENTATION_QA_JEV = 'enforce'
    metricsState.sharpness = 80
    serveJev(jevBody('copy_ok', 0.96))
    const v = await runPresentationQa(input())
    expect(v.criteria.image_sharpness.ok).toBe(false)
    expect(v.status).toBe('failed')
    expect(h.visionCreate.calls).toBe(0)
  })

  it('the deterministic claim floor blocks even in shadow mode', async () => {
    serveJev(jevBody('copy_ok', 0.99))
    const v = await runPresentationQa(input({ title: 'Sherman Tank Embroidered History Tee Classic' }))
    expect(v.status).toBe('failed')
    expect(v.criteria.seo.findings.some(f => (f.evidence as any)?.source === 'deterministic')).toBe(true)
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  combinePresort,
  gateTriage,
  itemText,
  presortProducts,
  resetPresortCache,
  runFloor,
  runImageFloor,
  sortByPresort,
  toPresortItem,
  TRIAGE_CRITERIA,
  PRESORT_VERDICTS,
  MIN_CONFIDENCE,
  type ImageMeasureFns
} from './jev-approval-presort.js'
import { resetJevIpCache, type JevFetch } from './jev-ip-gate.js'
import type { ImageMetricsResult, OpacityResult } from './image-metrics.js'

/** Fast, network-free stand-in for image-metrics.ts, so presortProducts's
 *  image floor never makes a real fetch in a test. Reads as a clean,
 *  print-ready file unless a test overrides one or both functions. */
const cleanImageFns: ImageMeasureFns = {
  measureImage: async (url): Promise<ImageMetricsResult> =>
    ({ url, ok: true, width: 2048, height: 2048, shortEdge: 2048, longEdge: 2048, format: 'png', bytes: 500_000, sharpness: 900, edgeEnergy: 40 }),
  measureOpacity: async (url): Promise<OpacityResult> =>
    ({ url, ok: true, hasAlphaChannel: true, transparentFraction: 0.35, opaqueBorderFraction: 0.05, checkerboardBackground: false, borderMeanLuma: 40, borderPattern: null })
}

// A pending row with everything a finished apparel design carries, so the
// floor stays quiet unless a test takes something away.
const complete = (over: Record<string, any> = {}) => ({
  id: over.id ?? 'p1',
  name: 'Retro Sunset Surfer',
  description: 'A surfer riding into a pink and orange sunset.',
  created_at: '2026-09-20T00:00:00Z',
  images: ['https://cdn/p1.png'],
  product_assets: [{ id: 'a1', url: 'https://cdn/p1.png', kind: 'source' }],
  product_tags: [{ tag: 'surf' }, { tag: 'retro' }],
  metadata: {
    user_submitted: true,
    original_prompt: 'retro sunset with a surfer silhouette',
    mockup_url: 'https://cdn/p1-mock.png',
    assets: { clean: 'c', halftone: 'h', dtf: 'd' }
  },
  ...over
})

type Answer = { type: 'choice'; choice: string; confidence: number; probabilities?: Record<string, number> }

/**
 * A fake Jev transport. `triage` / `ip` map an item's title to the answer that
 * question should get; the two questions are told apart by their criteria.
 */
function fakeJev(triage: Record<string, Answer | undefined>, ip: Record<string, Answer | undefined> = {}) {
  const calls: { state: Record<string, string>; questions: Record<string, any> }[] = []
  const fetchImpl: JevFetch = async (state, questions) => {
    calls.push({ state, questions })
    const out: Record<string, any> = {}
    for (const [label, q] of Object.entries(questions) as [string, any][]) {
      const title = /title: ([^|]+)/.exec(state[label])?.[1]?.trim() ?? ''
      const isTriage = 'reject_quality' in q.criteria
      const a = isTriage ? triage[title] : (ip[title] ?? { type: 'choice', choice: 'clean', confidence: 0.95, probabilities: { clean: 0.95, generic_theme: 0.03 } })
      if (a) out[label] = a
    }
    return out
  }
  return { fetchImpl, calls }
}

const sure = (choice: string, confidence = 0.95): Answer => ({ type: 'choice', choice, confidence, probabilities: { [choice]: confidence } })

beforeEach(() => {
  resetPresortCache()
  resetJevIpCache()
  delete process.env.JEV
  delete process.env.JEV_PRESORT
  delete process.env.JEV_PRESORT_MIN_CONFIDENCE
})

describe('the question itself', () => {
  it('is a four-way choice with a written description for every option — never a yes/no', () => {
    expect(Object.keys(TRIAGE_CRITERIA).sort()).toEqual([...PRESORT_VERDICTS].sort())
    for (const text of Object.values(TRIAGE_CRITERIA)) expect(text.length).toBeGreaterThan(60)
  })

  it('reads name, tags and design prompt', () => {
    const text = itemText(toPresortItem(complete()))
    expect(text).toContain('title: Retro Sunset Surfer')
    expect(text).toContain('tags: surf, retro')
    expect(text).toContain('design prompt: retro sunset with a surfer silhouette')
  })
})

describe('deterministic floor', () => {
  it('a finished, clean design trips nothing', () => {
    expect(runFloor(toPresortItem(complete()))).toEqual([])
  })

  it('a trademark denylist hit is reject_ip — including a mark hiding in the tags or the prompt', () => {
    expect(runFloor(toPresortItem(complete({ name: 'Pikachu Beach Day' })))[0]).toMatchObject({ verdict: 'reject_ip', code: 'floor_trademark' })
    expect(runFloor(toPresortItem(complete({ product_tags: [{ tag: 'nfl' }] })))[0].code).toBe('floor_trademark')
    const viaPrompt = complete()
    viaPrompt.metadata.original_prompt = 'mickey mouse on a surfboard'
    expect(runFloor(toPresortItem(viaPrompt))[0].code).toBe('floor_trademark')
  })

  it('no artwork is reject_quality; a placeholder title is needs_fix; missing generations is info only', () => {
    const noArt = runFloor(toPresortItem(complete({ images: [], product_assets: [], metadata: { user_submitted: true } })))
    expect(noArt[0]).toMatchObject({ verdict: 'reject_quality', code: 'floor_no_artwork' })
    expect(runFloor(toPresortItem(complete({ name: 'Untitled' })))[0].code).toBe('floor_missing_title')
    const noMockup = complete()
    delete (noMockup.metadata as any).mockup_url
    // Informational: named, but it sets no verdict (it is the normal state of a pending item).
    expect(runFloor(toPresortItem(noMockup))[0]).toMatchObject({ verdict: null, code: 'floor_missing_generations' })
  })

  it('orders multiple hits most severe first', () => {
    const hits = runFloor(toPresortItem(complete({ name: 'Nike', images: [], product_assets: [], metadata: {} })))
    expect(hits.map(h => h.verdict)).toEqual(['reject_ip', 'reject_quality'])
  })
})

describe('image floor (runImageFloor) — the half a text-only triage cannot see', () => {
  it('a clean, measured design trips nothing', async () => {
    const hits = await runImageFloor([toPresortItem(complete())], { fns: cleanImageFns })
    expect(hits.size).toBe(0)
  })

  it('a painted-checkerboard / opaque background floors to reject_quality, not a Jev opinion', async () => {
    const badBackground: ImageMeasureFns = {
      measureImage: cleanImageFns.measureImage,
      measureOpacity: async (url): Promise<OpacityResult> =>
        ({ url, ok: true, hasAlphaChannel: true, transparentFraction: 0.01, opaqueBorderFraction: 0.97, checkerboardBackground: true, borderMeanLuma: 230, borderPattern: { clusterLow: 40, clusterHigh: 235, separation: 195, spread: 1.2, alternations: 40 } })
    }
    // kind: 'dtf' — background removal has run, so an opaque/checkerboard
    // result here is a real defect, not the normal pre-processing state a
    // raw 'source' file is in (see backgroundUrl's field comment).
    const processed = complete({ id: 'bg', product_assets: [{ id: 'a1', url: 'https://cdn/bg.png', kind: 'dtf' }] })
    const hits = await runImageFloor([toPresortItem(processed)], { fns: badBackground })
    expect(hits.get('bg')).toMatchObject([{ verdict: 'reject_quality', code: 'floor_image_background' }])
  })

  it('a raw, unprocessed source image with no alpha yet is NOT a background hit — that is the normal pre-removal state', async () => {
    const opaqueSource: ImageMeasureFns = {
      measureImage: cleanImageFns.measureImage,
      measureOpacity: async (url): Promise<OpacityResult> =>
        ({ url, ok: true, hasAlphaChannel: false, transparentFraction: 0, opaqueBorderFraction: 1, checkerboardBackground: false, borderMeanLuma: 255, borderPattern: null })
    }
    // complete()'s only asset is kind: 'source' — background removal has not run.
    const hits = await runImageFloor([toPresortItem(complete({ id: 'raw' }))], { fns: opaqueSource })
    expect(hits.size).toBe(0)
  })

  it('a blurry / upscaled artwork floors to reject_quality on sharpness', async () => {
    const blurry: ImageMeasureFns = {
      measureImage: async (url): Promise<ImageMetricsResult> =>
        ({ url, ok: true, width: 2000, height: 2000, shortEdge: 2000, longEdge: 2000, format: 'png', bytes: 100_000, sharpness: 40, edgeEnergy: 5 }),
      measureOpacity: cleanImageFns.measureOpacity
    }
    const hits = await runImageFloor([toPresortItem(complete({ id: 'blur' }))], { fns: blurry })
    expect(hits.get('blur')).toMatchObject([{ verdict: 'reject_quality', code: 'floor_image_sharpness' }])
  })

  it('fails OPEN when the image cannot be measured — no evidence is no opinion, never a hit', async () => {
    const unreachable: ImageMeasureFns = {
      measureImage: async (url) => ({ url, ok: false, error: 'ECONNREFUSED' }),
      measureOpacity: async (url) => ({ url, ok: false, error: 'ECONNREFUSED' })
    }
    const hits = await runImageFloor([toPresortItem(complete())], { fns: unreachable })
    expect(hits.size).toBe(0)
  })

  it('an item with no resolvable artwork URL is skipped without measuring anything', async () => {
    const fns: ImageMeasureFns = {
      measureImage: vi.fn(cleanImageFns.measureImage),
      measureOpacity: vi.fn(cleanImageFns.measureOpacity)
    }
    const noArt = toPresortItem(complete({ images: [], product_assets: [], metadata: { user_submitted: true } }))
    const hits = await runImageFloor([noArt], { fns })
    expect(hits.size).toBe(0)
    expect(fns.measureImage).not.toHaveBeenCalled()
  })

  it('a design already failed on an image criterion in a prior QA submission floors WITHOUT re-measuring', async () => {
    const fns: ImageMeasureFns = {
      measureImage: vi.fn(cleanImageFns.measureImage),
      measureOpacity: vi.fn(cleanImageFns.measureOpacity)
    }
    const stamped = complete({
      id: 'stamped',
      metadata: {
        user_submitted: true, mockup_url: 'https://cdn/p1-mock.png', assets: { clean: 'c', halftone: 'h', dtf: 'd' },
        qa_gate: { storefront: { status: 'failed', score: 40, failures: ['print_background: opaque background'] } }
      }
    })
    const hits = await runImageFloor([toPresortItem(stamped)], { fns })
    expect(hits.get('stamped')).toMatchObject([{ verdict: 'reject_quality', code: 'floor_qa_gate_image_fail' }])
    expect(fns.measureImage).not.toHaveBeenCalled()
  })

  it('a QA failure that was only about copy/price (seo, pricing) says nothing here — falls through to measurement', async () => {
    const stamped = complete({
      id: 'copyonly',
      metadata: {
        user_submitted: true, mockup_url: 'https://cdn/p1-mock.png', assets: { clean: 'c', halftone: 'h', dtf: 'd' },
        qa_gate: { storefront: { status: 'failed', score: 60, failures: ['seo: title too short'] } }
      }
    })
    const hits = await runImageFloor([toPresortItem(stamped)], { fns: cleanImageFns })
    expect(hits.size).toBe(0)
  })

  it('end to end: Jev is fooled by a good text brief, the image floor is not', async () => {
    const { fetchImpl } = fakeJev({ 'Retro Sunset Surfer': sure('approve', 0.97) })
    const badBackground: ImageMeasureFns = {
      measureImage: cleanImageFns.measureImage,
      measureOpacity: async (url): Promise<OpacityResult> =>
        ({ url, ok: true, hasAlphaChannel: false, transparentFraction: 0, opaqueBorderFraction: 1, checkerboardBackground: false, borderMeanLuma: 250, borderPattern: null })
    }
    // Processed (dtf) artwork, so the opaque read is a real defect, not the
    // normal pre-background-removal state.
    const processed = complete({ product_assets: [{ id: 'a1', url: 'https://cdn/p1.png', kind: 'dtf' }] })
    const presort = await presortProducts([processed], { fetchImpl, mode: 'shadow', imageFns: badBackground })
    expect(presort.p1).toMatchObject({ recommendation: 'reject_quality', reasonCode: 'floor_image_background' })
    expect(presort.p1.reasonCodes).toContain('jev_approve')
  })
})

describe('confidence gate', () => {
  it('passes a sure answer through', () => {
    expect(gateTriage(sure('approve', 0.9))).toMatchObject({ verdict: 'approve', status: 'sure' })
  })

  it('under the bar is NO opinion — not a weak verdict', () => {
    const d = gateTriage(sure('reject_quality', MIN_CONFIDENCE - 0.01))
    expect(d.verdict).toBeNull()
    expect(d.status).toBe('low_confidence')
    expect(d.confidence).toBeCloseTo(MIN_CONFIDENCE - 0.01)
  })

  it('the bar is overridable by env', () => {
    process.env.JEV_PRESORT_MIN_CONFIDENCE = '0.95'
    expect(gateTriage(sure('approve', 0.9)).status).toBe('low_confidence')
  })

  it('missing, off-menu or malformed answers are unavailable', () => {
    expect(gateTriage(undefined).status).toBe('unavailable')
    expect(gateTriage(sure('maybe')).status).toBe('unavailable')
    expect(gateTriage({ type: 'choice', choice: 'approve' } as any).status).toBe('unavailable')
  })
})

describe('combining floor, IP gate and triage', () => {
  const noIp = undefined
  const pass = { verdict: 'pass' as const, reason: 'Jev: clean (97% safe).', confidence: 0.97 }

  it('a sure approve with a clean IP read is suggested as approve', () => {
    const r = combinePresort([], pass, gateTriage(sure('approve')))
    expect(r).toMatchObject({ recommendation: 'approve', band: 'approve', reasonCode: 'jev_approve', source: 'jev', lowConfidence: false })
  })

  it('floor precedence: Jev cannot soften a floor verdict', () => {
    const floor = runFloor(toPresortItem(complete({ name: 'Star Wars Sunset' })))
    const r = combinePresort(floor, noIp, gateTriage(sure('approve', 0.99)))
    expect(r).toMatchObject({ recommendation: 'reject_ip', reasonCode: 'floor_trademark', source: 'floor', confidence: 1 })
    expect(r.reasonCodes).toEqual(['floor_trademark', 'jev_approve'])
  })

  it('Jev can make a floor verdict stricter', () => {
    const floor = runFloor(toPresortItem(complete({ name: 'Untitled' })))
    const r = combinePresort(floor, pass, gateTriage(sure('reject_quality')))
    expect(r).toMatchObject({ recommendation: 'reject_quality', reasonCode: 'jev_reject_quality' })
  })

  it('missing generations alone never produces a recommendation', () => {
    const noMockup = complete()
    delete (noMockup.metadata as any).mockup_url
    const r = combinePresort(runFloor(toPresortItem(noMockup)), pass, gateTriage(sure('approve', 0.97)))
    expect(r).toMatchObject({ recommendation: 'approve', reasonCode: 'jev_approve' })
    expect(r.reasonCodes).toEqual(['floor_missing_generations', 'jev_approve'])
    const unsure = combinePresort(runFloor(toPresortItem(noMockup)), pass, gateTriage(undefined))
    expect(unsure).toMatchObject({ recommendation: null, band: 'needs_human' })
  })

  it('a floor verdict stands even when Jev is unsure', () => {
    const floor = runFloor(toPresortItem(complete({ name: 'Untitled' })))
    const r = combinePresort(floor, noIp, gateTriage(sure('approve', 0.3)))
    expect(r).toMatchObject({ recommendation: 'needs_fix', band: 'needs_fix', source: 'floor', lowConfidence: false })
  })

  it('low confidence with no floor hit goes to a human with NO suggested verdict', () => {
    const r = combinePresort([], pass, gateTriage(sure('reject_quality', 0.4)))
    expect(r).toMatchObject({ recommendation: null, band: 'needs_human', reasonCode: 'jev_low_confidence', lowConfidence: true, source: 'none' })
  })

  it('the Jev IP gate blocking makes it reject_ip over a sure approve', () => {
    const block = { verdict: 'block' as const, tier: 'definite_brand_or_character' as const, confidence: 0.92, reason: 'Jev: names a real brand or character (92% sure).' }
    const r = combinePresort([], block, gateTriage(sure('approve')))
    expect(r).toMatchObject({ recommendation: 'reject_ip', reasonCode: 'jev_ip_block', confidence: 0.92 })
  })

  it('an IP doubt outranks a soft Jev suggestion: human review, nothing suggested', () => {
    const review = { verdict: 'review' as const, tier: 'likely_ip_reference' as const, confidence: 0.6, reason: 'Jev: likely paraphrases a brand.' }
    const r = combinePresort([], review, gateTriage(sure('approve')))
    expect(r).toMatchObject({ recommendation: null, band: 'needs_human', reasonCode: 'jev_ip_review', lowConfidence: true })
    expect(r.rationale).toContain('likely paraphrases')
  })

  it('Jev unavailable with no floor hit is a human read, not an approval', () => {
    const r = combinePresort([], undefined, gateTriage(undefined))
    expect(r).toMatchObject({ recommendation: null, band: 'needs_human', reasonCode: 'jev_unavailable', lowConfidence: true })
  })
})

describe('presortProducts (end to end with a fake Jev)', () => {
  it('classifies a mixed queue and sorts it by triage priority', async () => {
    const products = [
      complete({ id: 'lowconf', name: 'Odd Blob Thing', created_at: '2026-09-22T00:00:00Z' }),
      complete({ id: 'tm', name: 'Batman Sunset', created_at: '2026-09-21T00:00:00Z' }),
      complete({ id: 'good', name: 'Retro Sunset Surfer', created_at: '2026-09-19T00:00:00Z' }),
      complete({ id: 'fix', name: 'shirt design cool awesome best', created_at: '2026-09-18T00:00:00Z' }),
      complete({ id: 'junk', name: 'asdf test', created_at: '2026-09-17T00:00:00Z' })
    ]
    const { fetchImpl } = fakeJev({
      'Odd Blob Thing': sure('approve', 0.4),
      'Retro Sunset Surfer': sure('approve', 0.97),
      'shirt design cool awesome best': sure('needs_fix', 0.88),
      'asdf test': sure('reject_quality', 0.99)
    })
    const presort = await presortProducts(products, { fetchImpl, mode: 'shadow', imageFns: cleanImageFns })

    expect(presort.good).toMatchObject({ recommendation: 'approve', reasonCode: 'jev_approve' })
    expect(presort.tm).toMatchObject({ recommendation: 'reject_ip', reasonCode: 'floor_trademark' })
    expect(presort.lowconf).toMatchObject({ recommendation: null, reasonCode: 'jev_low_confidence', lowConfidence: true })
    expect(presort.fix).toMatchObject({ recommendation: 'needs_fix', reasonCode: 'jev_needs_fix' })
    // "asdf" is a placeholder title on the floor (needs_fix); Jev's sure reject_quality is stricter and wins.
    expect(presort.junk).toMatchObject({ recommendation: 'reject_quality', reasonCode: 'jev_reject_quality' })
    expect(presort.junk.reasonCodes).toContain('floor_missing_title')

    const sorted = sortByPresort(products.map(p => ({ ...p, jev_presort: presort[p.id] })))
    expect(sorted.map(p => p.id)).toEqual(['good', 'lowconf', 'fix', 'junk', 'tm'])
  })

  it('does not ask the Jev IP gate about an item the denylist already blocked', async () => {
    const { fetchImpl, calls } = fakeJev({ 'Batman Sunset': sure('approve') })
    await presortProducts([complete({ id: 'tm', name: 'Batman Sunset' })], { fetchImpl, mode: 'shadow', imageFns: cleanImageFns })
    const ipCalls = calls.filter(c => Object.values(c.questions).some((q: any) => 'likely_ip_reference' in q.criteria))
    expect(ipCalls).toHaveLength(0)
  })

  it('fails open when the Jev transport throws or hangs: floor only, flagged for a human', async () => {
    const throwing: JevFetch = async () => { throw new Error('down') }
    const r1 = await presortProducts([complete({ id: 'a' }), complete({ id: 'b', name: 'Nike Air' })], { fetchImpl: throwing, mode: 'shadow', imageFns: cleanImageFns })
    expect(r1.a).toMatchObject({ recommendation: null, reasonCode: 'jev_unavailable', lowConfidence: true })
    expect(r1.b).toMatchObject({ recommendation: 'reject_ip', reasonCode: 'floor_trademark' })

    resetPresortCache(); resetJevIpCache()
    const hanging: JevFetch = () => new Promise(() => {})
    const r2 = await presortProducts([complete({ id: 'a' })], { fetchImpl: hanging, mode: 'shadow', budgetMs: 30, imageFns: cleanImageFns })
    expect(r2.a.reasonCode).toBe('jev_unavailable')
  })

  it('mode off makes no Jev call at all but still runs the floor', async () => {
    const fetchImpl = vi.fn<JevFetch>(async () => ({}))
    const r = await presortProducts([complete({ id: 'a' }), complete({ id: 'b', name: 'Disney Castle' })], { fetchImpl, mode: 'off' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(r.a).toMatchObject({ recommendation: null, reasonCode: 'jev_off' })
    expect(r.b).toMatchObject({ recommendation: 'reject_ip', reasonCode: 'floor_trademark' })
  })

  it('JEV=off is the fleet kill switch', async () => {
    process.env.JEV = 'off'
    const fetchImpl = vi.fn<JevFetch>(async () => ({}))
    await presortProducts([complete()], { fetchImpl })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('caches answers so a refresh does not re-ask Jev', async () => {
    const { fetchImpl, calls } = fakeJev({ 'Retro Sunset Surfer': sure('approve') })
    await presortProducts([complete()], { fetchImpl, mode: 'shadow', imageFns: cleanImageFns })
    const first = calls.length
    await presortProducts([complete()], { fetchImpl, mode: 'shadow', imageFns: cleanImageFns })
    expect(calls.length).toBe(first)
  })
})

describe('sortByPresort', () => {
  it('leaves rows without a pre-sort at the end, newest first, and does not mutate input', () => {
    const rows = [
      { id: 'x', created_at: '2026-09-01' },
      { id: 'y', created_at: '2026-09-02' },
      { id: 'z', created_at: '2026-09-03', jev_presort: { priority: 0.1 } as any }
    ]
    const copy = [...rows]
    expect(sortByPresort(rows).map(r => r.id)).toEqual(['z', 'y', 'x'])
    expect(rows).toEqual(copy)
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ReworkItem } from './presentation-qa.js'

const db: { product: any; updates: any[] } = { product: null, updates: [] }
vi.mock('../lib/supabase.js', () => {
  const chain = (): any => {
    const c: any = {}
    c.select = () => c
    c.eq = () => c
    c.update = (patch: any) => {
      db.updates.push(patch)
      return { eq: async () => ({ error: null }) }
    }
    c.maybeSingle = async () => ({ data: db.product, error: null })
    return c
  }
  return { supabase: { from: () => chain() } }
})

// step-flow/shots.ts reaches the mockup worker at import time; the only thing
// this module needs from it is "queue a redo", so it is stubbed wholesale.
const redos: Array<{ productId: string; userId: string; key: string }> = []
let redoBehaviour: 'ok' | 'invalid' | 'throw' = 'ok'
vi.mock('./step-flow/shots.js', () => {
  class StepFlowValidationError extends Error {}
  return {
    StepFlowValidationError,
    getStepFlow: (product: any) => product?.metadata?.step_flow ?? { shots: {} },
    redoShot: async (productId: string, userId: string, key: string) => {
      if (redoBehaviour === 'invalid') throw new StepFlowValidationError('Approve garments & colors before redoing shots')
      if (redoBehaviour === 'throw') throw new Error('worker unreachable')
      redos.push({ productId, userId, key })
      return { job: { id: `job-${key}`, key, status: 'queued' } }
    },
  }
})

const repairCalls: Array<{ productId: string; objections: string[] }> = []
let repairResult: any = { repaired: true, changes: ['Rewrote the listing copy.'], stillBlocking: [], pack: {}, usedModel: false }
vi.mock('./etsy-copy-repair.js', () => ({
  repairEtsyPack: async (productId: string, objections: string[]) => {
    repairCalls.push({ productId, objections })
    if (repairResult instanceof Error) throw repairResult
    return repairResult
  },
}))

const { autofixPresentation, laneFor, laneRework, shotKeysForFindings, MAX_RESHOOTS } = await import('./design-qa-autofix.js')

const item = (over: Partial<ReworkItem>): ReworkItem => ({
  criterion: 'seo',
  severity: 'block',
  issue: 'something is wrong',
  fix: 'fix it',
  ...over,
})

// ---------------------------------------------------------------------------
// Routing. Sending a finding down the wrong lane is the expensive mistake here
// — a re-shoot costs a real render, and "fixing" a print file by re-rendering
// the photo of it fixes nothing at all.
// ---------------------------------------------------------------------------
describe('laneFor', () => {
  it('routes copy, price and photo findings to their own fixers', () => {
    expect(laneFor(item({ criterion: 'seo' }))).toBe('copy')
    expect(laneFor(item({ criterion: 'pricing' }))).toBe('price')
    expect(laneFor(item({ criterion: 'design_placement' }))).toBe('photo')
    expect(laneFor(item({ criterion: 'mockup_quality' }))).toBe('photo')
    expect(laneFor(item({ criterion: 'typography' }))).toBe('photo')
    expect(laneFor(item({ criterion: 'image_sharpness' }))).toBe('photo')
  })

  it('splits print_background by which read produced it', () => {
    // The vision read is about the RENDER — a re-shoot can fix that.
    expect(laneFor(item({ criterion: 'print_background', evidence: { source: 'vision' } }))).toBe('photo')
    // The opacity read is about the PRINT FILE — re-rendering it changes nothing.
    expect(laneFor(item({ criterion: 'print_background', evidence: { url: 'x.png', has_alpha_channel: false } }))).toBe('artwork')
  })

  it('never re-renders over a vision outage', () => {
    const outage = item({
      criterion: 'design_placement',
      issue: 'Design placement could not be checked because the vision reviewer was unavailable.',
      fix: 'This is an infrastructure problem, not a design problem. Retry the review; if it keeps failing, check OPENAI_API_KEY on the backend.',
    })
    expect(laneFor(outage)).toBe('manual')
  })

  it('ignores warnings — only blocking findings are laned', () => {
    const lanes = laneRework([item({ severity: 'warn' }), item({ criterion: 'pricing' })])
    expect(lanes.copy).toHaveLength(0)
    expect(lanes.price).toHaveLength(1)
  })
})

describe('shotKeysForFindings', () => {
  const shots = {
    product: { url: 'https://cdn/product.png', approved: true, status: 'done' as const },
    model: { url: 'https://cdn/model.png', approved: true, status: 'done' as const },
  }

  it('re-shoots the exact photo the finding measured', () => {
    const keys = shotKeysForFindings([item({ criterion: 'typography', evidence: { url: 'https://cdn/product.png' } })], shots)
    expect(keys).toEqual(['product'])
  })

  it('falls back to the on-person shot when the URL does not match a step-flow asset', () => {
    // Real case: the Etsy presentation is assembled from metadata.etsy_shots,
    // whose URLs are the mirrored copies rather than the shot assets.
    const keys = shotKeysForFindings([item({ criterion: 'design_placement', evidence: { url: 'https://cdn/etsy-shot-1.png' } })], shots)
    expect(keys).toEqual(['model'])
  })

  it('caps how many renders one pass may spend', () => {
    const many = ['product', 'model', 'hanger', 'details'].map(k =>
      item({ criterion: 'image_sharpness', evidence: { url: `https://cdn/${k}.png` } })
    )
    const keys = shotKeysForFindings(many, {
      product: { url: 'https://cdn/product.png', approved: true, status: 'done' },
      model: { url: 'https://cdn/model.png', approved: true, status: 'done' },
      hanger: { url: 'https://cdn/hanger.png', approved: true, status: 'done' },
      details: { url: 'https://cdn/details.png', approved: true, status: 'done' },
    })
    expect(keys).toHaveLength(MAX_RESHOOTS)
  })

  it('returns nothing when there are no shots at all', () => {
    expect(shotKeysForFindings([item({ criterion: 'design_placement' })], {})).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The pass itself.
// ---------------------------------------------------------------------------
describe('autofixPresentation', () => {
  beforeEach(() => {
    redos.length = 0
    repairCalls.length = 0
    db.updates = []
    redoBehaviour = 'ok'
    repairResult = { repaired: true, changes: ['Rewrote the listing copy.'], stillBlocking: [], pack: {}, usedModel: false }
    db.product = {
      id: 'p1',
      name: 'Stoic Samurai',
      category: 'shirts',
      price: 25,
      metadata: {
        etsy_pack: { title: 't', tags: [], description: 'd', price: 25, colors: [], composed_at: 'x', model: 'mechanical' },
        step_flow: { shots: { model: { url: 'https://cdn/model.png', approved: true, status: 'done' } } },
      },
    }
  })

  // David's screenshot, verbatim: two copy failures and one photo failure.
  it('rewrites the copy AND re-shoots the photo in one pass', async () => {
    const report = await autofixPresentation({
      productId: 'p1',
      channel: 'etsy',
      userId: 'admin-1',
      rework: [
        item({ criterion: 'seo', issue: 'Title is 32 characters; the minimum is 40.' }),
        item({ criterion: 'seo', issue: 'Only 0 tag(s); at least 10 are required and Etsy allows 13.' }),
        item({ criterion: 'design_placement', issue: 'The towel obscures part of the printed artwork.', evidence: { url: 'https://cdn/model.png' } }),
      ],
    })

    expect(report.changed).toBe(true)
    expect(report.copy.repaired).toBe(true)
    expect(repairCalls[0].objections).toHaveLength(2)
    expect(report.photos.redone).toEqual([{ key: 'model', jobId: 'job-model' }])
    expect(redos).toEqual([{ productId: 'p1', userId: 'admin-1', key: 'model' }])
    expect(report.unfixable).toEqual([])
    expect(report.summary).toMatch(/Mrs. Imagine/)
  })

  it('hands back an artwork defect instead of pretending to fix it', async () => {
    const artwork = item({
      criterion: 'print_background',
      issue: 'The artwork has a PAINTED checkerboard background.',
      evidence: { url: 'https://cdn/source.png', has_alpha_channel: false },
    })
    const report = await autofixPresentation({ productId: 'p1', channel: 'etsy', userId: 'admin-1', rework: [artwork] })

    expect(report.changed).toBe(false)
    expect(redos).toHaveLength(0)
    expect(report.unfixable).toEqual([artwork])
    expect(report.summary).toMatch(/could not fix this one automatically/i)
  })

  it('never rewrites storefront copy — that is the product row the admin edits', async () => {
    const report = await autofixPresentation({
      productId: 'p1',
      channel: 'storefront',
      userId: 'admin-1',
      rework: [item({ criterion: 'seo', issue: 'Title is 12 characters; the minimum is 20.' })],
    })
    expect(repairCalls).toHaveLength(0)
    expect(report.copy.repaired).toBe(false)
    expect(report.unfixable).toHaveLength(1)
  })

  it('resets an out-of-band price to the category anchor', async () => {
    db.product.metadata.etsy_pack.price = 4
    const report = await autofixPresentation({
      productId: 'p1',
      channel: 'etsy',
      userId: 'admin-1',
      rework: [item({ criterion: 'pricing', issue: 'Price $4.00 is outside the sane range for shirts ($15-$60).' })],
    })
    expect(report.price).toMatchObject({ repaired: true, from: 4, to: 25 })
    expect(db.updates[0].metadata.etsy_pack.price).toBe(25)
  })

  it('leaves a below-cost price to David', async () => {
    const belowCost = item({
      criterion: 'pricing',
      issue: 'Price $18.00 is at or below the recorded cost of $19.00 — every sale loses money.',
    })
    const report = await autofixPresentation({ productId: 'p1', channel: 'etsy', userId: 'admin-1', rework: [belowCost] })
    expect(report.price.repaired).toBe(false)
    expect(report.unfixable).toEqual([belowCost])
    expect(db.updates).toHaveLength(0)
  })

  it('reports a re-shoot it could not start instead of claiming it worked', async () => {
    redoBehaviour = 'invalid'
    const photo = item({ criterion: 'design_placement', evidence: { url: 'https://cdn/model.png' } })
    const report = await autofixPresentation({ productId: 'p1', channel: 'etsy', userId: 'admin-1', rework: [photo] })

    expect(report.changed).toBe(false)
    expect(report.photos.redone).toEqual([])
    expect(report.photos.note).toMatch(/Approve garments & colors/)
    expect(report.unfixable).toEqual([photo])
  })

  it('keeps the copy fix when the photo fix fails', async () => {
    redoBehaviour = 'throw'
    const report = await autofixPresentation({
      productId: 'p1',
      channel: 'etsy',
      userId: 'admin-1',
      rework: [
        item({ criterion: 'seo', issue: 'Title is 32 characters; the minimum is 40.' }),
        item({ criterion: 'design_placement', evidence: { url: 'https://cdn/model.png' } }),
      ],
    })
    expect(report.copy.repaired).toBe(true)
    expect(report.changed).toBe(true)
    expect(report.unfixable).toHaveLength(1)
    expect(report.summary).toMatch(/still needs you/)
  })

  it('surfaces a copy repair that could not clear every objection', async () => {
    repairResult = { repaired: true, changes: ['Grew the title.'], stillBlocking: ['Duplicate tags: samurai tee.'], pack: {}, usedModel: true }
    const report = await autofixPresentation({
      productId: 'p1',
      channel: 'etsy',
      userId: 'admin-1',
      rework: [item({ criterion: 'seo', issue: 'Duplicate tags: samurai tee.' })],
    })
    expect(report.copy.stillBlocking).toHaveLength(1)
    expect(report.copy.note).toMatch(/could not be cleared/)
  })
})

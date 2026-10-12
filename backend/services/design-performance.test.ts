import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/supabase.js', () => ({ supabase: {} }))

import {
  buildReport,
  emptyCounts,
  flagFor,
  isBotUserAgent,
  parseEventBatch,
  ratesOf,
  wilsonUpper,
  type CountRow,
  type VariantRecord,
} from './design-performance'

const counts = (over: Partial<ReturnType<typeof emptyCounts>>) => ({ ...emptyCounts(), ...over })
const store = { ctr: 0.04, addToCartRate: 0.12, conversion: 0.02 }

describe('wilsonUpper', () => {
  it('is generous with few views and tight with many', () => {
    expect(wilsonUpper(0, 10)).toBeGreaterThan(0.15)
    expect(wilsonUpper(0, 1000)).toBeLessThan(0.003)
    expect(wilsonUpper(50, 1000)).toBeGreaterThan(0.05)
    expect(wilsonUpper(0, 0)).toBe(1)
  })
})

describe('flagFor', () => {
  it('waits for enough views before judging', () => {
    expect(flagFor(counts({ impressions: 40, clicks: 0 }), store).flag).toBe('learning')
  })

  it('prunes a design that is seen a lot and rarely clicked', () => {
    const r = flagFor(counts({ impressions: 600, clicks: 2, detailViews: 4 }), store)
    expect(r.flag).toBe('prune')
    expect(r.reason).toContain('Seen 600 times, clicked 2')
  })

  it('does not prune a low click count that is not yet credibly low', () => {
    // 3/150 = 2%: half the shop's 4%, but the generous reading is not under half.
    expect(flagFor(counts({ impressions: 150, clicks: 3 }), store).flag).not.toBe('prune')
  })

  it('refreshes a design that gets clicks but no carts', () => {
    const r = flagFor(counts({ impressions: 900, clicks: 60, detailViews: 70, addToCarts: 0 }), store)
    expect(r.flag).toBe('refresh')
  })

  it('never flags a design that sold in the window', () => {
    expect(flagFor(counts({ impressions: 900, clicks: 1, detailViews: 60, orders: 1 }), store).flag).toBe('healthy')
  })

  it('cannot judge against a shop with no clicks yet', () => {
    expect(flagFor(counts({ impressions: 900 }), { ctr: 0, addToCartRate: null, conversion: null }).flag).toBe('healthy')
  })
})

describe('ratesOf', () => {
  it('divides by the right denominators and never by zero', () => {
    expect(ratesOf(counts({ impressions: 200, clicks: 10, detailViews: 20, addToCarts: 5, orders: 1 }))).toEqual({
      ctr: 0.05, addToCartRate: 0.25, conversion: 0.05,
    })
    expect(ratesOf(emptyCounts())).toEqual({ ctr: null, addToCartRate: null, conversion: null })
  })
})

const variant = (id: string, concept: string, prompt: string): VariantRecord => ({
  id, variant_key: `v_${id}`, concept_key: concept, concept_label: concept, prompt_text: prompt,
  model_id: null, source: 'step_flow', flag: 'learning', flagged_at: null,
})
const row = (product: string, variantId: string | null, c: Partial<Record<keyof CountRow, number>>): CountRow => ({
  product_id: product, prompt_variant_id: variantId,
  impressions: 0, clicks: 0, detail_views: 0, add_to_carts: 0, orders: 0, units: 0, revenue: 0, ...c,
})

describe('buildReport', () => {
  const base = {
    since: new Date('2026-09-12T00:00:00Z'),
    until: new Date('2026-10-12T00:00:00Z'),
    variants: [variant('A', 'idea:koi', 'one koi'), variant('B', 'idea:koi', 'three koi'), variant('C', 'idea:wolf', 'wolves')],
    products: [
      { id: 'p1', name: 'Koi Tee', slug: 'koi-tee', status: 'active', category: 'shirts', image: null },
      { id: 'p2', name: 'Koi Trio Tee', slug: null, status: 'active', category: 'shirts', image: null },
      { id: 'p3', name: 'Wolf Tee', slug: null, status: 'active', category: 'shirts', image: null },
    ],
    current: [
      { productId: 'p1', artworkId: 'asset-1', variantId: 'A' },
      { productId: 'p2', artworkId: 'asset-2', variantId: 'B' },
      { productId: 'p3', artworkId: 'asset-3', variantId: 'C' },
    ],
  }

  it('reconciles each variant with the raw rows and lines two koi variants up side by side', () => {
    const report = buildReport({
      ...base,
      rows: [
        row('p1', 'A', { impressions: 700, clicks: 1, detail_views: 3 }),
        row('p2', 'B', { impressions: 300, clicks: 24, detail_views: 30, add_to_carts: 6, orders: 2, units: 3, revenue: 74.85 }),
        row('p3', 'C', { impressions: 20 }),
      ],
    })
    const a = report.variants.find(v => v.variantId === 'A')!
    const b = report.variants.find(v => v.variantId === 'B')!
    expect(a.counts).toMatchObject({ impressions: 700, clicks: 1, detailViews: 3 })
    expect(b.counts).toMatchObject({ impressions: 300, clicks: 24, addToCarts: 6, orders: 2, revenue: 74.85 })
    expect(report.store.counts.impressions).toBe(1020)
    expect(report.concepts).toEqual([{ conceptKey: 'idea:koi', conceptLabel: 'idea:koi', variantIds: expect.arrayContaining(['A', 'B']) }])
    expect(a.flag).toBe('prune')
    expect(b.flag).toBe('healthy')
    // Underperformers surface first.
    expect(report.variants[0].variantId).toBe('A')
    expect(report.window.days).toBe(30)
  })

  it('gives every live design a row even with no events', () => {
    const report = buildReport({ ...base, rows: [] })
    expect(report.variants.map(v => v.variantId).sort()).toEqual(['A', 'B', 'C'])
    expect(report.variants.every(v => v.flag === 'learning')).toBe(true)
  })

  it('files an unstamped event row under the product\'s current variant', () => {
    const report = buildReport({ ...base, rows: [row('p3', null, { impressions: 5, clicks: 1 })] })
    expect(report.variants.find(v => v.variantId === 'C')!.counts.clicks).toBe(1)
  })

  it('keeps an old variant\'s numbers on the old variant after a redo', () => {
    const report = buildReport({
      ...base,
      // p1 was redone from A to B; its earlier events still carry A.
      current: [{ productId: 'p1', artworkId: 'asset-9', variantId: 'B' }],
      rows: [row('p1', 'A', { impressions: 40 }), row('p1', 'B', { impressions: 10 })],
    })
    expect(report.variants.find(v => v.variantId === 'A')!.counts.impressions).toBe(40)
    const b = report.variants.find(v => v.variantId === 'B')!
    expect(b.counts.impressions).toBe(10)
    expect(b.products[0].artworkId).toBe('asset-9')
    expect(report.variants.find(v => v.variantId === 'A')!.products[0].artworkId).toBeNull()
  })
})

describe('parseEventBatch', () => {
  const pid = '4c0ea310-088b-45cf-b8e4-a4fb7f731872'

  it('keeps valid events and drops junk', () => {
    const out = parseEventBatch({
      sid: 'abcDEF123_-x',
      events: [
        { t: 'impression', p: pid, s: 'catalog' },
        { t: 'click', p: pid.toUpperCase(), s: 'Not A Surface' },
        { t: 'order', p: pid },
        { t: 'impression', p: 'not-a-uuid' },
        null,
      ],
    })
    expect(out.sessionId).toBe('abcDEF123_-x')
    expect(out.events).toEqual([
      { type: 'impression', productId: pid, surface: 'catalog' },
      { type: 'click', productId: pid, surface: null },
    ])
  })

  it('caps a batch at 50 and refuses a bad session id', () => {
    const out = parseEventBatch({ sid: 'x', events: Array.from({ length: 80 }, () => ({ t: 'impression', p: pid })) })
    expect(out.events).toHaveLength(50)
    expect(out.sessionId).toBeNull()
    expect(parseEventBatch('nope').events).toEqual([])
  })
})

describe('isBotUserAgent', () => {
  it('drops crawlers and empty agents, keeps browsers', () => {
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true)
    expect(isBotUserAgent('Mozilla/5.0 HeadlessChrome/120')).toBe(true)
    expect(isBotUserAgent(undefined)).toBe(true)
    expect(isBotUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1')).toBe(false)
  })
})

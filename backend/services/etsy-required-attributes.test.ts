// Tests for etsy-required-attributes — Christina 2026-08-22: Etsy's mandatory
// "Craft type" had nothing that fits a DTF transfer or a PNG design, so every
// one of those drafts sat unpublishable until someone picked a wrong answer.
//
// Fixtures are the real property shapes, read live 2026-10-13 with
// `node backend/scripts/etsy-poc.mjs properties --ids 6617,6844,1853 --raw`
// (trimmed to the fields the planner reads).
import { describe, it, expect } from 'vitest'
import {
  CRAFT_TYPES,
  applyRequiredAttributes,
  craftKindFor,
  planRequiredAttributes,
  type EtsyCall,
  type TaxonomyProperty
} from './etsy-required-attributes.js'

const CRAFT_TYPE_ID = 47626759760

const craftType = (values: Array<[number, string]>): TaxonomyProperty => ({
  property_id: CRAFT_TYPE_ID,
  name: 'Craft type',
  display_name: 'Craft type',
  is_required: true,
  is_multivalued: true,
  max_values_allowed: 5,
  possible_values: values.map(([value_id, name]) => ({ value_id, name }))
})

// 6617 Image Transfers — the DTF tier.
const NODE_6617: TaxonomyProperty[] = [
  craftType([
    [534, 'Calligraphy'], [538, 'Card making & stationery'], [540, 'Ceramics & pottery'],
    [544, 'Cross stitch'], [550, 'Embroidery'], [551, 'Enameling'], [558, 'Glass fusing'],
    [562, "Kids' crafts"], [576, 'Painting'], [577, 'Party & gifting'], [743, 'Sewing'],
    [595, 'Woodworking & carpentry']
  ]),
  { property_id: 148789511893, name: 'Material multi', display_name: 'Materials', is_required: false },
  { property_id: 200, name: 'Primary color', display_name: 'Primary color', is_required: false }
]

// 6844 Clip Art & Image Files — the PNG tier.
const NODE_6844: TaxonomyProperty[] = [
  craftType([[538, 'Card making & stationery'], [541, 'Collage'], [562, "Kids' crafts"], [584, 'Scrapbooking']]),
  { property_id: 200, name: 'Primary color', display_name: 'Primary color', is_required: false }
]

// 482 T-shirts — nothing required.
const NODE_482: TaxonomyProperty[] = [
  { property_id: 200, name: 'Primary color', display_name: 'Primary color', is_required: false },
  { property_id: 62809790533, name: 'Size', display_name: 'Size', is_required: false }
]

// 1853 Hoodies — requires a closure, which nothing here has a rule for.
const NODE_1853: TaxonomyProperty[] = [
  {
    property_id: 325502674108, name: 'Clothing closure', display_name: 'Closure', is_required: true,
    is_multivalued: true, max_values_allowed: 1,
    possible_values: [{ value_id: 2587, name: 'Pullover' }, { value_id: 2589, name: 'Full zip' }]
  }
]

describe('craftKindFor', () => {
  it('reads the listing type, not the tier, so a primary DTF product is a transfer', () => {
    expect(craftKindFor('download')).toBe('download')
    expect(craftKindFor('physical')).toBe('transfer')
    expect(craftKindFor(undefined)).toBe('transfer')
  })
})

describe('planRequiredAttributes', () => {
  it('fills a DTF transfer with Sewing + Party & gifting, by Etsy\'s own ids', () => {
    const plan = planRequiredAttributes(NODE_6617, [], 'transfer')
    expect(plan.unfilled).toEqual([])
    expect(plan.writes).toEqual([{
      property_id: CRAFT_TYPE_ID,
      name: 'Craft type',
      value_ids: [743, 577],
      values: ['Sewing', 'Party & gifting']
    }])
  })

  it('never tags a transfer as Embroidery — ITP does not embroider', () => {
    const plan = planRequiredAttributes(NODE_6617, [], 'transfer')
    expect(plan.writes[0].values).not.toContain('Embroidery')
    expect(CRAFT_TYPES.transfer).not.toContain('Embroidery')
  })

  it('fills a PNG download with the three paper-craft values the node offers', () => {
    const plan = planRequiredAttributes(NODE_6844, [], 'download')
    expect(plan.writes[0].value_ids).toEqual([538, 584, 541])
    expect(plan.writes[0].values).toEqual(['Card making & stationery', 'Scrapbooking', 'Collage'])
    expect(plan.writes[0].values).not.toContain("Kids' crafts")
  })

  it('writes nothing for a tee — that node requires nothing', () => {
    expect(planRequiredAttributes(NODE_482, [], 'transfer')).toEqual({ writes: [], unfilled: [] })
  })

  it('never overwrites a craft type someone already set in Shop Manager', () => {
    const plan = planRequiredAttributes(NODE_6617, [{ property_id: CRAFT_TYPE_ID, value_ids: [576], values: ['Painting'] }], 'transfer')
    expect(plan).toEqual({ writes: [], unfilled: [] })
  })

  it('treats an empty value on the listing as blank and fills it', () => {
    const plan = planRequiredAttributes(NODE_6617, [{ property_id: CRAFT_TYPE_ID, value_ids: [], values: [] }], 'transfer')
    expect(plan.writes).toHaveLength(1)
  })

  it('reports a required attribute it has no rule for instead of guessing', () => {
    const plan = planRequiredAttributes(NODE_1853, [], 'transfer')
    expect(plan.writes).toEqual([])
    expect(plan.unfilled).toEqual(['Closure'])
  })

  it('reports craft type as unfilled when Etsy has dropped every value we prefer', () => {
    const plan = planRequiredAttributes([craftType([[534, 'Calligraphy'], [576, 'Painting']])], [], 'transfer')
    expect(plan.writes).toEqual([])
    expect(plan.unfilled).toEqual(['Craft type'])
  })

  it('respects a single-value cap', () => {
    const single = { ...NODE_6844[0], is_multivalued: false }
    const plan = planRequiredAttributes([single], [], 'download')
    expect(plan.writes[0].values).toEqual(['Card making & stationery'])
  })

  it('matches Etsy\'s value names case-insensitively', () => {
    const plan = planRequiredAttributes([craftType([[743, 'SEWING']])], [], 'transfer')
    expect(plan.writes[0]).toMatchObject({ value_ids: [743], values: ['SEWING'] })
  })
})

describe('applyRequiredAttributes', () => {
  type Call = { path: string; method: string; json?: any }
  const stub = (node: TaxonomyProperty[], current: any[] = []) => {
    const calls: Call[] = []
    const call: EtsyCall = async (path, opts = {}) => {
      calls.push({ path, method: opts.method ?? 'GET', json: opts.json })
      if (/\/seller-taxonomy\/nodes\/\d+\/properties$/.test(path)) return { count: node.length, results: node }
      if (/\/listings\/\d+\/properties$/.test(path)) return { count: current.length, results: current }
      return { ok: true }
    }
    return { call, calls }
  }

  it('PUTs craft type as JSON value_ids + values on the listing\'s property path', async () => {
    const { call, calls } = stub(NODE_6617)
    const r = await applyRequiredAttributes(call, 67055923, 4593902255, 6617, 'transfer')
    expect(r.filled).toEqual(['Craft type'])
    const put = calls.find(c => c.method === 'PUT')!
    expect(put.path).toBe(`/application/shops/67055923/listings/4593902255/properties/${CRAFT_TYPE_ID}`)
    expect(put.json).toEqual({ value_ids: [743, 577], values: ['Sewing', 'Party & gifting'] })
  })

  it('skips reading the listing when it was created this run', async () => {
    const { call, calls } = stub(NODE_6844)
    await applyRequiredAttributes(call, 1, 2, 6844, 'download', { fresh: true })
    expect(calls.some(c => /\/listings\/2\/properties$/.test(c.path))).toBe(false)
    expect(calls.filter(c => c.method === 'PUT')).toHaveLength(1)
  })

  it('makes one read and no write on a node with nothing required', async () => {
    const { call, calls } = stub(NODE_482)
    const r = await applyRequiredAttributes(call, 1, 2, 482, 'transfer')
    expect(r).toEqual({ writes: [], unfilled: [], filled: [] })
    expect(calls).toHaveLength(1)
  })

  it('does not write over a craft type already on the listing', async () => {
    const { call, calls } = stub(NODE_6617, [{ property_id: CRAFT_TYPE_ID, value_ids: [576], values: ['Painting'] }])
    const r = await applyRequiredAttributes(call, 1, 2, 6617, 'transfer')
    expect(r.filled).toEqual([])
    expect(calls.some(c => c.method === 'PUT')).toBe(false)
  })

  it('dry run plans the write and sends nothing', async () => {
    const { call, calls } = stub(NODE_6617)
    const r = await applyRequiredAttributes(call, 1, 2, 6617, 'transfer', { dryRun: true })
    expect(r.writes.map(w => w.name)).toEqual(['Craft type'])
    expect(r.filled).toEqual([])
    expect(calls.some(c => c.method === 'PUT')).toBe(false)
  })
})

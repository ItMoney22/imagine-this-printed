// Tests for the Etsy apparel variation axis — the size dropdown a buyer picks
// from, and what each row costs.
//
// This is real money on a live storefront and it had no test at all before
// 2026-09-07, which is how Etsy ended up selling a 3XL at the same price as a
// small while our own site charged +$2.50 for it.
//
// etsy.ts imports backend/lib/supabase.ts, which builds its client eagerly at
// module load, so the env vars have to exist BEFORE the dynamic import below
// (a static import would be hoisted ahead of these assignments). Nothing here
// touches Supabase — apparelVariationSizes is pure and applyListingVariations
// below stubs global fetch instead of hitting the real Etsy API.
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.ETSY_KEYSTRING ||= 'test-keystring'
process.env.ETSY_SHARED_SECRET ||= 'test-secret'

const { apparelVariationSizes, applyListingVariations } = await import('./etsy.js')

/** The rows keyed by label, for readable assertions. */
const priceMap = (metadata: any, base: number): Record<string, number | undefined> =>
  Object.fromEntries(apparelVariationSizes(metadata, base).map(v => [v.label, v.price]))

describe('apparelVariationSizes — Etsy size axis pricing', () => {
  const TEE = { product_type: 'tshirt' }
  const HOODIE = { product_type: 'hoodie' }

  it('offers the adult band and the youth band, youth spelled out', () => {
    expect(apparelVariationSizes(TEE, 25).map(v => v.label)).toEqual([
      'S', 'M', 'L', 'XL', '2XL', '3XL',
      'Youth XS', 'Youth S', 'Youth M', 'Youth L', 'Youth XL'
    ])
  })

  it('charges the listing price for S-XL', () => {
    const p = priceMap(TEE, 25)
    for (const sz of ['S', 'M', 'L', 'XL']) expect(p[sz]).toBe(25)
  })

  it('adds the $2.50 plus-size upcharge to 2XL and 3XL (David 2026-09-07)', () => {
    const p = priceMap(TEE, 25)
    expect(p['2XL']).toBe(27.5)
    expect(p['3XL']).toBe(27.5)
  })

  it('takes $3 off every youth size', () => {
    const p = priceMap(TEE, 25)
    for (const sz of ['Youth XS', 'Youth S', 'Youth M', 'Youth L', 'Youth XL']) {
      expect(p[sz]).toBe(22)
    }
  })

  it('never charges a youth size the plus-size upcharge', () => {
    // 'Youth XL' must not trip the PLUS_SIZES substring match — the same shape
    // of bug that once charged a 4x6 metal panel a plus-size upcharge.
    expect(priceMap(TEE, 25)['Youth XL']).toBe(22)
  })

  it('prices hoodies on the same rails', () => {
    const p = priceMap(HOODIE, 45)
    expect(p['M']).toBe(45)
    expect(p['2XL']).toBe(47.5)
    expect(p['Youth M']).toBe(42)
  })

  it('matches what the storefront charges for the same size', () => {
    // The whole point: a buyer must not find a different price on Etsy than on
    // our own product page for the identical shirt and size.
    const base = 25
    const p = priceMap(TEE, base)
    expect(p['2XL']).toBe(base + 2.5)  // PLUS_SIZE_UPCHARGE_DOLLARS
    expect(p['Youth M']).toBe(base - 3) // YOUTH_SIZE_DISCOUNT_DOLLARS
  })

  it('falls back to the adult tee axis for a row with no product_type', () => {
    const labels = apparelVariationSizes({}, 25).map(v => v.label)
    expect(labels).toContain('3XL')
    expect(labels).toContain('Youth M')
  })

  it('gives a youth-tee listing only youth sizes, all discounted', () => {
    const rows = apparelVariationSizes({ product_type: 'youth-tshirt' }, 22)
    expect(rows.map(v => v.label)).toEqual(['Youth XS', 'Youth S', 'Youth M', 'Youth L', 'Youth XL'])
    for (const r of rows) expect(r.price).toBe(19)
  })

  it('never emits a non-positive price — Etsy rejects those', () => {
    // A $2 listing minus the $3 youth discount would be -$1.
    for (const row of apparelVariationSizes(TEE, 2)) {
      expect(row.price).toBeGreaterThan(0)
    }
    expect(priceMap(TEE, 2)['Youth M']).toBe(1)
  })

  it('rounds to whole cents rather than leaking float dust into a price', () => {
    for (const row of apparelVariationSizes(TEE, 19.99)) {
      expect(Number.isInteger(Math.round(row.price! * 100))).toBe(true)
      expect(row.price).toBe(Number(row.price!.toFixed(2)))
    }
    expect(priceMap(TEE, 19.99)['2XL']).toBe(22.49)
    expect(priceMap(TEE, 19.99)['Youth M']).toBe(16.99)
  })
})

describe('applyListingVariations — taxonomy 6617 (Image Transfers) size fallback', () => {
  // Real property payload for taxonomy 6617, captured 2026-09-21 via
  // `node backend/scripts/etsy-poc.mjs properties --ids 6617` (raw dump:
  // GET /application/seller-taxonomy/nodes/6617/properties). Etsy exposes 12
  // properties on this node; only the 7 with supports_variations: true matter
  // to applyListingVariations (it filters on that flag), so the rest
  // (Craft type, Materials, Occasion, ... — none variation-capable) are
  // omitted here. This is the exact shape that made
  // `taxonomy 6617 exposes no variation properties` fire on every live
  // transfer-tier publish: no property whose name/display_name matches
  // /^size\b/i.
  const COLOR_VALUES = [
    { value_id: 1213, name: 'Beige', scale_id: null, equal_to: [] },
    { value_id: 1, name: 'Black', scale_id: null, equal_to: [] },
    { value_id: 2, name: 'Blue', scale_id: null, equal_to: [] },
    { value_id: 1216, name: 'Bronze', scale_id: null, equal_to: [] },
    { value_id: 3, name: 'Brown', scale_id: null, equal_to: [] },
    { value_id: 1219, name: 'Clear', scale_id: null, equal_to: [] },
    { value_id: 1218, name: 'Copper', scale_id: null, equal_to: [] },
    { value_id: 1214, name: 'Gold', scale_id: null, equal_to: [] },
    { value_id: 5, name: 'Gray', scale_id: null, equal_to: [] },
    { value_id: 4, name: 'Green', scale_id: null, equal_to: [] },
    { value_id: 6, name: 'Orange', scale_id: null, equal_to: [] },
    { value_id: 7, name: 'Pink', scale_id: null, equal_to: [] },
    { value_id: 8, name: 'Purple', scale_id: null, equal_to: [] },
    { value_id: 1220, name: 'Rainbow', scale_id: null, equal_to: [] },
    { value_id: 9, name: 'Red', scale_id: null, equal_to: [] },
    { value_id: 1217, name: 'Rose gold', scale_id: null, equal_to: [] },
    { value_id: 1215, name: 'Silver', scale_id: null, equal_to: [] },
    { value_id: 10, name: 'White', scale_id: null, equal_to: [] },
    { value_id: 11, name: 'Yellow', scale_id: null, equal_to: [] }
  ]
  const LENGTH_WIDTH_SCALES = [
    { scale_id: 7, display_name: 'Centimeters', description: '' },
    { scale_id: 11, display_name: 'Feet', description: '' },
    { scale_id: 5, display_name: 'Inches', description: '' },
    { scale_id: 10, display_name: 'Meters', description: '' },
    { scale_id: 4, display_name: 'Millimeters', description: '' }
  ]
  const TAXONOMY_6617_VARIATION_PROPERTIES = [
    { property_id: 200, name: 'Primary color', display_name: 'Primary color', scales: [], is_required: false, supports_attributes: true, supports_variations: true, is_multivalued: false, max_values_allowed: 5, possible_values: COLOR_VALUES, selected_values: [] },
    { property_id: 52047899002, name: 'Secondary color', display_name: 'Secondary color', scales: [], is_required: false, supports_attributes: true, supports_variations: true, is_multivalued: false, max_values_allowed: 5, possible_values: COLOR_VALUES, selected_values: [] },
    { property_id: 102448162080, name: 'Canvas length', display_name: 'Length', scales: LENGTH_WIDTH_SCALES, is_required: false, supports_attributes: true, supports_variations: true, is_multivalued: false, max_values_allowed: null, possible_values: [], selected_values: [] },
    { property_id: 102448163338, name: 'Canvas width', display_name: 'Width', scales: LENGTH_WIDTH_SCALES, is_required: false, supports_attributes: true, supports_variations: true, is_multivalued: false, max_values_allowed: null, possible_values: [], selected_values: [] },
    { property_id: 513, name: 'Custom1', display_name: 'Custom Property', scales: [], is_required: false, supports_attributes: false, supports_variations: true, is_multivalued: false, max_values_allowed: null, possible_values: [], selected_values: [] },
    { property_id: 514, name: 'Custom2', display_name: 'Custom Property', scales: [], is_required: false, supports_attributes: false, supports_variations: true, is_multivalued: false, max_values_allowed: null, possible_values: [], selected_values: [] },
    { property_id: 516, name: 'Custom3', display_name: 'Custom Property', scales: [], is_required: false, supports_attributes: false, supports_variations: true, is_multivalued: false, max_values_allowed: null, possible_values: [], selected_values: [] }
  ]

  // The three sheet sizes the transfer tier actually sells (etsy-tiers.ts
  // TRANSFER_SHEET_SIZES), reproduced here so this test doesn't depend on
  // that module's current prices — only the shape matters.
  const TRANSFER_SIZES = [
    { label: '8.5x11 inches', price: 12 },
    { label: '11x17 inches', price: 20 },
    { label: '13x19 inches', price: 28 }
  ]

  let putBody: any
  beforeEach(() => {
    putBody = undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
      const path = String(url).replace('https://api.etsy.com/v3', '')
      const ok = (json: any) => ({ ok: true, status: 200, json: async () => json, headers: new Map() } as any)
      if (/properties$/.test(path)) return ok({ results: TAXONOMY_6617_VARIATION_PROPERTIES })
      if (init.method === 'PUT' && /inventory$/.test(path)) {
        putBody = JSON.parse(init.body)
        return ok({ ok: true })
      }
      return ok({ ok: true })
    }))
  })

  it('maps sheet sizes onto a Custom Property slot instead of throwing', async () => {
    const combos = await applyListingVariations(
      'token', 4544388862, 6617,
      { colors: [], sizes: TRANSFER_SIZES, basePrice: 12, readinessStateId: 999 }
    )
    expect(combos).toBe(3)
    expect(putBody.products).toHaveLength(3)
  })

  it('labels the fallback axis "Size" on the real Custom1 property id (513)', async () => {
    await applyListingVariations(
      'token', 4544388862, 6617,
      { colors: [], sizes: TRANSFER_SIZES, basePrice: 12, readinessStateId: 999 }
    )
    for (const p of putBody.products) {
      expect(p.property_values).toHaveLength(1)
      expect(p.property_values[0].property_id).toBe(513)
      expect(p.property_values[0].property_name).toBe('Size')
    }
    const labels = putBody.products.map((p: any) => p.property_values[0].values[0])
    expect(labels).toEqual(['8.5x11 inches', '11x17 inches', '13x19 inches'])
  })

  it('carries per-size sheet pricing and turns on price_on_property for the fallback slot', async () => {
    await applyListingVariations(
      'token', 4544388862, 6617,
      { colors: [], sizes: TRANSFER_SIZES, basePrice: 12, readinessStateId: 999 }
    )
    const priced = Object.fromEntries(putBody.products.map((p: any) =>
      [p.property_values[0].values[0], p.offerings[0].price]))
    expect(priced['8.5x11 inches']).toBe(12)
    expect(priced['11x17 inches']).toBe(20)
    expect(priced['13x19 inches']).toBe(28)
    expect(putBody.price_on_property).toEqual([513])
  })

  it('does not throw a custom variation value against Etsy\'s own possible_values (goes through as free text)', async () => {
    await applyListingVariations(
      'token', 4544388862, 6617,
      { colors: [], sizes: TRANSFER_SIZES, basePrice: 12, readinessStateId: 999 }
    )
    // No scale is attached — Custom Property has none, and "8.5x11 inches"
    // matches nothing in possible_values (which is empty for this slot).
    expect(putBody.products.every((p: any) => p.property_values[0].scale_id === undefined)).toBe(true)
    expect(putBody.products.every((p: any) => p.property_values[0].value_ids)).toBeTruthy()
    expect(putBody.products[0].property_values[0].value_ids).toEqual([])
  })
})

describe('applyListingVariations — regressions on a normal garment taxonomy', () => {
  // A taxonomy that exposes a native Size property (e.g. apparel, taxonomy
  // 482) must keep using it — the 6617 fallback must never shadow it.
  const GARMENT_PROPERTIES = [
    {
      property_id: 62809790533, name: 'Size', display_name: 'Size', supports_variations: true,
      possible_values: [{ value_id: 1, name: 'S' }, { value_id: 2, name: 'M' }, { value_id: 3, name: 'L' }],
      scales: [{ scale_id: 51, display_name: 'Unisex letter size' }]
    },
    { property_id: 200, name: 'Primary color', display_name: 'Primary color', supports_variations: true, possible_values: [] }
  ]

  let putBody: any
  beforeEach(() => {
    putBody = undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
      const path = String(url).replace('https://api.etsy.com/v3', '')
      const ok = (json: any) => ({ ok: true, status: 200, json: async () => json, headers: new Map() } as any)
      if (/properties$/.test(path)) return ok({ results: GARMENT_PROPERTIES })
      if (init.method === 'PUT' && /inventory$/.test(path)) {
        putBody = JSON.parse(init.body)
        return ok({ ok: true })
      }
      return ok({ ok: true })
    }))
  })

  it('still uses the native Size property, not a Custom Property fallback', async () => {
    await applyListingVariations(
      'token', 4544388862, 482,
      { colors: ['Black'], sizes: [{ label: 'S', price: 25 }, { label: 'M', price: 25 }], basePrice: 25, readinessStateId: 999 }
    )
    const sizePV = putBody.products[0].property_values.find((pv: any) => pv.property_name === 'Size')
    expect(sizePV.property_id).toBe(62809790533)
    expect(sizePV.value_ids).toEqual([1])
  })

  it('still throws when a taxonomy genuinely has no variation properties at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const path = String(url).replace('https://api.etsy.com/v3', '')
      if (/properties$/.test(path)) return { ok: true, status: 200, json: async () => ({ results: [] }), headers: new Map() } as any
      return { ok: true, status: 200, json: async () => ({}), headers: new Map() } as any
    }))
    await expect(applyListingVariations(
      'token', 4544388862, 999999,
      { colors: [], sizes: [{ label: 'One size', price: 10 }], basePrice: 10 }
    )).rejects.toThrow('taxonomy 999999 exposes no variation properties')
  })
})

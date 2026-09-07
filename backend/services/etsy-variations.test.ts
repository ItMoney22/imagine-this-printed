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
// touches Etsy or Supabase — apparelVariationSizes is pure.
import { describe, it, expect } from 'vitest'

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { apparelVariationSizes } = await import('./etsy.js')

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

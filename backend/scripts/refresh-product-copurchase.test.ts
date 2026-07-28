import { describe, it, expect } from 'vitest'

// backend/lib/supabase.ts (transitively reachable via the script's Supabase
// client construction) creates its client eagerly at module load — same
// pattern as backend/services/order-pricing.test.ts. buildPairCounts itself
// never touches Supabase, but the dynamic import keeps this file consistent
// with the rest of the suite regardless.
process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { buildPairCounts } = await import('./refresh-product-copurchase.js')

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const C = '33333333-3333-3333-3333-333333333333'

describe('buildPairCounts', () => {
  it('counts a directional pair once per order for a 2-item order', () => {
    const byOrder = new Map([['order-1', new Set([A, B])]])
    const counts = buildPairCounts(byOrder)
    expect(counts.get(`${A}|${B}`)).toBe(1)
    expect(counts.get(`${B}|${A}`)).toBe(1)
  })

  it('ignores single-item orders — there is no pair to count', () => {
    const byOrder = new Map([['order-1', new Set([A])]])
    const counts = buildPairCounts(byOrder)
    expect(counts.size).toBe(0)
  })

  it('accumulates counts across multiple orders sharing a pair', () => {
    const byOrder = new Map([
      ['order-1', new Set([A, B])],
      ['order-2', new Set([A, B])],
      ['order-3', new Set([A, C])]
    ])
    const counts = buildPairCounts(byOrder)
    expect(counts.get(`${A}|${B}`)).toBe(2)
    expect(counts.get(`${A}|${C}`)).toBe(1)
    expect(counts.has(`${B}|${C}`)).toBe(false)
  })

  it('produces N*(N-1) directional pairs for an N-item order', () => {
    const byOrder = new Map([['order-1', new Set([A, B, C])]])
    const counts = buildPairCounts(byOrder)
    expect(counts.size).toBe(6) // 3*2
    expect(counts.get(`${A}|${B}`)).toBe(1)
    expect(counts.get(`${B}|${A}`)).toBe(1)
    expect(counts.get(`${A}|${C}`)).toBe(1)
    expect(counts.get(`${C}|${A}`)).toBe(1)
    expect(counts.get(`${B}|${C}`)).toBe(1)
    expect(counts.get(`${C}|${B}`)).toBe(1)
  })
})

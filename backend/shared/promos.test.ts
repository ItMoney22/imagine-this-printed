import { describe, it, expect } from 'vitest'
import { BUNDLE_DEAL, bundleTotalCents, isBundleEligible } from './promos.js'

describe('BUNDLE_DEAL', () => {
  it('is the 2-for-$25 deal (David 2026-09-02, changed from 3-for-$25)', () => {
    expect(BUNDLE_DEAL.qty).toBe(2)
    expect(BUNDLE_DEAL.priceCents).toBe(2500)
    expect(BUNDLE_DEAL.label).toBe('2 for $25')
  })
})

describe('bundleTotalCents', () => {
  it('charges nothing for zero eligible units', () => {
    expect(bundleTotalCents(0, 2500)).toBe(0)
  })

  it('charges a single leftover unit at the passed unit price', () => {
    expect(bundleTotalCents(1, 2500)).toBe(2500)
  })

  it('charges exactly $25 for a matched pair', () => {
    expect(bundleTotalCents(2, 2500)).toBe(2500)
  })

  it('charges one bundle plus one leftover unit for 3', () => {
    expect(bundleTotalCents(3, 2500)).toBe(2500 + 2500)
  })

  it('charges two full bundles for 4', () => {
    expect(bundleTotalCents(4, 2500)).toBe(5000)
  })

  it('charges two bundles plus one leftover for 5', () => {
    expect(bundleTotalCents(5, 2500)).toBe(7500)
  })

  it('uses the passed unitCents for the remainder, not a hardcoded $25', () => {
    // Exercises the generalized parameter — not how today's callers use it,
    // but the function itself must honor whatever unit price it's given.
    expect(bundleTotalCents(1, 1000)).toBe(1000)
    expect(bundleTotalCents(3, 1000)).toBe(2500 + 1000)
  })

  it('floors a fractional/negative/non-finite quantity to a safe non-negative integer', () => {
    expect(bundleTotalCents(2.9, 2500)).toBe(2500) // floors to 2
    expect(bundleTotalCents(-5, 2500)).toBe(0)
    expect(bundleTotalCents(NaN, 2500)).toBe(0)
  })
})

describe('isBundleEligible', () => {
  it('is eligible via the top-level flag', () => {
    expect(isBundleEligible({ isThreeForTwentyFive: true })).toBe(true)
  })

  it('is eligible via metadata.isThreeForTwentyFive', () => {
    expect(isBundleEligible({ metadata: { isThreeForTwentyFive: true } })).toBe(true)
  })

  it('is eligible when either is truthy (OR, not AND)', () => {
    expect(isBundleEligible({ isThreeForTwentyFive: true, metadata: { isThreeForTwentyFive: false } })).toBe(true)
    expect(isBundleEligible({ isThreeForTwentyFive: false, metadata: { isThreeForTwentyFive: true } })).toBe(true)
  })

  it('is not eligible when neither flag is set', () => {
    expect(isBundleEligible({})).toBe(false)
    expect(isBundleEligible({ isThreeForTwentyFive: false, metadata: { isThreeForTwentyFive: false } })).toBe(false)
    expect(isBundleEligible({ metadata: {} })).toBe(false)
  })

  it('tolerates a missing/null product instead of throwing', () => {
    expect(isBundleEligible(null)).toBe(false)
    expect(isBundleEligible(undefined)).toBe(false)
  })
})

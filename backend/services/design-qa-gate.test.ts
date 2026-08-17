import { describe, it, expect, vi } from 'vitest'

// The gate module builds a Supabase client at import time; the enforcement
// logic under test here is pure, so the client is stubbed out entirely.
vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => ({}), rpc: async () => ({ data: 1 }) } }))

const { evaluateGate, partitionByQa, fingerprintPresentation } = await import('./design-qa-gate.js')
import type { PresentationInput } from './presentation-qa.js'

// ---------------------------------------------------------------------------
// Enforcement. The gate's whole value is that it cannot be talked around, so
// these tests are mostly about the ways it could be:
//
//   1. Never reviewed is NOT the same as passed. A design nobody looked at must
//      not go live just because there is no failure on file.
//   2. A pass is bound to the presentation that earned it. "Pass QA, then edit
//      the price to $2" has to be caught, or the gate protects nothing.
//   3. An admin override is honoured, because a gate with no human escape hatch
//      gets switched off the first time it is wrong.
// ---------------------------------------------------------------------------

const stamp = (over: Record<string, unknown> = {}) => ({
  status: 'passed',
  channel: 'storefront',
  submission_no: 1,
  review_id: 'r1',
  score: 96,
  fingerprint: 'abc123',
  blocking: 0,
  warnings: 0,
  at: '2026-08-17T00:00:00.000Z',
  by: 'daily-designer',
  failures: [],
  ...over
})

const meta = (over: Record<string, unknown> = {}) => ({ qa_gate: { storefront: stamp(over) } })

describe('evaluateGate', () => {
  it('refuses a design that has never been reviewed', () => {
    const verdict = evaluateGate({}, 'storefront')
    expect(verdict.allowed).toBe(false)
    expect(verdict.code).toBe('never_reviewed')
  })

  it('refuses a design whose latest review failed, and says which finding', () => {
    const verdict = evaluateGate(meta({ status: 'failed', failures: ['image_sharpness: photo is blurry'] }), 'storefront')
    expect(verdict.allowed).toBe(false)
    expect(verdict.code).toBe('failed')
    expect(verdict.reason).toContain('blurry')
  })

  it('allows a passing design', () => {
    expect(evaluateGate(meta(), 'storefront').allowed).toBe(true)
  })

  it('allows an admin override', () => {
    const verdict = evaluateGate(meta({ status: 'overridden', by: 'david@example.com' }), 'storefront')
    expect(verdict.allowed).toBe(true)
    expect(verdict.code).toBe('overridden')
  })

  it('goes stale when the listing changed after passing', () => {
    const verdict = evaluateGate(meta(), 'storefront', 'a-different-fingerprint')
    expect(verdict.allowed).toBe(false)
    expect(verdict.code).toBe('stale')
  })

  it('keeps the pass when the presentation is unchanged', () => {
    expect(evaluateGate(meta(), 'storefront', 'abc123').allowed).toBe(true)
  })

  it('grades each channel separately — passing on the storefront is not passing on Etsy', () => {
    expect(evaluateGate(meta(), 'storefront').allowed).toBe(true)
    expect(evaluateGate(meta(), 'etsy').allowed).toBe(false)
  })
})

describe('partitionByQa', () => {
  it('splits candidates and keeps the reason with each blocked row', () => {
    const { allowed, blocked } = partitionByQa(
      [
        { id: 'ok', name: 'Passed', metadata: meta() },
        { id: 'never', name: 'Unreviewed', metadata: {} },
        { id: 'bad', name: 'Failed', metadata: meta({ status: 'failed', failures: ['seo: title is stuffed'] }) }
      ],
      'storefront'
    )
    expect(allowed.map(a => a.id)).toEqual(['ok'])
    expect(blocked.map(b => b.id).sort()).toEqual(['bad', 'never'])
    expect(blocked.find(b => b.id === 'bad')?.reason).toContain('stuffed')
  })
})

describe('fingerprintPresentation', () => {
  const base: PresentationInput = {
    productId: 'p1',
    name: 'Tee',
    channel: 'etsy',
    category: 'shirts',
    designUrl: 'https://x/art.png',
    mockupUrls: ['https://x/1.png', 'https://x/2.png'],
    placement: 'front-center',
    printSizeInches: 11,
    title: 'A Title',
    description: 'A description',
    tags: ['one tag', 'two tag'],
    price: 25
  }

  it('is stable for the same presentation', () => {
    expect(fingerprintPresentation(base)).toBe(fingerprintPresentation({ ...base }))
  })

  it('ignores tag ORDER but not tag CONTENT', () => {
    expect(fingerprintPresentation({ ...base, tags: ['two tag', 'one tag'] })).toBe(fingerprintPresentation(base))
    expect(fingerprintPresentation({ ...base, tags: ['one tag', 'three tag'] })).not.toBe(fingerprintPresentation(base))
  })

  it('changes when any reviewed field changes', () => {
    const original = fingerprintPresentation(base)
    expect(fingerprintPresentation({ ...base, price: 2 })).not.toBe(original)
    expect(fingerprintPresentation({ ...base, title: 'Another Title' })).not.toBe(original)
    expect(fingerprintPresentation({ ...base, description: 'Rewritten' })).not.toBe(original)
    // A re-render swaps the URL, and a re-render is exactly what must be
    // re-reviewed — this is the case a title/price-only fingerprint would miss.
    expect(fingerprintPresentation({ ...base, mockupUrls: ['https://x/1.png', 'https://x/3.png'] })).not.toBe(original)
  })

  it('does not change for fields the review never looked at', () => {
    expect(fingerprintPresentation({ ...base, name: 'Renamed internally' })).toBe(fingerprintPresentation(base))
  })
})

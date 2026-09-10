// Tests for the print-true mockup brief and its template gate.
//
// The render itself is two network calls plus a composite, so what is unit
// tested here is the part that decides WHETHER to take this path and the brief
// that keeps the generated garment blank — a garment that arrives with an
// invented graphic on it would sit under the real print and show around its
// edges, which is the one way this path can produce a worse mockup than the
// generative one it replaces.
import { describe, it, expect, vi } from 'vitest'

// The module graph reaches the real Supabase/GCS clients through the image-flow
// provider, which throw at construction without env — same stub-mock pattern as
// the other service tests here.
vi.mock('../lib/supabase.js', () => ({ supabase: { from: () => ({}), rpc: async () => ({ data: 1 }) } }))

import { buildBlankGarmentPrompt, supportsPrintTrue } from './print-true-mockup.js'

describe('supportsPrintTrue', () => {
  it('takes the plain garment templates', () => {
    expect(supportsPrintTrue('ghost_mannequin')).toBe(true)
    expect(supportsPrintTrue('flat_lay')).toBe(true)
    expect(supportsPrintTrue('hanger')).toBe(true)
  })

  it('leaves metal art alone — a panel is full-bleed, not a print box on a chest', () => {
    expect(supportsPrintTrue('metal_shelf')).toBe(false)
    expect(supportsPrintTrue('metal_wall')).toBe(false)
  })

  it('leaves the character templates alone', () => {
    expect(supportsPrintTrue('mr_imagine')).toBe(false)
  })

  it('is safe on a missing template', () => {
    expect(supportsPrintTrue(undefined)).toBe(false)
    expect(supportsPrintTrue('')).toBe(false)
  })
})

describe('buildBlankGarmentPrompt', () => {
  it('names the garment and colour it was asked for', () => {
    const p = buildBlankGarmentPrompt('pullover hoodie', 'navy', 'ghost_mannequin')
    expect(p).toMatch(/navy pullover hoodie/i)
  })

  it('demands a completely blank garment, since the real print goes on next', () => {
    const p = buildBlankGarmentPrompt('crew neck t-shirt', 'black', 'ghost_mannequin')
    expect(p).toMatch(/BLANK/)
    expect(p).toMatch(/no print/i)
    expect(p).toMatch(/no graphic/i)
    expect(p).toMatch(/no text/i)
  })

  it('asks for a transparent background, which is what makes the composite possible', () => {
    // mockup-composite derives the garment box from alpha; a backdrop would
    // swallow the silhouette and the print would land in the wrong place.
    const p = buildBlankGarmentPrompt('crew neck t-shirt', 'white', 'flat_lay')
    expect(p).toMatch(/transparent background/i)
    expect(p).toMatch(/no backdrop/i)
  })

  it('stages each template differently', () => {
    const ghost = buildBlankGarmentPrompt('crew neck t-shirt', 'black', 'ghost_mannequin')
    const flat = buildBlankGarmentPrompt('crew neck t-shirt', 'black', 'flat_lay')
    const hanger = buildBlankGarmentPrompt('crew neck t-shirt', 'black', 'hanger')
    expect(ghost).toMatch(/invisible-mannequin|ghost mannequin/i)
    expect(flat).toMatch(/laid perfectly flat/i)
    expect(hanger).toMatch(/wooden hanger/i)
    expect(new Set([ghost, flat, hanger]).size).toBe(3)
  })

  it('falls back to the ghost-mannequin staging for an unknown template', () => {
    expect(buildBlankGarmentPrompt('crew neck t-shirt', 'black', 'nonsense')).toMatch(/ghost mannequin/i)
  })
})

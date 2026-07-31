// Tests for buildDTFPrompt's positive-only phrasing (Watchtower 335a3416).
//
// services/replicate.ts generates on black-forest-labs/flux-2-pro, which has
// NO negative_prompt parameter. Black Forest Labs document that naming a thing
// in order to exclude it tends to summon it instead. The prompt this builder
// produces used to say "DO NOT generate any clothing, t-shirts, hoodies... NO
// mockups" — on flux-2-pro that reads as a shopping list for exactly the
// garment mockups the DTF step must never produce, and every one of those is a
// paid generation that has to be thrown away.
//
// So these are not style assertions. Re-introducing an exclusion here silently
// costs money per generation, and nothing else in the pipeline would catch it.

import { describe, it, expect } from 'vitest'
import { buildDTFPrompt } from './dtf-optimizer.js'

// Phrases that name a garment/mockup as something to avoid. Each is a real
// pattern that existed in this file before the flux-2-pro migration.
const EXCLUSION_PATTERNS: RegExp[] = [
  /\bDO NOT\b/i,
  /\bDON'T\b/i,
  /\bNO t-shirts?\b/i,
  /\bNO hoodies?\b/i,
  /\bNO clothing\b/i,
  /\bNO garments?\b/i,
  /\bNO fabric\b/i,
  /\bNO mockups?\b/i,
  /\bNO product images?\b/i,
  /\bwithout any (?:clothing|garment|shirt)/i,
  /\bnever (?:show|generate|create)\b/i,
]

const SHIRT_COLORS = ['black', 'white', 'grey', 'color'] as const
const PRINT_STYLES = ['clean', 'halftone', 'grunge'] as const

describe('buildDTFPrompt — no exclusion phrasing reaches flux-2-pro', () => {
  it('never emits a DO-NOT style exclusion, for any color/style combination', () => {
    for (const color of SHIRT_COLORS) {
      for (const style of PRINT_STYLES) {
        const prompt = buildDTFPrompt('a roaring grizzly bear', color, style)
        for (const pattern of EXCLUSION_PATTERNS) {
          expect(
            pattern.test(prompt),
            `buildDTFPrompt('${color}', '${style}') matched exclusion ${pattern}. ` +
            `flux-2-pro has no negative_prompt — reword this positively.`
          ).toBe(false)
        }
      }
    }
  })

  it('does not name garments at all, so the model has nothing to latch onto', () => {
    const prompt = buildDTFPrompt('a neon skull', 'black', 'clean')
    // "t-shirt"/"hoodie"/"apparel" should not appear even as a bare noun in
    // the builder's own scaffolding. (A user prompt asking for one is their
    // choice and is interpolated verbatim — that is not what this guards.)
    for (const garment of ['t-shirt', 'tshirt', 'hoodie', 'tank top', 'apparel', 'garment']) {
      expect(prompt.toLowerCase()).not.toContain(garment)
    }
  })

  it('still states the actual goal — isolated, print-ready, transparent-background art', () => {
    const prompt = buildDTFPrompt('a neon skull', 'black', 'clean')
    expect(prompt).toMatch(/isolated/i)
    expect(prompt).toMatch(/transparent/i)
    expect(prompt).toMatch(/print-ready/i)
    // The user's subject must survive intact.
    expect(prompt).toContain('a neon skull')
  })

  it('steers color positively per shirt color rather than forbidding a color', () => {
    const onBlack = buildDTFPrompt('a wolf', 'black', 'clean')
    expect(onBlack).toMatch(/bright|vivid|saturated/i)

    const onWhite = buildDTFPrompt('a wolf', 'white', 'clean')
    expect(onWhite).toMatch(/saturated|contrast/i)
  })
})

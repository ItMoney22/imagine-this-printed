// Tests for the mockup prompt builders in worker-helpers.ts.
//
// Both failures below were reported by David from real generated product images
// on 2026-07-29 ("it doesnt look like we got the ghost maniquien and the
// mrimagine is missingf a whole arm"). Each cost paid generations to discover,
// and nothing else in the pipeline can catch either one — a mockup that comes
// back flat, or a mascot with a limb missing, is only visible to a human
// looking at the finished image. So these assertions guard behaviour, not style.

import { describe, it, expect } from 'vitest'
import { buildEmptyGarmentPromptPair, buildMrImaginePrompt, type RunMockupOpts } from './worker-helpers.js'

const PRODUCT_TYPES = ['tshirt', 'hoodie', 'tank'] as const
const SHIRT_COLORS = ['black', 'white', 'gray', 'grey'] as const
const PLACEMENTS = ['front-center', 'left-pocket', 'back-only', 'pocket-front-back-full'] as const

function opts(over: Partial<RunMockupOpts> = {}): RunMockupOpts {
  return {
    template: 'ghost_mannequin',
    designImageUrl: 'https://example.test/design.png',
    productType: 'tshirt',
    shirtColor: 'black',
    ...over,
  }
}

describe('buildMrImaginePrompt — the character keeps every limb', () => {
  // Nano Banana takes NO negative_prompt (models.ts: input is prompt +
  // image_input), so the only place an exclusion can live is the positive
  // prompt. The original prompt said just "keep Mr. Imagine exactly as in the
  // first image", which it treated as a soft style hint — and it repeatedly
  // dropped the non-waving arm while repainting the garment.
  it('demands both arms and forbids limb loss, for every combination', () => {
    for (const productType of PRODUCT_TYPES) {
      for (const shirtColor of SHIRT_COLORS) {
        for (const printPlacement of PLACEMENTS) {
          const p = buildMrImaginePrompt(
            opts({ template: 'mr_imagine', productType, shirtColor, printPlacement })
          )
          const where = `(${productType}/${shirtColor}/${printPlacement})`

          expect(p, `${where} must require both arms`).toMatch(/both arms/i)
          expect(p, `${where} must require both legs`).toMatch(/both legs/i)
          expect(p, `${where} must forbid a missing arm`).toMatch(/missing arm/i)
          expect(p, `${where} must forbid a one-armed result`).toMatch(/only one arm|one-armed/i)
          // The observed failure: the sleeve ate the hanging arm.
          expect(p, `${where} must forbid a limb absorbed by the garment`).toMatch(
            /swallowed by the sleeve|absorbed into the garment/i
          )
          // Guard the other direction too — over-correcting produces extra arms.
          expect(p, `${where} must forbid extra limbs`).toMatch(/extra arms|extra limbs/i)
        }
      }
    }
  })

  it('still states that printing the design is the only permitted change', () => {
    const p = buildMrImaginePrompt(opts({ template: 'mr_imagine' }))
    expect(p).toMatch(/ONLY change/i)
  })
})

describe('buildEmptyGarmentPromptPair — ghost_mannequin must not read as a flat lay', () => {
  // Step A (Imagen 4 Fast) generates the empty garment and Step B faithfully
  // preserves whatever shape Step A produced. So if the ghost negative lacks
  // anti-flat pressure, Imagen can satisfy "no wearer" with a flat garment and
  // the ghost slot silently becomes a second flat_lay — which is exactly what
  // shipped. Imagen DOES honour negative_prompt, so the exclusion belongs there.
  const FLAT_TERMS = [/flat lay/i, /laid flat/i, /top-down/i, /folded/i]

  it('puts flat-lay exclusions in the ghost negative prompt', () => {
    for (const productType of PRODUCT_TYPES) {
      for (const shirtColor of SHIRT_COLORS) {
        const { negativePrompt } = buildEmptyGarmentPromptPair(
          opts({ template: 'ghost_mannequin', productType, shirtColor })
        )
        for (const term of FLAT_TERMS) {
          expect(
            term.test(negativePrompt),
            `ghost_mannequin (${productType}/${shirtColor}) negative prompt is missing ${term}. ` +
            'Without it Imagen returns a flat garment and the ghost slot duplicates flat_lay.'
          ).toBe(true)
        }
      }
    }
  })

  it('pins the ghost camera straight on, never overhead', () => {
    const { prompt } = buildEmptyGarmentPromptPair(opts({ template: 'ghost_mannequin' }))
    // An unspecified angle let Imagen choose a top-down framing, which reads as
    // a flat lay regardless of how much volume language follows it.
    expect(prompt).toMatch(/STRAIGHT ON|straight on/)
    expect(prompt).toMatch(/never from above|eye-level/i)
    expect(prompt).toMatch(/three-dimensional|3D/i)
    expect(prompt).toMatch(/hollow/i)
  })

  it('does NOT leak the anti-flat negatives into flat_lay, which must stay flat', () => {
    // The inverse invariant: flat_lay is SUPPOSED to be flat and shot overhead.
    // Applying the ghost negatives to both templates would fight its own
    // positive prompt — the same class of contradiction the file's existing
    // comments describe for "mannequin shape" on the ghost slot.
    const { negativePrompt } = buildEmptyGarmentPromptPair(opts({ template: 'flat_lay' }))
    for (const term of FLAT_TERMS) {
      expect(
        term.test(negativePrompt),
        `flat_lay negative prompt must NOT contain ${term} — it contradicts the flat-lay positive.`
      ).toBe(false)
    }
  })

  it('keeps forbidding the mascot on both garment templates', () => {
    // Regression guard for the original "all three mockups come back as Mr.
    // Imagine" bug the 2-step pipeline exists to defeat.
    for (const template of ['ghost_mannequin', 'flat_lay'] as const) {
      const { negativePrompt } = buildEmptyGarmentPromptPair(opts({ template }))
      expect(negativePrompt, `${template} must exclude the mascot by name`).toMatch(/Mr\. Imagine/)
      expect(negativePrompt, `${template} must exclude a purple character`).toMatch(/purple character/i)
    }
  })

  it('keeps a light garment from being darkened for contrast', () => {
    // White-on-white has no contrast anchor, so Imagen used to darken the
    // garment to keep the subject visible. White garments get a gray backdrop
    // plus explicit light assertions and dark-garment negatives.
    const white = buildEmptyGarmentPromptPair(opts({ shirtColor: 'white' }))
    expect(white.prompt).toMatch(/bright white/i)
    expect(white.negativePrompt).toMatch(/black garment|dark garment/i)

    const black = buildEmptyGarmentPromptPair(opts({ shirtColor: 'black' }))
    expect(black.negativePrompt).not.toMatch(/dark garment/i)
  })
})

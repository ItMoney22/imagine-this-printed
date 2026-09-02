// Unit tests for the pure key/label helpers MockupStep exports — same
// pattern as PhraseChips (IdeaStep) / RecommendationBadge (PrintPrepPanel):
// exercise the presentational/computation logic without the component's
// network effects. Design doc §14 (metal prints lane).
import { describe, it, expect } from 'vitest'
import { expectedShotKeys, shotLabel } from './MockupStep'
import type { StepFlowMeta } from './types'

function stepFlowMeta(over: Partial<StepFlowMeta> = {}): StepFlowMeta {
  return { version: 1, idea: 'x', brief: null, shots: {}, approvals: {}, ...over }
}

describe('expectedShotKeys', () => {
  it('garment: product, hanger, model, details plus one color:<id> per extra color', () => {
    const flow = stepFlowMeta({ colors: { primary: 'black', extras: ['white', 'navy'] } })
    expect(expectedShotKeys(flow, 'garment')).toEqual(['product', 'hanger', 'model', 'details', 'color:white', 'color:navy'])
  })

  it('garment: no extras still fires the four base keys', () => {
    const flow = stepFlowMeta({ colors: { primary: 'black', extras: [] } })
    expect(expectedShotKeys(flow, 'garment')).toEqual(['product', 'hanger', 'model', 'details'])
  })

  it('metal: one scene:<size> per approved size, plus details — never product/hanger/model/color', () => {
    const flow = stepFlowMeta({ sizes: ['4x6', '8x10'] })
    expect(expectedShotKeys(flow, 'metal')).toEqual(['scene:4x6', 'scene:8x10', 'details'])
  })

  it('metal: no sizes approved yet still fires just details (nothing to shoot a scene of)', () => {
    expect(expectedShotKeys(stepFlowMeta(), 'metal')).toEqual(['details'])
  })

  it('metal ignores colors entirely, even if a legacy step_flow object happens to carry them', () => {
    const flow = stepFlowMeta({ sizes: ['4x6'], colors: { primary: 'black', extras: ['white'] } })
    expect(expectedShotKeys(flow, 'metal')).toEqual(['scene:4x6', 'details'])
  })
})

describe('shotLabel', () => {
  it('labels the metal scene keys with their size-true staging copy', () => {
    expect(shotLabel('scene:4x6')).toBe('4×6 on a desk')
    expect(shotLabel('scene:8x10')).toBe('8×10 on the wall')
  })

  it('falls back to a generic "Scene — <size>" for an unrecognized size', () => {
    expect(shotLabel('scene:11x14')).toBe('Scene — 11x14')
  })

  it('details keeps its shared "Product details card" label for both kinds', () => {
    expect(shotLabel('details')).toBe('Product details card')
  })

  it('garment keys are unaffected', () => {
    expect(shotLabel('product')).toBe('Product shot')
    expect(shotLabel('hanger')).toBe('On a hanger')
    expect(shotLabel('model')).toBe('On a person')
    expect(shotLabel('color:heather-grey')).toBe('Extra color — Heather Grey')
  })
})

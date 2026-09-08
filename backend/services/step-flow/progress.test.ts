import { describe, it, expect } from 'vitest'
import { isInStepFlow, stepFlowStage, STAGE_LABELS } from './progress.js'

const meta = (stepFlow: Record<string, any> | null) => (stepFlow ? { step_flow: stepFlow } : {})

describe('isInStepFlow', () => {
  it('is false for an untouched design-library row', () => {
    expect(isInStepFlow({ import_source: 'design-library', collection: 'Cats' })).toBe(false)
  })

  it('is false for a draft that has a brief but never picked a design', () => {
    expect(isInStepFlow(meta({ version: 1, idea: 'cat', brief: { title: 'Cat' }, shots: {}, approvals: {} }))).toBe(false)
  })

  it('is true once a design has been selected', () => {
    expect(isInStepFlow(meta({ shots: {}, approvals: { design: '2026-09-08T00:00:00Z' } }))).toBe(true)
  })

  it('survives missing metadata entirely', () => {
    expect(isInStepFlow(null)).toBe(false)
    expect(isInStepFlow(undefined)).toBe(false)
  })
})

describe('stepFlowStage', () => {
  it('returns null when the product is not in the flow', () => {
    expect(stepFlowStage({ import_source: 'design-library' }, 'draft', false)).toBeNull()
  })

  it('sits on Design while the background is still coming off', () => {
    expect(stepFlowStage(meta({ shots: {}, approvals: { design: 'x' } }), 'draft', false)).toBe('design')
  })

  it('moves to Garment & Color once the cut has landed', () => {
    expect(stepFlowStage(meta({ shots: {}, approvals: { design: 'x' } }), 'draft', true)).toBe('garments')
  })

  it('does not strand a metal print waiting on a cut it never gets', () => {
    // select-design never queues background removal for metal art, so a nobg
    // asset will never exist — gating on it would pin metal on Design forever.
    const metal = meta({ shots: {}, approvals: { design: 'x' }, brief: { productKind: 'metal' } })
    expect(stepFlowStage(metal, 'draft', false)).toBe('garments')
  })

  it('moves to Mockups once a garment and colors are chosen', () => {
    const m = meta({ shots: {}, approvals: { design: 'x', garments: 'x' }, garment: 'tshirt', colors: { primary: 'black', extras: [] } })
    expect(stepFlowStage(m, 'draft', true)).toBe('mockups')
  })

  it('moves to Mockups on a metal print once sizes are picked', () => {
    const m = meta({ shots: {}, approvals: { design: 'x' }, sizes: ['4x6'], brief: { productKind: 'metal' } })
    expect(stepFlowStage(m, 'draft', false)).toBe('mockups')
  })

  it('stays on Mockups while a shot is still unsettled', () => {
    const m = meta({
      garment: 'tshirt',
      approvals: { design: 'x', garments: 'x' },
      shots: { product: { approved: true, status: 'done' }, model: { approved: false, status: 'done' } },
    })
    expect(stepFlowStage(m, 'draft', true)).toBe('mockups')
  })

  it('a failed shot alone does not count as settled — it blocks until skipped', () => {
    const failed = meta({
      garment: 'tshirt',
      approvals: { design: 'x', garments: 'x' },
      shots: { product: { approved: true, status: 'done' }, model: { approved: false, status: 'failed' } },
    })
    expect(stepFlowStage(failed, 'draft', true)).toBe('mockups')

    const skipped = meta({
      garment: 'tshirt',
      approvals: { design: 'x', garments: 'x' },
      shots: { product: { approved: true, status: 'done' }, model: { approved: false, status: 'failed', skipped: true } },
    })
    expect(stepFlowStage(skipped, 'draft', true)).toBe('listing')
  })

  it('reaches Listing once every fired shot is settled', () => {
    const m = meta({
      garment: 'tshirt',
      approvals: { design: 'x', garments: 'x' },
      shots: { product: { approved: true, status: 'done' }, model: { approved: true, status: 'done' } },
    })
    expect(stepFlowStage(m, 'draft', true)).toBe('listing')
  })

  it('is published once the product is live, whatever the step_flow says', () => {
    const m = meta({ shots: {}, approvals: { design: 'x' } })
    expect(stepFlowStage(m, 'active', true)).toBe('published')
  })

  it('is published on the listing approval even before the row flips active', () => {
    const m = meta({ shots: {}, approvals: { design: 'x', listing: 'x' } })
    expect(stepFlowStage(m, 'draft', true)).toBe('published')
  })

  it('labels every stage', () => {
    for (const stage of ['design', 'garments', 'mockups', 'listing', 'published'] as const) {
      expect(STAGE_LABELS[stage]).toBeTruthy()
    }
  })
})

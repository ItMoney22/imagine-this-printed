import { describe, it, expect } from 'vitest'
import {
  areMockupsResolved,
  canReachStep,
  furthestReachableStep,
  getDesignCandidates,
  getNobgAsset,
  getShots,
  hasNonTerminalWork,
  initialStepFlowState,
  mergeShots,
  stepFlowReducer,
  type StepFlowState,
} from './stepFlowReducer'
import type {
  ShotState,
  StepFlowAsset,
  StepFlowGetResponse,
  StepFlowJob,
  StepFlowMeta,
} from './types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const brief = {
  designPrompt: 'a hip-hop street monkey, bold streetwear illustration',
  background: 'white' as const,
  title: 'Street Monkey Tee',
  styleTags: ['streetwear', 'urban'],
  garmentHint: 'tshirt' as const,
  rationale: 'Dark, high-contrast ink reads best on a white render.',
}

function stepFlowMeta(over: Partial<StepFlowMeta> = {}): StepFlowMeta {
  return {
    version: 1,
    idea: 'hip-hop street monkey',
    brief,
    shots: {},
    approvals: {},
    ...over,
  }
}

function asset(over: Partial<StepFlowAsset> & { id: string }): StepFlowAsset {
  return { kind: 'mockup', asset_role: null, url: null, created_at: '2026-09-01T00:00:00Z', ...over }
}

function job(over: Partial<StepFlowJob> & { id: string }): StepFlowJob {
  return {
    product_id: 'p1',
    type: 'replicate_mockup_v2',
    status: 'queued',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  }
}

function response(over: {
  stepFlow?: Partial<StepFlowMeta>
  assets?: StepFlowAsset[]
  jobs?: StepFlowJob[]
  productId?: string
} = {}): StepFlowGetResponse {
  return {
    product: { id: over.productId ?? 'p1', name: 'Street Monkey Tee', category: 't-shirts', metadata: {} },
    step_flow: stepFlowMeta(over.stepFlow),
    assets: over.assets ?? [],
    jobs: over.jobs ?? [],
  }
}

function stateWith(over: Partial<StepFlowState> = {}): StepFlowState {
  return { ...initialStepFlowState, ...over }
}

// ---------------------------------------------------------------------------
// Reachability / gating
// ---------------------------------------------------------------------------

describe('canReachStep', () => {
  it('idea is always reachable', () => {
    expect(canReachStep(stateWith(), 'idea')).toBe(true)
  })

  it('design requires a productId (the idea/brief must have created a draft product)', () => {
    expect(canReachStep(stateWith({ productId: null }), 'design')).toBe(false)
    expect(canReachStep(stateWith({ productId: 'p1' }), 'design')).toBe(true)
  })

  it('garments requires the no-bg asset to have landed — approvals.design alone is not enough', () => {
    // The backend stamps approvals.design at select-design time, before the
    // rembg job that produces the no-bg asset even starts, so trusting that
    // stamp alone would unlock Garments (and let color-advice measure the
    // solid-background source) while "Removing the background…" is still
    // running.
    const noNobg = stateWith({ productId: 'p1', stepFlow: stepFlowMeta() })
    expect(canReachStep(noNobg, 'garments')).toBe(false)

    const withNobg = stateWith({
      productId: 'p1',
      stepFlow: stepFlowMeta(),
      assets: [asset({ id: 'a1', kind: 'nobg', url: 'https://x/nobg.png' })],
    })
    expect(canReachStep(withNobg, 'garments')).toBe(true)

    const approvalOnly = stateWith({
      productId: 'p1',
      stepFlow: stepFlowMeta({ approvals: { design: '2026-09-01T00:00:00Z' } }),
    })
    expect(canReachStep(approvalOnly, 'garments')).toBe(false)
  })

  it('mockups requires either approvals.garments or a chosen garment on step_flow', () => {
    const nothing = stateWith({ productId: 'p1', stepFlow: stepFlowMeta() })
    expect(canReachStep(nothing, 'mockups')).toBe(false)

    const withGarment = stateWith({ productId: 'p1', stepFlow: stepFlowMeta({ garment: 'tshirt' }) })
    expect(canReachStep(withGarment, 'mockups')).toBe(true)

    const withApproval = stateWith({
      productId: 'p1',
      stepFlow: stepFlowMeta({ approvals: { garments: '2026-09-01T00:00:00Z' } }),
    })
    expect(canReachStep(withApproval, 'mockups')).toBe(true)
  })

  it('listing requires either approvals.mockups or every fired shot resolved (approved or explicitly skipped)', () => {
    const midFlight = stateWith({
      productId: 'p1',
      stepFlow: stepFlowMeta({
        shots: {
          product: { approved: true, status: 'done', assetId: 'a1' },
          hanger: { approved: false, status: 'running' },
        },
      }),
    })
    expect(canReachStep(midFlight, 'listing')).toBe(false)

    // A bare `failed` status does NOT count as resolved on its own — the
    // admin has to hit Skip so nothing silently ships without that shot.
    const failedNotSkipped = stateWith({
      productId: 'p1',
      stepFlow: stepFlowMeta({
        shots: {
          product: { approved: true, status: 'done', assetId: 'a1' },
          hanger: { approved: false, status: 'failed', error: 'boom' },
        },
      }),
    })
    expect(canReachStep(failedNotSkipped, 'listing')).toBe(false)

    const skipped = stateWith({
      productId: 'p1',
      stepFlow: stepFlowMeta({
        shots: {
          product: { approved: true, status: 'done', assetId: 'a1' },
          hanger: { approved: false, status: 'failed', error: 'boom', skipped: true },
        },
      }),
    })
    expect(canReachStep(skipped, 'listing')).toBe(true)

    const stamped = stateWith({
      productId: 'p1',
      stepFlow: stepFlowMeta({ approvals: { mockups: '2026-09-01T00:00:00Z' } }),
    })
    expect(canReachStep(stamped, 'listing')).toBe(true)
  })

  it('etsy requires the explicit approvals.listing stamp — no fallback', () => {
    const unpublished = stateWith({ productId: 'p1', stepFlow: stepFlowMeta() })
    expect(canReachStep(unpublished, 'etsy')).toBe(false)

    const published = stateWith({
      productId: 'p1',
      stepFlow: stepFlowMeta({ approvals: { listing: '2026-09-01T00:00:00Z' } }),
    })
    expect(canReachStep(published, 'etsy')).toBe(true)
  })
})

describe('furthestReachableStep', () => {
  it('stops at the first ungated step', () => {
    const state = stateWith({
      productId: 'p1',
      stepFlow: stepFlowMeta({ approvals: { design: 't', garments: 't' } }),
      assets: [asset({ id: 'a1', kind: 'nobg', url: 'https://x/nobg.png' })],
    })
    expect(furthestReachableStep(state)).toBe('mockups')
  })

  it('goes all the way to etsy once listing is stamped', () => {
    const state = stateWith({
      productId: 'p1',
      stepFlow: stepFlowMeta({ approvals: { design: 't', garments: 't', mockups: 't', listing: 't' } }),
      assets: [asset({ id: 'a1', kind: 'nobg', url: 'https://x/nobg.png' })],
    })
    expect(furthestReachableStep(state)).toBe('etsy')
  })

  it('is idea with no productId at all', () => {
    expect(furthestReachableStep(stateWith())).toBe('idea')
  })
})

// ---------------------------------------------------------------------------
// Reducer actions
// ---------------------------------------------------------------------------

describe('stepFlowReducer', () => {
  it('SET_IDEA only touches the idea draft', () => {
    const next = stepFlowReducer(initialStepFlowState, { type: 'SET_IDEA', idea: 'a glowing cat astronaut' })
    expect(next.idea).toBe('a glowing cat astronaut')
    expect(next.step).toBe('idea')
  })

  it('PRODUCT_CREATED advances straight to design (no approval needed for that edge)', () => {
    const next = stepFlowReducer(initialStepFlowState, { type: 'PRODUCT_CREATED', productId: 'p1' })
    expect(next.productId).toBe('p1')
    expect(next.step).toBe('design')
  })

  it('GO_TO_STEP is a no-op when the target step is not yet reachable', () => {
    const state = stateWith({ productId: 'p1', step: 'design', stepFlow: stepFlowMeta() })
    const next = stepFlowReducer(state, { type: 'GO_TO_STEP', step: 'listing' })
    expect(next.step).toBe('design')
  })

  it('GO_TO_STEP moves back to an already-reachable earlier step (review)', () => {
    const state = stateWith({
      productId: 'p1',
      step: 'mockups',
      stepFlow: stepFlowMeta({ approvals: { design: 't', garments: 't' } }),
      assets: [asset({ id: 'a1', kind: 'nobg', url: 'https://x/nobg.png' })],
    })
    const next = stepFlowReducer(state, { type: 'GO_TO_STEP', step: 'garments' })
    expect(next.step).toBe('garments')
  })

  it('HYDRATE with advance:true jumps to the furthest reachable step (resume-by-productId)', () => {
    // Simulates loading `?productId=p1` on mount for a product that already
    // has design + garments approved and every fired shot resolved (the
    // failed hanger shot was explicitly skipped), but has not been through
    // Listing yet.
    const res = response({
      productId: 'p1',
      stepFlow: {
        approvals: { design: 't', garments: 't' },
        garment: 'tshirt',
        shots: {
          product: { approved: true, status: 'done', assetId: 'a1', url: 'https://x/product.png' },
          hanger: { approved: false, status: 'failed', error: 'render failed', skipped: true },
        },
      },
      assets: [asset({ id: 'a1', kind: 'nobg', url: 'https://x/nobg.png' })],
    })
    const next = stepFlowReducer(initialStepFlowState, { type: 'HYDRATE', response: res, advance: true })
    expect(next.productId).toBe('p1')
    expect(next.step).toBe('listing')
  })

  it('HYDRATE without advance (a background poll) never moves the visible step', () => {
    const state = stateWith({
      productId: 'p1',
      step: 'mockups',
      stepFlow: stepFlowMeta({ approvals: { design: 't', garments: 't', mockups: 't' } }),
    })
    // Poll tick that would newly unlock Listing — the admin is still reviewing
    // Mockups, so the view must not jump forward under them.
    const res = response({
      productId: 'p1',
      stepFlow: { approvals: { design: 't', garments: 't', mockups: 't' } },
    })
    const next = stepFlowReducer(state, { type: 'HYDRATE', response: res })
    expect(next.step).toBe('mockups')
  })

  it('a passive HYDRATE clamps back down if the current step somehow became unreachable', () => {
    const state = stateWith({
      productId: 'p1',
      step: 'etsy',
      stepFlow: stepFlowMeta({ approvals: { design: 't', garments: 't', mockups: 't', listing: 't' } }),
    })
    // A fresh GET that (implausibly) comes back with listing un-stamped —
    // etsy is no longer reachable, but listing still is (it only needs
    // approvals.mockups), so that's where the clamp lands.
    const res = response({
      productId: 'p1',
      stepFlow: { approvals: { design: 't', garments: 't', mockups: 't' } },
      assets: [asset({ id: 'a1', kind: 'nobg', url: 'https://x/nobg.png' })],
    })
    const next = stepFlowReducer(state, { type: 'HYDRATE', response: res })
    expect(next.step).toBe('listing')
  })

  it('SET_ERROR clears loading and records the message', () => {
    const next = stepFlowReducer(stateWith({ loading: true }), { type: 'SET_ERROR', error: 'boom' })
    expect(next.error).toBe('boom')
    expect(next.loading).toBe(false)
  })

  it('RESET returns to the initial state', () => {
    const dirty = stateWith({ productId: 'p1', step: 'etsy', idea: 'whatever' })
    expect(stepFlowReducer(dirty, { type: 'RESET' })).toEqual(initialStepFlowState)
  })
})

// ---------------------------------------------------------------------------
// Shot merge (GET /:id/step → step_flow.shots + assets + jobs)
// ---------------------------------------------------------------------------

describe('mergeShots / getShots', () => {
  it('backfills a missing url from the assets array by assetId', () => {
    const shots: Partial<Record<string, ShotState>> = {
      product: { approved: true, status: 'done', assetId: 'a1' },
    }
    const assets = [asset({ id: 'a1', url: 'https://x/product.png' })]
    const out = mergeShots(shots as any, assets, [])
    expect(out.product?.url).toBe('https://x/product.png')
  })

  it('prefers a fresher status straight off the shot\'s own job row', () => {
    const shots: Partial<Record<string, ShotState>> = {
      hanger: { approved: false, status: 'queued', jobId: 'j1' },
    }
    const jobs = [job({ id: 'j1', status: 'succeeded' })]
    const out = mergeShots(shots as any, [], jobs)
    expect(out.hanger?.status).toBe('done')
  })

  it('carries the job error onto a failed shot', () => {
    const shots: Partial<Record<string, ShotState>> = {
      hanger: { approved: false, status: 'running', jobId: 'j1' },
    }
    const jobs = [job({ id: 'j1', status: 'failed', error: 'replicate timed out' })]
    const out = mergeShots(shots as any, [], jobs)
    expect(out.hanger?.status).toBe('failed')
    expect(out.hanger?.error).toBe('replicate timed out')
  })

  it('leaves a shot untouched when it has no job row to reconcile against', () => {
    const shots: Partial<Record<string, ShotState>> = {
      details: { approved: true, status: 'done', url: 'https://x/details.png' },
    }
    const out = mergeShots(shots as any, [], [])
    expect(out.details).toEqual({ approved: true, status: 'done', url: 'https://x/details.png' })
  })

  it('getShots reads through state.stepFlow/assets/jobs', () => {
    const state = stateWith({
      stepFlow: stepFlowMeta({ shots: { product: { approved: false, status: 'queued', jobId: 'j1' } } }),
      jobs: [job({ id: 'j1', status: 'running' })],
    })
    expect(getShots(state).product?.status).toBe('running')
  })
})

// ---------------------------------------------------------------------------
// Small selectors used directly by the step components
// ---------------------------------------------------------------------------

describe('getNobgAsset', () => {
  it('returns null before rembg has produced anything', () => {
    expect(getNobgAsset(stateWith())).toBeNull()
  })

  it('returns the newest nobg asset when there are duplicates', () => {
    const state = stateWith({
      assets: [
        asset({ id: 'old', kind: 'nobg', url: 'old.png', created_at: '2026-01-01T00:00:00Z' }),
        asset({ id: 'new', kind: 'nobg', url: 'new.png', created_at: '2026-09-01T00:00:00Z' }),
      ],
    })
    expect(getNobgAsset(state)?.id).toBe('new')
  })
})

describe('getDesignCandidates', () => {
  it('only takes kind:source / asset_role:design rows, oldest first (take order)', () => {
    const state = stateWith({
      assets: [
        asset({ id: 'b', kind: 'source', asset_role: 'design', url: 'b.png', created_at: '2026-09-01T00:01:00Z' }),
        asset({ id: 'a', kind: 'source', asset_role: 'design', url: 'a.png', created_at: '2026-09-01T00:00:00Z' }),
        asset({ id: 'n', kind: 'nobg', asset_role: 'auxiliary', url: 'n.png' }),
      ],
    })
    expect(getDesignCandidates(state).map((c) => c.assetId)).toEqual(['a', 'b'])
  })
})

describe('areMockupsResolved / hasNonTerminalWork', () => {
  it('is false while nothing has fired yet', () => {
    expect(areMockupsResolved(stateWith())).toBe(false)
  })

  it('is false while a failed shot has not been explicitly skipped — a bare `failed` status does not resolve it', () => {
    const state = stateWith({
      stepFlow: stepFlowMeta({
        shots: {
          product: { approved: true, status: 'done' },
          hanger: { approved: false, status: 'failed' },
        },
      }),
    })
    expect(areMockupsResolved(state)).toBe(false)
  })

  it('is true once a failed shot is explicitly skipped (the persisted ShotState.skipped flag)', () => {
    const state = stateWith({
      stepFlow: stepFlowMeta({
        shots: {
          product: { approved: true, status: 'done' },
          hanger: { approved: false, status: 'failed', skipped: true },
        },
      }),
    })
    expect(areMockupsResolved(state)).toBe(true)
  })

  it('is true once every shot is approved — e.g. via a single batch approve-all call', () => {
    const state = stateWith({
      stepFlow: stepFlowMeta({
        shots: {
          product: { approved: true, status: 'done', assetId: 'a1' },
          hanger: { approved: true, status: 'done', assetId: 'a2' },
          model: { approved: true, status: 'done', assetId: 'a3' },
          details: { approved: true, status: 'done', assetId: 'a4' },
        },
      }),
    })
    expect(areMockupsResolved(state)).toBe(true)
  })

  it('hasNonTerminalWork is true while a job is queued or running', () => {
    expect(hasNonTerminalWork(stateWith({ jobs: [job({ id: 'j1', status: 'running' })] }))).toBe(true)
    expect(hasNonTerminalWork(stateWith({ jobs: [job({ id: 'j1', status: 'succeeded' })] }))).toBe(false)
  })

  it('hasNonTerminalWork is true while any shot is queued or running, even with no matching job row', () => {
    const state = stateWith({
      stepFlow: stepFlowMeta({ shots: { model: { approved: false, status: 'running' } } }),
    })
    expect(hasNonTerminalWork(state)).toBe(true)
  })

  it('hasNonTerminalWork is true while a replicate_rembg job is running (the actual type the backend inserts for background removal)', () => {
    const state = stateWith({ jobs: [job({ id: 'j1', type: 'replicate_rembg', status: 'running' })] })
    expect(hasNonTerminalWork(state)).toBe(true)
  })

  it('hasNonTerminalWork ignores a queued/running job of a type this flow never queues', () => {
    const state = stateWith({ jobs: [job({ id: 'j1', type: 'some_other_feature_job', status: 'running' })] })
    expect(hasNonTerminalWork(state)).toBe(false)
  })

  it('hasNonTerminalWork stops polling on an orphaned `details` shot once `product` has failed', () => {
    // `details` is rendered synchronously once `product` lands an asset —
    // if `product` failed outright, `details` is stuck `queued` forever with
    // no job of its own, and must not keep the poll loop alive.
    const state = stateWith({
      stepFlow: stepFlowMeta({
        shots: {
          product: { approved: false, status: 'failed', error: 'render failed' },
          details: { approved: false, status: 'queued' },
        },
      }),
    })
    expect(hasNonTerminalWork(state)).toBe(false)
  })

  it('hasNonTerminalWork still polls a queued `details` shot while `product` has not failed', () => {
    const state = stateWith({
      stepFlow: stepFlowMeta({
        shots: {
          product: { approved: true, status: 'done', assetId: 'a1' },
          details: { approved: false, status: 'queued' },
        },
      }),
    })
    expect(hasNonTerminalWork(state)).toBe(true)
  })
})

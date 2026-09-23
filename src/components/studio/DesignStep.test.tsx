// @vitest-environment jsdom
// Regression cover for the "hip-hop monkey" brief David hit: flux-2-pro
// refused the very FIRST design generation with "flagged as sensitive
// (E005)". Before this, a refusal on the first attempt left ZERO candidates
// to look at, and Tweak (the only prompt-editing path) only renders once a
// candidate exists — so the draft was a dead end with no explanation and no
// way to retry with different wording. These tests pin the rephrase path
// that replaces that dead end.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import DesignStep from './DesignStep'
import { aiProducts } from '../../lib/api'
import { initialStepFlowState, type StepFlowJob, type StepFlowState } from './stepFlowReducer'

vi.mock('../../lib/api', () => ({
  aiProducts: { create: vi.fn(), delete: vi.fn(), regenerateImages: vi.fn() },
  customerStepFlow: {},
  etsy: { compose: vi.fn() },
  stepFlow: { selectDesign: vi.fn() },
}))

// This project runs vitest without `globals`, so testing-library's automatic
// per-test cleanup never registers — unmount by hand (see PhraseChips.test.tsx).
afterEach(cleanup)
beforeEach(() => vi.resetAllMocks())

const PRODUCT_ID = 'p-123'

const failedJob = (over: Partial<StepFlowJob> = {}): StepFlowJob => ({
  id: 'job-1',
  product_id: PRODUCT_ID,
  type: 'replicate_image_v2',
  status: 'failed',
  created_at: '2026-09-23T00:00:00Z',
  updated_at: '2026-09-23T00:00:00Z',
  error: 'replicate black-forest-labs/flux-2-pro failed: flagged as sensitive (E005)',
  ...over,
})

const baseState = (over: Partial<StepFlowState> = {}): StepFlowState => ({
  ...initialStepFlowState,
  step: 'design',
  productId: PRODUCT_ID,
  product: { id: PRODUCT_ID, category: 't-shirts', metadata: {} } as StepFlowState['product'],
  stepFlow: {
    version: 1,
    idea: 'hip-hop street monkey',
    brief: {
      designPrompt: 'a hip-hop street monkey holding a gun, bold streetwear illustration',
      background: 'white',
      title: 'Street Monkey Tee',
      styleTags: ['streetwear'],
      garmentHint: 'tshirt',
      rationale: 'high contrast',
    },
    shots: {},
    approvals: {},
  },
  ...over,
})

describe('DesignStep — E005 sensitivity rephrase path', () => {
  it('offers a rephrase panel (not the generic empty state) when the only design job was refused as sensitive', () => {
    const state = baseState({ jobs: [failedJob()] })
    render(<DesignStep state={state} dispatch={vi.fn()} refresh={vi.fn()} />)

    expect(screen.getByText(/flagged by the image model's safety filter/i)).toBeTruthy()
    expect(screen.queryByText(/No design on this product yet/i)).toBeNull()
    cleanup()
  })

  it('does not offer the rephrase panel for an ordinary (non-sensitivity) failure', () => {
    const state = baseState({ jobs: [failedJob({ error: 'replicate black-forest-labs/flux-2-pro failed: request timed out' })] })
    render(<DesignStep state={state} dispatch={vi.fn()} refresh={vi.fn()} />)

    expect(screen.queryByText(/flagged by the image model's safety filter/i)).toBeNull()
    cleanup()
  })

  it('auto-soften strips risky wording and adds a wholesome framing clause', () => {
    const state = baseState({ jobs: [failedJob()] })
    render(<DesignStep state={state} dispatch={vi.fn()} refresh={vi.fn()} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toContain('gun')

    fireEvent.click(screen.getByRole('button', { name: /Auto-soften/i }))

    expect(textarea.value).not.toMatch(/\bgun\b/i)
    expect(textarea.value.toLowerCase()).toContain('wholesome')
    cleanup()
  })

  it('retrying spins a fresh draft with the edited prompt and hands the new productId to the caller', async () => {
    vi.mocked(aiProducts.create).mockResolvedValue({ productId: 'p-456' } as any)
    const dispatch = vi.fn()
    const refresh = vi.fn().mockResolvedValue(undefined)
    const state = baseState({ jobs: [failedJob()] })

    render(<DesignStep state={state} dispatch={dispatch} refresh={refresh} />)

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'a friendly street monkey dancing, wholesome and family-friendly' } })
    fireEvent.click(screen.getByRole('button', { name: /Retry with this prompt/i }))

    await waitFor(() => expect(aiProducts.create).toHaveBeenCalled())
    const [request] = vi.mocked(aiProducts.create).mock.calls[0]
    expect((request as any).prompt).toContain('friendly street monkey')
    expect(dispatch).toHaveBeenCalledWith({ type: 'PRODUCT_CREATED', productId: 'p-456' })
    expect(refresh).toHaveBeenCalledWith({ productId: 'p-456', advance: true })
    // The dead first draft (never got past a refusal, nothing approved) is
    // cleaned up rather than left as an orphan.
    expect(aiProducts.delete).toHaveBeenCalledWith(PRODUCT_ID)
    cleanup()
  })
})

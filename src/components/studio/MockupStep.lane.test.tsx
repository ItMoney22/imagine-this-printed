// @vitest-environment jsdom
// A customer's mockup cards never say what drew them or how an engine failed.
// The team's cards do: David needs to see what is running what.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import MockupStep from './MockupStep'
import { adminLane, customerLane, StudioLaneProvider, type StudioLane } from './lane'
import { initialStepFlowState, type StepFlowState } from './stepFlowReducer'

vi.mock('../../lib/api', () => ({
  aiProducts: {},
  customerStepFlow: {},
  etsy: {},
  stepFlow: {},
}))

afterEach(cleanup)

const engineError = 'replicate google/nano-banana-2-lite failed: request timed out'

const state = {
  ...initialStepFlowState,
  step: 'mockups',
  productId: 'p-1',
  productKind: 'garment',
  product: { id: 'p-1', category: 'shirts', metadata: {} },
  stepFlow: {
    version: 1,
    idea: 'ghost',
    approvals: {},
    shots: {
      product: { status: 'done', approved: false, url: 'https://cdn.test/a.png', assetId: 'a-1', engine: 'print-true/openai/gpt-image-2.6-flare+composite' },
      model: { status: 'failed', approved: false, error: engineError },
    },
  },
} as unknown as StepFlowState

const show = (lane: StudioLane) =>
  render(
    <StudioLaneProvider lane={{ ...lane, api: new Proxy({}, { get: () => async () => ({ subjects: [] }) }) as StudioLane['api'] }}>
      <MockupStep state={state} dispatch={vi.fn()} refresh={vi.fn(async () => {})} />
    </StudioLaneProvider>
  )

describe('MockupStep — who sees the engine', () => {
  it('names no engine to a customer, on a finished card or a failed one', () => {
    const { container } = show(customerLane)

    expect(container.innerHTML).not.toMatch(/gpt|openai|flare|replicate|banana/i)
    expect(screen.getByText('This one did not finish. Press Redo to try again.')).toBeTruthy()
  })

  it('shows the team the engine and the raw failure', () => {
    show(adminLane)

    expect(screen.getByText('gpt-image-2.6-flare + real print')).toBeTruthy()
    expect(screen.getByText(engineError)).toBeTruthy()
  })
})

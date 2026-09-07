// @vitest-environment jsdom
// Regression cover for the bug David hit on 2026-09-03: "in the step flow it
// doesnt let me complete the etsy side it give me a error all the time".
//
// Every step-flow product reached this step with NO design-QA stamp for the
// `etsy` channel, so POST /etsy/queue/:id answered 422 `never_reviewed` — and
// the step's only response was to print the refusal. There was no path from
// here to a queued draft, for any product, ever. These tests pin the three
// ways out: auto-review-and-retry, show-the-rework, and the admin override.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import EtsyStep from './EtsyStep'
import { designQa, etsy } from '../../lib/api'
import { initialStepFlowState, type StepFlowState } from './stepFlowReducer'

vi.mock('../../lib/api', () => ({
  etsy: { queue: vi.fn(), compose: vi.fn() },
  designQa: { submit: vi.fn(), override: vi.fn() },
}))

// This project runs vitest without `globals`, so testing-library's automatic
// per-test cleanup never registers — unmount by hand (see PhraseChips.test.tsx).
afterEach(cleanup)
beforeEach(() => vi.resetAllMocks())

const PRODUCT_ID = 'p-123'

const state: StepFlowState = {
  ...initialStepFlowState,
  step: 'etsy',
  productId: PRODUCT_ID,
  product: { id: PRODUCT_ID, category: 't-shirts' } as StepFlowState['product'],
}

/** The 422 the queue route throws through `etsy.queue` (src/lib/api.ts attaches
 *  `status`/`body` precisely so this step can read the gate code). */
const gate422 = (code: string, error: string) =>
  Object.assign(new Error(error), {
    status: 422,
    body: { error, qa_gate: { code }, next_step: 'POST /api/admin/design-qa/submit/p-123' },
  })

const renderStep = () => render(<EtsyStep state={state} dispatch={vi.fn()} />)
const clickQueue = () => fireEvent.click(screen.getByRole('button', { name: /Queue draft/i }))

describe('EtsyStep — the design QA gate', () => {
  it('runs the review itself when the design has never been reviewed, then queues', async () => {
    vi.mocked(etsy.queue)
      .mockRejectedValueOnce(gate422('never_reviewed', 'Presentation QA gate: never been through the gate.'))
      .mockResolvedValueOnce({ queued: ['primary'], skipped: [] })
    vi.mocked(designQa.submit).mockResolvedValue({
      status: 'passed',
      score: 88,
      blocking: 0,
      warnings: 1,
      submission_no: 1,
      rework: [],
    })

    renderStep()
    clickQueue()

    await waitFor(() => expect(screen.getByText(/Queued/)).toBeTruthy())
    expect(designQa.submit).toHaveBeenCalledWith(PRODUCT_ID, 'etsy')
    // Refused once, reviewed, queued for real on the retry.
    expect(vi.mocked(etsy.queue).mock.calls).toHaveLength(2)
    expect(screen.getByText(/Draft queued: primary\./)).toBeTruthy()
  })

  it('shows what to fix — in the reviewer’s own words — when the review fails, and does not retry', async () => {
    vi.mocked(etsy.queue).mockRejectedValue(gate422('never_reviewed', 'Presentation QA gate: never been through the gate.'))
    vi.mocked(designQa.submit).mockResolvedValue({
      status: 'failed',
      score: 64,
      blocking: 1,
      warnings: 1,
      submission_no: 1,
      rework: [
        {
          criterion: 'mockup_quality',
          severity: 'block',
          issue: 'A listing photo is only 896x1200px.',
          fix: 'Re-render the shot at 1024px or wider on its short edge.',
        },
        { criterion: 'seo', severity: 'warn', issue: 'Only 1 product photo.' },
      ],
    })

    renderStep()
    clickQueue()

    await waitFor(() => expect(screen.getByText(/A listing photo is only 896x1200px\./)).toBeTruthy())
    expect(screen.getByText(/Re-render the shot at 1024px or wider/)).toBeTruthy()
    expect(screen.getByText(/1 thing to fix/)).toBeTruthy()
    // One attempt only — a failed review must not spend another queue call.
    expect(vi.mocked(etsy.queue).mock.calls).toHaveLength(1)
  })

  it('never leaks the API endpoint hint into anything David reads', async () => {
    vi.mocked(etsy.queue).mockRejectedValue(gate422('failed', 'Presentation QA gate: Failed QA (submission #2, score 51).'))

    renderStep()
    clickQueue()

    await waitFor(() => expect(screen.getByText(/Failed QA \(submission #2, score 51\)\./)).toBeTruthy())
    expect(document.body.textContent).not.toContain('/api/admin/design-qa')
    // The route's own prefix is stripped — the panel already says which gate.
    expect(document.body.textContent).not.toContain('Presentation QA gate:')
    // A recorded failure is not auto-re-reviewed; that costs two vision calls
    // to reprint the same list.
    expect(designQa.submit).not.toHaveBeenCalled()
  })

  it('lets an admin override a failed review with a reason, then queues', async () => {
    vi.mocked(etsy.queue)
      .mockRejectedValueOnce(gate422('failed', 'Presentation QA gate: Failed QA (submission #1, score 51).'))
      .mockResolvedValueOnce({ queued: ['primary'], skipped: [] })
    vi.mocked(designQa.override).mockResolvedValue(undefined)

    renderStep()
    clickQueue()

    await waitFor(() => expect(screen.getByText(/design review is holding this listing/i)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Post it anyway/i }))

    const overrideButton = screen.getByRole('button', { name: /Override and queue/i })
    expect((overrideButton as HTMLButtonElement).disabled).toBe(true) // no reason yet

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Photo is soft but the artwork is right and this drop is time-sensitive.' },
    })
    expect((screen.getByRole('button', { name: /Override and queue/i }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /Override and queue/i }))

    await waitFor(() => expect(screen.getByText(/Queued/)).toBeTruthy())
    expect(designQa.override).toHaveBeenCalledWith(
      PRODUCT_ID,
      'Photo is soft but the artwork is right and this drop is time-sensitive.',
      'etsy'
    )
  })

  it('reports a non-gate failure as a plain error and leaves the gate panel alone', async () => {
    vi.mocked(etsy.queue).mockRejectedValue(Object.assign(new Error('Etsy is not connected'), { status: 500 }))

    renderStep()
    clickQueue()

    await waitFor(() => expect(screen.getByText('Etsy is not connected')).toBeTruthy())
    expect(designQa.submit).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Post it anyway/i })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Composing the listing before it is graded.
//
// David, 2026-09-07: "the step flow should be able to format the listing for
// etsy at the end". His review came back blocking on 7 over-length tags with
// "10 tags used of 13" and "none of the tags appear in the title" — the
// signature of NO composed pack, where both the gate and the publisher fall
// back to the website's search_keywords. Reaching this step without a pack
// means the Listing step was skipped or its compose failed, so the step
// composes one itself rather than grading the storefront's SEO fields.
// ---------------------------------------------------------------------------
const withPack = {
  ...state,
  product: {
    id: PRODUCT_ID,
    category: 't-shirts',
    metadata: { etsy_pack: { title: 'Gnome Abduction Tee', tags: ['gnome tee'], description: 'x', price: 25 } },
  } as StepFlowState['product'],
}

describe('EtsyStep — the listing is composed before it is graded', () => {
  const passingReview = {
    status: 'passed' as const,
    score: 88,
    blocking: 0,
    warnings: 0,
    submission_no: 1,
    rework: [],
  }

  it('composes the Etsy pack before submitting the review when the product has none', async () => {
    vi.mocked(etsy.queue)
      .mockRejectedValueOnce(gate422('never_reviewed', 'Presentation QA gate: never been through the gate.'))
      .mockResolvedValueOnce({ queued: ['primary'], skipped: [] })
    vi.mocked(etsy.compose).mockResolvedValue({ pack: { title: 't', tags: ['a'], description: 'd', price: 25 } } as any)
    vi.mocked(designQa.submit).mockResolvedValue(passingReview)

    renderStep()
    clickQueue()

    await waitFor(() => expect(screen.getByText(/Queued/)).toBeTruthy())
    expect(etsy.compose).toHaveBeenCalledWith(PRODUCT_ID)
    // Order matters: grading has to see the composed copy, not the fallback.
    expect(vi.mocked(etsy.compose).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(designQa.submit).mock.invocationCallOrder[0])
  })

  it('does not spend a second compose call when the pack is already there', async () => {
    vi.mocked(etsy.queue)
      .mockRejectedValueOnce(gate422('never_reviewed', 'Presentation QA gate: never been through the gate.'))
      .mockResolvedValueOnce({ queued: ['primary'], skipped: [] })
    vi.mocked(designQa.submit).mockResolvedValue(passingReview)

    render(<EtsyStep state={withPack} dispatch={vi.fn()} />)
    clickQueue()

    await waitFor(() => expect(screen.getByText(/Queued/)).toBeTruthy())
    expect(etsy.compose).not.toHaveBeenCalled()
  })

  it('still reviews when composing fails, and says the copy is the weaker fallback', async () => {
    vi.mocked(etsy.queue)
      .mockRejectedValueOnce(gate422('never_reviewed', 'Presentation QA gate: never been through the gate.'))
      .mockResolvedValueOnce({ queued: ['primary'], skipped: [] })
    vi.mocked(etsy.compose).mockRejectedValue(new Error('OpenAI credits exhausted'))
    vi.mocked(designQa.submit).mockResolvedValue(passingReview)

    renderStep()
    clickQueue()

    await waitFor(() => expect(screen.getByText(/Queued/)).toBeTruthy())
    // A compose failure must not dead-end the step all over again.
    expect(designQa.submit).toHaveBeenCalledWith(PRODUCT_ID, 'etsy')
    expect(screen.getByText(/Could not write Etsy-native listing copy/)).toBeTruthy()
    expect(screen.getByText(/OpenAI credits exhausted/)).toBeTruthy()
  })
})

describe('EtsyStep — the primary tier is labelled for the garment it is', () => {
  it('shows the hoodie anchor on a hoodie, not the tee price', () => {
    const hoodie = {
      ...state,
      product: { id: PRODUCT_ID, category: 'hoodies' } as StepFlowState['product'],
    }
    render(<EtsyStep state={hoodie} dispatch={vi.fn()} />)
    // David 2026-09-07: "shirts are 25, hoodies 40", less the standing 40% sale.
    expect(screen.getByText(/\$40 → \$24/)).toBeTruthy()
  })

  it('shows the tee anchor on a tee', () => {
    renderStep()
    expect(screen.getByText(/\$25 → \$15/)).toBeTruthy()
  })
})

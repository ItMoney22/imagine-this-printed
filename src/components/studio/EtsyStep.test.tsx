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
import { designQa, etsy, stepFlow, type QaAutofix } from '../../lib/api'
import { initialStepFlowState, type StepFlowState } from './stepFlowReducer'

vi.mock('../../lib/api', () => ({
  etsy: { queue: vi.fn(), compose: vi.fn() },
  designQa: { submit: vi.fn(), override: vi.fn(), autofix: vi.fn() },
  stepFlow: { get: vi.fn() },
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

const renderStep = () => render(<EtsyStep state={state} dispatch={vi.fn()} refresh={vi.fn()} />)
const clickQueue = () => fireEvent.click(screen.getByRole('button', { name: /Queue draft/i }))

/** A repair report. Defaults to "she tried and could not help", which is the
 *  state that must still hand David a readable panel. */
const fixReport = (over: Partial<QaAutofix> = {}): QaAutofix => ({
  attempted: true,
  changed: false,
  reason: null,
  copy: { repaired: false, changes: [], note: null },
  photos: { redone: [], note: null },
  price: { repaired: false, to: null },
  unfixable: [],
  summary: 'Mrs. Imagine could not fix this one automatically.',
  ...over,
})

const failedReview = (rework: any[], score = 59) => ({
  status: 'failed' as const,
  score,
  blocking: rework.filter((r) => r.severity === 'block').length,
  warnings: rework.filter((r) => r.severity !== 'block').length,
  submission_no: 1,
  rework,
})

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

  it('shows what to fix — in the reviewer’s own words — once Mrs. Imagine cannot fix it', async () => {
    vi.mocked(etsy.queue).mockRejectedValue(gate422('never_reviewed', 'Presentation QA gate: never been through the gate.'))
    vi.mocked(designQa.submit).mockResolvedValue(
      failedReview(
        [
          {
            criterion: 'mockup_quality',
            severity: 'block',
            issue: 'A listing photo is only 896x1200px.',
            fix: 'Re-render the shot at 1024px or wider on its short edge.',
          },
          { criterion: 'seo', severity: 'warn', issue: 'Only 1 product photo.' },
        ],
        64
      )
    )
    vi.mocked(designQa.autofix).mockResolvedValue(fixReport())

    renderStep()
    clickQueue()

    await waitFor(() => expect(screen.getByText(/A listing photo is only 896x1200px\./)).toBeTruthy())
    expect(screen.getByText(/Re-render the shot at 1024px or wider/)).toBeTruthy()
    expect(screen.getByText(/1 thing to fix/)).toBeTruthy()
    // Her own sentence, so the panel does not read as if nothing was tried.
    expect(screen.getByText(/could not fix this one automatically/i)).toBeTruthy()
    // One attempt only — a failed review must not spend another queue call.
    expect(vi.mocked(etsy.queue).mock.calls).toHaveLength(1)
    // She stops after one fruitless pass rather than paying for a second.
    expect(vi.mocked(designQa.autofix).mock.calls).toHaveLength(1)
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

    render(<EtsyStep state={withPack} dispatch={vi.fn()} refresh={vi.fn()} />)
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
    render(<EtsyStep state={hoodie} dispatch={vi.fn()} refresh={vi.fn()} />)
    // David 2026-09-07: "shirts are 25, hoodies 40", less the standing 40% sale.
    expect(screen.getByText(/\$40 → \$24/)).toBeTruthy()
  })

  it('shows the tee anchor on a tee', () => {
    renderStep()
    expect(screen.getByText(/\$25 → \$15/)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Mrs. Imagine steps in (2026-09-08).
//
// David, looking at three blocking findings on this step: "if theres something
// wrong then mrs imagine should step in and fix it so it can proccess". Before
// this, a failed review printed a list and stopped. These tests pin the loop
// that replaced it — repair, wait for any re-shoot, re-review, queue — and,
// just as importantly, the places it has to STOP: after MAX_FIX_ROUNDS, and
// the moment a pass changes nothing.
// ---------------------------------------------------------------------------
describe('EtsyStep — Mrs. Imagine steps in', () => {
  const copyFailure = [
    { criterion: 'seo', severity: 'block' as const, issue: 'Title is 32 characters; the minimum is 40.', fix: 'Name the design.' },
    { criterion: 'seo', severity: 'block' as const, issue: 'Only 0 tag(s); at least 10 are required and Etsy allows 13.', fix: 'Add buyer phrases.' },
  ]
  const passing = { status: 'passed' as const, score: 91, blocking: 0, warnings: 0, submission_no: 2, rework: [] }

  it('repairs the copy, re-reviews, and queues without David clicking anything', async () => {
    vi.mocked(etsy.queue)
      .mockRejectedValueOnce(gate422('never_reviewed', 'Presentation QA gate: never been through the gate.'))
      .mockResolvedValueOnce({ queued: ['primary'], skipped: [] })
    vi.mocked(designQa.submit)
      .mockResolvedValueOnce(failedReview(copyFailure))
      .mockResolvedValueOnce(passing)
    vi.mocked(designQa.autofix).mockResolvedValue(
      fixReport({
        changed: true,
        copy: { repaired: true, changes: ['Grew the title from 32 to 61 characters.'], note: null },
        summary: 'Mrs. Imagine rewrote the listing copy.',
      })
    )

    renderStep()
    clickQueue()

    await waitFor(() => expect(screen.getByText(/Queued/)).toBeTruthy())
    expect(vi.mocked(designQa.autofix).mock.calls).toHaveLength(1)
    expect(vi.mocked(designQa.submit).mock.calls).toHaveLength(2)
    // David never had to read the failure at all.
    expect(screen.queryByRole('button', { name: /Post it anyway/i })).toBeNull()
    // But he is told what changed under him, on the way past.
    expect(screen.getByText(/Grew the title from 32 to 61 characters\./)).toBeTruthy()
  })

  it('waits for a re-shoot to land before it re-reviews the photo', async () => {
    vi.mocked(etsy.queue)
      .mockRejectedValueOnce(gate422('never_reviewed', 'Presentation QA gate: never been through the gate.'))
      .mockResolvedValueOnce({ queued: ['primary'], skipped: [] })
    vi.mocked(designQa.submit)
      .mockResolvedValueOnce(
        failedReview([
          {
            criterion: 'design_placement',
            severity: 'block' as const,
            issue: 'The towel obscures part of the printed artwork.',
            fix: 'Re-render from the source artwork.',
          },
        ])
      )
      .mockResolvedValueOnce(passing)
    vi.mocked(designQa.autofix).mockResolvedValue(
      fixReport({
        changed: true,
        photos: { redone: [{ key: 'model', jobId: 'job-1' }], note: null },
        summary: 'Mrs. Imagine is re-shooting the photo.',
      })
    )
    // Still rendering on the first poll, landed on the second — grading the
    // shot that is being replaced would fail for the very same reason.
    vi.mocked(stepFlow.get)
      .mockResolvedValueOnce({ step_flow: { shots: { model: { status: 'running' } } } } as any)
      .mockResolvedValue({ step_flow: { shots: { model: { status: 'done' } } } } as any)

    const refresh = vi.fn()
    render(<EtsyStep state={state} dispatch={vi.fn()} refresh={refresh} />)
    clickQueue()

    await waitFor(() => expect(screen.getByText(/Queued/)).toBeTruthy(), { timeout: 20_000 })
    expect(vi.mocked(stepFlow.get).mock.calls.length).toBeGreaterThanOrEqual(2)
    // The review that mattered ran only after the shot settled.
    expect(vi.mocked(designQa.submit).mock.invocationCallOrder[1]).toBeGreaterThan(
      vi.mocked(stepFlow.get).mock.invocationCallOrder[1]
    )
    // The new photo is pulled into the builder so Mockups shows what shipped.
    expect(refresh).toHaveBeenCalled()
  }, 30_000)

  it('gives up after two rounds instead of spending forever', async () => {
    vi.mocked(etsy.queue).mockRejectedValue(gate422('never_reviewed', 'Presentation QA gate: never been through the gate.'))
    vi.mocked(designQa.submit).mockResolvedValue(failedReview(copyFailure))
    vi.mocked(designQa.autofix).mockResolvedValue(
      fixReport({ changed: true, copy: { repaired: true, changes: ['Grew the title.'], note: null } })
    )

    renderStep()
    clickQueue()

    await waitFor(() => expect(screen.getByRole('button', { name: /Post it anyway/i })).toBeTruthy())
    expect(vi.mocked(designQa.autofix).mock.calls).toHaveLength(2)
    expect(screen.getByText(/Mrs. Imagine already tried this:/)).toBeTruthy()
    expect(screen.getByText(/Title is 32 characters; the minimum is 40\./)).toBeTruthy()
  })

  it('does not re-review when the repair pass changed nothing', async () => {
    vi.mocked(etsy.queue).mockRejectedValue(gate422('never_reviewed', 'Presentation QA gate: never been through the gate.'))
    vi.mocked(designQa.submit).mockResolvedValue(failedReview(copyFailure))
    vi.mocked(designQa.autofix).mockResolvedValue(fixReport({ attempted: true, changed: false }))

    renderStep()
    clickQueue()

    await waitFor(() => expect(screen.getByRole('button', { name: /Post it anyway/i })).toBeTruthy())
    // One review, one repair attempt, and then it stops — re-measuring an
    // unchanged design is two vision calls for the same answer.
    expect(vi.mocked(designQa.submit).mock.calls).toHaveLength(1)
    expect(vi.mocked(designQa.autofix).mock.calls).toHaveLength(1)
  })

  it('keeps the copy fix visible when a finding is one only David can settle', async () => {
    vi.mocked(etsy.queue).mockRejectedValue(gate422('never_reviewed', 'Presentation QA gate: never been through the gate.'))
    const artwork = {
      criterion: 'print_background',
      severity: 'block' as const,
      issue: 'The artwork has a PAINTED checkerboard background.',
      fix: 'Run the design through background removal and re-render.',
    }
    vi.mocked(designQa.submit).mockResolvedValue(failedReview([...copyFailure, artwork]))
    vi.mocked(designQa.autofix).mockResolvedValue(
      fixReport({
        changed: true,
        copy: { repaired: true, changes: ['Filled the tags out to 13 of 13.'], note: null },
        unfixable: [artwork],
        summary: 'Mrs. Imagine rewrote the listing copy. 1 thing still needs you.',
      })
    )

    renderStep()
    clickQueue()

    await waitFor(() => expect(screen.getByRole('button', { name: /Post it anyway/i })).toBeTruthy())
    expect(screen.getByText(/Filled the tags out to 13 of 13\./)).toBeTruthy()
    expect(screen.getByText(/PAINTED checkerboard background/)).toBeTruthy()
  })
})

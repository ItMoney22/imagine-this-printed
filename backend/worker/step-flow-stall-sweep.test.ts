// Tests for the Step Flow stalled-shot sweep.
//
// THE BUG THIS SWEEP EXISTS FOR
// A Step Flow shot (`services/step-flow/shots.ts`) pre-claims its `ai_jobs`
// row as 'running' and then renders it INLINE, in the API process, via a
// fire-and-forget `void runModelShot(...)`. If that process goes away
// mid-render — a deploy, a crash, a local restart — nothing on either side of
// the wire ever writes a terminal state:
//   - the worker's own stuck-job sweep deliberately skips these rows
//     (ai-jobs-worker.ts filters out `input.stepKey`, because resetting one to
//     'queued' would hand a second render to the worker while the inline one
//     may still be finishing), and
//   - the admin UI renders no Redo and no Skip on a 'running' shot, and
//     `areMockupsResolved` blocks Continue until every shot is approved or
//     skipped.
// The result is a permanently spinning card that wedges the whole flow for
// that product. Observed live 2026-09-09 on "Crazy Witch Halloween Graphic".
//
// Everything runs against an in-memory fake of StallSweepDeps — no Supabase,
// no clock. The properties under test are the ways this sweep can do damage:
//   1. failing a shot that is still legitimately rendering,
//   2. stealing rows that belong to the other (requeue) sweep,
//   3. requeuing instead of failing, which is what the exclusion prevents,
//   4. failing the JOB row while leaving the shot state spinning — which
//      would strand the UI forever with nothing left for a later sweep to find.

import { describe, it, expect, beforeEach } from 'vitest'

// step-flow-stall-sweep.ts transitively imports backend/lib/supabase.ts, which
// calls createClient() eagerly at module load and throws without a URL/key.
// These tests never touch a real client — the sweep takes injected deps — so
// dummy values are fine. Dynamic import (rather than a static one, which ESM
// hoists ahead of any code in this file) is what makes the ordering work;
// mirrors tryon-retention-sweep.test.ts.
process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const {
  sweepStalledStepFlowShots,
  stallCutoff,
  STEP_FLOW_STALL_MESSAGE,
  makeSupabaseStallDeps,
} = await import('./step-flow-stall-sweep.js')

type StalledShotJob = Awaited<ReturnType<Awaited<ReturnType<typeof makeSupabaseStallDeps>>['findStalledShotJobs']>>[number]

const NOW = new Date('2026-09-09T02:30:00.000Z')
const MIN = 60 * 1000

/** A job row as the sweep's query would hand it back. */
function job(overrides: Partial<StalledShotJob> = {}): StalledShotJob {
  return {
    id: 'job-1',
    product_id: 'prod-1',
    type: 'step_flow_model_shot',
    updated_at: new Date(NOW.getTime() - 60 * MIN).toISOString(),
    input: { stepKey: 'model' },
    ...overrides,
  } as StalledShotJob
}

interface Fake {
  deps: Parameters<typeof sweepStalledStepFlowShots>[0]
  state: {
    rows: StalledShotJob[]
    /** Every (id, message) the sweep marked failed, in order. */
    jobsFailed: Array<{ id: string; message: string }>
    /** Every shot state the sweep marked failed, in order. */
    shotsFailed: Array<{ productId: string; stepKey: string; message: string }>
    /** Product ids whose shot-state write should throw. */
    failShotWrites: Set<string>
    /** Job ids whose job write should throw. */
    failJobWrites: Set<string>
    queried: Array<{ cutoff: string; limit: number }>
  }
}

function makeFake(rows: StalledShotJob[]): Fake {
  const state: Fake['state'] = {
    rows,
    jobsFailed: [],
    shotsFailed: [],
    failShotWrites: new Set(),
    failJobWrites: new Set(),
    queried: [],
  }
  return {
    state,
    deps: {
      async findStalledShotJobs(cutoffIso, limit) {
        state.queried.push({ cutoff: cutoffIso, limit })
        // The real dep filters server-side on updated_at; the fake honours the
        // same contract so a test can assert the cutoff is actually applied.
        return state.rows.filter((r) => r.updated_at < cutoffIso).slice(0, limit)
      },
      async failShotState(productId, stepKey, message) {
        if (state.failShotWrites.has(productId)) throw new Error('shot write boom')
        state.shotsFailed.push({ productId, stepKey, message })
      },
      async failJob(id, message) {
        if (state.failJobWrites.has(id)) throw new Error('job write boom')
        state.jobsFailed.push({ id, message })
      },
      now: () => NOW,
    },
  }
}

describe('stallCutoff', () => {
  it('is the instant a render older than the window started before', () => {
    expect(stallCutoff(NOW, 15)).toBe(new Date(NOW.getTime() - 15 * MIN).toISOString())
  })
})

describe('sweepStalledStepFlowShots', () => {
  let fake: Fake

  beforeEach(() => {
    fake = makeFake([])
  })

  it('fails a step-flow shot stranded past the window', async () => {
    fake = makeFake([job()])

    const summary = await sweepStalledStepFlowShots(fake.deps, { stallMinutes: 15 })

    expect(summary.failed).toBe(1)
    expect(fake.state.shotsFailed).toEqual([
      { productId: 'prod-1', stepKey: 'model', message: STEP_FLOW_STALL_MESSAGE },
    ])
    expect(fake.state.jobsFailed).toEqual([{ id: 'job-1', message: STEP_FLOW_STALL_MESSAGE }])
  })

  it('writes the SHOT STATE before the job row', async () => {
    // Ordering is the one thing that must not be swapped. The admin UI reads
    // `products.metadata.step_flow.shots[key].status`, not the job row, and the
    // sweep's own query only ever finds jobs still in 'running'. So a sweep
    // that failed the job first and then died would leave a card spinning
    // forever with nothing left for a later sweep to select — strictly worse
    // than not sweeping at all.
    const order: string[] = []
    fake = makeFake([job()])
    const deps = {
      ...fake.deps,
      async failShotState(p: string, k: string, m: string) {
        order.push('shot')
        return fake.deps.failShotState(p, k, m)
      },
      async failJob(id: string, m: string) {
        order.push('job')
        return fake.deps.failJob(id, m)
      },
    }

    await sweepStalledStepFlowShots(deps, { stallMinutes: 15 })

    expect(order).toEqual(['shot', 'job'])
  })

  it('leaves the job running when the shot state could not be written', async () => {
    // Failing the job while the shot state still says 'running' is the exact
    // unrecoverable state described above, so a shot-write failure must abort
    // that row and leave it for the next tick.
    fake = makeFake([job()])
    fake.state.failShotWrites.add('prod-1')

    const summary = await sweepStalledStepFlowShots(fake.deps, { stallMinutes: 15 })

    expect(fake.state.jobsFailed).toEqual([])
    expect(summary.failed).toBe(0)
    expect(summary.errors).toBe(1)
  })

  it('never touches a shot that is still inside the window', async () => {
    // A real on-person shot takes 2-4 minutes, and a QA retry doubles it.
    // Failing one mid-render both lies to the admin and invites a double spend.
    fake = makeFake([job({ updated_at: new Date(NOW.getTime() - 3 * MIN).toISOString() })])

    const summary = await sweepStalledStepFlowShots(fake.deps, { stallMinutes: 15 })

    expect(summary.scanned).toBe(0)
    expect(fake.state.shotsFailed).toEqual([])
    expect(fake.state.jobsFailed).toEqual([])
  })

  it('ignores a job that is not a step-flow shot', async () => {
    // No `input.stepKey` means the worker's own 12-minute sweep owns this row
    // and will requeue it for a real re-render. Failing it here would take that
    // recovery away.
    fake = makeFake([job({ id: 'plain', input: {} }), job({ id: 'nullish', input: null })])

    const summary = await sweepStalledStepFlowShots(fake.deps, { stallMinutes: 15 })

    expect(summary.skipped).toBe(2)
    expect(summary.failed).toBe(0)
    expect(fake.state.jobsFailed).toEqual([])
  })

  it('keeps going when one row fails, and reports it', async () => {
    fake = makeFake([job({ id: 'a', product_id: 'p-a' }), job({ id: 'b', product_id: 'p-b' })])
    fake.state.failShotWrites.add('p-a')

    const summary = await sweepStalledStepFlowShots(fake.deps, { stallMinutes: 15 })

    expect(summary.failed).toBe(1)
    expect(summary.errors).toBe(1)
    expect(fake.state.jobsFailed).toEqual([{ id: 'b', message: STEP_FLOW_STALL_MESSAGE }])
  })

  it('carries the shot key from the job, so an added person is failed in its own slot', async () => {
    fake = makeFake([job({ input: { stepKey: 'model:2' } })])

    await sweepStalledStepFlowShots(fake.deps, { stallMinutes: 15 })

    expect(fake.state.shotsFailed[0].stepKey).toBe('model:2')
  })

  it('tells the admin what to do, in words, not a status code', async () => {
    // This string lands under the thumbnail in MockupStep. "Redo" is the
    // button right next to it.
    expect(STEP_FLOW_STALL_MESSAGE).toMatch(/redo/i)
    expect(STEP_FLOW_STALL_MESSAGE).toMatch(/interrupted/i)
  })
})

describe('makeSupabaseStallDeps', () => {
  it('selects only running, unpredicted jobs older than the cutoff', async () => {
    const calls: any = { table: '', select: '', filters: [] as any[], limit: 0 }
    const query: any = {
      select(cols: string) { calls.select = cols; return query },
      eq(col: string, val: any) { calls.filters.push(['eq', col, val]); return query },
      is(col: string, val: any) { calls.filters.push(['is', col, val]); return query },
      lt(col: string, val: any) { calls.filters.push(['lt', col, val]); return query },
      limit(n: number) { calls.limit = n; return Promise.resolve({ data: [], error: null }) },
    }
    const db = { from(table: string) { calls.table = table; return query } }

    const deps = makeSupabaseStallDeps(db as any)
    await deps.findStalledShotJobs('2026-09-09T02:15:00.000Z', 20)

    expect(calls.table).toBe('ai_jobs')
    expect(calls.filters).toContainEqual(['eq', 'status', 'running'])
    expect(calls.filters).toContainEqual(['is', 'prediction_id', null])
    expect(calls.filters).toContainEqual(['lt', 'updated_at', '2026-09-09T02:15:00.000Z'])
    expect(calls.select).toContain('input')
    expect(calls.limit).toBe(20)
  })
})

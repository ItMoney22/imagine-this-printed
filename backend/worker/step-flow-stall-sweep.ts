// ---------------------------------------------------------------------------
// Recovery sweep for Step Flow shots stranded by a dead API process.
//
// THE HOLE THIS CLOSES
// A Step Flow shot does not go through the worker queue. `queueModelShot` /
// `queueMockupJob` (services/step-flow/shots.ts) insert the `ai_jobs` row
// ALREADY pre-claimed as 'running', tag it with `input.stepKey`, and then
// render it inline in the API process with a fire-and-forget
// `void runModelShot(...)`. That is a deliberate design — it keeps the render
// next to the request that asked for it — but it means the process holding the
// render is the only thing that will ever write a terminal state.
//
// So when that process goes away mid-render — a Render deploy, a crash, a local
// restart — the row is stranded at 'running' forever:
//   - the worker's own stuck-job sweep (ai-jobs-worker.ts) skips these rows on
//     purpose: it recovers by resetting to 'queued', and a queued step-flow row
//     would either sit unclaimed forever or hand a SECOND render to the worker
//     while the inline one may still be finishing, and
//   - the admin UI (components/studio/MockupStep.tsx) offers no Redo and no
//     Skip on a 'running' shot, while `areMockupsResolved` refuses to enable
//     Continue until every shot is approved or skipped.
// Net effect: one spinning card wedges that product's entire Step Flow, with no
// way out from the screen. Seen live 2026-09-09 — an on-person shot started
// 87 seconds before the API was restarted sat spinning until it was fixed by
// hand in the database.
//
// WHY THIS FAILS ROWS INSTEAD OF REQUEUING THEM
// Requeuing is exactly what the ai-jobs-worker exclusion is there to prevent.
// This sweep therefore copies the shape of that file's OTHER recovery — the
// 30-minute ceiling on hung 3D Tripo jobs — which marks the row FAILED and
// lets the human retry from the UI rather than silently re-paying for a
// generation that may still land. 'failed' is also the state the UI already
// knows how to offer Redo, "Who?" and Skip on, so the fix needs no new
// front-end concept.
//
// Every I/O touch goes through an injected `StallSweepDeps` so the unit tests
// (step-flow-stall-sweep.test.ts) run with no database and no clock.
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase.js'
import { failStalledShot } from '../services/step-flow/shots.js'
import type { ShotKey } from '../services/step-flow/shots.js'

/**
 * How long a shot may sit in 'running' before it is presumed dead.
 *
 * Measured against real renders, not guessed: an on-person shot takes 110-140s
 * normally and 230-260s when design-fidelity QA buys its one corrective retry
 * (observed range across the 2026-09-08/09 jobs). 15 minutes is ~3.5x the
 * slowest real run, and deliberately sits ABOVE the 12-minute generic sweep in
 * ai-jobs-worker.ts so the two can never argue over a row.
 *
 * Over-shooting is cheap and self-healing — a late render that lands after this
 * sweep patches its own 'done' state straight over the failure. Under-shooting
 * is not: it shows the admin a red card for a photo that is still coming, and
 * invites a Redo that pays for the same shot twice.
 */
export const STEP_FLOW_STALL_MINUTES = Math.max(1, Number(process.env.STEP_FLOW_STALL_MINUTES) || 15)

/** Sweep cadence. Cheap query, so it runs often enough that nobody sits looking at a dead card for long. */
export const STEP_FLOW_STALL_SWEEP_MINUTES = Math.max(1, Number(process.env.STEP_FLOW_STALL_SWEEP_MINUTES) || 5)

/** Rows per tick — bounds one sweep's work. A backlog this big has never happened; the cap is here so it can't. */
export const STEP_FLOW_STALL_BATCH = Math.max(1, Number(process.env.STEP_FLOW_STALL_BATCH) || 20)

/** Delay before the first sweep after boot, so a deploy doesn't sweep mid-rollout. */
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000

/**
 * What the admin reads under the thumbnail. Plain English and actionable —
 * "Redo" is the button immediately next to it — rather than a status code that
 * makes a stalled render look like a bad design.
 */
export const STEP_FLOW_STALL_MESSAGE =
  'The render was interrupted before it finished — hit Redo to shoot it again.'

export interface StalledShotJob {
  id: string
  product_id: string | null
  type: string
  updated_at: string
  input: { stepKey?: string } | null
}

export interface StallSweepDeps {
  /** Jobs still claimed 'running' whose last write is older than `cutoffIso`. */
  findStalledShotJobs(cutoffIso: string, limit: number): Promise<StalledShotJob[]>
  /**
   * Flip the shot the admin is actually looking at. MUST be a no-op when the
   * shot already reached a terminal state — the inline render can land between
   * the query and this write.
   */
  failShotState(productId: string, stepKey: string, message: string): Promise<void>
  /** Flip the bookkeeping row. Never 'queued' — see the header. */
  failJob(id: string, message: string): Promise<void>
  now(): Date
}

export interface StallSweepSummary {
  cutoff: string
  /** Rows the query returned that belong to this sweep. */
  scanned: number
  /** Rows fully recovered — shot state and job row both flipped. */
  failed: number
  /** Rows left alone because they aren't step-flow shots. */
  skipped: number
  /** Rows that threw and were left in 'running' for the next tick. */
  errors: number
}

/** The instant a render older than the window must have started before. */
export function stallCutoff(now: Date, minutes: number = STEP_FLOW_STALL_MINUTES): string {
  return new Date(now.getTime() - minutes * 60 * 1000).toISOString()
}

/**
 * Recover every stranded Step Flow shot.
 *
 * ORDERING IS LORE, NOT STYLE: the shot state is written FIRST, the job row
 * second. The admin UI reads `products.metadata.step_flow.shots[key].status`,
 * and this sweep's own query only ever finds jobs still in 'running'. Fail the
 * job first and die before the shot state, and the card spins forever with
 * nothing left for any later sweep to select — strictly worse than never
 * having swept. In the other order the worst case is a failed shot with a
 * 'running' job row, which the next tick picks up and finishes.
 */
export async function sweepStalledStepFlowShots(
  deps: StallSweepDeps,
  opts: { stallMinutes?: number; batchSize?: number } = {}
): Promise<StallSweepSummary> {
  const stallMinutes = opts.stallMinutes ?? STEP_FLOW_STALL_MINUTES
  const batchSize = opts.batchSize ?? STEP_FLOW_STALL_BATCH

  const cutoff = stallCutoff(deps.now(), stallMinutes)
  const summary: StallSweepSummary = { cutoff, scanned: 0, failed: 0, skipped: 0, errors: 0 }

  const rows = await deps.findStalledShotJobs(cutoff, batchSize)

  for (const row of rows) {
    const stepKey = row.input?.stepKey
    // No stepKey means this row belongs to the worker's own 12-minute sweep,
    // which recovers it properly by requeuing a real re-render. Failing it here
    // would take that recovery away.
    if (!stepKey || !row.product_id) {
      summary.skipped++
      continue
    }
    summary.scanned++

    try {
      await deps.failShotState(row.product_id, stepKey, STEP_FLOW_STALL_MESSAGE)
      await deps.failJob(row.id, STEP_FLOW_STALL_MESSAGE)
      summary.failed++
    } catch (err: any) {
      // Left in 'running' on purpose — the next tick re-selects it. Never fall
      // through to failJob here: see the ordering note above.
      summary.errors++
      console.error(
        `[step-flow-stall] could not recover ${row.id} (${stepKey} on ${row.product_id}), leaving it for the next tick:`,
        err?.message || String(err)
      )
    }
  }

  return summary
}

// ---------------------------------------------------------------------------
// Supabase wiring
// ---------------------------------------------------------------------------

/**
 * The real deps. `db` is injected so the query shape can be asserted without a
 * database — mirrors makeSupabaseRetentionDeps in tryon-retention-sweep.ts.
 *
 * `input` is selected and filtered in JS rather than with a
 * `.not('input->>stepKey', 'is', null)` path expression, for the same reason
 * ai-jobs-worker.ts does it: the batch is capped at 20, so the extra column
 * costs nothing and nothing depends on getting PostgREST's JSON-path syntax
 * exactly right.
 */
export function makeSupabaseStallDeps(db: { from: (table: string) => any } = supabase): StallSweepDeps {
  return {
    async findStalledShotJobs(cutoffIso, limit) {
      const { data, error } = await db
        .from('ai_jobs')
        .select('id, product_id, type, updated_at, input')
        .eq('status', 'running')
        // A prediction_id means a real provider job is being polled elsewhere;
        // this sweep only owns renders nothing is watching.
        .is('prediction_id', null)
        .lt('updated_at', cutoffIso)
        .limit(limit)
      if (error) throw new Error(error.message)
      return (data || []) as StalledShotJob[]
    },

    async failShotState(productId, stepKey, message) {
      await failStalledShot(productId, stepKey as ShotKey, message)
    },

    async failJob(id, message) {
      const { error } = await db
        .from('ai_jobs')
        .update({ status: 'failed', error: message, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw new Error(error.message)
    },

    now: () => new Date(),
  }
}

/** The default instance the worker runs with. */
export const supabaseStallDeps: StallSweepDeps = makeSupabaseStallDeps()

/** One tick: sweep, then log a single line an operator can grep. */
export async function runStepFlowStallSweep(
  deps: StallSweepDeps = supabaseStallDeps
): Promise<StallSweepSummary | null> {
  try {
    const summary = await sweepStalledStepFlowShots(deps)
    if (summary.failed > 0 || summary.errors > 0) {
      console.log(
        `[step-flow-stall] 🩹 recovered ${summary.failed}/${summary.scanned} stranded shot(s) ` +
          `older than ${STEP_FLOW_STALL_MINUTES}m — ${summary.errors} left for the next tick`
      )
    }
    return summary
  } catch (err: any) {
    console.error('[step-flow-stall] sweep failed:', err?.message || String(err))
    return null
  }
}

/**
 * Start the stall sweep. Safe on several worker replicas at once: the shot-state
 * write is guarded to in-flight shots only and the job update is idempotent, so
 * two sweeps racing the same row produce the same single outcome.
 */
export function startStepFlowStallSweep(): void {
  if (process.env.STEP_FLOW_STALL_SWEEP_ENABLED === 'false') {
    console.log('[step-flow-stall] disabled (STEP_FLOW_STALL_SWEEP_ENABLED=false)')
    return
  }

  console.log(
    `[step-flow-stall] 🧵 starting stalled-shot sweep — shots stuck >${STEP_FLOW_STALL_MINUTES}m ` +
      `are failed so the admin can Redo, checked every ${STEP_FLOW_STALL_SWEEP_MINUTES}m`
  )

  const intervalMs = STEP_FLOW_STALL_SWEEP_MINUTES * 60 * 1000
  setInterval(() => { void runStepFlowStallSweep() }, intervalMs)
  setTimeout(() => { void runStepFlowStallSweep() }, FIRST_RUN_DELAY_MS)
}

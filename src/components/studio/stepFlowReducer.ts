// Step Flow reducer — the single state machine StepFlowBuilder and every step
// component read from. Design intent (docs/plans/2026-09-01-imagine-studio-
// step-flow-plan.md, "Track C"): "server step_flow.approvals is the source of
// truth after every write; a step is reachable only when the previous
// approval is stamped." In practice that means every write a step component
// makes is followed by a fresh `GET /:id/step` + a HYDRATE dispatch — this
// reducer never hand-rolls an optimistic update to step_flow itself.
//
// Two edges in the chain (design→garments, mockups→listing) don't have a
// dedicated "stamp this approval" route in the shared contract table
// (only garments→mockups via POST .../step/garments and listing→etsy via
// POST .../step/publish explicitly say they stamp an approval). For those two
// this reducer uses a concrete, resumable signal instead of an approval
// string: a no-bg asset existing (rembg landed) gates Garments, and "every
// fired shot is approved or failed" gates Listing.
//
// design→garments is a NOBG-ONLY gate — it deliberately does NOT also accept
// approvals.design as a fallback. The backend stamps approvals.design at
// select-design time, BEFORE the rembg job that strips the background even
// starts, so trusting that stamp would unlock Garments (and let color-advice
// measure the artwork) while "Removing the background…" is still running —
// the color scoring would run against the solid-background source instead of
// the transparent print file. mockups→listing keeps its approvals.mockups
// fallback, in case the backend ends up stamping it after all.
import type {
  ColorAdvice,
  DesignCandidate,
  ShotKey,
  ShotState,
  StepFlowAsset,
  StepFlowGetResponse,
  StepFlowJob,
  StepFlowMeta,
  StepFlowProductSnapshot,
  StepId,
} from './types'
import { STEP_ORDER } from './types'

// Re-exported so step components can pull everything they need (reducer
// state/actions AND the wire types they render) from this one module.
export type {
  ColorAdvice,
  DesignCandidate,
  ShotKey,
  ShotState,
  StepFlowAsset,
  StepFlowGetResponse,
  StepFlowJob,
  StepFlowMeta,
  StepFlowProductSnapshot,
  StepId,
}

export interface StepFlowState {
  step: StepId
  productId: string | null
  product: StepFlowProductSnapshot | null
  assets: StepFlowAsset[]
  jobs: StepFlowJob[]
  stepFlow: StepFlowMeta | null
  /** Idea textarea draft, before a brief/product exists. */
  idea: string
  loading: boolean
  error: string | null
}

export const initialStepFlowState: StepFlowState = {
  step: 'idea',
  productId: null,
  product: null,
  assets: [],
  jobs: [],
  stepFlow: null,
  idea: '',
  loading: false,
  error: null,
}

export type StepFlowAction =
  | { type: 'RESET' }
  | { type: 'SET_IDEA'; idea: string }
  | { type: 'PRODUCT_CREATED'; productId: string }
  /** advance:true jumps the visible step to the furthest one now reachable
   *  (an initial resume load, or right after the admin's own write/approve).
   *  advance:false (the default — background polling) only ever refreshes the
   *  data in place; it never pulls the admin forward or pushes them back. */
  | { type: 'HYDRATE'; response: StepFlowGetResponse; advance?: boolean }
  | { type: 'GO_TO_STEP'; step: StepId }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }

// ---------------------------------------------------------------------------
// Selectors / gating — pure functions so they're independently testable.
// ---------------------------------------------------------------------------

export function getApprovals(state: Pick<StepFlowState, 'stepFlow'>) {
  return state.stepFlow?.approvals ?? {}
}

/** Newest `kind:'nobg'` asset (the rembg output), or null if it hasn't landed. */
export function getNobgAsset(state: Pick<StepFlowState, 'assets'>): StepFlowAsset | null {
  const nobg = state.assets.filter((a) => a.kind === 'nobg' && a.url)
  if (nobg.length === 0) return null
  return [...nobg].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0]
}

/** The generated "takes" the Design step picks from (kind:'source', asset_role:'design'). */
export function getDesignCandidates(state: Pick<StepFlowState, 'assets'>): DesignCandidate[] {
  return state.assets
    .filter((a) => a.kind === 'source' && a.asset_role === 'design' && a.url)
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
    .map((a) => ({ assetId: a.id, url: a.url as string, label: a.metadata?.model_name }))
}

function jobStatusToShotStatus(status: StepFlowJob['status']): ShotState['status'] | null {
  switch (status) {
    case 'succeeded':
      return 'done'
    case 'failed':
      return 'failed'
    case 'running':
      return 'running'
    case 'queued':
      return 'queued'
    default:
      return null
  }
}

/** Backfill a shot's `url` from the assets array when only an `assetId` is set. */
export function resolveShotUrl(shot: ShotState, assets: StepFlowAsset[]): string | undefined {
  if (shot.url) return shot.url
  if (shot.assetId) return assets.find((a) => a.id === shot.assetId)?.url ?? undefined
  return undefined
}

/**
 * Merge `step_flow.shots` with the `assets`/`jobs` GET /:id/step also returns:
 * backfill a missing `url` from the matching asset, and prefer a fresher
 * status read straight off the shot's own job row when one exists (covers the
 * gap between a worker finishing a job and the next server-side step_flow
 * write re-deriving shots[key].status).
 */
export function mergeShots(
  shots: Partial<Record<ShotKey, ShotState>> | undefined,
  assets: StepFlowAsset[],
  jobs: StepFlowJob[]
): Partial<Record<ShotKey, ShotState>> {
  const out: Partial<Record<ShotKey, ShotState>> = {}
  for (const key of Object.keys(shots ?? {}) as ShotKey[]) {
    const shot = shots?.[key]
    if (!shot) continue
    const job = shot.jobId ? jobs.find((j) => j.id === shot.jobId) : undefined
    const derivedStatus = job ? jobStatusToShotStatus(job.status) : null
    out[key] = {
      ...shot,
      url: resolveShotUrl(shot, assets),
      status: derivedStatus ?? shot.status,
      error: job?.status === 'failed' ? job.error ?? shot.error : shot.error,
    }
  }
  return out
}

export function getShots(
  state: Pick<StepFlowState, 'stepFlow' | 'assets' | 'jobs'>
): Partial<Record<ShotKey, ShotState>> {
  return mergeShots(state.stepFlow?.shots, state.assets, state.jobs)
}

/** True once every fired shot is either approved or has failed (a failed shot
 *  can be explicitly skipped rather than blocking the flow forever). */
export function areMockupsResolved(state: Pick<StepFlowState, 'stepFlow' | 'assets' | 'jobs'>): boolean {
  const shots = getShots(state)
  const entries = Object.values(shots).filter((s): s is ShotState => !!s)
  if (entries.length === 0) return false
  return entries.every((s) => s.approved || s.status === 'failed')
}

/** The job types this flow actually queues — filters out any stray row from
 *  another feature so it can never keep the poll loop alive. */
const FLOW_JOB_TYPES = new Set(['replicate_image_v2', 'replicate_remove_bg', 'replicate_mockup_v2', 'step_flow_model_shot'])

/** True while any job or shot is still in flight — the poll loop's condition. */
export function hasNonTerminalWork(state: Pick<StepFlowState, 'stepFlow' | 'assets' | 'jobs'>): boolean {
  if (state.jobs.some((j) => FLOW_JOB_TYPES.has(j.type) && (j.status === 'queued' || j.status === 'running'))) return true
  const shots = getShots(state)
  // `details` is rendered synchronously by the server once the `product`
  // shot lands an asset (see plan "Job conventions") — it has no job row of
  // its own. If `product` failed, `details` is orphaned: stuck `queued`
  // forever with nothing that will ever resolve it, so it must not keep the
  // poll loop running (MockupStep's Skip button is what clears it for good).
  const productFailed = shots.product?.status === 'failed'
  return Object.entries(shots).some(([key, s]) => {
    if (!s) return false
    if (key === 'details' && productFailed) return false
    return s.status === 'queued' || s.status === 'running'
  })
}

/**
 * Reachability, step by step. `idea` is always reachable; every later step
 * needs its predecessor's exit condition. `design`, `garments` and `listing`
 * don't have a documented approval stamp in the shared contract (see file
 * header): `design` uses the nobg asset alone (no approval fallback — it's
 * stamped too early to trust), `garments` and `listing` use a concrete
 * fallback signal alongside the approval string.
 */
export function canReachStep(
  state: Pick<StepFlowState, 'productId' | 'stepFlow' | 'assets' | 'jobs'>,
  step: StepId
): boolean {
  const idx = STEP_ORDER.indexOf(step)
  if (idx <= 0) return true
  const approvals = getApprovals(state)
  switch (STEP_ORDER[idx - 1]) {
    case 'idea':
      return !!state.productId
    case 'design':
      // No approvals.design fallback — see the file header. The nobg asset
      // landing is the only trustworthy signal that the background has
      // actually been stripped.
      return getNobgAsset(state) !== null
    case 'garments':
      return !!approvals.garments || !!state.stepFlow?.garment
    case 'mockups':
      return !!approvals.mockups || areMockupsResolved(state)
    case 'listing':
      return !!approvals.listing
    default:
      return false
  }
}

export function furthestReachableStep(
  state: Pick<StepFlowState, 'productId' | 'stepFlow' | 'assets' | 'jobs'>
): StepId {
  let result: StepId = 'idea'
  for (const step of STEP_ORDER) {
    if (canReachStep(state, step)) result = step
    else break
  }
  return result
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function stepFlowReducer(state: StepFlowState, action: StepFlowAction): StepFlowState {
  switch (action.type) {
    case 'RESET':
      return initialStepFlowState

    case 'SET_IDEA':
      return { ...state, idea: action.idea }

    case 'PRODUCT_CREATED': {
      const next = { ...state, productId: action.productId, loading: false, error: null }
      return { ...next, step: furthestReachableStep(next) }
    }

    case 'HYDRATE': {
      const next: StepFlowState = {
        ...state,
        productId: action.response.product?.id ?? state.productId,
        product: action.response.product,
        assets: action.response.assets ?? [],
        jobs: action.response.jobs ?? [],
        stepFlow: action.response.step_flow,
        loading: false,
        error: null,
      }
      if (action.advance) {
        return { ...next, step: furthestReachableStep(next) }
      }
      // Passive/poll refresh: never leave the admin stranded on a step that
      // just became unreachable (shouldn't normally happen), but otherwise
      // leave their place in the flow alone — new shot statuses update the
      // cards in place without yanking the view forward or back.
      return { ...next, step: canReachStep(next, state.step) ? state.step : furthestReachableStep(next) }
    }

    case 'GO_TO_STEP':
      return canReachStep(state, action.step) ? { ...state, step: action.step } : state

    case 'SET_LOADING':
      return { ...state, loading: action.loading }

    case 'SET_ERROR':
      return { ...state, error: action.error, loading: false }

    default:
      return state
  }
}

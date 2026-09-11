// Imagine Studio — Step Flow. One idea in, an approve on every step, a
// product + Etsy listing out. See
// docs/plans/2026-09-01-imagine-studio-step-flow-plan.md ("Track C").
import React, { useCallback, useEffect, useReducer, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  canReachStep,
  hasNonTerminalWork,
  initialStateFor,
  stepFlowReducer,
} from './stepFlowReducer'
import { adminLane, StudioLaneProvider, useStudioLane, type StudioLane } from './lane'
import type { StepId } from './types'
import { HexTracker, InlineError, StepCard } from './shared'
import IdeaStep from './IdeaStep'
import DesignStep from './DesignStep'
import GarmentStep from './GarmentStep'
import SizesStep from './SizesStep'
import MockupStep from './MockupStep'
import ListingStep from './ListingStep'
import EtsyStep from './EtsyStep'

const POLL_INTERVAL_MS = 3000

interface StepFlowBuilderProps {
  /** Resume an existing draft at the right step (?productId= from the page). */
  productId?: string | null
  /** Which lane this builder runs (components/studio/lane.tsx). Defaults to
   *  the staff lane, so the admin page keeps working untouched. */
  lane?: StudioLane
}

const StepFlowBuilder: React.FC<StepFlowBuilderProps> = ({ productId, lane = adminLane }) => (
  <StudioLaneProvider lane={lane}>
    <StepFlowBody productId={productId} />
  </StudioLaneProvider>
)

/** Split from the exported component so every step below — and the loader
 *  itself — reads the lane through the same hook the steps use, rather than
 *  half the tree taking it as a prop and the other half from context. */
const StepFlowBody: React.FC<{ productId?: string | null }> = ({ productId }) => {
  const lane = useStudioLane()
  const [state, dispatch] = useReducer(stepFlowReducer, lane.steps, initialStateFor)
  const stateRef = useRef(state)
  stateRef.current = state
  const [searchParams, setSearchParams] = useSearchParams()

  const refresh = useCallback(async (opts?: { productId?: string; advance?: boolean }) => {
    const id = opts?.productId ?? stateRef.current.productId
    if (!id) return
    try {
      const response = await lane.api.get(id)
      dispatch({ type: 'HYDRATE', response, advance: opts?.advance })
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', error: err?.message || 'Failed to load the current step' })
    }
  }, [lane])

  // Resume: a productId in the URL loads straight to the furthest step this
  // product has actually reached. Skips the refetch when we're already
  // sitting on that exact product (e.g. right after the URL-sync effect
  // below writes the productId we just created back into the URL, handing
  // the same value straight back as this prop).
  useEffect(() => {
    if (!productId) return
    if (stateRef.current.productId === productId && stateRef.current.product) return
    dispatch({ type: 'SET_LOADING', loading: true })
    void refresh({ productId, advance: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId])

  // Seed from one of Mrs. Imagine's scout picks (AdminMrsImagine.tsx links
  // here with ?idea=&kind=). Runs once, and only for a flow that has no
  // product yet: resuming a draft must never have its idea overwritten by a
  // stale link someone re-opened from history. The params are dropped straight
  // after so a refresh mid-flow doesn't re-seed on top of real work.
  //
  // Seeding fills the box; it does not press anything. David still writes the
  // brief, picks the design and approves every step — the click only saves him
  // retyping what she pitched.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || productId || stateRef.current.productId) return
    const idea = searchParams.get('idea')
    if (!idea?.trim()) return
    seeded.current = true
    const kind = searchParams.get('kind')
    dispatch({
      type: 'SEED',
      idea: idea.trim(),
      productKind: kind === 'metal' ? 'metal' : 'garment',
      garment: kind === 'hoodie' || kind === 'youth-tshirt' || kind === 'tshirt' ? kind : null,
    })
    const next = new URLSearchParams(searchParams)
    next.delete('idea')
    next.delete('kind')
    setSearchParams(next, { replace: true })
  }, [productId, searchParams, setSearchParams])

  // Keep `?productId=` (and `?mode=steps`) in sync with whatever draft is
  // actually loaded, so a refresh mid-flow resumes instead of losing the
  // draft. Fires after PRODUCT_CREATED (first generate) and again after a
  // Tweak swaps in a fresh product id — both just change state.productId.
  useEffect(() => {
    if (!state.productId) return
    if (searchParams.get('productId') === state.productId && searchParams.get('mode') === 'steps') return
    const next = new URLSearchParams(searchParams)
    next.set('mode', 'steps')
    next.set('productId', state.productId)
    setSearchParams(next, { replace: true })
  }, [state.productId, searchParams, setSearchParams])

  // Poll while anything server-side is still in flight; stop the moment
  // everything's terminal, and always clear the interval on unmount.
  const pollActive = hasNonTerminalWork(state)
  useEffect(() => {
    if (!state.productId || !pollActive) return
    const interval = setInterval(() => {
      void refresh()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [state.productId, pollActive, refresh])

  // "after this step there should be make another button so i can keep
  // going" (David, 2026-09-09). Both lanes dead-ended on their success
  // screen: the flow was finished, but the only way to start the next one was
  // to edit the URL or reload the page. Resetting state is only half of it —
  // `?productId=` has to go too, or a refresh (and the resume effect above)
  // would drag the finished draft straight back in.
  const startAnother = useCallback(() => {
    dispatch({ type: 'RESET' })
    const next = new URLSearchParams(searchParams)
    next.delete('productId')
    next.set('mode', 'steps')
    setSearchParams(next, { replace: true })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [searchParams, setSearchParams])

  const canReach = useCallback((step: StepId) => canReachStep(state, step), [state])
  const goTo = useCallback((step: StepId) => dispatch({ type: 'GO_TO_STEP', step }), [])
  const isMetal = state.productKind === 'metal'

  return (
    <div className="space-y-6">
      <HexTracker
        step={state.step}
        canReach={canReach}
        onSelect={goTo}
        labelOverrides={isMetal ? { garments: 'Sizes' } : undefined}
        steps={lane.steps}
      />

      {state.loading && !state.product && (
        <StepCard>
          <p className="text-sm text-muted text-center py-6">Loading…</p>
        </StepCard>
      )}

      <InlineError message={state.error} />

      {state.step === 'idea' && <IdeaStep state={state} dispatch={dispatch} refresh={refresh} />}
      {state.step === 'design' && <DesignStep state={state} dispatch={dispatch} refresh={refresh} />}
      {state.step === 'garments' &&
        (isMetal ? (
          <SizesStep state={state} dispatch={dispatch} refresh={refresh} />
        ) : (
          <GarmentStep state={state} dispatch={dispatch} refresh={refresh} />
        ))}
      {state.step === 'mockups' && <MockupStep state={state} dispatch={dispatch} refresh={refresh} />}
      {state.step === 'listing' && (
        <ListingStep state={state} dispatch={dispatch} refresh={refresh} onStartAnother={startAnother} />
      )}
      {/* The customer lane has no Etsy stop at all — not in `lane.steps`, not
          reachable in the reducer, and no route behind it on the server. */}
      {state.step === 'etsy' && lane.steps.includes('etsy') && (
        <EtsyStep state={state} dispatch={dispatch} refresh={refresh} onStartAnother={startAnother} />
      )}
    </div>
  )
}

export default StepFlowBuilder

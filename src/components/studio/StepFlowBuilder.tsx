// Imagine Studio — Step Flow. One idea in, an approve on every step, a
// product + Etsy listing out. See
// docs/plans/2026-09-01-imagine-studio-step-flow-plan.md ("Track C").
import React, { useCallback, useEffect, useReducer, useRef } from 'react'
import { stepFlow } from '../../lib/api'
import {
  canReachStep,
  hasNonTerminalWork,
  initialStepFlowState,
  stepFlowReducer,
} from './stepFlowReducer'
import type { StepId } from './types'
import { HexTracker, InlineError, StepCard } from './shared'
import IdeaStep from './IdeaStep'
import DesignStep from './DesignStep'
import GarmentStep from './GarmentStep'
import MockupStep from './MockupStep'
import ListingStep from './ListingStep'
import EtsyStep from './EtsyStep'

const POLL_INTERVAL_MS = 3000

interface StepFlowBuilderProps {
  /** Resume an existing draft at the right step (?productId= from the page). */
  productId?: string | null
}

const StepFlowBuilder: React.FC<StepFlowBuilderProps> = ({ productId }) => {
  const [state, dispatch] = useReducer(stepFlowReducer, initialStepFlowState)
  const stateRef = useRef(state)
  stateRef.current = state

  const refresh = useCallback(async (opts?: { productId?: string; advance?: boolean }) => {
    const id = opts?.productId ?? stateRef.current.productId
    if (!id) return
    try {
      const response = await stepFlow.get(id)
      dispatch({ type: 'HYDRATE', response, advance: opts?.advance })
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', error: err?.message || 'Failed to load the current step' })
    }
  }, [])

  // Resume: a productId in the URL loads straight to the furthest step
  // this product has actually reached.
  useEffect(() => {
    if (!productId) return
    dispatch({ type: 'SET_LOADING', loading: true })
    void refresh({ productId, advance: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId])

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

  const canReach = useCallback((step: StepId) => canReachStep(state, step), [state])
  const goTo = useCallback((step: StepId) => dispatch({ type: 'GO_TO_STEP', step }), [])

  return (
    <div className="space-y-6">
      <HexTracker step={state.step} canReach={canReach} onSelect={goTo} />

      {state.loading && !state.product && (
        <StepCard>
          <p className="text-sm text-muted text-center py-6">Loading…</p>
        </StepCard>
      )}

      <InlineError message={state.error} />

      {state.step === 'idea' && <IdeaStep state={state} dispatch={dispatch} refresh={refresh} />}
      {state.step === 'design' && <DesignStep state={state} dispatch={dispatch} refresh={refresh} />}
      {state.step === 'garments' && <GarmentStep state={state} dispatch={dispatch} refresh={refresh} />}
      {state.step === 'mockups' && <MockupStep state={state} dispatch={dispatch} refresh={refresh} />}
      {state.step === 'listing' && <ListingStep state={state} dispatch={dispatch} refresh={refresh} />}
      {state.step === 'etsy' && <EtsyStep state={state} dispatch={dispatch} />}
    </div>
  )
}

export default StepFlowBuilder

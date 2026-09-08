// Which lane of the Step Flow is running.
//
// David 2026-09-08: "i wanted our customers to have the same flow on design
// studio … please look and mimic minus the etsy step ofc." Mimicking by
// copying would have produced a second builder that drifts from the first
// within a week, so instead the SAME step components render on both lanes and
// read their differences out of this context:
//
//   - which hexes exist (the customer lane simply has no Etsy stop),
//   - which API base every call goes to (staff vs. the creator-gated rail),
//   - whether the team-only production panels render at all,
//   - what finishing the flow means and what the last button says.
//
// Anything a step needs to know about "am I staff or a customer" belongs here,
// so no step component ever has to ask.
import React, { createContext, useContext, useMemo } from 'react'
import {
  aiProducts,
  customerStepFlow,
  etsy,
  stepFlow as adminStepFlowApi,
  type EtsyComposePack,
  type StepFlowApi,
} from '../../lib/api'
import { buildStepFlowCreateRequest } from './createStepFlowProduct'
import type { AIProductCreationRequest } from '../../types'
import { ADMIN_STEP_ORDER, CUSTOMER_STEP_ORDER, type SelectedInspiration, type StepBrief, type StepId } from './types'

export type StudioLaneId = 'admin' | 'customer'

export interface StudioLane {
  id: StudioLaneId
  /** The endpoint set for this lane — never reach for the module-level one. */
  api: StepFlowApi
  /** The hexes this lane shows, in order. */
  steps: StepId[]
  /** Team-only production tooling: the halftone print-prep panel and the
   *  storefront promo picker. Real work, but not a customer's business. */
  showTeamTools: boolean
  /** Copy for the last step's button and the line under it. */
  finishLabel: string
  finishHint: string
  /** What the customer/admin sees once the last step succeeds. */
  finishedTitle: string
  finishedBody: string
  /** Spins up the draft product + first generation from the Idea step. */
  createProduct: (
    idea: string,
    brief: StepBrief,
    inspiration?: SelectedInspiration
  ) => Promise<{ productId: string }>
  /** Writes the listing copy the Listing step opens with. */
  composeListing: (productId: string) => Promise<{ pack: EtsyComposePack }>
  /** "Another take" on the Design step — re-runs generation on the SAME draft.
   *  Staff only: it is an unmetered spend route, and a customer already has a
   *  metered way to try again (Tweak, which creates a fresh, charged draft).
   *  Absent = the button isn't rendered. */
  regenerateTakes?: (productId: string) => Promise<unknown>
  /** Throws away the scratch draft a Tweak just replaced. */
  discardDraft: (productId: string) => Promise<unknown>
}

export const adminLane: StudioLane = {
  id: 'admin',
  api: adminStepFlowApi,
  steps: ADMIN_STEP_ORDER,
  showTeamTools: true,
  finishLabel: 'Publish',
  finishHint: 'Publishing makes it live on the storefront, then opens the Etsy step.',
  finishedTitle: 'Published',
  finishedBody: 'It is live on the storefront.',
  createProduct: async (idea, brief, inspiration) => {
    const request = buildStepFlowCreateRequest(idea, brief, inspiration)
    // The request carries a few fields whose types AIProductCreationRequest
    // does not know about yet (see createStepFlowProduct.ts) — the backend
    // /create route reads them by name.
    return aiProducts.create(request as unknown as AIProductCreationRequest)
  },
  composeListing: (productId) => etsy.compose(productId),
  regenerateTakes: (productId) => aiProducts.regenerateImages(productId),
  discardDraft: (productId) => aiProducts.delete(productId),
}

export const customerLane: StudioLane = {
  id: 'customer',
  api: customerStepFlow,
  steps: CUSTOMER_STEP_ORDER,
  showTeamTools: false,
  finishLabel: 'Submit for review',
  finishHint: 'The print shop checks it over before it goes on sale. You keep the design either way.',
  finishedTitle: 'Sent to the print shop',
  finishedBody: "They review every design before it goes on sale — you'll hear back once it's looked at.",
  createProduct: (idea, brief, inspiration) =>
    customerStepFlow.createProduct(
      buildStepFlowCreateRequest(idea, brief, inspiration) as unknown as Record<string, unknown>
    ),
  composeListing: (productId) => customerStepFlow.listingCopy(productId),
  discardDraft: (productId) => customerStepFlow.discardDraft(productId),
}

const LaneContext = createContext<StudioLane>(adminLane)

/** Defaults to the admin lane, so an existing caller that never wraps its tree
 *  (AdminAIProductBuilder, and every step test) behaves exactly as before. */
export const useStudioLane = (): StudioLane => useContext(LaneContext)

export const StudioLaneProvider: React.FC<{ lane: StudioLane; children: React.ReactNode }> = ({ lane, children }) => {
  const value = useMemo(() => lane, [lane])
  return <LaneContext.Provider value={value}>{children}</LaneContext.Provider>
}

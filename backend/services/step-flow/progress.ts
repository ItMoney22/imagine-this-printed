// Where a product is standing in the Step Flow — computed from the stored
// `metadata.step_flow` rather than from the builder's own React state, so the
// admin lists can answer "which designs am I part-way through, and where do I
// pick each one up?" without opening the builder on every candidate.
//
// David 2026-09-08: "once i bring it into step flow it should show up under
// products, it takes it down from designs... so we dont do the same ones twice
// because idk where to pick up the step flow i already am doing."
//
// This deliberately mirrors `canReachStep` in
// src/components/studio/stepFlowReducer.ts — the frontend gate that actually
// decides which step opens. Any disagreement between the two shows up as a
// list that promises one step and lands you on another, so the two rule sets
// are written to match, including the awkward one: `design -> garments` is
// gated on the no-background asset EXISTING, not on `approvals.design`, which
// the backend stamps before the background removal has even started.
import type { StepFlowMeta } from './shots.js'

/** The stop a product is sitting on. 'published' means the flow is finished. */
export type StepFlowStage = 'design' | 'garments' | 'mockups' | 'listing' | 'published'

/** Human labels — the same words the builder's own step tracker uses. */
export const STAGE_LABELS: Record<StepFlowStage, string> = {
  design: 'Design',
  garments: 'Garment & Color',
  mockups: 'Mockups',
  listing: 'Listing',
  published: 'Published',
}

/**
 * True once a design has actually been committed to. `approvals.design` is the
 * signal because it is stamped the moment a source design is selected — which
 * is exactly the point the design stops being an untouched library design and
 * becomes a build in progress.
 *
 * A product created with a brief but abandoned before any design was picked is
 * deliberately NOT counted: there is nothing to resume, and it would clutter
 * the list with rows whose only sensible action is "start over".
 */
export function isInStepFlow(metadata: Record<string, any> | null | undefined): boolean {
  return Boolean(metadata?.step_flow?.approvals?.design)
}

/** Every shot that was fired is settled — approved, or explicitly skipped. A
 *  bare `failed` does NOT count on its own, matching `areMockupsResolved` in
 *  the reducer: a failed shot blocks until someone hits Skip. */
function mockupsResolved(stepFlow: Record<string, any>): boolean {
  const shots = Object.values(stepFlow?.shots || {}).filter(Boolean) as Record<string, any>[]
  if (shots.length === 0) return false
  return shots.every((s) => s.approved || s.skipped === true)
}

/**
 * Which step this product is standing on, or `null` when it isn't in the flow
 * at all.
 *
 * `hasNobg` is the caller's answer to "does a `kind:'nobg'` asset exist for
 * this product" — the background-removal output. Callers that list many
 * products should fetch it for the whole page in one query rather than per
 * row; a caller that genuinely can't tell may pass `false`, which only ever
 * under-reports (a freshly adopted design reads as 'design' instead of
 * 'garments'), never the other way round.
 */
export function stepFlowStage(
  metadata: Record<string, any> | null | undefined,
  status: string | null | undefined,
  hasNobg: boolean
): StepFlowStage | null {
  if (!isInStepFlow(metadata)) return null
  const stepFlow = (metadata as any).step_flow as StepFlowMeta & Record<string, any>

  // Live on the storefront, or the listing approval stamped by /step/publish.
  if (status === 'active' || stepFlow.approvals?.listing) return 'published'

  if (stepFlow.approvals?.mockups || mockupsResolved(stepFlow)) return 'listing'
  if (stepFlow.approvals?.garments || stepFlow.garment || (stepFlow.sizes?.length ?? 0) > 0) return 'mockups'

  // Metal prints never get a nobg asset — select-design skips background
  // removal for them entirely — so waiting on one would strand every metal
  // draft on 'design' forever. Same exception the reducer makes.
  const isMetal = stepFlow.productKind === 'metal' || stepFlow.brief?.productKind === 'metal'
  if (isMetal || hasNobg) return 'garments'

  // Design picked, background still coming off.
  return 'design'
}

// Step Flow — shared UI types. The wire contract (StepBrief, ShotKey,
// ShotState, ColorAdvice, StepFlowMeta, ...) is defined once in
// `src/lib/api.ts` (the API boundary) and re-exported here so every step
// component imports from one place. Everything added in THIS file is
// UI/reducer-only — it never crosses the wire.
import type {
  ArtworkStats,
  CastingDecision,
  ColorAdvice,
  EtsyComposePack,
  EtsyTier,
  InspirationAnalysis,
  InspirationBreakdown,
  InspirationChoices,
  InspirationQuestion,
  LetteringStyleId,
  Phrase,
  PrintAdvice,
  PrintAdviceStats,
  PrintFile,
  PrintFileOptions,
  PrintMethod,
  PrintShape,
  SelectedInspiration,
  SelectedPhrase,
  ShotKey,
  ShotState,
  StepBrief,
  StepFlowApprovals,
  StepFlowAsset,
  StepFlowColorId,
  StepFlowGarmentId,
  StepFlowGetResponse,
  StepFlowJob,
  StepFlowMeta,
  StepFlowProductKind,
  StepFlowProductSnapshot,
  SuggestedPrintOptions,
} from '../../lib/api'

export type {
  ArtworkStats,
  CastingDecision,
  ColorAdvice,
  EtsyComposePack,
  EtsyTier,
  InspirationAnalysis,
  InspirationBreakdown,
  InspirationChoices,
  InspirationQuestion,
  LetteringStyleId,
  Phrase,
  PrintAdvice,
  PrintAdviceStats,
  PrintFile,
  PrintFileOptions,
  PrintMethod,
  PrintShape,
  SelectedInspiration,
  SelectedPhrase,
  ShotKey,
  ShotState,
  StepBrief,
  StepFlowApprovals,
  StepFlowAsset,
  StepFlowColorId,
  StepFlowGarmentId,
  StepFlowGetResponse,
  StepFlowJob,
  StepFlowMeta,
  StepFlowProductKind,
  StepFlowProductSnapshot,
  SuggestedPrintOptions,
}

/** Every stop the builder knows about, in order. */
export type StepId = 'idea' | 'design' | 'garments' | 'mockups' | 'listing' | 'etsy'

/** Staff: the full six, ending in the Etsy hand-off. */
export const ADMIN_STEP_ORDER: StepId[] = ['idea', 'design', 'garments', 'mockups', 'listing', 'etsy']

/** Customers: the same flow "minus the etsy step ofc" (David 2026-09-08).
 *  Listing is the last stop and finishes as Submit for review. */
export const CUSTOMER_STEP_ORDER: StepId[] = ['idea', 'design', 'garments', 'mockups', 'listing']

/** Back-compat alias — the admin order was the only order until 2026-09-08,
 *  and it stays the default for anything that doesn't declare a lane. */
export const STEP_ORDER = ADMIN_STEP_ORDER

export const STEP_LABELS: Record<StepId, string> = {
  idea: 'Idea',
  design: 'Design',
  garments: 'Garment & Color',
  mockups: 'Mockups',
  listing: 'Listing',
  etsy: 'Etsy',
}

/** One "take" the admin can pick from on the Design step — a source/design asset. */
export interface DesignCandidate {
  assetId: string
  url: string
  label?: string
  /** Which model actually drew this take, from the asset's own
   *  `metadata.model_id`. Undefined when the asset recorded nothing, and the
   *  card then shows no engine line - see EngineLine in shared.tsx for why a
   *  blank beats a guess. */
  engine?: string
}

/** Editable listing draft the Listing step composes and the admin can hand-edit. */
export interface ListingDraft {
  title: string
  description: string
  tags: string[]
  price: number
}

export const listingDraftFromPack = (pack: EtsyComposePack): ListingDraft => ({
  title: pack.title,
  description: pack.description,
  tags: pack.tags,
  price: pack.price,
})

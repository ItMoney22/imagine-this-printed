// Step Flow — shared UI types. The wire contract (StepBrief, ShotKey,
// ShotState, ColorAdvice, StepFlowMeta, ...) is defined once in
// `src/lib/api.ts` (the API boundary) and re-exported here so every step
// component imports from one place. Everything added in THIS file is
// UI/reducer-only — it never crosses the wire.
import type {
  ArtworkStats,
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

/** The six stops of the builder, in order. */
export type StepId = 'idea' | 'design' | 'garments' | 'mockups' | 'listing' | 'etsy'

export const STEP_ORDER: StepId[] = ['idea', 'design', 'garments', 'mockups', 'listing', 'etsy']

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

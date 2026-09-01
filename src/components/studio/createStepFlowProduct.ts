// Shared "spin up a fresh draft product from a brief" builder — used by both
// IdeaStep (first generate) and DesignStep (Tweak, which starts a fresh
// draft product with an edited prompt rather than mutating the current one).
// Kept in one place so the two call sites can't drift on the fields the
// backend's POST /create route reads by name.
import { aiProducts } from '../../lib/api'
import type { AIProductCreationRequest, AIProductCreationResponse } from '../../types'
import type { StepBrief } from './types'

// The create route's typed request doesn't know about takes/stepFlow yet, and
// its `background`/`category` unions predate this flow's 'white'|'black'
// solid-background render and the catalog-capability 't-shirts' category id —
// extending it locally here keeps src/types/index.ts untouched, which is
// outside this track's file ownership this round.
export type StepFlowCreateRequest = Omit<AIProductCreationRequest, 'background' | 'category'> & {
  background?: 'white' | 'black'
  category?: AIProductCreationRequest['category'] | 't-shirts'
  takes?: 1 | 2 | 3
  stepFlow?: { idea: string; brief: StepBrief }
}

export function buildStepFlowCreateRequest(idea: string, brief: StepBrief): StepFlowCreateRequest {
  return {
    prompt: brief.designPrompt,
    modelId: 'openai/gpt-image-2',
    forceSingleModel: true,
    takes: 1,
    background: brief.background,
    productType: brief.garmentHint,
    shirtColor: brief.background === 'white' ? 'black' : 'white',
    category: brief.garmentHint === 'hoodie' ? 'hoodies' : 't-shirts',
    stepFlow: { idea, brief },
  }
}

/** Fires `POST /api/admin/products/ai/create` with a step-flow brief. */
export async function createStepFlowProduct(idea: string, brief: StepBrief): Promise<AIProductCreationResponse> {
  const request = buildStepFlowCreateRequest(idea, brief)
  // `request` intentionally carries a couple of fields whose types the
  // shared AIProductCreationRequest doesn't know about yet (see the type
  // note above) — the backend `/create` route reads them by name.
  return aiProducts.create(request as unknown as AIProductCreationRequest)
}

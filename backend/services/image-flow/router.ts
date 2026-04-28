// Routes a request to the best image model based on purpose + modifiers.
// Ported from david-trinidad-com (Watchtower) at src/modules/image-flow/lib/router.ts.

import {
  MODELS,
  getModel,
  requiresCostGate,
  type ImageModel,
  type ModelTier,
  type Purpose,
  type Strength,
  DEFAULT_GENERATE_MODEL,
  DEFAULT_EDIT_MODEL,
  DEFAULT_MOCKUP_MODEL,
} from './models.js'

export interface RouteInput {
  purpose: Purpose
  modifiers?: {
    tier?: ModelTier
    strength?: Strength
    photoreal?: boolean
    vector?: boolean
    textInImage?: boolean
    draft?: boolean
    /** True if caller will pass input images (forces edit-capable model). */
    hasInputImages?: boolean
  }
  forceModel?: string
}

export interface RouteResult {
  model: ImageModel
  needsCostGate: boolean
  reason: string
}

/** Strengths each purpose cares about, in priority order. */
const PURPOSE_STRENGTHS: Record<Purpose, Strength[]> = {
  product: ['photoreal-product', 'edit', 'multi-image'],
  'product-edit': ['edit', 'multi-image'],
  mockup: ['edit', 'multi-image', 'photoreal-product'],
  hero: ['photoreal-product', 'stylized'],
  banner: ['stylized', 'photoreal-product'],
  gallery: ['photoreal-product', 'stylized'],
  thumbnail: ['fast-draft', 'stylized'],
  avatar: ['photoreal-people', 'stylized'],
  logo: ['logo-vector'],
  icon: ['logo-vector', 'stylized'],
  background: ['stylized', 'concept-art'],
  'social-post': ['stylized', 'text-in-image'],
  'email-header': ['stylized', 'text-in-image'],
  'blog-cover': ['stylized', 'photoreal-product'],
  concept: ['concept-art', 'stylized'],
  reference: ['fast-draft'],
}

/** Default tier per purpose. */
const PURPOSE_TIER: Record<Purpose, ModelTier> = {
  // Generation → multi-model fan-out (admin builder picks); edit → gpt-image-2 / gemini-3;
  // mockup → nano-banana (best quality on garments per testing).
  product: 'hero',
  'product-edit': 'edit',
  mockup: 'mockup',
  hero: 'hero',
  banner: 'workhorse',
  gallery: 'workhorse',
  thumbnail: 'draft',
  avatar: 'workhorse',
  logo: 'vector',
  icon: 'vector',
  background: 'workhorse',
  'social-post': 'workhorse',
  'email-header': 'workhorse',
  'blog-cover': 'workhorse',
  concept: 'workhorse',
  reference: 'draft',
}

function score(
  model: ImageModel,
  preferredTier: ModelTier,
  preferredStrengths: Strength[]
): number {
  let s = 0
  if (model.tier === preferredTier) s += 100
  for (let i = 0; i < preferredStrengths.length; i++) {
    if (model.strengths.includes(preferredStrengths[i])) {
      s += 30 - i * 5
    }
  }
  s += Math.max(0, 10 - model.costPerImageUsd * 100)
  return s
}

export function route(input: RouteInput): RouteResult {
  if (input.forceModel) {
    const m = getModel(input.forceModel)
    if (!m) throw new Error(`unknown model: ${input.forceModel}`)
    return {
      model: m,
      needsCostGate: requiresCostGate(m),
      reason: `forced: ${input.forceModel}`,
    }
  }

  const mods = input.modifiers ?? {}

  // Hard overrides for ITP defaults — keep gpt-image-2 sticky for product/mockup/edit
  // unless caller passes explicit modifiers that ask for something else.
  if (
    !mods.tier &&
    !mods.strength &&
    !mods.draft &&
    !mods.vector &&
    !mods.textInImage
  ) {
    if (input.purpose === 'product') {
      const m = getModel(DEFAULT_GENERATE_MODEL)
      if (m) {
        return { model: m, needsCostGate: requiresCostGate(m), reason: 'default: product → gpt-image-2' }
      }
    }
    if (input.purpose === 'product-edit') {
      const m = getModel(DEFAULT_EDIT_MODEL)
      if (m) {
        return { model: m, needsCostGate: requiresCostGate(m), reason: 'default: edit → gpt-image-2' }
      }
    }
    if (input.purpose === 'mockup') {
      const m = getModel(DEFAULT_MOCKUP_MODEL)
      if (m) {
        return { model: m, needsCostGate: requiresCostGate(m), reason: 'default: mockup → gpt-image-2' }
      }
    }
  }

  let tier: ModelTier
  if (mods.tier) tier = mods.tier
  else if (mods.draft) tier = 'draft'
  else if (mods.vector) tier = 'vector'
  else if (mods.textInImage) tier = 'text-in-image'
  else tier = PURPOSE_TIER[input.purpose]

  const strengths: Strength[] = []
  if (mods.strength) strengths.push(mods.strength)
  if (mods.photoreal) strengths.push('photoreal-people', 'photoreal-product')
  if (mods.vector) strengths.push('logo-vector')
  if (mods.textInImage) strengths.push('text-in-image')
  if (mods.hasInputImages) strengths.push('edit', 'multi-image')
  if (strengths.length === 0) strengths.push(...PURPOSE_STRENGTHS[input.purpose])

  const candidates = MODELS.filter((m) => m.tier === tier)
  const pool = candidates.length > 0 ? candidates : MODELS
  const scored = pool.map((m) => ({ m, s: score(m, tier, strengths) })).sort((a, b) => b.s - a.s)
  const best = scored[0].m
  return {
    model: best,
    needsCostGate: requiresCostGate(best),
    reason: `auto: tier=${tier}, strengths=${strengths.join(',')}`,
  }
}

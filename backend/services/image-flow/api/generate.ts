// Generate API — text prompt -> image, persisted to GCS + product_assets.
// Adapted from david-trinidad-com api/generate.ts.

import { supabase } from '../../../lib/supabase.js'
import { runReplicate } from '../providers/replicate.js'
import { runFal } from '../providers/fal.js'
import { route, type RouteInput } from '../router.js'
import { generateKey, uploadFromUrl } from '../storage.js'
import { type Purpose } from '../models.js'
import { enhancePrompt } from '../prompt-enhancer.js'
import { buildInput } from '../input-builder.js'

export interface GenerateRequest {
  purpose: Purpose
  prompt: string
  modifiers?: RouteInput['modifiers']
  forceModel?: string
  /** ITP-specific — attach the generated asset to a product. */
  productId?: string
  /** Asset role label (e.g. 'design', 'mockup_flat_lay'). Stored on product_assets. */
  assetRole?: string
  labels?: string[]
  createdBy?: string
  /** Skip the cost gate (caller already confirmed). */
  confirmedCost?: boolean
  /** Provider-specific overrides merged into the model input. */
  extra?: Record<string, unknown>
  /** Run prompt through Gemini 2.5 Pro enhancer first. */
  enhance?: boolean
}

export type GenerateResponse =
  | {
      status: 'ok'
      assetId: string | null
      url: string
      path: string
      costUsd: number
      modelId: string
      provider: 'replicate' | 'fal'
      routingReason: string
      enhancedPrompt?: string
      enhancerCostUsd?: number
    }
  | {
      status: 'needs_confirmation'
      estimatedCostUsd: number
      modelId: string
      provider: 'replicate' | 'fal'
      reason: string
    }

export async function generate(req: GenerateRequest): Promise<GenerateResponse> {
  if (!req.prompt || typeof req.prompt !== 'string') {
    throw new Error('prompt required')
  }

  const routed = route({
    purpose: req.purpose,
    modifiers: req.modifiers,
    forceModel: req.forceModel,
  })

  if (routed.needsCostGate && !req.confirmedCost) {
    return {
      status: 'needs_confirmation',
      estimatedCostUsd: routed.model.costPerImageUsd,
      modelId: routed.model.id,
      provider: routed.model.provider,
      reason: routed.reason,
    }
  }

  let finalPrompt = req.prompt
  let enhancerResult: Awaited<ReturnType<typeof enhancePrompt>> | null = null
  if (req.enhance) {
    enhancerResult = await enhancePrompt({
      prompt: req.prompt,
      purpose: req.purpose,
      model: routed.model,
    })
    finalPrompt = enhancerResult.enhanced
  }

  const input = buildInput(routed.model, {
    prompt: finalPrompt,
    extra: req.extra,
  })

  let imageUrl: string
  if (routed.model.provider === 'replicate') {
    const r = await runReplicate({ modelId: routed.model.id, input })
    imageUrl = r.imageUrls[0]
  } else {
    const r = await runFal({ modelId: routed.model.id, input })
    imageUrl = r.imageUrls[0]
  }

  const ext = imageUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? 'png'
  const safeExt = ['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(ext) ? ext : 'png'
  const key = generateKey({
    productId: req.productId,
    purpose: req.purpose,
    ext: safeExt,
  })

  const { publicUrl, path } = await uploadFromUrl({ key, url: imageUrl })

  let assetId: string | null = null
  if (req.productId) {
    const { data, error } = await supabase
      .from('product_assets')
      .insert({
        product_id: req.productId,
        kind: req.assetRole?.startsWith('mockup') ? 'mockup' : 'source',
        path,
        url: publicUrl,
        width: 1024,
        height: 1024,
        asset_role: req.assetRole ?? 'design',
        is_primary: false,
        display_order: 99,
        metadata: {
          model_id: routed.model.id,
          provider: routed.model.provider,
          purpose: req.purpose,
          original_prompt: req.prompt,
          enhanced_prompt: enhancerResult?.enhanced,
          cost_usd: routed.model.costPerImageUsd + (enhancerResult?.costUsd ?? 0),
          generated_at: new Date().toISOString(),
        },
      })
      .select()
      .single()
    if (error) throw new Error(`product_assets insert: ${error.message}`)
    assetId = data.id
  }

  return {
    status: 'ok',
    assetId,
    url: publicUrl,
    path,
    costUsd: routed.model.costPerImageUsd + (enhancerResult?.costUsd ?? 0),
    modelId: routed.model.id,
    provider: routed.model.provider,
    routingReason: routed.reason,
    ...(enhancerResult
      ? { enhancedPrompt: enhancerResult.enhanced, enhancerCostUsd: enhancerResult.costUsd }
      : {}),
  }
}

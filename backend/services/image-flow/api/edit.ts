// Edit API — image(s) + prompt -> edited image, persisted to GCS + product_assets.
// Default model: openai/gpt-image-2 (supports multi-image compositing).
// Adapted from david-trinidad-com api/edit.ts.

import { supabase } from '../../../lib/supabase.js'
import { runReplicate } from '../providers/replicate.js'
import { runFal } from '../providers/fal.js'
import { editOpenAIImage } from '../providers/openai-image.js'
import {
  getModel,
  requiresCostGate,
  DEFAULT_EDIT_MODEL,
  type Purpose,
} from '../models.js'
import { generateKey, uploadFromUrl } from '../storage.js'
import { resolveSource } from '../source-resolver.js'
import { buildInput } from '../input-builder.js'
import { enhancePrompt } from '../prompt-enhancer.js'

export interface EditRequest {
  /** Existing product_assets.id to use as the source image. */
  parentAssetId?: string
  /** Or a direct URL. */
  imageUrl?: string
  /** Edit instruction. */
  prompt: string
  /** Additional reference images (for multi-ref / compositing models like gpt-image-2). */
  refImageUrls?: string[]
  /** Defaults to openai/gpt-image-2. */
  forceModel?: string
  /** ITP-specific — attach the edited asset to a product (defaults to source's product_id). */
  productId?: string
  /** Asset role label. Defaults to 'design' or 'mockup_*' based on input. */
  assetRole?: string
  labels?: string[]
  createdBy?: string
  confirmedCost?: boolean
  extra?: Record<string, unknown>
  /** Run prompt through enhancer (instruction-style for edits). */
  enhance?: boolean
  /**
   * Strict design-fidelity mode: wraps the instruction with hard preservation
   * rules so the model applies ONLY the requested change (no extra wings).
   * Intended for single-image design refinement; skipped automatically for
   * multi-image compositing requests.
   */
  preserveDesign?: boolean
}

export type EditResponse =
  | {
      status: 'ok'
      assetId: string | null
      url: string
      path: string
      costUsd: number
      modelId: string
      provider: 'replicate' | 'fal'
      parentAssetId: string | null
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

export async function edit(req: EditRequest): Promise<EditResponse> {
  if (!req.prompt) throw new Error('prompt required')

  const modelId = req.forceModel ?? DEFAULT_EDIT_MODEL
  const model = getModel(modelId)
  if (!model) throw new Error(`unknown model: ${modelId}`)
  // Allow models with unifiedGenAndEdit (like gpt-image-2) — they live in 'edit' tier
  // but also handle generation. Block tier mismatches otherwise.
  if (model.tier !== 'edit' && !model.unifiedGenAndEdit) {
    throw new Error(`model ${modelId} is not an edit model (tier=${model.tier})`)
  }

  if (requiresCostGate(model) && !req.confirmedCost) {
    return {
      status: 'needs_confirmation',
      estimatedCostUsd: model.costPerImageUsd,
      modelId: model.id,
      provider: model.provider,
      reason: `edit model ${model.id} cost $${model.costPerImageUsd} exceeds gate`,
    }
  }

  const src = await resolveSource({
    parentAssetId: req.parentAssetId,
    imageUrl: req.imageUrl,
  })

  let finalPrompt = req.prompt
  let enhancerResult: Awaited<ReturnType<typeof enhancePrompt>> | null = null
  if (req.enhance) {
    enhancerResult = await enhancePrompt({
      prompt: req.prompt,
      purpose: 'product-edit',
      model,
    })
    finalPrompt = enhancerResult.enhanced
  }

  // Design-fidelity wrapper. GPT Image 2's playbook: edits behave best when
  // told what changes AND what must stay identical. Only for single-image
  // edits — compositing prompts (refImageUrls) legitimately restructure.
  if (req.preserveDesign && (req.refImageUrls ?? []).length === 0) {
    finalPrompt =
      `Edit the provided image. Requested change: ${finalPrompt}\n\n` +
      `STRICT EDIT RULES — the input image is the ground truth. Apply ONLY the requested change. ` +
      `Everything else must remain IDENTICAL to the original: the exact same subject with the exact same ` +
      `number of parts and elements (do not add, duplicate, remove, or mirror any element that was not ` +
      `explicitly mentioned), the same pose and composition, the same art style and line work, the same ` +
      `color palette, and the same background. The result must read as the original image with one precise ` +
      `modification applied — not a reinterpretation or regeneration.`
  }

  const inputImages = [src.url, ...(req.refImageUrls ?? [])]
  const input = buildInput(model, {
    prompt: finalPrompt,
    inputImages,
    extra: req.extra,
  })

  let imageUrl: string
  if (model.id === 'openai/gpt-image-2') {
    // OpenAI-direct edit (gpt-image-2 → gpt-image-1 fallback): cheaper than
    // Replicate's wrapper and not subject to Replicate's rate limit.
    const r = await editOpenAIImage({
      sourceUrl: src.url,
      refUrls: req.refImageUrls,
      prompt: finalPrompt,
      userId: req.createdBy,
      quality: 'high',
    })
    imageUrl = r.url
  } else if (model.provider === 'replicate') {
    const r = await runReplicate({ modelId: model.id, input })
    imageUrl = r.imageUrls[0]
  } else {
    const r = await runFal({ modelId: model.id, input })
    imageUrl = r.imageUrls[0]
  }

  const ext = imageUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? 'png'
  const safeExt = ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'png'
  const productId = req.productId ?? src.parentProductId ?? undefined
  const purpose: Purpose = 'product-edit'
  const key = generateKey({ productId, purpose, ext: safeExt })

  const { publicUrl, path } = await uploadFromUrl({ key, url: imageUrl })

  let assetId: string | null = null
  if (productId) {
    const role = req.assetRole ?? 'design'
    const kind = role.startsWith('mockup') ? 'mockup' : 'source'
    const { data, error } = await supabase
      .from('product_assets')
      .insert({
        product_id: productId,
        kind,
        path,
        url: publicUrl,
        width: 1024,
        height: 1024,
        asset_role: role,
        is_primary: false,
        display_order: 99,
        metadata: {
          model_id: model.id,
          provider: model.provider,
          purpose,
          parent_asset_id: src.parentAssetId,
          edit_prompt: req.prompt,
          enhanced_prompt: enhancerResult?.enhanced,
          ref_image_urls: req.refImageUrls ?? [],
          cost_usd: model.costPerImageUsd + (enhancerResult?.costUsd ?? 0),
          edited_at: new Date().toISOString(),
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
    costUsd: model.costPerImageUsd + (enhancerResult?.costUsd ?? 0),
    modelId: model.id,
    provider: model.provider,
    parentAssetId: src.parentAssetId,
    ...(enhancerResult
      ? { enhancedPrompt: enhancerResult.enhanced, enhancerCostUsd: enhancerResult.costUsd }
      : {}),
  }
}

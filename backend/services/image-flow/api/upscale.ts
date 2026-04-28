// Upscale API — runs an image-only model (no prompt) and persists output to product_assets.
// Defaults to recraft-ai/recraft-crisp-upscale (best for graphic design per 2026 benchmarks).

import { supabase } from '../../../lib/supabase.js'
import { runReplicate } from '../providers/replicate.js'
import { runFal } from '../providers/fal.js'
import { getModel, DEFAULT_UPSCALE_MODEL } from '../models.js'
import { generateKey, uploadFromUrl } from '../storage.js'
import { resolveSource } from '../source-resolver.js'
import { buildInput } from '../input-builder.js'

export interface UpscaleRequest {
  parentAssetId?: string
  imageUrl?: string
  forceModel?: string
  productId?: string
  assetRole?: string
  extra?: Record<string, unknown>
}

export interface UpscaleResponse {
  status: 'ok'
  assetId: string | null
  url: string
  path: string
  costUsd: number
  modelId: string
  parentAssetId: string | null
}

export async function upscale(req: UpscaleRequest): Promise<UpscaleResponse> {
  const modelId = req.forceModel ?? DEFAULT_UPSCALE_MODEL
  const model = getModel(modelId)
  if (!model) throw new Error(`unknown model: ${modelId}`)
  if (model.tier !== 'upscale') {
    throw new Error(`model ${modelId} is not an upscale model (tier=${model.tier})`)
  }

  const src = await resolveSource({
    parentAssetId: req.parentAssetId,
    imageUrl: req.imageUrl,
  })

  const input = buildInput(model, {
    prompt: '',
    inputImages: [src.url],
    extra: req.extra,
  })

  const r = model.provider === 'replicate'
    ? await runReplicate({ modelId: model.id, input, timeoutMs: 90_000 })
    : await runFal({ modelId: model.id, input, timeoutMs: 90_000 })
  const imageUrl = r.imageUrls[0]

  const ext = imageUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? 'png'
  const safeExt = ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? ext : 'png'
  const productId = req.productId ?? src.parentProductId ?? undefined
  const key = generateKey({ productId, purpose: 'product-edit', ext: safeExt })

  const { publicUrl, path } = await uploadFromUrl({ key, url: imageUrl })

  let assetId: string | null = null
  if (productId) {
    const { data, error } = await supabase
      .from('product_assets')
      .insert({
        product_id: productId,
        kind: 'source',
        path,
        url: publicUrl,
        width: 2048,
        height: 2048,
        asset_role: req.assetRole ?? 'design_upscaled',
        is_primary: false,
        display_order: 99,
        metadata: {
          model_id: model.id,
          provider: model.provider,
          parent_asset_id: src.parentAssetId,
          cost_usd: model.costPerImageUsd,
          upscaled_at: new Date().toISOString(),
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
    costUsd: model.costPerImageUsd,
    modelId: model.id,
    parentAssetId: src.parentAssetId,
  }
}

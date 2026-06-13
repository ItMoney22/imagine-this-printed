// BG remove / replace — defaults to fal-ai/bria/background/remove.
// Adapted from david-trinidad-com api/bg-remove.ts.

import { supabase } from '../../../lib/supabase.js'
import { runFal } from '../providers/fal.js'
import { removeBackgroundSync } from '../../replicate.js'
import { getModel, DEFAULT_BG_REMOVE_MODEL } from '../models.js'
import { generateKey, uploadFromUrl } from '../storage.js'
import { resolveSource } from '../source-resolver.js'
import { buildInput } from '../input-builder.js'

export interface BgRemoveRequest {
  parentAssetId?: string
  imageUrl?: string
  /** Default: 'fal-ai/bria/background/remove'. Use 'fal-ai/bria/background/replace' with extra.bg_prompt. */
  forceModel?: string
  productId?: string
  assetRole?: string
  labels?: string[]
  createdBy?: string
  extra?: Record<string, unknown>
}

export interface BgRemoveResponse {
  status: 'ok'
  assetId: string | null
  url: string
  path: string
  costUsd: number
  modelId: string
  parentAssetId: string | null
}

export async function bgRemove(req: BgRemoveRequest): Promise<BgRemoveResponse> {
  const modelId = req.forceModel ?? DEFAULT_BG_REMOVE_MODEL
  const model = getModel(modelId)
  if (!model) throw new Error(`unknown model: ${modelId}`)
  if (model.tier !== 'bg') {
    throw new Error(`model ${modelId} is not a bg model (tier=${model.tier})`)
  }

  const src = await resolveSource({
    parentAssetId: req.parentAssetId,
    imageUrl: req.imageUrl,
  })

  const isReplace = model.id.endsWith('/replace')

  // The fal Bria key is dead (401 invalid credentials). Route plain background
  // REMOVAL to the working Replicate 851-labs remover (same provider the worker
  // rembg path uses). Background REPLACE needs prompt-driven generation that
  // 851-labs can't do, so it stays on fal until a valid FAL_API_KEY is set.
  let imageUrl: string
  let provider: 'replicate' | 'fal'
  if (isReplace) {
    const input = buildInput(model, {
      prompt: '',
      inputImages: [src.url],
      extra: req.extra,
    })
    const { imageUrls } = await runFal({ modelId: model.id, input })
    imageUrl = imageUrls[0]
    provider = 'fal'
  } else {
    imageUrl = await removeBackgroundSync(src.url)
    provider = 'replicate'
  }

  const ext = imageUrl.split('?')[0].split('.').pop()?.toLowerCase() ?? 'png'
  const safeExt = ['png', 'webp'].includes(ext) ? ext : 'png'
  const productId = req.productId ?? src.parentProductId ?? undefined
  const key = generateKey({ productId, purpose: 'product-edit', ext: safeExt })

  const { publicUrl, path } = await uploadFromUrl({ key, url: imageUrl })

  let assetId: string | null = null
  if (productId) {
    const role = req.assetRole ?? (isReplace ? 'design_bg_replaced' : 'design_no_bg')
    const { data, error } = await supabase
      .from('product_assets')
      .insert({
        product_id: productId,
        kind: 'source',
        path,
        url: publicUrl,
        width: 1024,
        height: 1024,
        asset_role: role,
        is_primary: false,
        display_order: 99,
        metadata: {
          model_id: model.id,
          provider,
          parent_asset_id: src.parentAssetId,
          cost_usd: model.costPerImageUsd,
          processed_at: new Date().toISOString(),
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

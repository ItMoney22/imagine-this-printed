// BG remove — defaults to 851-labs/background-remover (Replicate).
// Adapted from david-trinidad-com api/bg-remove.ts.
//
// Background REPLACE (prompt-driven new background) previously ran on
// fal-ai/bria/background/replace. The fal.ai key is dead and no Replicate
// equivalent is registered, so that model was removed from the registry
// during the 2026-07 fal.ai purge. A forceModel pointing at the old fal id
// now fails fast with a clean "unknown model" error via getModel() below,
// instead of hard-failing deep inside a fetch to fal's queue API.

import { supabase } from '../../../lib/supabase.js'
import { removeBackgroundToBuffer } from '../../background-removal.js'
import { getModel, DEFAULT_BG_REMOVE_MODEL } from '../models.js'
import { generateKey, uploadFromBuffer } from '../storage.js'
import { resolveSource } from '../source-resolver.js'

export interface BgRemoveRequest {
  parentAssetId?: string
  imageUrl?: string
  /** Default: '851-labs/background-remover'. */
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

  // Colour key for a solid field, AI segmentation only for photographic
  // sources - decided centrally so this path cannot drift from the others.
  // AI segmentation keeps only the most salient subject and deletes artwork
  // detached from it, which is how a design loses a floating element.
  const removal = await removeBackgroundToBuffer(src.url, 'image-flow/bg-remove')
  const provider = 'replicate' as const

  const productId = req.productId ?? src.parentProductId ?? undefined
  const key = generateKey({ productId, purpose: 'product-edit', ext: 'png' })

  const { publicUrl, path } = await uploadFromBuffer({ key, buffer: removal.buffer })

  let assetId: string | null = null
  if (productId) {
    const role = req.assetRole ?? 'design_no_bg'
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
          bg_removal_method: removal.method,
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

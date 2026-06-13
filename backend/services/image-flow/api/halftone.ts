// Halftone API — runs the local DTF halftone engine (no external model, $0)
// and persists output to product_assets, mirroring the upscale/bg-remove shape.

import { supabase } from '../../../lib/supabase.js'
import { generateKey } from '../storage.js'
import { resolveSource } from '../source-resolver.js'
import { uploadImageFromBuffer } from '../../google-cloud-storage.js'
import { applyHalftone, type HalftoneOptions } from '../../halftone.js'

export interface HalftoneRequest extends HalftoneOptions {
  parentAssetId?: string
  imageUrl?: string
  productId?: string
  assetRole?: string
}

export interface HalftoneResponse {
  status: 'ok'
  assetId: string | null
  url: string
  path: string
  width: number
  height: number
  costUsd: number
  modelId: string
  parentAssetId: string | null
  halftone: Record<string, unknown>
}

export async function halftone(req: HalftoneRequest): Promise<HalftoneResponse> {
  const src = await resolveSource({
    parentAssetId: req.parentAssetId,
    imageUrl: req.imageUrl,
  })

  const resp = await fetch(src.url)
  if (!resp.ok) throw new Error(`failed to fetch source image (${resp.status})`)
  const input = Buffer.from(await resp.arrayBuffer())

  const result = await applyHalftone(input, req)

  const productId = req.productId ?? src.parentProductId ?? undefined
  const key = generateKey({ productId, purpose: 'product-edit', ext: 'png' })
  const { publicUrl, path } = await uploadImageFromBuffer(result.buffer, key, 'image/png')

  let assetId: string | null = null
  if (productId) {
    const { data, error } = await supabase
      .from('product_assets')
      .insert({
        product_id: productId,
        kind: 'source',
        path,
        url: publicUrl,
        width: result.width,
        height: result.height,
        asset_role: req.assetRole ?? 'design_halftone',
        is_primary: false,
        display_order: 99,
        metadata: {
          model_id: 'local/halftone',
          provider: 'local',
          parent_asset_id: src.parentAssetId,
          cost_usd: 0,
          halftone: result.metadata,
          halftoned_at: new Date().toISOString(),
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
    width: result.width,
    height: result.height,
    costUsd: 0,
    modelId: 'local/halftone',
    parentAssetId: src.parentAssetId,
    halftone: result.metadata,
  }
}

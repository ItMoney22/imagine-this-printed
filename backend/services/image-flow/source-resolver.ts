// Resolves the source image for an edit/bg-remove call.
// Adapted from david-trinidad-com — but uses ITP's product_assets table instead of
// Watchtower's flat images table.

import { supabase } from '../../lib/supabase.js'

export interface ResolvedSource {
  url: string
  parentAssetId: string | null
  parentProductId: string | null
}

export interface ResolveOptions {
  /** Direct URL — used as-is. */
  imageUrl?: string
  /** product_assets.id — looked up to get url + product_id. */
  parentAssetId?: string
}

export async function resolveSource(opts: ResolveOptions): Promise<ResolvedSource> {
  if (opts.parentAssetId) {
    const { data, error } = await supabase
      .from('product_assets')
      .select('id, url, product_id')
      .eq('id', opts.parentAssetId)
      .single()
    if (error || !data) {
      throw new Error(`source asset not found: ${opts.parentAssetId}`)
    }
    return {
      url: data.url,
      parentAssetId: data.id,
      parentProductId: data.product_id,
    }
  }
  if (opts.imageUrl) {
    return {
      url: opts.imageUrl,
      parentAssetId: null,
      parentProductId: null,
    }
  }
  throw new Error('resolveSource requires either parentAssetId or imageUrl')
}

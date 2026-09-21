// Team plate — resolving a template's layers, and caching what we draw.
//
// render.ts is deliberately pure (buffers in, buffer out) so it can be tested
// against real pixels without a database. This module is the I/O half: it turns
// a template's asset ids into buffers, and makes sure "SMITH 22" is only ever
// drawn once.
//
// URLS ARE SIGNED, NOT PUBLIC. Public object access is blocked at the org level
// on this bucket — a plain storage.googleapis.com URL returns 403, which is the
// bug that once made Remove BG / Upscale outputs render blank (see
// gcs-storage.ts's own note). So:
//
//   - callers that need to SHOW an image get a freshly signed URL, and
//   - anything persisted onto an order stores the durable gcsPath, never the
//     signed URL, because a signed URL expires and an order outlives it.
import { supabase } from '../../lib/supabase.js'
import { downloadFile, fileExists, generateSignedUrl, uploadFile } from '../gcs-storage.js'
import { templateCacheKey, type TeamTemplate } from '../../shared/team-template.js'
import { renderTeamPlate, type PlateSource } from './render.js'

/**
 * Namespace for rendered plates. uploadFile() builds
 * `users/<userId>/<folder>/<filename>`, so this rides in the userId slot: these
 * files belong to no one customer, they belong to the template.
 */
const PLATE_OWNER = 'team-plates'
const PLATE_FOLDER = 'ai-generated' as const

/** How long a preview/download link stays good. Re-signed on every read. */
const SIGNED_URL_HOURS = 24

// A product's plate/distress layers change only when a template is re-saved,
// but they are needed on every cache MISS. Holding the buffers avoids
// re-downloading a 3600x4800 PNG for every new name on the same shirt.
const layerCache = new Map<string, Promise<Buffer>>()

async function assetBuffer(assetId: string): Promise<Buffer> {
  const hit = layerCache.get(assetId)
  if (hit) return hit
  const pending = (async () => {
    const { data, error } = await supabase
      .from('product_assets')
      .select('path, url')
      .eq('id', assetId)
      .maybeSingle()
    if (error) throw new Error(`product_assets lookup failed: ${error.message}`)
    if (!data) throw new Error(`Template layer ${assetId} not found`)
    if (data.path) return downloadFile(data.path)
    if (data.url) {
      const res = await fetch(data.url)
      if (!res.ok) throw new Error(`Template layer fetch failed (${res.status})`)
      return Buffer.from(await res.arrayBuffer())
    }
    throw new Error(`Template layer ${assetId} has neither path nor url`)
  })().catch((err) => {
    // Never cache a failure — a transient GCS blip would otherwise kill this
    // product's personalization for the life of the process.
    layerCache.delete(assetId)
    throw err
  })
  layerCache.set(assetId, pending)
  return pending
}

/** Called after a template is re-saved so the next render picks up new layers. */
export function forgetTemplateLayers(template: TeamTemplate): void {
  layerCache.delete(template.plateAssetId)
  if (template.distressAssetId) layerCache.delete(template.distressAssetId)
}

export async function loadPlateSource(template: TeamTemplate): Promise<PlateSource> {
  const [plate, distress] = await Promise.all([
    assetBuffer(template.plateAssetId),
    template.distressAssetId ? assetBuffer(template.distressAssetId) : Promise.resolve(null),
  ])
  return { plate, distress }
}

export interface RenderedPlate {
  /** Signed, expiring — for display. Never persist this. */
  url: string
  /** Durable GCS path — this is what goes onto an order. */
  path: string
  /** True when this call actually drew the image rather than finding it cached. */
  rendered: boolean
}

/**
 * Render `values` for `template` at `width`, or return the cached file.
 *
 * The cache key covers the TEMPLATE as well as the values (see
 * templateCacheKey), so editing a template invalidates every file derived from
 * it with no purge step — the next request simply misses.
 *
 * Preview and press file share this path and differ only by `width`, which is
 * part of the object name. That is deliberate: the press file is not a
 * re-derivation of the preview, it is the same function called again.
 */
export async function renderOrGetCached(
  template: TeamTemplate,
  values: Record<string, string>,
  width: number
): Promise<RenderedPlate> {
  const key = templateCacheKey(template, values)
  const filename = `${key}-${Math.round(width)}.png`
  const path = `users/${PLATE_OWNER}/${PLATE_FOLDER}/${filename}`

  if (await fileExists(path)) {
    return { url: await generateSignedUrl(path, SIGNED_URL_HOURS), path, rendered: false }
  }

  const source = await loadPlateSource(template)
  const buffer = await renderTeamPlate(template, values, source, { width })
  const result = await uploadFile(buffer, {
    userId: PLATE_OWNER,
    folder: PLATE_FOLDER,
    filename,
    contentType: 'image/png',
    metadata: { kind: 'team-plate', cacheKey: key, width: String(Math.round(width)) },
  })
  return { url: result.publicUrl, path: result.gcsPath, rendered: true }
}

/** Mint a fresh link for a plate already on an order. */
export function signPlatePath(path: string, hours = SIGNED_URL_HOURS): Promise<string> {
  return generateSignedUrl(path, hours)
}

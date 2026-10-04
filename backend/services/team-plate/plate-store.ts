// Team plate — resolving the tagged back, and caching what flare draws.
//
// The press file and the preview share one generation. The expensive work
// (gpt-image-2.5-flare, then recraft-crisp-upscale) runs once per template +
// name + number and is stored at the canvas width. A smaller width is a
// downscale of that file, never a second model call.
//
// URLS ARE SIGNED, NOT PUBLIC. Public object access is blocked at the org level
// on this bucket. Callers that SHOW an image get a freshly signed URL.
// Anything persisted onto an order stores the durable gcsPath, never the
// signed URL, because a signed URL expires and an order outlives it.
import sharp from 'sharp'
import { supabase } from '../../lib/supabase.js'
import { downloadFile, fileExists, generateSignedUrl, uploadFile } from '../gcs-storage.js'
import { sanitizeValues, templateCacheKey, type TeamTemplate } from '../../shared/team-template.js'
import {
  chooseTaggedBack,
  PlateLetteringError,
  renderFlarePlate,
  type ArtworkRef,
} from './lettering.js'

/**
 * Namespace for rendered plates. uploadFile() builds
 * `users/<userId>/<folder>/<filename>`, so this rides in the userId slot: these
 * files belong to no one customer, they belong to the template.
 */
const PLATE_OWNER = 'team-plates'
const PLATE_FOLDER = 'ai-generated' as const

/** How long a preview/download link stays good. Re-signed on every read. */
const SIGNED_URL_HOURS = 24

/** Long enough for the edit endpoint to fetch the source. Not what we store. */
const SOURCE_URL_HOURS = 2

function objectPath(key: string, width: number): string {
  return `users/${PLATE_OWNER}/${PLATE_FOLDER}/${key}-${width}.png`
}

interface AssetRow extends ArtworkRef {
  id?: string
  product_id?: string
  width?: number | null
  height?: number | null
  is_primary?: boolean | null
}

// One in-flight generation per cache key. A preview and a checkout for the
// same name share it, so a double-fired request does not pay twice.
const inflight = new Map<string, Promise<boolean>>()

/** Called after a template is re-saved. The cache key already changes with the
 *  template; this only drops a generation that started against the old one. */
export function forgetTemplateLayers(_template: TeamTemplate): void {
  inflight.clear()
}

async function assetById(id: string): Promise<AssetRow | null> {
  const { data, error } = await supabase
    .from('product_assets')
    .select('id, product_id, path, url, width, height, is_primary')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`product_assets lookup failed: ${error.message}`)
  return data
}

async function productMetadata(productId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('products')
    .select('id, metadata')
    .eq('id', productId)
    .maybeSingle()
  if (error) throw new Error(`product lookup failed: ${error.message}`)
  return (data?.metadata as Record<string, unknown> | null) ?? null
}

async function assetsByRole(productId: string, role: string): Promise<AssetRow[]> {
  const { data, error } = await supabase
    .from('product_assets')
    .select('id, product_id, path, url, width, height, is_primary, asset_role')
    .eq('product_id', productId)
    .eq('asset_role', role)
  if (error) throw new Error(`product_assets lookup failed: ${error.message}`)
  return (data ?? []) as AssetRow[]
}

function pickSide(rows: AssetRow[]): AssetRow | null {
  const usable = rows.filter((row) => row.path || row.url)
  return usable.find((row) => row.is_primary) ?? usable.find((row) => row.path) ?? usable[0] ?? null
}

async function signOrUrl(ref: ArtworkRef): Promise<string> {
  if (ref.path) return generateSignedUrl(ref.path, SOURCE_URL_HOURS)
  if (ref.url) return ref.url
  throw new PlateLetteringError('Tagged artwork has no file')
}

/**
 * The picture flare should edit: the role-tagged side first, then the
 * print_artwork URL, then the erased plate.
 */
export async function resolveTaggedBack(template: TeamTemplate): Promise<{
  url: string
  productId: string | null
  mode: 'replace' | 'paint'
}> {
  const plate = await assetById(template.plateAssetId)
  const productId = plate?.product_id ?? null
  const metadata = productId ? await productMetadata(productId) : null
  const printArtwork = (metadata?.print_artwork ?? null) as Record<string, unknown> | null
  const sideRows = productId ? await assetsByRole(productId, template.side) : []
  const side = pickSide(sideRows)

  const choice = chooseTaggedBack({
    sideAsset: side,
    printArtworkUrl: printArtwork?.[template.side],
    plateAsset: plate,
  })
  if (!choice) throw new PlateLetteringError('No tagged artwork for this team plate')

  if (choice.kind === 'print-artwork') {
    return { url: choice.url, productId, mode: choice.mode }
  }
  const ref = choice.kind === 'side-asset' ? side : plate
  if (!ref) throw new PlateLetteringError('No tagged artwork for this team plate')
  return { url: await signOrUrl(ref), productId, mode: choice.mode }
}

export interface RenderedPlate {
  /** Signed, expiring — for display. Never persist this. */
  url: string
  /** Durable GCS path — this is what goes onto an order. */
  path: string
  /** True when this call ran flare + upscale, not when it reused a file. */
  rendered: boolean
}

function ensureMaster(key: string, pressPath: string, generate: () => Promise<void>): Promise<boolean> {
  const existing = inflight.get(key)
  if (existing) return existing
  const flight = (async () => {
    if (await fileExists(pressPath)) return false
    await generate()
    return true
  })()
  inflight.set(key, flight)
  // The caller awaits `flight`. This second chain only drops the map entry,
  // and it must not reject on its own — that would be an unhandled rejection
  // beside the one the caller already received.
  void flight
    .finally(() => {
      if (inflight.get(key) === flight) inflight.delete(key)
    })
    .catch(() => {})
  return flight
}

/**
 * Render `values` for `template` at `width`, or return the cached file.
 *
 * The cache key covers the template as well as the values (see
 * templateCacheKey), so editing a template invalidates every file derived
 * from it with no purge step.
 */
export async function renderOrGetCached(
  template: TeamTemplate,
  values: Record<string, string>,
  width: number
): Promise<RenderedPlate> {
  const clean = sanitizeValues(template, values)
  if (!template.fields.some((field) => clean[field.key])) {
    throw new PlateLetteringError('Name and number are required before a plate can be generated')
  }

  const key = templateCacheKey(template, clean)
  const pressWidth = Math.max(1, Math.round(template.canvas.w))
  const asked = Math.max(1, Math.round(width || pressWidth))
  const pressPath = objectPath(key, pressWidth)

  const generated = await ensureMaster(key, pressPath, async () => {
    const source = await resolveTaggedBack(template)
    const plate = await renderFlarePlate({
      template,
      values: clean,
      sourceUrl: source.url,
      mode: source.mode,
      productId: source.productId,
      objectKey: key,
    })
    const stored = await uploadFile(plate.buffer, {
      userId: PLATE_OWNER,
      folder: PLATE_FOLDER,
      filename: `${key}-${pressWidth}.png`,
      contentType: 'image/png',
      metadata: {
        kind: 'team-plate',
        engine: 'gpt-image-2.5-flare+recraft-crisp-upscale',
        cacheKey: key,
        model: plate.modelId,
        upscalePath: plate.upscalePath,
        width: String(plate.width),
        height: String(plate.height),
      },
    })
    if (stored.gcsPath !== pressPath) {
      throw new Error(`Plate stored at ${stored.gcsPath}, expected ${pressPath}`)
    }
  })

  if (asked === pressWidth) {
    return { url: await generateSignedUrl(pressPath, SIGNED_URL_HOURS), path: pressPath, rendered: generated }
  }

  const previewPath = objectPath(key, asked)
  if (!(await fileExists(previewPath))) {
    const master = await downloadFile(pressPath)
    const previewHeight = Math.max(1, Math.round((template.canvas.h / template.canvas.w) * asked))
    const resized = await sharp(master)
      .resize(asked, previewHeight, { fit: 'fill' })
      .png()
      .toBuffer()
    const stored = await uploadFile(resized, {
      userId: PLATE_OWNER,
      folder: PLATE_FOLDER,
      filename: `${key}-${asked}.png`,
      contentType: 'image/png',
      metadata: { kind: 'team-plate-preview', cacheKey: key, width: String(asked) },
    })
    if (stored.gcsPath !== previewPath) {
      throw new Error(`Preview stored at ${stored.gcsPath}, expected ${previewPath}`)
    }
  }

  return {
    url: await generateSignedUrl(previewPath, SIGNED_URL_HOURS),
    path: previewPath,
    rendered: generated,
  }
}

/** Mint a fresh link for a plate already on an order. */
export function signPlatePath(path: string, hours = SIGNED_URL_HOURS): Promise<string> {
  return generateSignedUrl(path, hours)
}

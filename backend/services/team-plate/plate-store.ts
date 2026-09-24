// Team plate — resolving a template's layers, and caching what we generate.
//
// generate.ts is deliberately pure (deps in, buffers out). This module is the
// I/O half: it hands generate.ts the real OpenAI / Replicate / GCS calls, and
// makes sure "SMITH 22" is only ever generated — and paid for — once.
//
// TWO CACHED TIERS, ONE KEY
//
//   <key>-base.png   the gpt-image-2.5-flare edit (~1152x1536). The preview.
//   <key>-press.png  that same image through recraft-crisp-upscale, fitted to
//                    the template canvas (3600x4800 @300 DPI). The print file.
//
// The key is templateCacheKey(template, values), so editing a template (new
// source art, a moved zone) invalidates every file derived from it with no
// purge step, and the folder carries ENGINE, so a prompt change does the same.
// The press tier is built FROM the base tier: a customer who previewed has
// already paid for the flare call, and checkout only adds the upscale.
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
import { downloadFile, fileExists, generateSignedUrl } from '../gcs-storage.js'
import { uploadImageFromBuffer } from '../google-cloud-storage.js'
import { editOpenAIImage } from '../image-flow/providers/openai-image.js'
import { upscaleToPng } from '../step-flow/print-resolution.js'
import { templateCacheKey, type TeamTemplate } from '../../shared/team-template.js'
import { LETTERING_PROMPT_VERSION } from './lettering-prompt.js'
import { generateBase, upscaleToPress, type AssetRef, type GenerateDeps } from './generate.js'
import { readLettering, type LetteringVerdict } from '../lettering-check.js'

/**
 * Namespace for generated plates: `users/<PLATE_OWNER>/<ENGINE>/...`. These
 * files belong to no one customer, they belong to the template.
 */
const PLATE_OWNER = 'team-plates'
/** The engine + prompt revision. Changing either must miss every old file. */
export const ENGINE = `flare-v${LETTERING_PROMPT_VERSION}`

/** How long a preview/download link stays good. Re-signed on every read. */
const SIGNED_URL_HOURS = 24

export type PlateTier = 'base' | 'press'

export function platePath(template: TeamTemplate, values: Record<string, string>, tier: PlateTier): string {
  return `users/${PLATE_OWNER}/${ENGINE}/${templateCacheKey(template, values)}-${tier}.png`
}

/** The durable path the press file lives (or will live) at. Knowable before it exists. */
export function pressPlatePath(template: TeamTemplate, values: Record<string, string>): string {
  return platePath(template, values, 'press')
}

// ---------------------------------------------------------------------------
// Real dependencies
// ---------------------------------------------------------------------------

async function loadAsset(assetId: string): Promise<AssetRef> {
  const { data, error } = await supabase
    .from('product_assets')
    .select('path, url')
    .eq('id', assetId)
    .maybeSingle()
  if (error) throw new Error(`product_assets lookup failed: ${error.message}`)
  if (!data) throw new Error(`Template layer ${assetId} not found`)
  if (data.path) {
    const [buffer, url] = await Promise.all([downloadFile(data.path), generateSignedUrl(data.path, 1)])
    return { buffer, url }
  }
  if (data.url) {
    const res = await fetch(data.url)
    if (!res.ok) throw new Error(`Template layer fetch failed (${res.status})`)
    return { buffer: Buffer.from(await res.arrayBuffer()), url: data.url }
  }
  throw new Error(`Template layer ${assetId} has neither path nor url`)
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch failed (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

/** The production OpenAI / Replicate / GCS calls. Exported for the live smoke script. */
export const realDeps: GenerateDeps = {
  loadAsset,
  edit: (o) =>
    editOpenAIImage({
      sourceUrl: o.sourceUrl,
      prompt: o.prompt,
      size: o.size,
      background: o.background,
      objectPath: o.objectPath,
      model: o.model,
      quality: 'high',
      // The prompt is built server-side; the only customer text in it is a
      // sanitized [A-Z0-9 '-] value. The 'auto' filter false-positives on house
      // design work (openai-image.ts), and a real surname must not be refused —
      // review-flags.ts is where a human catches the rest.
      moderation: 'low',
    }),
  fetchBuffer,
  upscale: (url, buf) => upscaleToPng(url, buf),
  verify: (url, expected) => readLettering(url, expected),
}

let deps: GenerateDeps = realDeps

/** Tests only: swap the OpenAI / Replicate / GCS-asset calls. */
export function __setGenerateDeps(next: GenerateDeps | null): void {
  deps = next ?? realDeps
  inflight.clear()
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export interface RenderedPlate {
  /** Signed, expiring — for display. Never persist this. */
  url: string
  /** Durable GCS path — this is what goes onto an order. */
  path: string
  /** True when this call actually generated the image rather than finding it cached. */
  rendered: boolean
  tier: PlateTier
  /** The image model that drew it, when this call drew it. */
  modelId?: string
  /**
   * The read-back spelling check, when this call drew it (undefined for a
   * cache hit, null when the checker could not run).
   */
  lettering?: LetteringVerdict | null
  /** How many flare renders this call made (2 = the first was misspelled). */
  attempts?: number
}

// A roster order fires the same name at the preview and at checkout within
// seconds, and a double-clicked button fires it twice. One promise per file
// means one flare bill per file, not one per request.
const inflight = new Map<string, Promise<RenderedPlate>>()

function once(path: string, work: () => Promise<RenderedPlate>): Promise<RenderedPlate> {
  const hit = inflight.get(path)
  if (hit) return hit
  const pending = work().finally(() => inflight.delete(path))
  inflight.set(path, pending)
  return pending
}

async function getBase(template: TeamTemplate, values: Record<string, string>): Promise<RenderedPlate & { buffer?: Buffer }> {
  const path = platePath(template, values, 'base')
  if (await fileExists(path)) {
    return { url: await generateSignedUrl(path, SIGNED_URL_HOURS), path, rendered: false, tier: 'base' }
  }
  return once(path, async () => {
    // The spelling gate (task 630bae57). Flare spells well, not perfectly —
    // live 2026-09-24 it drew "SMTH" for "SMITH". A misspelled render is
    // redrawn ONCE at the same path (so the cache keeps the good one); a
    // second miss is kept but reported, for a human to catch.
    const expected = template.fields.map((f) => values[f.key] ?? '').filter(Boolean)
    let base = await generateBase(template, values, deps, path)
    let lettering = deps.verify ? await deps.verify(base.url, expected) : null
    let attempts = 1
    if (lettering && !lettering.ok) {
      console.warn('[team-plate] lettering misspelled, redrawing once', { path, mismatches: lettering.mismatches })
      base = await generateBase(template, values, deps, path)
      lettering = deps.verify ? await deps.verify(base.url, expected) : null
      attempts = 2
      if (lettering && !lettering.ok) {
        console.error('[team-plate] lettering still misspelled after a redraw', { path, mismatches: lettering.mismatches })
      }
    }
    return {
      url: base.url,
      path: base.path,
      rendered: true,
      tier: 'base',
      modelId: base.modelId,
      buffer: base.buffer,
      lettering,
      attempts,
    } as RenderedPlate
  })
}

async function getPress(template: TeamTemplate, values: Record<string, string>): Promise<RenderedPlate> {
  const path = platePath(template, values, 'press')
  if (await fileExists(path)) {
    return { url: await generateSignedUrl(path, SIGNED_URL_HOURS), path, rendered: false, tier: 'press' }
  }
  return once(path, async () => {
    const base = (await getBase(template, values)) as RenderedPlate & { buffer?: Buffer }
    const baseBuffer = base.buffer ?? (await downloadFile(base.path))
    const press = await upscaleToPress(template, { url: base.url, buffer: baseBuffer }, deps)
    // Same bucket as gcs-storage.ts, written at the deterministic cache path
    // so the next request for this name and number is a fileExists() hit.
    const uploaded = await uploadImageFromBuffer(press.buffer, path, 'image/png')
    console.info('[team-plate] press file generated', {
      path,
      from: base.path,
      upscaledTo: `${press.upscaled.width}x${press.upscaled.height}`,
      canvas: `${press.width}x${press.height}`,
      modelId: base.modelId ?? '(base was cached)',
    })
    return { url: uploaded.publicUrl, path: uploaded.path, rendered: true, tier: 'press', modelId: base.modelId }
  })
}

/**
 * The preview or the press file for `values` on `template`, from cache when it
 * exists.
 *
 * `width` picks the tier, which keeps the old call sites' meaning: anything
 * below the template's canvas width is a display request and gets the flare
 * BASE; the canvas width itself is the press file. The base is not resized per
 * width — at ~1152x1536 it is already what a phone or a desktop panel shows.
 */
export async function renderOrGetCached(
  template: TeamTemplate,
  values: Record<string, string>,
  width: number
): Promise<RenderedPlate> {
  if (width >= template.canvas.w) return getPress(template, values)
  // Rebuilt rather than spread: the in-memory buffer stays with the press step,
  // and the in-flight promise's object is shared, so it must not be mutated.
  const { url, path, rendered, tier, modelId, lettering, attempts } = await getBase(template, values)
  return { url, path, rendered, tier, modelId, lettering, attempts }
}

/** Mint a fresh link for a plate already on an order. */
export function signPlatePath(path: string, hours = SIGNED_URL_HOURS): Promise<string> {
  return generateSignedUrl(path, hours)
}

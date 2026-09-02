// Step Flow — "Print prep" panel (design doc §10, David 2026-09-02):
//
//   "if i feel the design needs to be halftoned after can i do it there but i
//   dont want the main design to be comprimised and i dont want the cust to
//   see the halftoned design its only for my team to use when they are
//   pressing and printing the design. and reccomend if a design should be
//   half toned or not."
//
// Two entry points, both operating on the nobg (fallback source) PNG:
//   - computePrintAdvice(): MEASURED, not guessed — samples the artwork with
//     sharp for smooth-tonal-ramp share, distinct color count, and soft-edge
//     share, then applies a fixed rule of thumb (see decidePrintAdvice) to
//     recommend 'halftone' or 'clean'. Never renders anything.
//   - buildPrintFile(): runs the existing DTF halftone engine
//     (../halftone.ts's applyHalftone) and uploads a TEAM-ONLY
//     `kind:'print', asset_role:'print_halftone'` product_assets row. Never
//     touches the `source`/`nobg` rows or `products.images` — `print_*`
//     roles are deliberately excluded from `shared/product-gallery.ts`'s
//     ROLE_ORDER whitelist, so this can never reach the storefront gallery no
//     matter what publishes.
//
// applyHalftone() note (see that file's own header): it does NOT respect an
// input PNG's existing alpha channel — it fully REBUILDS alpha from the
// halftone screen (grayscale brightness thresholded against a rotated sine
// wave / dithered), on the assumption the source is a flat black-or-white
// BACKGROUND that gets "knocked out" by luminance, not a pre-masked cutout.
// Fed a transparent nobg PNG directly, whatever RGB sits under alpha=0 (many
// bg-removal outputs keep the original, unpremultiplied colour there) could
// pick up screen dots it has no business having, and any soft/feathered edge
// alpha in the source gets flattened to a hard binary dot mask. So
// buildPrintFile re-applies the ORIGINAL nobg alpha as a multiplicative mask
// on top of the halftone result before re-encoding: screen dots only ever
// appear where the source was actually opaque, and every pixel that was
// transparent in the source (the removed background, and proportionally any
// soft edge) stays exactly as transparent in the print file.
import sharp from 'sharp'
import { supabase } from '../../lib/supabase.js'
import { uploadFile } from '../gcs-storage.js'
import { applyHalftone, type HalftoneOptions } from '../halftone.js'

const ADVICE_SAMPLE_MAX_DIM = 512
// A pixel counts as "opaque" (art, not background) above this alpha.
const OPAQUE_ALPHA_THRESHOLD = 240
// softEdgeShare's window — strictly between these two.
const SOFT_EDGE_MIN_ALPHA = 16
const SOFT_EDGE_MAX_ALPHA = 240
// "Small but nonzero" local luminance gradient (0-255 scale) — a tonal ramp,
// not a flat fill (gradient ~0) and not a hard edge (gradient large).
const SMOOTH_GRADIENT_MIN = 1
const SMOOTH_GRADIENT_MAX = 18
// Rule of thumb (design doc §10 / the routes contract): large smooth-ramp
// share alone is enough, OR a high color count PLUS a smaller-but-still
// meaningful smooth-ramp share (a busy but not overwhelmingly-gradient image
// that would still band badly under flat DTF ink).
const HALFTONE_SMOOTH_SHARE_THRESHOLD = 0.35
const HALFTONE_COLOR_COUNT_THRESHOLD = 900
const HALFTONE_COLOR_COUNT_SMOOTH_SHARE_THRESHOLD = 0.2
// Below this quantized color count, treat the art as flat vector/line work —
// a tighter screen (45 lpi vs the default 35) holds fine detail better.
const LOW_COLOR_COUNT_THRESHOLD = 32

export interface PrintAdviceStats {
  smoothShare: number
  colorCount: number
  softEdgeShare: number
}

export interface PrintAdviceSuggested {
  method: 'halftone' | 'diffusion'
  frequency: number
  angle: number
  shape: 'round' | 'line'
  invertDark: boolean
}

export interface PrintAdvice {
  recommend: 'halftone' | 'clean'
  confidence: number
  reason: string
  stats: PrintAdviceStats
  suggested: PrintAdviceSuggested
}

export interface PrintFileResult {
  assetId: string
  url: string
  options: Record<string, unknown>
  createdAt: string
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** ITU-R 601-2 luma — matches halftone.ts's own grayscale weighting. */
function relativeLuma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * Pure, synchronous over a decoded buffer — the measurement half of print
 * advice. Downscales to <=512px (advice only needs a statistical sample, not
 * full resolution) before sampling.
 */
export async function measurePrintAdviceStats(pngBuffer: Buffer): Promise<PrintAdviceStats> {
  const { data, info } = await sharp(pngBuffer)
    .resize(ADVICE_SAMPLE_MAX_DIM, ADVICE_SAMPLE_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width, height } = info
  const n = width * height
  const luma = new Float32Array(n)
  const colorSet = new Set<number>()
  let opaqueCount = 0
  let softEdgeCount = 0

  for (let i = 0; i < n; i++) {
    const o = i * 4
    const r = data[o]
    const g = data[o + 1]
    const b = data[o + 2]
    const a = data[o + 3]
    luma[i] = relativeLuma(r, g, b)
    if (a > OPAQUE_ALPHA_THRESHOLD) {
      opaqueCount++
      // Quantize RGB to 4 bits/channel (16 levels each) for the distinct-color count.
      colorSet.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4))
    }
    if (a > SOFT_EDGE_MIN_ALPHA && a < SOFT_EDGE_MAX_ALPHA) softEdgeCount++
  }

  // Local gradient over opaque interior pixels: simple 4-neighbour max
  // absolute luma difference (a cheap Sobel stand-in). Small-but-nonzero =
  // a smooth tonal ramp; ~0 = a flat fill; large = a hard edge.
  let smoothCount = 0
  for (let y = 1; y < height - 1; y++) {
    const row = y * width
    for (let x = 1; x < width - 1; x++) {
      const i = row + x
      if (data[i * 4 + 3] <= OPAQUE_ALPHA_THRESHOLD) continue
      const c = luma[i]
      const grad = Math.max(
        Math.abs(c - luma[i - 1]),
        Math.abs(c - luma[i + 1]),
        Math.abs(c - luma[i - width]),
        Math.abs(c - luma[i + width])
      )
      if (grad >= SMOOTH_GRADIENT_MIN && grad <= SMOOTH_GRADIENT_MAX) smoothCount++
    }
  }

  return {
    smoothShare: opaqueCount > 0 ? smoothCount / opaqueCount : 0,
    colorCount: colorSet.size,
    softEdgeShare: n > 0 ? softEdgeCount / n : 0,
  }
}

/** Pure decision layer over measured stats — no I/O, easy to pin with synthetic stats in tests. */
export function decidePrintAdvice(stats: PrintAdviceStats, opts: { primaryLuma?: number } = {}): PrintAdvice {
  const { smoothShare, colorCount } = stats
  const recommend: PrintAdvice['recommend'] =
    smoothShare >= HALFTONE_SMOOTH_SHARE_THRESHOLD ||
    (colorCount > HALFTONE_COLOR_COUNT_THRESHOLD && smoothShare >= HALFTONE_COLOR_COUNT_SMOOTH_SHARE_THRESHOLD)
      ? 'halftone'
      : 'clean'

  // Confidence scales with smoothShare — directly for a halftone call (more
  // smooth shading = more sure a screen is needed), inversely for a clean
  // call (flatter art = more sure it prints fine as-is). smoothShare is the
  // only signal the routes contract calls out for this.
  const confidence = clamp01(Math.round((recommend === 'halftone' ? smoothShare : 1 - smoothShare) * 100) / 100)

  const pct = Math.round(smoothShare * 100)
  const reason =
    recommend === 'halftone'
      ? `${pct}% of the artwork is smooth shading — DTF flattens that without a screen.`
      : `Flat colors with hard edges (${pct}% smooth shading, ${colorCount} colors) print cleanly without a screen.`

  const invertDark = typeof opts.primaryLuma === 'number' ? opts.primaryLuma < 0.5 : false
  const lowColorCount = colorCount > 0 && colorCount < LOW_COLOR_COUNT_THRESHOLD

  const suggested: PrintAdviceSuggested = {
    method: 'halftone',
    frequency: lowColorCount ? 45 : 35,
    angle: 23.5,
    shape: 'round',
    invertDark,
  }

  return { recommend, confidence, reason, stats, suggested }
}

/** Fetch + measure + decide — the route's entry point. */
export async function computePrintAdvice(pngUrl: string, opts: { primaryLuma?: number } = {}): Promise<PrintAdvice> {
  if (!pngUrl) throw new Error('pngUrl is required')
  const res = await fetch(pngUrl)
  if (!res.ok) throw new Error(`Failed to fetch artwork for print advice: ${res.status} ${res.statusText}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const stats = await measurePrintAdviceStats(buffer)
  return decidePrintAdvice(stats, opts)
}

/**
 * Multiply the halftone result's alpha by the ORIGINAL (pre-halftone) nobg
 * image's alpha, so the print file never shows ink where the source was
 * actually transparent — see this file's header comment for why applyHalftone
 * alone can't be trusted to preserve that. `targetWidth`/`targetHeight` are
 * applyHalftone's OWN output dimensions (it only ever downscales, same
 * aspect ratio, when cropBg is false) so resizing the original to them with
 * `fit:'fill'` lands pixel-aligned without distortion.
 */
async function maskToOriginalAlpha(
  originalBuffer: Buffer,
  halftoneBuffer: Buffer,
  targetWidth: number,
  targetHeight: number
): Promise<Buffer> {
  const { data: origData } = await sharp(originalBuffer)
    .resize(targetWidth, targetHeight, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { data: htData, info: htInfo } = await sharp(halftoneBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const n = htInfo.width * htInfo.height
  const out = Buffer.from(htData)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    out[o + 3] = Math.round((htData[o + 3] * origData[o + 3]) / 255)
  }

  return sharp(out, { raw: { width: htInfo.width, height: htInfo.height, channels: 4 } })
    .png()
    .toBuffer()
}

export interface BuildPrintFileOptions {
  method?: 'halftone' | 'diffusion'
  frequency?: number
  angle?: number
  shape?: 'round' | 'line'
  invertDark?: boolean
}

/**
 * Full pipeline: fetch the nobg (or fallback source) PNG, run applyHalftone,
 * re-mask onto the original alpha, upload to GCS, and replace the product's
 * single `print_halftone` product_assets row. Synchronous — no ai_jobs
 * bookkeeping, this is a local sharp transform ($0, same as the other
 * halftone callers).
 */
export async function buildPrintFile(
  productId: string,
  pngUrl: string,
  opts: BuildPrintFileOptions = {},
  actorId: string = 'system'
): Promise<PrintFileResult> {
  if (!pngUrl) throw new Error('pngUrl is required')
  const res = await fetch(pngUrl)
  if (!res.ok) throw new Error(`Failed to fetch artwork for print file: ${res.status} ${res.statusText}`)
  const original = Buffer.from(await res.arrayBuffer())

  const halftoneOpts: HalftoneOptions = {
    method: opts.method,
    frequency: opts.frequency,
    angle: opts.angle,
    shape: opts.shape,
    invertDark: opts.invertDark,
    // Never crop — the transparent canvas (and its exact framing against the
    // approved design) must be preserved intact. This is what makes the
    // re-mask above pixel-aligned with the source too.
    cropBg: false,
  }
  const result = await applyHalftone(original, halftoneOpts)
  const buffer = await maskToOriginalAlpha(original, result.buffer, result.width, result.height)

  const filename = `${productId}-print-halftone-${Date.now()}.png`
  const { publicUrl, gcsPath } = await uploadFile(buffer, {
    userId: actorId,
    folder: 'mockups',
    filename,
    contentType: 'image/png',
  })

  // One print file per product, ever — replace any prior one. The bucket
  // object is left alone (nothing deletes from GCS here); only the DB
  // pointer moves.
  await supabase.from('product_assets').delete().eq('product_id', productId).eq('asset_role', 'print_halftone')

  const options: Record<string, unknown> = { ...result.metadata }
  const { data: inserted, error } = await supabase
    .from('product_assets')
    .insert({
      product_id: productId,
      kind: 'print',
      path: gcsPath,
      url: publicUrl,
      width: result.width,
      height: result.height,
      asset_role: 'print_halftone',
      is_primary: false,
      display_order: 99,
      metadata: options,
    })
    .select()
    .single()
  if (error) throw new Error(`Failed to save print file asset: ${error.message}`)

  return { assetId: inserted.id, url: publicUrl, options, createdAt: new Date().toISOString() }
}

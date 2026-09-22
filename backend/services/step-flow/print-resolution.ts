// ---------------------------------------------------------------------------
// Print resolution — make under-sized artwork printable instead of refusing it.
//
// David 2026-09-22: he built the Spartans team tee from the two design files he
// had, opened the Step Flow, and hit a red bar:
//
//   "Artwork is 1122x1402px. Its short edge (1122px) is under the 1200px
//    needed for a 4" print at 300 DPI, so it would print blurry."
//
// The gate is right — 1122px across a 12" shirt front is 93 DPI and would ship
// a fuzzy shirt — but being right is not the same as being useful. The flow
// stopped dead with no button on it, and the only cure on offer was "go find a
// bigger file", which for a design that came off a phone or out of a chat does
// not exist.
//
// So the server makes one. recraft-crisp-upscale is already registered in the
// image-flow model catalogue (services/image-flow/models.ts) at $0.006 and is
// the field's best for flat graphic-design art with lettering. Measured on the
// real Spartans crest: 1122x1402 -> 3278x4096 in ~31s, edges crisp, nothing
// hallucinated, which is 273 DPI across a 12" front.
//
// TRANSPARENCY IS RESTORED BY HAND. The upscaler returns opaque WebP: the
// crest's transparent surround came back white. Re-cutting it with rembg would
// be a second lossy pass over soft edges, so instead the ORIGINAL alpha channel
// is resampled to the new geometry and composited back with `dest-in`. The
// upscaler never changes the aspect ratio (0.8003 in, 0.8003 out), so the mask
// lands exactly where it came from — verified: original alpha mean 196.9,
// restored 197.7.
// ---------------------------------------------------------------------------
import sharp from 'sharp'
import { runReplicate } from '../image-flow/providers/replicate.js'
import { getModel, DEFAULT_UPSCALE_MODEL } from '../image-flow/models.js'
import { buildInput } from '../image-flow/input-builder.js'
import { uploadImageFromBuffer } from '../google-cloud-storage.js'

export interface ArtworkMeasurement {
  width: number
  height: number
  hasAlpha: boolean
}

export interface UpscaledArtwork {
  url: string
  path: string
  width: number
  height: number
}

/** One piece of artwork after this module is done with it. */
export interface ResolvedArtwork {
  /** The URL to use from here on — the upscale when one happened, else the original. */
  url: string
  width: number | null
  height: number | null
  upscaled: boolean
  /** GCS object path of the upscale, so an asset row can point at the same
   *  object its url serves rather than inheriting the original's path. */
  path: string | null
  /** The URL it came from, kept so nothing is silently lost. */
  originalUrl: string
  /** Why it was left alone, when it was. */
  skipped?: 'already_big_enough' | 'unmeasurable' | 'upscale_failed'
  error?: string
}

export interface EnsureDeps {
  measure: (url: string) => Promise<ArtworkMeasurement | null>
  upscale: (url: string, source: ArtworkMeasurement) => Promise<UpscaledArtwork>
  log?: { info?: (...a: any[]) => void; warn?: (...a: any[]) => void }
}

/** Measure a remote image. Returns null rather than throwing — an image we
 *  cannot read is a fact to report, not an exception to unwind the flow. */
export async function measureArtwork(url: string): Promise<ArtworkMeasurement | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata()
    if (!meta.width || !meta.height) return null
    return { width: meta.width, height: meta.height, hasAlpha: Boolean(meta.hasAlpha) }
  } catch {
    return null
  }
}

/**
 * Upscale one image to print resolution and put it back in the bucket as a PNG,
 * with the original's transparency restored.
 */
export async function upscaleArtwork(
  url: string,
  opts: { productId?: string; label?: string } = {}
): Promise<UpscaledArtwork> {
  const model = getModel(DEFAULT_UPSCALE_MODEL)
  if (!model) throw new Error(`unknown upscale model: ${DEFAULT_UPSCALE_MODEL}`)

  const originalBuf = Buffer.from(await (await fetch(url)).arrayBuffer())
  const originalMeta = await sharp(originalBuf).metadata()

  const input = buildInput(model, { prompt: '', inputImages: [url] })
  const run = await runReplicate({ modelId: model.id, input, timeoutMs: 120_000 })
  const resultUrl = run.imageUrls[0]
  if (!resultUrl) throw new Error('the upscaler returned no image')

  const upscaledBuf = Buffer.from(await (await fetch(resultUrl)).arrayBuffer())
  const upscaledMeta = await sharp(upscaledBuf).metadata()
  if (!upscaledMeta.width || !upscaledMeta.height) throw new Error('the upscaled image could not be read')

  // Put the original's transparency back. Skipped when the source was opaque —
  // there is nothing to restore, and forcing an alpha channel onto flat art
  // just makes the file bigger.
  let outPipeline = sharp(upscaledBuf)
  if (originalMeta.hasAlpha) {
    const mask = await sharp(originalBuf)
      .ensureAlpha()
      .extractChannel('alpha')
      .resize(upscaledMeta.width, upscaledMeta.height, { kernel: 'lanczos3', fit: 'fill' })
      .toColourspace('b-w')
      .png()
      .toBuffer()
    outPipeline = sharp(upscaledBuf)
      .ensureAlpha()
      .composite([{ input: mask, blend: 'dest-in' }])
  }
  const outBuf = await outPipeline.png({ compressionLevel: 9 }).toBuffer()

  const slug = opts.label ? `${opts.label}-` : ''
  const folder = opts.productId ? `print-ready/${opts.productId}` : 'print-ready/loose'
  const destination = `${folder}/${slug}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
  const uploaded = await uploadImageFromBuffer(outBuf, destination, 'image/png')

  return {
    url: uploaded.publicUrl,
    path: uploaded.path,
    width: upscaledMeta.width,
    height: upscaledMeta.height,
  }
}

/**
 * Bring a set of artwork URLs up to the required short edge.
 *
 * Every URL is measured first, and only the ones that fall short are sent to
 * the upscaler — in parallel, because a two-sided product has two of them and
 * doing them one after the other doubles a minute of waiting for no reason.
 *
 * Runs ONCE per URL. If an upscale comes back still under the bar, that is
 * reported as-is rather than retried: a second pass on art that is already
 * synthetic detail invents pixels without adding information, and a loop here
 * would sit on the request forever.
 *
 * Duplicate URLs are collapsed — a product whose front and back are tagged to
 * the same file must not pay for the same upscale twice.
 */
export async function ensurePrintResolution(
  urls: string[],
  requiredPx: number,
  deps: EnsureDeps
): Promise<Map<string, ResolvedArtwork>> {
  const unique = [...new Set(urls.filter((u) => typeof u === 'string' && u))]
  const out = new Map<string, ResolvedArtwork>()

  const measurements = await Promise.all(unique.map((u) => deps.measure(u)))

  const work: Promise<void>[] = []
  unique.forEach((url, i) => {
    const m = measurements[i]
    if (!m) {
      out.set(url, {
        url,
        width: null,
        height: null,
        upscaled: false,
        path: null,
        originalUrl: url,
        skipped: 'unmeasurable',
      })
      return
    }
    if (Math.min(m.width, m.height) >= requiredPx) {
      out.set(url, {
        url,
        width: m.width,
        height: m.height,
        upscaled: false,
        path: null,
        originalUrl: url,
        skipped: 'already_big_enough',
      })
      return
    }
    work.push(
      deps
        .upscale(url, m)
        .then((up) => {
          deps.log?.info?.(
            { from: `${m.width}x${m.height}`, to: `${up.width}x${up.height}` },
            '[print-resolution] upscaled artwork for print'
          )
          out.set(url, {
            url: up.url,
            width: up.width,
            height: up.height,
            upscaled: true,
            path: up.path,
            originalUrl: url,
          })
        })
        .catch((err: any) => {
          deps.log?.warn?.({ err: err?.message }, '[print-resolution] upscale failed')
          out.set(url, {
            url,
            width: m.width,
            height: m.height,
            upscaled: false,
            path: null,
            originalUrl: url,
            skipped: 'upscale_failed',
            error: err?.message || 'the upscaler failed',
          })
        })
    )
  })

  await Promise.all(work)
  return out
}

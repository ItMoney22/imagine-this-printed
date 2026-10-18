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
// is resampled to the new geometry and written back in (restoreTransparency).
// The upscaler never changes the aspect ratio (0.8003 in, 0.8003 out), so the
// mask lands exactly where it came from. (The first version of that restore
// silently did nothing until 2026-10-16 — see restoreTransparency.)
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

export interface UpscaledBuffer {
  buffer: Buffer
  width: number
  height: number
}

/**
 * Run one image through recraft-crisp-upscale and hand back a PNG buffer with
 * the source's transparency restored. Uploads nothing — the caller decides
 * where the file lives.
 *
 * Split out of upscaleArtwork() so the team-plate pipeline (task 65d98dd9) can
 * put its press file at a DETERMINISTIC path — its cache key — instead of the
 * timestamped one below, which would make every cache lookup a miss.
 *
 * `sourceBuf` is optional: pass it when the caller already holds the bytes
 * behind `url` (a freshly generated image) to skip downloading them again.
 */
export async function upscaleToPng(url: string, sourceBuf?: Buffer): Promise<UpscaledBuffer> {
  const model = getModel(DEFAULT_UPSCALE_MODEL)
  if (!model) throw new Error(`unknown upscale model: ${DEFAULT_UPSCALE_MODEL}`)

  const originalBuf = sourceBuf ?? Buffer.from(await (await fetch(url)).arrayBuffer())
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
  const buffer = originalMeta.hasAlpha
    ? await restoreTransparency(originalBuf, upscaledBuf)
    : await sharp(upscaledBuf).png({ compressionLevel: 9 }).toBuffer()
  return { buffer, width: upscaledMeta.width, height: upscaledMeta.height }
}

/**
 * The upscaled colours with the ORIGINAL's alpha channel, resampled to the new
 * size, as a PNG.
 *
 * THIS USED TO BE A NO-OP, and it cost David the Folgers tee (2026-10-16). It
 * composited a greyscale mask with `dest-in`, which reads the overlay's ALPHA,
 * and a greyscale mask has none, so every pixel stayed opaque. Chaining
 * removeAlpha().joinChannel() does not work either: sharp runs its operations
 * in a fixed internal order, not call order, and the join is thrown away. Every
 * transparent upload therefore left the upscaler flattened onto white, the
 * background cut then keyed that white field, and its enclosed-pocket rule took
 * the white fill out of the lettering with it, so every mockup printed the
 * shirt colour through the letters. The pixels are assembled by hand here so
 * there is no pipeline order left to get wrong.
 *
 * The upscaler also blends soft edges into the colour it flattened onto, which
 * on a dark shirt prints as a pale halo. That matte colour is measured where
 * the original was fully clear, and divided back out of every partly clear
 * pixel (C = (P - (1 - a) * M) / a), so edges keep their own colour.
 */
export async function restoreTransparency(originalBuf: Buffer, upscaledBuf: Buffer): Promise<Buffer> {
  const rgb = await sharp(upscaledBuf).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = rgb.info
  const alpha = await sharp(originalBuf)
    .ensureAlpha()
    .extractChannel(3)
    .resize(W, H, { kernel: 'lanczos3', fit: 'fill' })
    .raw()
    .toBuffer()
  const n = W * H
  if (alpha.length !== n || rgb.data.length !== n * 3) throw new Error('could not line the transparency up with the upscaled image')

  // The colour the upscaler filled the clear areas with.
  const matte = [0, 0, 0]
  let clear = 0
  for (let p = 0; p < n; p += 7) {
    if (alpha[p] !== 0) continue
    matte[0] += rgb.data[p * 3]; matte[1] += rgb.data[p * 3 + 1]; matte[2] += rgb.data[p * 3 + 2]
    clear++
  }
  const M = clear ? matte.map((s) => s / clear) : null

  const out = Buffer.alloc(n * 4)
  for (let p = 0; p < n; p++) {
    const a = alpha[p]
    for (let c = 0; c < 3; c++) {
      let v = rgb.data[p * 3 + c]
      if (a === 0) v = 0
      // Below ~10% opacity the division amplifies noise into specks, and the
      // pixel barely shows either way.
      else if (M && a < 255 && a >= 24) {
        const f = a / 255
        v = Math.max(0, Math.min(255, Math.round((v - (1 - f) * M[c]) / f)))
      }
      out[p * 4 + c] = v
    }
    out[p * 4 + 3] = a
  }
  return sharp(out, { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer()
}

/**
 * Upscale one image to print resolution and put it back in the bucket as a PNG,
 * with the original's transparency restored.
 */
export async function upscaleArtwork(
  url: string,
  opts: { productId?: string; label?: string } = {}
): Promise<UpscaledArtwork> {
  const up = await upscaleToPng(url)

  const slug = opts.label ? `${opts.label}-` : ''
  const folder = opts.productId ? `print-ready/${opts.productId}` : 'print-ready/loose'
  const destination = `${folder}/${slug}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
  const uploaded = await uploadImageFromBuffer(up.buffer, destination, 'image/png')

  return {
    url: uploaded.publicUrl,
    path: uploaded.path,
    width: up.width,
    height: up.height,
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

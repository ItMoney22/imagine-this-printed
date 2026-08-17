// ---------------------------------------------------------------------------
// Image metrics — the MEASURED half of the presentation QA gate.
//
// "Is this mockup sharp enough?" is the kind of question people answer with a
// vibe, and vibes are exactly what put the store where it is. So this module
// answers it with two numbers pulled off the actual image bytes:
//
//   1. RESOLUTION — width/height straight from the decoder. A 512px listing
//      photo is a bad listing photo no matter how pretty it is.
//   2. SHARPNESS  — variance of the Laplacian, the standard blur-detection
//      metric (Pech-Pacheco et al., "Diatom autofocusing in brightfield
//      microscopy", ICPR 2000; it is what OpenCV users mean by
//      `cv2.Laplacian(img, CV_64F).var()`). A crisp image has strong
//      second-derivative response at its edges and therefore high variance; a
//      blurred or upscaled one has almost none.
//
// WHY THE LAPLACIAN IS COMPUTED BY HAND rather than with sharp's `.convolve()`:
// convolve runs in the image's uint8 domain and CLAMPS, so every negative half
// of the Laplacian response — half the signal — is silently flattened to 0.
// That both shifts and shrinks the variance, and it does so more for sharp
// images than blurry ones, which is the wrong direction. Working from the raw
// greyscale buffer in JS costs ~262k float ops per image and is exact.
//
// NORMALISATION: the image is resized so its SHORT edge is
// LAPLACIAN_SAMPLE_PX before measuring. Variance of the Laplacian is
// resolution-dependent — the same photo at 4000px scores far lower than at
// 800px, because neighbouring pixels of a big image are more similar. Without
// this, a high-res mockup would look blurrier than a small one, which is
// backwards. Measuring every image at one fixed size makes the numbers
// comparable to each other and to the threshold.
// ---------------------------------------------------------------------------
import sharp from 'sharp'

/** Short edge every image is resampled to before the Laplacian runs. */
export const LAPLACIAN_SAMPLE_PX = 512

/** Refuse to buffer anything larger — a QA check must not be a memory bomb. */
const MAX_BYTES = 32 * 1024 * 1024
const FETCH_TIMEOUT_MS = Number(process.env.QA_IMAGE_FETCH_TIMEOUT_MS || 20_000)

export interface ImageMetrics {
  url: string
  ok: true
  width: number
  height: number
  shortEdge: number
  longEdge: number
  format: string
  bytes: number
  /** Variance of the Laplacian at LAPLACIAN_SAMPLE_PX. Higher = crisper. */
  sharpness: number
  /** Mean absolute Laplacian response — reported alongside the variance because
   *  it separates "flat but clean" (low both) from "noisy" (high mean, high
   *  variance) when a threshold call needs explaining to a human. */
  edgeEnergy: number
}

export interface ImageMetricsFailure {
  url: string
  ok: false
  error: string
}

export type ImageMetricsResult = ImageMetrics | ImageMetricsFailure

/**
 * Variance of the Laplacian over a single-channel 8-bit buffer.
 *
 * Kernel is the 4-neighbour discrete Laplacian:
 *      0  1  0
 *      1 -4  1
 *      0  1  0
 * Border pixels are skipped rather than padded — padding invents edges that
 * are not in the image and inflates the score of small crops.
 */
export function laplacianStats(
  gray: Uint8Array | Buffer,
  width: number,
  height: number
): { variance: number; meanAbs: number } {
  if (width < 3 || height < 3) return { variance: 0, meanAbs: 0 }
  // Single-channel buffer required. Caught live during calibration: sharp's
  // .greyscale() on an RGBA source emits TWO channels (grey + alpha), so
  // indexing it as one channel reads alpha as luminance and reports a crisp
  // transparent PNG as blurry. measureImage() flattens first; this guard keeps
  // any future caller from re-introducing it silently.
  if (gray.length < width * height) return { variance: 0, meanAbs: 0 }

  let sum = 0
  let sumSq = 0
  let sumAbs = 0
  let n = 0

  for (let y = 1; y < height - 1; y++) {
    const row = y * width
    for (let x = 1; x < width - 1; x++) {
      const i = row + x
      const value =
        gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i]
      sum += value
      sumSq += value * value
      sumAbs += value < 0 ? -value : value
      n++
    }
  }

  if (!n) return { variance: 0, meanAbs: 0 }
  const mean = sum / n
  return {
    variance: Math.max(0, sumSq / n - mean * mean),
    meanAbs: sumAbs / n
  }
}

async function fetchImageBytes(url: string): Promise<Buffer> {
  // data: URLs show up when an agent hands us an inline render instead of a
  // hosted asset. Decoding them here means the gate grades the same bytes the
  // shopper would eventually be served.
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',')
    if (comma < 0) throw new Error('malformed data: URL')
    const buf = Buffer.from(url.slice(comma + 1), url.slice(0, comma).includes(';base64') ? 'base64' : 'utf8')
    if (buf.byteLength > MAX_BYTES) throw new Error('image is larger than 32MB')
    return buf
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const declared = Number(response.headers.get('content-length') || 0)
    if (declared > MAX_BYTES) throw new Error('image is larger than 32MB')
    const buf = Buffer.from(await response.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) throw new Error('image is larger than 32MB')
    if (!buf.byteLength) throw new Error('empty response body')
    return buf
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Download one image and measure it. Never throws — a failure is a RESULT,
 * because "we could not open your listing photo" is itself a QA finding the
 * designer needs to see, not an exception that aborts the whole review.
 */
export async function measureImage(url: string): Promise<ImageMetricsResult> {
  try {
    const buf = await fetchImageBytes(url)
    const meta = await sharp(buf).metadata()
    const width = meta.width ?? 0
    const height = meta.height ?? 0
    if (!width || !height) throw new Error('could not read image dimensions')

    const { data, info } = await sharp(buf)
      // Composite onto white BEFORE greyscale. Two reasons, one of which cost a
      // calibration run to find: (a) transparent artwork is displayed against
      // the page, so white is what the shopper actually sees, and (b) without
      // it .greyscale() keeps the alpha channel and .raw() emits 2 bytes per
      // pixel, which the single-channel Laplacian below would misread entirely.
      .flatten({ background: '#ffffff' })
      .greyscale()
      // `fit: 'outside'` sizes by the SHORT edge (both dimensions >= the box),
      // which is what makes the sample comparable across aspect ratios.
      .resize(LAPLACIAN_SAMPLE_PX, LAPLACIAN_SAMPLE_PX, { fit: 'outside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true })

    if (info.channels !== 1) throw new Error(`expected 1 channel after flatten+greyscale, got ${info.channels}`)
    const { variance, meanAbs } = laplacianStats(data, info.width, info.height)

    return {
      url,
      ok: true,
      width,
      height,
      shortEdge: Math.min(width, height),
      longEdge: Math.max(width, height),
      format: meta.format ?? 'unknown',
      bytes: buf.byteLength,
      sharpness: Number(variance.toFixed(2)),
      edgeEnergy: Number(meanAbs.toFixed(2))
    }
  } catch (err: any) {
    return { url, ok: false, error: String(err?.message || err).slice(0, 200) }
  }
}

/** Measure a set of images concurrently, preserving order. */
export async function measureImages(urls: string[]): Promise<ImageMetricsResult[]> {
  return Promise.all(urls.map(measureImage))
}

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

/** Edge the alpha sample is resampled to. 256 is plenty — this measures large
 *  regions (is the whole border solid?), not fine detail, and a smaller sample
 *  keeps the per-pixel loop cheap. */
export const OPACITY_SAMPLE_PX = 256
/** Alpha at or below this reads as see-through to a shopper. */
export const TRANSPARENT_ALPHA = 16
/** Alpha at or above this reads as solid ink. */
export const OPAQUE_ALPHA = 240

/** Thresholds for spotting a PAINTED checkerboard — the fake-transparency
 *  pattern an image model draws when it cannot emit a real alpha channel. The
 *  file looks transparent to a human AND to a vision model, but every pixel is
 *  solid ink and prints as a grey-and-white chequered block.
 *
 *  MEASURED 2026-08-19 over the border lines of five real designs (best segment):
 *    bass badge      painted checker  sep  17.2  spread  2.0  alt  23  low 234.8
 *    vet-tech cat    painted checker  sep  26.7  spread  1.6  alt  99  low 226.1
 *    trail-runner v1 opaque sky       sep  86.8  spread  8.8  alt  36  low 125.8
 *    trail-runner v2 real alpha       sep  90.7  spread 18.6  alt  40  low  57.7
 *    trail-runner v3 real alpha       sep 179.5  spread 19.6  alt   4  low  74.4
 *
 *  Note which numbers actually do the work: SEPARATION does not discriminate —
 *  the opaque sky separates harder (86.8) than either checkerboard. What
 *  separates them is that a checkerboard is two FLAT, PALE tones: spread stays
 *  under 2 where real artwork runs 8.8-19.6, and the darker tone is still above
 *  200 where artwork sits at 57-126. Both gaps are wide and empty. */
export const CHECKER_MIN_SEPARATION = 12
export const CHECKER_MAX_SPREAD = 6
export const CHECKER_MIN_LUMA = 200
export const CHECKER_MIN_ALTERNATIONS = 20

export interface OpacityMetrics {
  url: string
  ok: true
  /** The file declares an alpha channel at all. A PNG without one CANNOT print
   *  as anything but a rectangle. */
  hasAlphaChannel: boolean
  /** Share of all pixels that are effectively see-through. */
  transparentFraction: number
  /** Share of the outer one-pixel ring that is effectively solid. This is the
   *  number that identifies a full-bleed rectangle: artwork meant for a garment
   *  has dead air at its edges, a poster does not. */
  opaqueBorderFraction: number
  /** The border is a painted checkerboard: the file LOOKS transparent to a human
   *  and to a vision model, but every pixel is solid ink and would print. */
  checkerboardBackground: boolean
  /** Mean luminance of the border ring, 0-255. A high value on an opaque file
   *  means a solid WHITE/light background — art that just needs the background
   *  stripped — as opposed to a full-bleed scene, which needs re-briefing. */
  borderMeanLuma: number
  /** The two-cluster split behind that call, so it can be argued with. */
  borderPattern: { clusterLow: number; clusterHigh: number; separation: number; spread: number; alternations: number } | null
}

export type OpacityResult = OpacityMetrics | ImageMetricsFailure

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

/**
 * Two-cluster analysis of one line of pixels, used to tell a painted
 * checkerboard from ordinary image noise. Run at FULL resolution: the 256px
 * alpha sample interpolates small checker cells into a flat grey and hides the
 * very pattern this is looking for.
 */
export function borderPatternOf(luma: number[]): {
  clusterLow: number
  clusterHigh: number
  separation: number
  spread: number
  alternations: number
} | null {
  if (luma.length < 8) return null
  const lo = Math.min(...luma)
  const hi = Math.max(...luma)
  const mid = (lo + hi) / 2
  const low = luma.filter(v => v < mid)
  const high = luma.filter(v => v >= mid)
  if (!low.length || !high.length) return null
  const mean = (a: number[]) => a.reduce((t, v) => t + v, 0) / a.length
  const clusterLow = mean(low)
  const clusterHigh = mean(high)
  const dev = (a: number[], m: number) => mean(a.map(v => Math.abs(v - m)))
  let alternations = 0
  for (let i = 1; i < luma.length; i++) {
    if ((luma[i] >= mid) !== (luma[i - 1] >= mid)) alternations++
  }
  return {
    clusterLow: Number(clusterLow.toFixed(1)),
    clusterHigh: Number(clusterHigh.toFixed(1)),
    separation: Number((clusterHigh - clusterLow).toFixed(1)),
    spread: Number(Math.max(dev(low, clusterLow), dev(high, clusterHigh)).toFixed(1)),
    alternations
  }
}

/**
 * Measure how much of an image is actually see-through.
 *
 * WHY THIS EXISTS: on 2026-08-19 a design generated with an opaque background,
 * printed as a cream rectangle stuck on a black tee, and scored 94/100 — the
 * gate graded placement and fidelity, and that print WAS centred and faithful.
 * Nothing measured whether there was a background at all. gpt-image-2 rejects
 * `background:'transparent'` outright, so opaque output is a routine outcome of
 * the normal generation path, not an edge case.
 *
 * Never throws: like measureImage, an unreadable file is a RESULT the reviewer
 * reports, not an exception that aborts the review.
 */
export async function measureOpacity(url: string): Promise<OpacityResult> {
  try {
    const buf = await fetchImageBytes(url)
    const meta = await sharp(buf).metadata()
    const hasAlphaChannel = Boolean(meta.hasAlpha)

    // ensureAlpha so the loop below can always read 4 bytes per pixel; on a
    // file with no alpha channel that yields a fully-opaque one, which is
    // exactly the right answer for this measurement.
    const { data, info } = await sharp(buf)
      .ensureAlpha()
      .resize(OPACITY_SAMPLE_PX, OPACITY_SAMPLE_PX, { fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (info.channels !== 4) throw new Error(`expected 4 channels after ensureAlpha, got ${info.channels}`)

    const w = info.width
    const h = info.height
    let transparent = 0
    let borderTotal = 0
    let borderOpaque = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = data[(y * w + x) * 4 + 3]
        if (a <= TRANSPARENT_ALPHA) transparent++
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
          borderTotal++
          if (a >= OPAQUE_ALPHA) borderOpaque++
        }
      }
    }

    // Border pattern at FULL resolution — one row off the top edge and one
    // column off the left. Inset by a pixel so a stray encoder edge row cannot
    // stand in for the artwork's actual border.
    // Each border LINE is analysed on its own, never concatenated. Measured on
    // the bass-badge design: its circular artwork touches the left column, and
    // pooling that column with the clean top row dragged the low cluster from
    // 226 down to 70 and hid a textbook checkerboard. One clean line is proof.
    const lines: number[][] = []
    try {
      const fullW = meta.width ?? 0
      const fullH = meta.height ?? 0
      if (fullW > 8 && fullH > 8) {
        // flatten BEFORE greyscale, for the reason documented at measureImage:
        // .greyscale() on an RGBA source keeps the alpha channel and .raw()
        // then emits TWO bytes per pixel. Reading that as luminance made the
        // genuinely-transparent emblem design look like a 235/248 checkerboard.
        // Flattening also gives the right answer semantically: transparent
        // pixels are uniform here, so only PAINTED patterns survive.
        const edge = async (left: number, top: number, width: number, height: number): Promise<number[] | null> => {
          const b = await sharp(buf)
            .extract({ left, top, width, height })
            .flatten({ background: '#ffffff' })
            .greyscale()
            .raw()
            .toBuffer()
          return b.length === width * height ? [...b] : null
        }
        const edges = await Promise.all([
          edge(0, 1, fullW, 1),
          edge(0, fullH - 2, fullW, 1),
          edge(1, 0, 1, fullH),
          edge(fullW - 2, 0, 1, fullH)
        ])
        for (const e of edges) {
          if (!e) continue
          lines.push(e)
          // Artwork often touches an edge mid-line (the bass badge's circle runs
          // into the left column), which drags the two-cluster split onto
          // dark-art-vs-light-background and hides the pattern. The corner
          // eighths are almost always pure background, so they get their own look.
          const eighth = Math.floor(e.length / 8)
          if (eighth >= 8) {
            lines.push(e.slice(0, eighth))
            lines.push(e.slice(-eighth))
          }
        }
      }
    } catch {
      // Leave `lines` empty — an unreadable edge is not evidence either way.
    }

    const isChecker = (bp: ReturnType<typeof borderPatternOf>): boolean =>
      Boolean(
        bp &&
        bp.separation >= CHECKER_MIN_SEPARATION &&
        bp.spread <= CHECKER_MAX_SPREAD &&
        bp.clusterLow >= CHECKER_MIN_LUMA &&
        bp.alternations >= CHECKER_MIN_ALTERNATIONS
      )

    // Mean luminance of the outermost ring, from the full-length edges only.
    const fullEdges = lines.filter(l => l.length > (meta.width ?? 0) / 2)
    const borderMeanLuma = fullEdges.length
      ? Number((fullEdges.flat().reduce((t, v) => t + v, 0) / fullEdges.flat().length).toFixed(1))
      : 0

    const patterns = lines.map(borderPatternOf)
    const checker = patterns.find(isChecker) ?? null
    const checkerboardBackground = Boolean(checker)
    // Report the line that decided it; otherwise the first readable one.
    const borderPattern = checker ?? patterns.find(Boolean) ?? null

    return {
      url,
      ok: true,
      hasAlphaChannel,
      transparentFraction: Number((transparent / Math.max(1, w * h)).toFixed(4)),
      opaqueBorderFraction: Number((borderOpaque / Math.max(1, borderTotal)).toFixed(4)),
      checkerboardBackground,
      borderMeanLuma,
      borderPattern
    }
  } catch (err: any) {
    return { url, ok: false, error: String(err?.message || err).slice(0, 200) }
  }
}

/** Measure a set of images concurrently, preserving order. */
export async function measureImages(urls: string[]): Promise<ImageMetricsResult[]> {
  return Promise.all(urls.map(measureImage))
}

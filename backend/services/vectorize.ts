// DTF vectorizer — traces a raster design into flat SVG shapes.
//
// WHY IT EARNS A PLACE NEXT TO HALFTONE: our designs are generated at 1024px.
// Pressed at 12 inches that is ~85 DPI, against the ~300 DPI a DTF film wants,
// so a raster print file is soft at any real garment size. A traced SVG has no
// resolution at all — the same file presses crisp at 4 inches or 40 — and flat
// vector shapes are what a cutter or a spot-colour separation needs.
//
// It is NOT a background remover and must never be sold as one: it reproduces
// whatever alpha the input already has. Feed it the transparent design.
//
// Local and free, exactly like the halftone engine — no model call, no queue.
// Tracing is lossy in the opposite direction from halftoning: it flattens
// gradients and fine texture into solid regions, which is right for bold
// graphic art and wrong for a photographic or heavily shaded design. That
// judgement is the caller's; `regions` in the result is the honest signal
// (a design that needs thousands of regions was not a good candidate).

import sharp from 'sharp'
import ImageTracer from 'imagetracerjs'

export interface VectorizeOptions {
  /**
   * Palette size. Fewer colours = flatter, cleaner separations, but the black
   * keyline is the first thing a small palette merges away - measured on the
   * Too Cute To Spook graffiti, 12 colours dissolved the outlines and shifted
   * the greens, while 24 held them. Default 24.
   */
  colors?: number
  /**
   * Curve-fitting tolerance (imagetracer's ltres/qtres). Higher is smoother and
   * smaller; lower follows the pixels more literally. Default 1.
   */
  detail?: number
  /** Drop traced regions smaller than this many pixels — kills speckle. Default 8. */
  despeckle?: number
  /**
   * Pre-blur radius (0-5). Cuts the path count hard - 64x on this art - but it
   * is a low-pass filter, so it eats thin black keylines before quantization
   * ever sees them. Default 0: speckle is cheaper to live with than lost
   * outlines on garment art.
   */
  smoothing?: number
  /**
   * Longest edge the tracer sees. Tracing cost grows with pixel count, and
   * detail beyond this is noise the curve fitter would chase. Default 1024.
   */
  maxSample?: number
}

export interface VectorizeResult {
  svg: string
  width: number
  height: number
  /** Palette entries actually used. */
  colors: number
  /** Traced path count — the honest "was this a good candidate" signal. */
  regions: number
  metadata: Record<string, unknown>
}

export async function vectorize(input: Buffer, opts: VectorizeOptions = {}): Promise<VectorizeResult> {
  const colors = Math.max(2, Math.min(64, Math.round(opts.colors ?? 24)))
  const detail = Math.max(0.01, Math.min(10, opts.detail ?? 1))
  const despeckle = Math.max(0, Math.round(opts.despeckle ?? 32))
  const smoothing = Math.max(0, Math.min(5, Math.round(opts.smoothing ?? 0)))
  const maxSample = Math.max(128, Math.min(4096, Math.round(opts.maxSample ?? 1024)))

  const meta = await sharp(input).metadata()
  const fullW = meta.width ?? maxSample
  const fullH = meta.height ?? maxSample

  const { data, info } = await sharp(input)
    .ensureAlpha()
    .resize(maxSample, maxSample, { fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const svg: string = ImageTracer.imagedataToSVG(
    { width: info.width, height: info.height, data: new Uint8ClampedArray(data) },
    {
      numberofcolors: colors,
      ltres: detail,
      qtres: detail,
      pathomit: despeckle,
      // A viewBox is the whole point — without it the SVG carries the sample's
      // pixel dimensions and stops being resolution-independent downstream.
      viewbox: true,
      linefilter: true,
      // Strokes would fatten every shape by half a pixel at print scale; DTF
      // wants filled regions only.
      strokewidth: 0,
      roundcoords: 2,
      blurradius: smoothing,
      blurdelta: 20,
      colorquantcycles: 3,
    }
  )

  const regions = (svg.match(/<path/g) || []).length

  return {
    svg,
    width: fullW,
    height: fullH,
    colors,
    regions,
    metadata: {
      engine: 'imagetracerjs',
      colors,
      detail,
      despeckle,
      smoothing,
      sampled: `${info.width}x${info.height}`,
      regions,
      vectorized_at: new Date().toISOString(),
    },
  }
}

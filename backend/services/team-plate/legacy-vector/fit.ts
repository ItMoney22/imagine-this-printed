// Team plate — text fitting and arch geometry.
//
// Pure math, no I/O, no font files: everything here takes a `measure` callback
// so the two things that actually go wrong in production can be tested without
// rasterizing anything.
//
// Those two things:
//
//   1. A long name overflowing its zone. VANDERMEULEN is twelve characters;
//      BEAR is four. sharp will happily composite outside the frame without
//      complaining, so an unfitted string does not error — it just prints off
//      the edge of the garment.
//
//   2. A short string ballooning. This is the subtle one. Fitting to the zone
//      WIDTH alone makes "1" render at roughly twice the cap height of "88",
//      so two kids on the same team get visibly different shirts. The fix is
//      one `Math.min` against the height scale (see fitToZone), and it is
//      pinned by a test that renders both and compares scale.
export interface Zone {
  x: number
  y: number
  w: number
  h: number
}

export interface StringMetrics {
  /** Advance width of the whole string, in font units. */
  width: number
  /** Font ascender, in font units (positive, up). */
  ascender: number
  /** Font descender, in font units (negative, down). */
  descender: number
  unitsPerEm: number
}

export interface Fit {
  /** Multiplier from font units to canvas px. */
  scale: number
  /** Fitted width in canvas px. */
  width: number
  /** Fitted height (ascender to descender) in canvas px. */
  height: number
  /** Left edge of the fitted string, in canvas px. */
  originX: number
  /** Baseline position in canvas px — glyph paths are placed relative to this. */
  baselineY: number
  /** Carried through so callers can recover the top edge without re-measuring. */
  ascender: number
}

export interface GlyphPlacement {
  index: number
  /** Vertical shift in canvas px, SVG convention (y grows downward). */
  dy: number
  /** Rotation in degrees, applied about the glyph's own centre. */
  rotation: number
}

export interface FitOptions {
  /** Total arc sweep in degrees. 0 (default) is a flat baseline. */
  arch?: number
  /**
   * Size the text as if it were this string, then centre the REAL string at
   * that size.
   *
   * This is how jersey numbers actually work. Fitting each value on its own
   * makes "1" render at twice the cap height of "88" — same zone, half the
   * glyphs, double the scale — so two kids on one team get visibly different
   * shirts. Passing the field's widest possible value (see widestNumberString)
   * as the reference gives every number on every order the same height, which
   * is the whole reason the number is in a fixed box.
   *
   * Names are deliberately NOT reference-fitted: a long surname really is set
   * smaller than a short one on a real jersey.
   */
  reference?: string
}

/**
 * Scale a string to fill `zone` without exceeding it on either axis, then
 * centre it both ways.
 *
 * Returns null for an empty or whitespace-only string — there is nothing to
 * draw, and callers skip the field entirely rather than compositing a blank
 * layer.
 */
export function fitToZone(
  text: string,
  zone: Zone,
  measure: (s: string) => StringMetrics,
  opts: FitOptions = {}
): Fit | null {
  if (!text || text.trim().length === 0) return null

  const archDegrees = opts.arch ?? 0
  const m = measure(text)
  if (!(m.width > 0)) return null

  // The string the SCALE is computed from, which is not always the string
  // being drawn. See FitOptions.reference — this is what keeps a lone "1" the
  // same cap height as an "88".
  const ref = opts.reference && opts.reference.length > 0 ? measure(opts.reference) : m
  if (!(ref.width > 0)) return null

  // Ascender to descender: the tallest the string can be, regardless of which
  // glyphs it happens to contain. Using the ACTUAL bounding box instead would
  // make "SMITH" (no descenders) render taller than "JONES" in the same zone.
  const naturalHeight = m.ascender - m.descender
  if (!(naturalHeight > 0)) return null

  // An arched string is TALLER than a flat one by the rise of its arc, and
  // that rise scales with the fitted width. Fitting the flat string and then
  // arching it lifts the middle glyphs straight out of the top of the zone —
  // silently, because sharp composites outside the frame without complaining.
  //
  // The rise is not circular to solve: with chord = 2r*sin(a/2), the sagitta
  // r*(1-cos(a/2)) reduces to chord * tan(a/4) / 2, i.e. a fixed multiple of
  // the fitted width. So it folds straight into the height budget.
  const archRisePerWidth = archRiseFactor(archDegrees)

  // Rotating the end glyphs about their own centres swings their corners
  // OUTSIDE the flat chord, so an arched string is wider than its unarched
  // self as well as taller. Measured: VANDERMEULEN at arch 18 overran its zone
  // by 12px at press resolution before this term existed. The excursion is
  // dominated by the glyph half-height turned through half the sweep.
  const archWidthPad = naturalHeight * Math.sin((Math.abs(archDegrees) * Math.PI) / 180 / 2)

  const widthScale = zone.w / (ref.width + archWidthPad)
  const heightScale = zone.h / (naturalHeight + ref.width * archRisePerWidth)
  // The `min` is the whole point. See the header note (2).
  const scale = Math.min(widthScale, heightScale)

  // The DRAWN width (what archPlacements treats as the chord) is the string
  // itself; archWidthPad was a budget reservation, not part of the glyph run.
  const width = m.width * scale
  // `height` is the total vertical extent the caller must reserve — the glyph
  // box PLUS the arc rise, so a bounds check on it is honest for arched text.
  const height = naturalHeight * scale + width * archRisePerWidth
  const originX = zone.x + (zone.w - width) / 2
  const top = zone.y + (zone.h - height) / 2
  // The baseline sits below the top by the ascender plus half the arc rise:
  // archPlacements centres the arc about zero, so the middle glyphs rise half
  // the sagitta above the baseline and the ends fall half below it.
  const baselineY = top + m.ascender * scale + (width * archRisePerWidth) / 2

  return { scale, width, height, originX, baselineY, ascender: m.ascender }
}

/**
 * Arc rise (sagitta) as a multiple of the chord, for a total sweep of
 * `archDegrees`. Zero for a flat baseline.
 */
function archRiseFactor(archDegrees: number): number {
  if (!archDegrees) return 0
  const quarter = (Math.abs(archDegrees) * Math.PI) / 180 / 4
  return Math.tan(quarter) / 2
}

/**
 * The widest string of `length` digits, for use as a fit reference.
 *
 * Measured rather than assumed: "8" is the widest digit in most faces but not
 * all, and in a tabular-figure font every digit is identical. Either way this
 * returns the true worst case for the font in hand.
 */
export function widestNumberString(length: number, measure: (s: string) => StringMetrics): string {
  if (length <= 0) return ''
  let widest = '0'
  let widestWidth = measure('0').width
  for (let d = 1; d <= 9; d++) {
    const ch = String(d)
    const w = measure(ch).width
    if (w > widestWidth) {
      widest = ch
      widestWidth = w
    }
  }
  return widest.repeat(length)
}

/**
 * Place each glyph on a circular arc.
 *
 * `archDegrees` is the TOTAL sweep from the first glyph to the last, so 18
 * means the string turns through 18 degrees end to end. 0 returns zeroed
 * placements — a flat baseline, no trigonometry applied.
 *
 * `dy` follows SVG convention (y grows downward). A POSITIVE arch is a
 * rainbow: the CENTRE glyphs rise and the ends fall, which is what "BEAR"
 * arched over a number actually looks like.
 *
 * The arc is centred about zero — dy runs from -rise/2 at the centre to
 * +rise/2 at the ends — so the placements stay balanced around the baseline
 * fitToZone computed. Leaving the ends pinned at zero instead would push the
 * whole string half a sagitta above its zone.
 */
export function archPlacements(
  text: string,
  archDegrees: number,
  fittedWidth: number
): GlyphPlacement[] {
  const n = text.length
  if (n === 0) return []
  // One glyph has no span to arch across, and the (n-1) divisor below would
  // be a division by zero.
  if (n === 1 || archDegrees === 0 || fittedWidth <= 0) {
    return Array.from({ length: n }, (_, index) => ({ index, dy: 0, rotation: 0 }))
  }

  // The geometry is computed on the ABSOLUTE sweep and the direction applied
  // at the end. Deriving it from the signed angle does not work: cos is even,
  // so a -18 arch produced exactly the same rainbow as +18 and the valley
  // shape was unreachable.
  const direction = Math.sign(archDegrees)
  const sweep = (Math.abs(archDegrees) * Math.PI) / 180
  const half = sweep / 2
  // Treat the fitted width as the chord of the arc: chord = 2r*sin(sweep/2).
  const radius = fittedWidth / (2 * Math.sin(half))
  const cosHalf = Math.cos(half)
  // Total rise from the ends to the centre.
  const rise = radius * (1 - cosHalf)

  return Array.from({ length: n }, (_, index) => {
    const theta = -half + sweep * (index / (n - 1))
    // Height of this glyph above the chord (0 at the ends, `rise` at the
    // centre), recentred so the arc straddles the baseline rather than
    // sitting entirely above it.
    const lift = radius * (Math.cos(theta) - cosHalf) - rise / 2
    return {
      index,
      dy: -lift * direction,
      rotation: ((theta * 180) / Math.PI) * direction,
    }
  })
}

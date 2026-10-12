// ---------------------------------------------------------------------------
// Garment colour — chosen from the ARTWORK, not from a hardcoded default.
//
// WHY THIS EXISTS. David, 2026-09-01: "look at this design it should go on a
// white shirt because of how it looks but it was mocked on a black shirt so now
// it looks like this." He was holding black line art printed on a black polo.
// Nothing in the pipeline had looked at the file: every create path in the
// backend stamped `shirtColor: 'black'` and `metadata.shirt_color = 'black'`,
// and the render prompt asserted "on a BLACK garment" as a fact about a picture
// that did not exist yet.
//
// So the decision moves to where the evidence is — after the artwork exists,
// measured off its own pixels (services/image-metrics.ts), against the garments
// this shop can actually put in front of a shopper.
//
// TWO CONSTRAINTS, AND THEY ARE NOT THE SAME SET.
//   1. What ITP can MAKE:   shared/catalog-capability.ts COLORS — seven blanks.
//   2. What we can RENDER:  the mockup pipeline's static Mr. Imagine bases,
//      public/mr-imagine/mockups/mr-imagine-{type}-{color}-{side}.png, which
//      exist for black / white / gray only. The worker builds that path by
//      string interpolation (worker/ai-jobs-worker.ts), so asking for a navy
//      tee produces a 404 on the base image, not a navy tee.
// The picker chooses from the INTERSECTION. A colour we cannot photograph is
// not an option, however well it would print — that lesson is already written
// into catalog-capability.ts and this is the same rule one layer down.
//
// EVERY THRESHOLD IS ANCHORED, NOT GUESSED. The contrast floor is WCAG 2.1's
// non-text contrast minimum (SC 1.4.11, 3:1) — the standard's own answer to
// "can a person distinguish this shape from what is behind it", which is
// exactly the question a print on a shirt asks. The worked numbers are quoted
// at each constant below.
// ---------------------------------------------------------------------------
import {
  measureArtworkLuminance,
  measureArtworkLuminanceFromBuffer,
  vanishingFraction,
  meanContrastAgainst,
  luminanceOfHex,
  contrastRatio,
  type ArtworkLuminance,
  type ArtworkLuminanceResult,
} from './image-metrics.js'
import { COLORS, normalizeGarment, normalizeColor, type GarmentId } from '../shared/catalog-capability.js'

/**
 * The garment colours the mockup renderer has a base image for. These strings
 * are the ones `shirtColor` carries through every job input — 'gray', not
 * 'heather-grey', because that is the spelling the worker interpolates into the
 * asset path and the one services/replicate.ts maps to "heather gray" fabric.
 */
export type RenderableColorId = 'black' | 'white' | 'gray'

export const RENDERABLE_COLORS: RenderableColorId[] = ['black', 'white', 'gray']

/**
 * Per-garment renderable set, read off the files that are actually on disk in
 * `public/mr-imagine/mockups`.
 *
 * Hoodie is black/white ONLY on purpose: there is a gray hoodie FRONT base but
 * no gray hoodie BACK, and a back-only placement would interpolate a path that
 * 404s. A missing base is a failed render, not a slightly different photo, so
 * the colour is simply not offered rather than offered conditionally.
 */
const RENDERABLE_BY_GARMENT: Record<GarmentId, RenderableColorId[]> = {
  tshirt: ['black', 'white', 'gray'],
  'youth-tshirt': ['black', 'white', 'gray'],
  hoodie: ['black', 'white'],
}

/** The capability colour each renderable id stands for, so the swatch on the
 *  storefront and the colour this module picks can never drift apart. */
const CAPABILITY_OF: Record<RenderableColorId, keyof typeof COLORS> = {
  black: 'black',
  white: 'white',
  gray: 'heather-grey',
}

/**
 * Relative luminance of each garment, derived from the capability module's own
 * hex rather than re-typed here.
 *
 *   black        #000000  ->  0.0000
 *   white        #FFFFFF  ->  1.0000
 *   heather-grey #9CA3AF  ->  0.3556
 *
 * Note that `COLORS[...].luma` is NOT used: those hand-entered values (black
 * 0.02, white 0.98, heather-grey 0.55) are sRGB-ish eyeball figures, and 0.55
 * for #9CA3AF is about 0.2 away from its real relative luminance. Contrast
 * ratios computed from them would be wrong by enough to change the answer on
 * mid-tone art, which is precisely the case this module exists to get right.
 */
export const GARMENT_LUMA: Record<RenderableColorId, number> = {
  black: luminanceOfHex(COLORS[CAPABILITY_OF.black].hex),
  white: luminanceOfHex(COLORS[CAPABILITY_OF.white].hex),
  gray: luminanceOfHex(COLORS[CAPABILITY_OF.gray].hex),
}

export const GARMENT_LABEL: Record<RenderableColorId, string> = {
  black: 'black',
  white: 'white',
  gray: 'heather grey',
}

// ---------------------------------------------------------------------------
// THRESHOLDS
// ---------------------------------------------------------------------------

/**
 * Contrast ratio below which a patch of ink is treated as VANISHING into the
 * garment. WCAG 2.1 SC 1.4.11 (non-text contrast) is 3:1, and a print on a
 * shirt is exactly the "graphical object a user must perceive" that clause is
 * about.
 *
 * Worked against the real palette, ink luminance on the left:
 *   pure black ink  (0.000) on black (0.000)  ->  1.00   invisible
 *   charcoal        (0.030) on black          ->  1.60   invisible
 *   mid grey        (0.216) on black          ->  5.32   fine
 *   pure red        (0.213) on black          ->  5.25   fine
 *   cream           (0.800) on white (1.000)  ->  1.24   invisible
 *   pure red        (0.213) on white          ->  3.99   fine
 *   black ink       (0.000) on heather (0.356)->  8.11   fine
 *   white ink       (1.000) on heather        ->  2.59   weak
 * The gap between "invisible" (1.0-1.6) and "fine" (4-8) is wide and empty,
 * and 3.0 sits in it with the standard's authority behind it.
 */
export const MIN_INK_CONTRAST = Number(process.env.GARMENT_MIN_INK_CONTRAST || 3)

/**
 * Share of the ink that may vanish before the garment is rejected outright.
 *
 * Not zero, and deliberately high: black outlines around colour fills on a
 * black tee are a legitimate look — the outline reads as a separation, not as
 * missing art — and that pattern runs 15-30% of the ink. What is NOT legitimate
 * is the failure David photographed, where the art IS the dark line work and
 * essentially all of it disappears (measured on black-on-black line art: 0.95+).
 * Half the ink gone is the line between the two.
 *
 * CALIBRATED AGAINST THE LIVE CATALOGUE, 2026-09-22 — 60 active garment
 * listings, 56 with readable artwork, graded on the colour they are actually
 * stamped with (scripts/verify-garment-contrast.ts and the sweep it documents):
 *
 *   >= 0.50 vanishing  13 listings (23%)   would BLOCK
 *   0.25 - 0.50        19 listings (34%)   would WARN
 *   < 0.25             24 listings (43%)   clean
 *
 * The blocking set is not a threshold artefact — it is a list of real defects
 * (Punctuation Perfection Tee 100%, Embroidered Golf Club Polo 96%, Bruh
 * Capital Letters 94%), every one of them dark line work stamped 'black', and
 * every one of them resolved by moving to white. The distribution runs smoothly
 * from 100% down to 1.2% with no cliff, so this number is a judgement about how
 * much of a design may disappear, not a gap in the data — which is why it is
 * env-tunable. Nothing already live is pulled down; the gate runs on
 * submissions.
 */
export const BLOCK_VANISHING_FRACTION = Number(process.env.GARMENT_BLOCK_VANISHING || 0.5)

/** Above this the garment is a warning — visible, but the design is fighting
 *  its own background and a different base would sell better. */
export const WARN_VANISHING_FRACTION = Number(process.env.GARMENT_WARN_VANISHING || 0.25)

/** A design holds up on a second base only if almost none of it vanishes there
 *  AND the average contrast is comfortable — a colourway is a photo shoot and a
 *  listing variation, so "technically legible" is not the bar. */
export const MULTI_COLORWAY_MAX_VANISHING = Number(process.env.GARMENT_COLORWAY_MAX_VANISHING || 0.1)
export const MULTI_COLORWAY_MIN_CONTRAST = Number(process.env.GARMENT_COLORWAY_MIN_CONTRAST || 4.5)
/** How many EXTRA colourways one design may fan out to. Each one is a real
 *  render bill, so the default is one. */
export const MAX_ALTERNATE_COLORWAYS = Math.max(0, Number(process.env.GARMENT_MAX_ALTERNATE_COLORWAYS ?? 1))

/**
 * A file this covered in ink has no dead air — it is a flattened rectangle, so
 * the "ink" being measured includes its background. The pick is still better
 * than a hardcoded default, but it is reported as low confidence and the
 * print-background criterion is the one that will actually stop the listing.
 */
export const OPAQUE_INK_FRACTION = Number(process.env.GARMENT_OPAQUE_INK_FRACTION || 0.97)

// ---------------------------------------------------------------------------
// The pick
// ---------------------------------------------------------------------------

export interface GarmentColorScore {
  color: RenderableColorId
  label: string
  garmentLuma: number
  /** Share of the ink that falls under MIN_INK_CONTRAST against this garment. */
  vanishing: number
  /** Ink-weighted mean contrast ratio against this garment. */
  meanContrast: number
  /** Contrast of the artwork's DARKEST tenth and LIGHTEST tenth — the two ends
   *  that actually go missing. */
  darkTailContrast: number
  lightTailContrast: number
  ok: boolean
}

export interface GarmentColorDecision {
  color: RenderableColorId
  /** Why this base won, in one sentence written for a human reading a log. */
  reason: string
  /** Every candidate with its numbers, so the call can be argued with. */
  scores: GarmentColorScore[]
  /** Other bases this design would ALSO hold up on — the multi-colourway set. */
  alternates: RenderableColorId[]
  /** False when the artwork had no dead air, so the measurement includes a
   *  background that will not be printed. */
  confident: boolean
  measured: {
    inkFraction: number
    inkPixels: number
    meanLuma: number
    medianLuma: number
    p10Luma: number
    p90Luma: number
  }
  decidedAt: string
}

/** The renderable colours available for a garment, defaulting to the tee set
 *  for anything unrecognised (the mockup path falls back to a tee too). */
export function renderableColorsFor(garment: string | null | undefined): RenderableColorId[] {
  const id = normalizeGarment(garment)
  return id ? RENDERABLE_BY_GARMENT[id] : RENDERABLE_BY_GARMENT.tshirt
}

/** Normalise any stored colour string to a renderable id, or null when the
 *  colour is one we sell but cannot photograph (navy, red, …). */
export function toRenderableColor(value: string | null | undefined): RenderableColorId | null {
  const v = String(value ?? '').toLowerCase().trim()
  if (v === 'black' || v === 'white') return v
  if (v === 'gray' || v === 'grey') return 'gray'
  const capability = normalizeColor(value)
  if (capability === 'heather-grey') return 'gray'
  if (capability === 'black' || capability === 'white') return capability
  return null
}

/**
 * Resolve ANY stored garment colour to something with a luminance — including
 * the four we sell but cannot render a mockup of (navy, red, forest green,
 * royal blue). The QA gate has to be able to judge a product that is stamped
 * navy even though the picker would never choose navy.
 *
 * `null` is deliberately resolved as BLACK rather than as "unknown", because
 * that is what the renderer does with it: worker/ai-jobs-worker.ts falls back to
 * 'black' when no colour is stamped anywhere. Treating it as unknown would hand
 * every legacy row a free pass on exactly the defect it has.
 */
export function garmentLumaOf(value: string | null | undefined): {
  id: string
  label: string
  hex: string
  luma: number
  renderable: boolean
} | null {
  if (value === null || value === undefined || String(value).trim() === '') {
    return { id: 'black', label: GARMENT_LABEL.black, hex: COLORS.black.hex, luma: GARMENT_LUMA.black, renderable: true }
  }
  const capability = normalizeColor(value)
  if (!capability) return null
  const c = COLORS[capability]
  return {
    id: capability,
    label: c.label.toLowerCase(),
    hex: c.hex,
    luma: luminanceOfHex(c.hex),
    renderable: toRenderableColor(capability) !== null,
  }
}

/** Score an arbitrary garment luminance against measured artwork. */
export function scoreGarmentLuma(
  lum: ArtworkLuminance,
  color: string,
  label: string,
  garmentLuma: number
): GarmentColorScore {
  const vanishing = vanishingFraction(lum.histogram, garmentLuma, MIN_INK_CONTRAST)
  return {
    color: color as RenderableColorId,
    label,
    garmentLuma: Number(garmentLuma.toFixed(4)),
    vanishing,
    meanContrast: meanContrastAgainst(lum.histogram, garmentLuma),
    darkTailContrast: Number(contrastRatio(lum.p10Luma, garmentLuma).toFixed(2)),
    lightTailContrast: Number(contrastRatio(lum.p90Luma, garmentLuma).toFixed(2)),
    ok: vanishing < BLOCK_VANISHING_FRACTION,
  }
}

/** Score one renderable garment base against measured artwork. */
export function scoreGarment(lum: ArtworkLuminance, color: RenderableColorId): GarmentColorScore {
  return scoreGarmentLuma(lum, color, GARMENT_LABEL[color], GARMENT_LUMA[color])
}

/**
 * Pick the garment colour that keeps the most of this design visible.
 *
 * Ranked on VANISHING INK first and mean contrast second, in that order and not
 * the other way round. Mean contrast alone picks the base that flatters the
 * bulk of the art and is happy to lose all of the line work — which is the
 * exact defect being fixed: a design that is 80% bright colour and 20% black
 * outline scores a fine average on black while every outline disappears.
 *
 * Returns null when there is nothing to judge (unreadable file, or artwork with
 * no ink at all); callers keep whatever they had rather than invent a colour.
 */
export function pickGarmentColor(
  lum: ArtworkLuminanceResult,
  opts: { garment?: string | null; allow?: RenderableColorId[] } = {}
): GarmentColorDecision | null {
  if (!lum.ok) return null
  if (!lum.inkPixels) return null

  const allowed = (opts.allow ?? renderableColorsFor(opts.garment)).filter(c => RENDERABLE_COLORS.includes(c))
  if (!allowed.length) return null

  const scores = allowed.map(c => scoreGarment(lum, c))
  const ranked = [...scores].sort((a, b) => (a.vanishing - b.vanishing) || (b.meanContrast - a.meanContrast))
  const winner = ranked[0]

  const alternates = ranked
    .slice(1)
    .filter(s => s.vanishing <= MULTI_COLORWAY_MAX_VANISHING && s.meanContrast >= MULTI_COLORWAY_MIN_CONTRAST)
    .slice(0, MAX_ALTERNATE_COLORWAYS)
    .map(s => s.color)

  const pct = (n: number) => `${Math.round(n * 100)}%`
  const runnerUp = ranked[1]
  const tone = lum.medianLuma <= 0.18 ? 'dark' : lum.medianLuma >= 0.6 ? 'light' : 'mid-tone'
  const reason =
    `Artwork is ${tone} (median luminance ${lum.medianLuma.toFixed(2)}). On ${winner.label} ` +
    `${pct(winner.vanishing)} of the ink falls under ${MIN_INK_CONTRAST}:1 contrast` +
    (runnerUp ? `, against ${pct(runnerUp.vanishing)} on ${runnerUp.label}` : '') +
    `; mean contrast ${winner.meanContrast}:1.` +
    (alternates.length ? ` Also holds up on ${alternates.map(a => GARMENT_LABEL[a]).join(' and ')}.` : '')

  return {
    color: winner.color,
    reason,
    scores,
    alternates,
    confident: lum.inkFraction < OPAQUE_INK_FRACTION,
    measured: {
      inkFraction: lum.inkFraction,
      inkPixels: lum.inkPixels,
      meanLuma: lum.meanLuma,
      medianLuma: lum.medianLuma,
      p10Luma: lum.p10Luma,
      p90Luma: lum.p90Luma,
    },
    decidedAt: new Date().toISOString(),
  }
}

/** Measure a hosted design and pick its garment colour. Never throws — a
 *  failure returns null and the caller keeps its existing behaviour. */
export async function chooseGarmentColorForDesign(
  designUrl: string,
  opts: { garment?: string | null; allow?: RenderableColorId[] } = {}
): Promise<GarmentColorDecision | null> {
  try {
    return pickGarmentColor(await measureArtworkLuminance(designUrl), opts)
  } catch {
    return null
  }
}

/** `chooseGarmentColorForDesign` for artwork already in memory. */
export async function chooseGarmentColorForBuffer(
  png: Buffer,
  opts: { garment?: string | null; allow?: RenderableColorId[] } = {}
): Promise<GarmentColorDecision | null> {
  try {
    return pickGarmentColor(await measureArtworkLuminanceFromBuffer(png), opts)
  } catch {
    return null
  }
}

/**
 * The shape written to `products.metadata.garment_color`. Kept next to the
 * decision so every writer stamps the same fields — the audit trail for "why is
 * this on a white shirt" has to survive the job that made the call.
 */
export function garmentColorMetadata(
  decision: GarmentColorDecision,
  source: 'measured' | 'requested'
): Record<string, unknown> {
  return {
    color: decision.color,
    source,
    reason: decision.reason,
    confident: decision.confident,
    alternates: decision.alternates,
    measured: decision.measured,
    scores: decision.scores,
    decided_at: decision.decidedAt,
  }
}

/**
 * The one sentence the image model is told about the garment.
 *
 * When the colour is not yet known — which is the normal case, because the
 * artwork has to exist before it can be measured — the prompt must NOT invent
 * one. The old wording ("heat-pressed across the chest of a BLACK t-shirt …
 * keep every shape readable against black") asserted a fact about a decision
 * nothing had made yet, and then the pipeline made the opposite one.
 */
export function garmentColorPromptClause(color: RenderableColorId | null, noun: string): string {
  if (color) {
    return (
      `This is artwork for a DTF transfer heat-pressed across the chest of a ${GARMENT_LABEL[color]} ${noun}, ` +
      `then worn and washed. Every shape has to stay readable against ${GARMENT_LABEL[color]} — nothing in the ` +
      `artwork may share that tone.`
    )
  }
  return (
    `This is artwork for a DTF transfer heat-pressed across the chest of a ${noun}, then worn and washed. ` +
    'The garment colour is chosen AFTER this render, from the artwork itself, to contrast with it — so commit ' +
    'to ONE value key and stay there: either predominantly DARK ink or predominantly LIGHT ink, never a ' +
    'mid-grey hedge that reads as mush on every shirt. Do not rely on the shirt colour showing through as part ' +
    'of the design, and never leave a shape whose only edge is the absence of ink.'
  )
}

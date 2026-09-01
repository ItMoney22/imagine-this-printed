// Step Flow — Step 3 color advice.
//
// David 2026-09-01: "the system should recommend colors that suit the artwork
// (a mostly-black design should not be pushed onto a black shirt) and David
// picks the final set." This is MEASURED, not guessed: sample the transparent
// (nobg) PNG's opaque pixels and score every ITP-offered color by contrast.
//
// Grading is a blend of two signals:
//   1. Raw luminance distance between the artwork's mean and the blank's luma
//      — captures the simple "dark art vs. light shirt" case.
//   2. The SHARE of the artwork that sits on the "wrong side" of the blank
//      (its dark ink share against a dark blank, or its bright/highlight
//      share against a light blank) — captures the case a plain mean can
//      miss: a mostly-dark design with a few bright highlights would still
//      read as "mostly invisible" ink on a black shirt even though its mean
//      luminance looks mid-range.
import sharp from 'sharp'
import { COLORS, colorsForGarment, type CapabilityColor, type ColorId, type GarmentId } from '../../shared/catalog-capability.js'

export interface ArtworkStats {
  /** Mean relative luminance (0..1) of opaque pixels. */
  meanLuma: number
  /** Share of opaque pixels with luma < 0.2. */
  darkShare: number
  /** Share of opaque pixels with luma > 0.8. */
  lightShare: number
  /** Share of all sampled pixels that are opaque (alpha >= 240). */
  coverage: number
  /** Saturation-weighted circular-mean hue in degrees, or null if effectively grayscale/empty. */
  dominantHue: number | null
}

export interface ColorAdvice {
  id: ColorId
  label: string
  hex: string
  grade: 'great' | 'ok' | 'poor'
  score: number
  reason: string
}

const SAMPLE_MAX_DIM = 256
const OPAQUE_ALPHA_THRESHOLD = 240
const DARK_LUMA_THRESHOLD = 0.2
const LIGHT_LUMA_THRESHOLD = 0.8
// Below this the sample has essentially no opaque ink to judge — treat every
// color as a neutral "ok" rather than let an empty/near-empty PNG poison the
// scores toward "poor" via a meaningless meanLuma of 0.
const MIN_JUDGEABLE_COVERAGE = 0.01

function relativeLuma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** RGB (0-255) -> { h: 0..360, s: 0..1 } (HSL hue/saturation; lightness not needed here). */
function rgbToHueSat(r: number, g: number, b: number): { h: number; s: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  const lightness = (max + min) / 2
  if (delta < 1e-6) return { h: 0, s: 0 }
  const s = delta / (1 - Math.abs(2 * lightness - 1))
  let h: number
  if (max === rn) h = ((gn - bn) / delta) % 6
  else if (max === gn) h = (bn - rn) / delta + 2
  else h = (rn - gn) / delta + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s }
}

/**
 * Measure an artwork PNG's opaque-pixel statistics. Pure and synchronous over
 * a decoded buffer — the one thing worth unit testing directly with synthetic
 * PNGs built by `sharp` in the test file.
 */
export async function measureArtworkStats(pngBuffer: Buffer): Promise<ArtworkStats> {
  const { data, info } = await sharp(pngBuffer)
    .resize(SAMPLE_MAX_DIM, SAMPLE_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const channels = info.channels || 4
  let total = 0
  let opaque = 0
  let sumLuma = 0
  let dark = 0
  let light = 0
  let sumSin = 0
  let sumCos = 0
  let sumSat = 0

  for (let i = 0; i + channels <= data.length; i += channels) {
    total++
    const a = channels >= 4 ? data[i + 3] : 255
    if (a < OPAQUE_ALPHA_THRESHOLD) continue
    opaque++
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const luma = relativeLuma(r, g, b)
    sumLuma += luma
    if (luma < DARK_LUMA_THRESHOLD) dark++
    if (luma > LIGHT_LUMA_THRESHOLD) light++
    const { h, s } = rgbToHueSat(r, g, b)
    if (s > 0.05) {
      sumSin += Math.sin((h * Math.PI) / 180) * s
      sumCos += Math.cos((h * Math.PI) / 180) * s
      sumSat += s
    }
  }

  const coverage = total > 0 ? opaque / total : 0
  const meanLuma = opaque > 0 ? sumLuma / opaque : 0
  const darkShare = opaque > 0 ? dark / opaque : 0
  const lightShare = opaque > 0 ? light / opaque : 0
  const dominantHue = sumSat > 0.01 ? (((Math.atan2(sumSin, sumCos) * 180) / Math.PI) + 360) % 360 : null

  return { meanLuma, darkShare, lightShare, coverage, dominantHue }
}

/** Score one capability color against measured artwork stats. */
export function scoreColor(stats: ArtworkStats, color: CapabilityColor): ColorAdvice {
  if (stats.coverage < MIN_JUDGEABLE_COVERAGE) {
    return {
      id: color.id,
      label: color.label,
      hex: color.hex,
      grade: 'ok',
      score: 0.5,
      reason: 'Not enough opaque artwork to judge contrast yet.',
    }
  }

  const isDarkBlank = color.luma < 0.5
  // The share of the art that would visually blend into THIS blank: dark ink
  // vanishes on a dark shirt, bright/light ink washes out on a light shirt.
  const riskShare = isDarkBlank ? stats.darkShare : stats.lightShare
  const diff = Math.abs(stats.meanLuma - color.luma)
  const rawScore = 0.6 * diff + 0.4 * (1 - riskShare)
  const score = Math.max(0, Math.min(1, rawScore))
  const grade: ColorAdvice['grade'] = score >= 0.6 ? 'great' : score >= 0.35 ? 'ok' : 'poor'

  let reason: string
  if (grade === 'poor') {
    reason = isDarkBlank
      ? `Artwork is ${Math.round(stats.darkShare * 100)}% dark ink — ${color.label.toLowerCase()} would swallow it.`
      : `Artwork is ${Math.round(stats.lightShare * 100)}% light/bright — it would wash out on ${color.label.toLowerCase()}.`
  } else if (grade === 'great') {
    reason = `Strong contrast against ${color.label.toLowerCase()} (${Math.round(diff * 100)}% luminance difference).`
  } else {
    reason = `Workable contrast against ${color.label.toLowerCase()}, but not the strongest pick.`
  }

  return { id: color.id, label: color.label, hex: color.hex, grade, score, reason }
}

/** Rank every color ITP offers for a garment against measured artwork stats. */
export function scoreColorsForGarment(stats: ArtworkStats, garment: GarmentId): ColorAdvice[] {
  return colorsForGarment(garment)
    .map((c) => scoreColor(stats, c))
    .sort((a, b) => b.score - a.score)
}

/**
 * Step 3 entry point: fetch the artwork PNG (the nobg asset — callers should
 * fall back to the source design when no nobg asset exists yet) and return a
 * ranked color list plus the raw stats for display ("artwork is 78% dark
 * ink…").
 */
export async function adviseColors(pngUrl: string, garment: GarmentId): Promise<{ advice: ColorAdvice[]; artwork: ArtworkStats }> {
  if (!pngUrl) throw new Error('pngUrl is required')
  const res = await fetch(pngUrl)
  if (!res.ok) throw new Error(`Failed to fetch artwork for color advice: ${res.status} ${res.statusText}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const artwork = await measureArtworkStats(buffer)
  const advice = scoreColorsForGarment(artwork, garment)
  return { advice, artwork }
}

// Re-exported for callers that already have COLORS loaded and want the raw map.
export { COLORS }

// Renders the buyer's Team / Name / Number into the print file.
//
// David 2026-09-09: "separate fields for team, name, and number - build it".
//
// WHY THIS IS NOT step-flow/letter-phrase.ts
// ------------------------------------------
// letter-phrase.ts letters words into artwork with an AI image EDIT. That is
// the right tool at DESIGN time: David is choosing a take, he can look at it,
// and if the lettering is wrong he keeps the original. It is the wrong tool at
// ORDER time for three reasons that all cost real money:
//   1. it bills an image generation on every single sale,
//   2. it takes ~60 seconds while a customer waits on a confirmation,
//   3. image models do not reliably spell an arbitrary surname — and a paid
//      order for a kid named Szczepanski has to be right the first time.
// So personalization is a deterministic sharp + SVG composite into zones the
// product declares. Exact spelling, instant, free per order, byte-identical
// every run.
import sharp from 'sharp'
import { PERSONALIZATION_FIELD_ORDER, type PersonalizationFieldId, type PersonalizationValues } from '../shared/personalization.js'

/** Thrown for a product whose zones are misconfigured — surfaced loudly rather
 *  than silently printing a name off the edge of the sheet. */
export class PersonalizationRenderError extends Error {}

export interface PrintZone {
  field: PersonalizationFieldId
  /** Pixel geometry in the base print file coordinate space. */
  x: number
  y: number
  width: number
  height: number
  fontFamily?: string
  color?: string
  align?: 'left' | 'center' | 'right'
  uppercase?: boolean
  /** Caps the auto-fitted size. Without it a 2-character number fills the zone height. */
  maxFontSize?: number
}

// Jersey lettering. Every face here is a safe fallback chain — if the box has
// none of them the renderer still produces a file with the generic sans.
const DEFAULT_FONT_FAMILY = "'Arial Black', 'Arial Bold', Arial, Helvetica, sans-serif"
const DEFAULT_COLOR = '#111111'

// Mean advance width of a bold sans glyph as a fraction of the em. Used to fit
// text to a zone without shelling out to a font metrics library. Deliberately
// generous — overestimating the width makes text slightly small, which is safe;
// underestimating would push it outside the zone, which is not.
const ADVANCE_WIDTH_EM = 0.6

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Escapes text for an SVG text node. A surname is untrusted buyer input and
 *  must never be able to close a tag or an attribute. */
export function escapeSvgText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Largest font size that keeps `text` inside the zone, capped by the zone
 * height and by `maxFontSize` when the product sets one.
 */
export function fitFontSize(
  text: string,
  zone: { width: number; height: number },
  maxFontSize?: number
): number {
  const cap = isFiniteNumber(maxFontSize) && maxFontSize > 0 ? maxFontSize : zone.height
  const byWidth = text.length > 0
    ? zone.width / (ADVANCE_WIDTH_EM * text.length)
    : cap
  return Math.max(1, Math.min(cap, zone.height, byWidth))
}

/** Reads `product.metadata.personalization.zones`, dropping anything malformed. */
export function resolvePrintZones(product: { metadata?: unknown } | null | undefined): PrintZone[] {
  const block = isPlainObject(product?.metadata) ? (product!.metadata as any).personalization : null
  if (!isPlainObject(block)) return []
  const raw = (block as any).zones
  if (!Array.isArray(raw)) return []

  const zones: PrintZone[] = []
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue
    const field = entry.field
    if (typeof field !== 'string') continue
    if (!PERSONALIZATION_FIELD_ORDER.includes(field as PersonalizationFieldId)) continue
    const { x, y, width, height } = entry
    if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) continue
    if (width <= 0 || height <= 0) continue

    const zone: PrintZone = { field: field as PersonalizationFieldId, x, y, width, height }
    if (typeof entry.fontFamily === 'string' && entry.fontFamily.trim()) zone.fontFamily = entry.fontFamily.trim()
    if (typeof entry.color === 'string' && entry.color.trim()) zone.color = entry.color.trim()
    if (entry.align === 'left' || entry.align === 'center' || entry.align === 'right') zone.align = entry.align
    if (entry.uppercase === true) zone.uppercase = true
    if (isFiniteNumber(entry.maxFontSize) && entry.maxFontSize > 0) zone.maxFontSize = entry.maxFontSize
    zones.push(zone)
  }
  return zones
}

/** One `<text>` element, positioned and auto-fitted inside its zone. */
function zoneToSvg(zone: PrintZone, value: string): string {
  const display = zone.uppercase ? value.toUpperCase() : value
  const fontSize = fitFontSize(display, zone, zone.maxFontSize)

  const align = zone.align ?? 'center'
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'
  const x = align === 'left' ? zone.x : align === 'right' ? zone.x + zone.width : zone.x + zone.width / 2

  // Baseline computed explicitly rather than with dominant-baseline, whose
  // support varies between SVG rasterizers — this centres the same everywhere.
  const y = zone.y + zone.height / 2 + fontSize * 0.35

  return `<text x="${x}" y="${y}" font-family="${zone.fontFamily ?? DEFAULT_FONT_FAMILY}" `
    + `font-size="${fontSize}" font-weight="bold" fill="${zone.color ?? DEFAULT_COLOR}" `
    + `text-anchor="${anchor}" xml:space="preserve">${escapeSvgText(display)}</text>`
}

/**
 * Composites the buyer's values onto the base print file.
 *
 * Returns the base buffer UNCHANGED when there is nothing to draw, so a product
 * with an optional field the buyer skipped is not needlessly re-encoded.
 */
export async function renderPersonalizedPrint(
  base: Buffer,
  zones: PrintZone[],
  values: PersonalizationValues
): Promise<Buffer> {
  if (!zones.length) return base

  const meta = await sharp(base).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (!width || !height) {
    throw new PersonalizationRenderError('base print file has no readable dimensions')
  }

  // Bounds are checked for EVERY declared zone, not just the ones being drawn
  // this order, so a misconfigured product fails on its first personalized sale
  // instead of the first sale that happens to fill that field.
  for (const zone of zones) {
    if (zone.x < 0 || zone.y < 0 || zone.x + zone.width > width || zone.y + zone.height > height) {
      throw new PersonalizationRenderError(
        `personalization zone for "${zone.field}" (${zone.x},${zone.y} ${zone.width}x${zone.height}) `
        + `falls outside the ${width}x${height} print file`
      )
    }
  }

  const drawable = zones
    .map(zone => {
      const value = values[zone.field]
      return typeof value === 'string' && value.trim() ? { zone, value: value.trim() } : null
    })
    .filter((v): v is { zone: PrintZone; value: string } => v !== null)

  if (!drawable.length) return base

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + drawable.map(({ zone, value }) => zoneToSvg(zone, value)).join('')
    + '</svg>'

  return sharp(base)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer()
}

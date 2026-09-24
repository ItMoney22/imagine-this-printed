// Team plate — turning a fitted string into SVG.
//
// Everything here is markup generation, no rasterizing: sharp does that in
// render.ts. Two deliberate choices, both of which exist because the obvious
// version fails SILENTLY rather than loudly.
//
//   1. The outline stack is drawn as REPEATED COPIES of the same path, widest
//      stroke first, with the fill last. The obvious alternative is
//      `paint-order: stroke fill`, which is one attribute instead of four
//      elements — but librsvg's support for it is inconsistent, and an
//      ignored attribute does not throw. It ships letters with no outline at
//      all, which on this artwork means maroon text on a maroon-and-gold
//      background.
//
//   2. Stroke widths are DOUBLED. SVG centres a stroke on the path, so half of
//      a 26px stroke lands inside the glyph and is then covered by the fill
//      drawn over it. A 26px visual outline is a 52px stroke.
//
// There is also no <text> element anywhere in the output, by construction —
// see fonts.ts for why that matters on Render.
import type { TeamField } from '../../../shared/team-template.js'
import { archPlacements, fitToZone, widestNumberString } from './fit.js'
import { loadFont, measureWith, type LoadedFont } from './fonts.js'

/** Path data precision. Two decimals at 3600px is well under a printed dot. */
const PRECISION = 2

/** Trims float noise (148.07000000000002) out of the emitted markup. */
function round(n: number): number {
  return Number(n.toFixed(4))
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * The four drawing passes for one path, back to front.
 *
 * `d` is the glyph outline in final canvas coordinates; the caller has already
 * applied scale and placement, so this is pure styling.
 */
function paintPasses(d: string, field: TeamField): string {
  const out: string[] = []

  if (field.offset) {
    out.push(
      `<path data-pass="shadow" d="${d}" fill="${field.offset.color}" ` +
        `transform="translate(${field.offset.dx} ${field.offset.dy})"/>`
    )
  }

  field.strokes.forEach((stroke, i) => {
    out.push(
      `<path data-pass="stroke-${i}" d="${d}" fill="none" stroke="${stroke.color}" ` +
        `stroke-width="${round(stroke.w * 2)}" stroke-linejoin="round" stroke-linecap="round"/>`
    )
  })

  out.push(`<path data-pass="fill" d="${d}" fill="${field.fill}"/>`)
  return out.join('')
}

/**
 * Build the SVG fragment for one field's value.
 *
 * Returns null for an empty value — the caller skips the field entirely rather
 * than compositing a blank layer.
 */
export function buildFieldSvg(value: string, field: TeamField, font: LoadedFont): string | null {
  const text = value.trim()
  if (!text) return null

  const measure = measureWith(font)
  // Numbers are sized to what the field CAN hold, not to what was typed, so
  // every number on every order comes out at one height. Names are not: a long
  // surname really is set smaller on a real jersey. See fit.ts FitOptions.
  const reference = field.type === 'number' ? widestNumberString(field.max, measure) : undefined

  const fit = fitToZone(text, field.zone, measure, { arch: field.arch, reference })
  if (!fit) return null

  const places = archPlacements(text, field.arch, fit.width)
  const strokeScale = fit.scale

  // Glyph outlines come out of opentype in font units at a given size; asking
  // for `unitsPerEm` as the size keeps them in font units so one transform can
  // carry the scale. That keeps the emitted path data identical between a
  // 900px preview and a 3600px print file, differing only by the outer scale.
  const glyphs = font.stringToGlyphs(text)
  let penX = 0
  const parts: string[] = []

  if (field.arch === 0) {
    // Flat: one path for the whole string, one transform. No per-glyph groups.
    const d = font.getPath(text, 0, 0, font.unitsPerEm).toPathData(PRECISION)
    const inner = paintPasses(d, scaleStrokes(field, strokeScale))
    parts.push(
      `<g transform="translate(${fit.originX} ${fit.baselineY}) scale(${fit.scale})">${inner}</g>`
    )
  } else {
    glyphs.forEach((glyph, i) => {
      const place = places[i]
      const advance = glyph.advanceWidth ?? 0
      const centre = penX + advance / 2
      const d = glyph.getPath(0, 0, font.unitsPerEm).toPathData(PRECISION)
      const inner = paintPasses(d, scaleStrokes(field, strokeScale))
      // Rotate about the glyph's own centre so the letterform turns with the
      // arc instead of swinging around the string's origin.
      parts.push(
        `<g data-glyph="${i}" transform="translate(${fit.originX} ${fit.baselineY}) ` +
          `scale(${fit.scale}) translate(${centre} ${place.dy / fit.scale}) ` +
          `rotate(${place.rotation.toFixed(4)}) translate(${-centre} 0)">` +
          `<g transform="translate(${penX} 0)">${inner}</g></g>`
      )
      penX += advance
    })
  }

  return `<g data-field="${escapeAttr(field.key)}">${parts.join('')}</g>`
}

/**
 * Stroke widths are expressed in CANVAS px in the template, but the paths are
 * emitted in font units inside a scaled group — so the stroke has to be
 * divided by that scale or a 26px outline would come out scaled along with the
 * glyph and swamp the letter at large sizes.
 */
function scaleStrokes(field: TeamField, scale: number): TeamField {
  if (scale === 1) return field
  return {
    ...field,
    strokes: field.strokes.map((s) => ({ ...s, w: s.w / scale })),
    offset: field.offset
      ? { ...field.offset, dx: field.offset.dx / scale, dy: field.offset.dy / scale }
      : null,
  }
}

export interface LayerField {
  field: TeamField
  value: string
}

/**
 * Compose every field into one canvas-sized SVG document.
 *
 * Returns null when no field has a value — the caller then composites nothing
 * and the plate goes out bare, which is correct for a preview of an empty form.
 */
export async function buildLayerSvg(
  canvas: { w: number; h: number },
  fields: LayerField[],
  loader: (field: TeamField) => Promise<LoadedFont> = (field) => loadFont(field.font),
  /**
   * Output size in px. The viewBox stays in CANVAS units, so librsvg does the
   * scaling and nothing in the geometry ever has to know what resolution it is
   * being drawn at - which is what keeps a 900px preview and a 3600px press
   * file the same picture. Defaults to the canvas.
   */
  out?: { w: number; h: number }
): Promise<string | null> {
  const parts: string[] = []
  for (const { field, value } of fields) {
    if (!value || !value.trim()) continue
    const font = await loader(field)
    const fragment = buildFieldSvg(value, field, font)
    if (fragment) parts.push(fragment)
  }
  if (parts.length === 0) return null
  const width = out?.w ?? canvas.w
  const height = out?.h ?? canvas.h
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${canvas.w} ${canvas.h}">${parts.join('')}</svg>`
  )
}

// Team plate — the composite.
//
// ONE function draws both the live preview and the press file, at different
// widths. That identity is the whole guarantee of this feature: the customer
// approves a 900px render and receives a 3600px one produced by the same code
// off the same numbers, rather than an approximation of it.
//
// Deliberately NOT done here: halftoning. `template.halftone` is a property of
// the artwork, but applying it belongs to the print-file path only — David's
// rule is that customers must never see the halftoned file (it is for the team
// when pressing). A preview that ran it would put the screen dots on the
// product page. See print-prep.ts.
import sharp from 'sharp'
import type { TeamTemplate } from '../../../shared/team-template.js'
import { buildLayerSvg } from './svg.js'

export interface PlateSource {
  /** The artwork with the sample lettering erased, at any resolution. */
  plate: Buffer
  /** Grunge/halftone mask lifted off the original lettering, or null for clean text. */
  distress?: Buffer | null
}

export interface RenderOptions {
  /** Output width in px. Defaults to the template's full canvas (press resolution). */
  width?: number
}

/**
 * Draw `values` onto the template's plate.
 *
 * Returns a PNG buffer at `width` (default: full canvas). Fields with no value
 * are skipped; a call with no values at all returns the bare plate, which is
 * the correct preview for an empty form.
 */
export async function renderTeamPlate(
  template: TeamTemplate,
  values: Record<string, string>,
  source: PlateSource,
  opts: RenderOptions = {}
): Promise<Buffer> {
  const outWidth = Math.max(1, Math.round(opts.width ?? template.canvas.w))
  const outHeight = Math.max(1, Math.round((template.canvas.h / template.canvas.w) * outWidth))

  // The plate is resized to the output size first, so every later composite
  // shares one coordinate space.
  const plate = sharp(source.plate).resize(outWidth, outHeight, { fit: 'fill' })

  // The SVG carries a viewBox in CANVAS units and width/height in OUTPUT units,
  // so librsvg does the scaling. Nothing in the geometry above ever has to know
  // what resolution it is being drawn at — which is what keeps the preview and
  // the press file the same picture.
  const svg = await buildLayerSvg(
    template.canvas,
    template.fields.map((field) => ({ field, value: values[field.key] ?? '' })),
    undefined,
    { w: outWidth, h: outHeight }
  )

  if (!svg) {
    return plate.png().toBuffer()
  }

  let textLayer = await sharp(Buffer.from(svg)).png().toBuffer()

  if (source.distress) {
    // 'dest-in' keeps the text layer only where the mask is opaque, so the
    // scratches become HOLES and the shirt colour shows through them.
    //
    // 'multiply' — the obvious alternative — would merely darken the letters
    // and leave them solid, which is not what the original artwork does.
    const mask = await sharp(source.distress)
      .resize(outWidth, outHeight, { fit: 'fill' })
      .toBuffer()
    textLayer = await sharp(textLayer)
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer()
  }

  return plate.composite([{ input: textLayer, blend: 'over' }]).png().toBuffer()
}

// Deterministic garment mockups: the REAL print file placed on a blank, never
// redrawn.
//
// WHY THIS EXISTS (David, 2026-09-03, looking at a hoodie listing): "one image
// has color and the main image doesnt idk what model is doing the mockups but
// it needs to be changed". Measured against that product's own print file
// (blue-ink saturation 0.937), the on-model hero came back at 0.639 and the
// flux-2-pro shots at 0.78-0.85. An A/B of three models on the identical design
// and prompt landed at 0.850 (flux-2-pro), 0.877 (gpt-image-2) and 0.715
// (nano-banana-2-lite) — so no model choice fixes it. A generative mockup
// REDRAWS the artwork. The prompt already asks it to preserve "the artwork's
// exact colours, shapes, and proportions", and it still comes back
// reinterpreted: a different helmet, a different "23", drawstrings laid over
// the print.
//
// So don't ask a model to draw the design at all. Take a cut-out photo of the
// BLANK garment and paste the actual print file onto it. The artwork is exact
// by construction, because nothing ever regenerates it.
//
// The colour handling is lifted from scripts/render-blank-colors.ts, which
// already renders 165 blank-tee colours this way: a white garment keeps every
// fold and seam in its LUMINANCE, so multiplying it by a colour yields that
// exact colour with real shading. The same physics drives the print — the
// fabric's own light and shade modulates the ink, which is what makes a paste
// read as printed rather than stickered on.
//
// Costs nothing and runs in milliseconds. No model, no queue, no drift.

import sharp from 'sharp'

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export interface CompositeMockupOptions {
  /** RGBA cut-out of the blank garment, photographed WHITE (alpha = silhouette). */
  base: Buffer
  /** The transparent print file. */
  design: Buffer
  /** Garment colour as #rrggbb. White (or omitted) leaves the base untouched. */
  colorHex?: string
  /** Output square, px. */
  size?: number
  /** Print width as a fraction of the GARMENT's width (~11in across a ~20in chest). */
  printWidth?: number
  /** Top of the print box, as a fraction of the garment's height below its top. */
  printTop?: number
  /** Backdrop colour. */
  ground?: string
  /**
   * How hard the fabric's folds modulate the ink, 0-1. The whole point of
   * compositing is a literal colour, so this is deliberately gentle: the
   * shading is clamped to +/-25% and then scaled by this, which keeps measured
   * ink saturation within a few points of the print file where the generative
   * renders lost 15-30%.
   */
  foldStrength?: number
}

export interface CompositeMockupResult {
  buffer: Buffer
  /** Where the artwork landed, in output pixels — recorded so a bad placement
   *  is inspectable after the fact instead of being a mystery. */
  printBox: Box
  /** The garment silhouette the placement was derived from. */
  garmentBox: Box
}

/**
 * Where the print sits, per garment, as fractions of the GARMENT's own box.
 *
 * A hoodie is not a tee with a hood bolted on: the hood eats the top of the
 * chest, so a tee's placement rides up into it. Measured by rendering the
 * ladder and looking — 0.24/0.42 buried the artwork under the hood, 0.33/0.50
 * sits it on the chest clear of both the hood and the pocket.
 */
export const PRINT_PLACEMENT: Record<string, { printTop: number; printWidth: number }> = {
  tshirt: { printTop: 0.26, printWidth: 0.46 },
  'youth-tshirt': { printTop: 0.26, printWidth: 0.46 },
  tank: { printTop: 0.24, printWidth: 0.40 },
  hoodie: { printTop: 0.33, printWidth: 0.50 },
  sweatshirt: { printTop: 0.30, printWidth: 0.50 },
}

export function placementFor(garment?: string): { printTop: number; printWidth: number } {
  return PRINT_PLACEMENT[String(garment ?? 'tshirt')] ?? PRINT_PLACEMENT.tshirt
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * The garment's own bounding box, taken from the cut-out's alpha.
 *
 * Placement has to be relative to the GARMENT, not to the frame: the same base
 * fitted into a different output size, or a blank shot with more headroom,
 * would otherwise slide the print up and down the chest.
 */
export function garmentBoxFromAlpha(rgba: Buffer, width: number, height: number, channels: number): Box {
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * channels + 3] < 24) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return { left: 0, top: 0, width, height }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/** Multiply a white cut-out by a colour: exact hex, real folds. */
function tint(rgba: Buffer, channels: number, rgb: [number, number, number]): Buffer {
  const out = Buffer.from(rgba)
  const fr = rgb[0] / 255, fg = rgb[1] / 255, fb = rgb[2] / 255
  for (let i = 0; i < out.length; i += channels) {
    if (out[i + 3] === 0) continue
    out[i] = Math.round(out[i] * fr)
    out[i + 1] = Math.round(out[i + 1] * fg)
    out[i + 2] = Math.round(out[i + 2] * fb)
  }
  return out
}

export async function compositeMockup(opts: CompositeMockupOptions): Promise<CompositeMockupResult> {
  const size = opts.size ?? 1024
  const ground = opts.ground ?? '#f2f2f4'
  const printWidth = opts.printWidth ?? 0.46
  const printTop = opts.printTop ?? 0.26
  const foldStrength = Math.max(0, Math.min(1, opts.foldStrength ?? 0.6))

  // Fit the cut-out into the frame with breathing room, exactly as the blank
  // colour renderer does, so composited mockups and blank listings frame alike.
  const fitted = await sharp(opts.base)
    .ensureAlpha()
    .trim({ threshold: 8 })
    .resize(Math.round(size * 0.84), Math.round(size * 0.84), { fit: 'inside' })
    .png()
    .toBuffer()
  const { data, info } = await sharp(fitted).raw().toBuffer({ resolveWithObject: true })
  const ch = info.channels

  const garment = garmentBoxFromAlpha(data, info.width, info.height, ch)
  const coloured = opts.colorHex && opts.colorHex.toLowerCase() !== '#ffffff'
    ? tint(data, ch, hexToRgb(opts.colorHex))
    : data
  const garmentPng = await sharp(coloured, { raw: { width: info.width, height: info.height, channels: ch as 4 } })
    .png()
    .toBuffer()

  // Print box, measured off the garment rather than the frame.
  const boxW = Math.max(1, Math.round(garment.width * printWidth))
  const art = await sharp(opts.design).trim().resize(boxW, boxW, { fit: 'inside' }).ensureAlpha().png().toBuffer()
  const am = await sharp(art).metadata()
  const aw = am.width!, ah = am.height!
  const boxL = Math.round(garment.left + (garment.width - aw) / 2)
  const boxT = Math.round(garment.top + garment.height * printTop)

  // The fabric under the print, blurred down to folds rather than weave grain.
  const fabric = await sharp(garmentPng)
    .extract({ left: boxL, top: boxT, width: aw, height: ah })
    .greyscale()
    .blur(4)
    .raw()
    .toBuffer()
  let sum = 0
  for (const v of fabric) sum += v
  const mean = sum / fabric.length || 1

  // Alpha is carried across by hand. sharp's `multiply` blend flattens it and
  // paints a white rectangle around the artwork — which is exactly what the
  // first attempt at this produced.
  const artRaw = await sharp(art).ensureAlpha().raw().toBuffer()
  const inked = Buffer.alloc(aw * ah * 4)
  for (let p = 0; p < aw * ah; p++) {
    const i = p * 4
    const k = 1 + Math.max(-0.25, Math.min(0.25, (fabric[p] - mean) / mean)) * foldStrength
    inked[i] = Math.max(0, Math.min(255, Math.round(artRaw[i] * k)))
    inked[i + 1] = Math.max(0, Math.min(255, Math.round(artRaw[i + 1] * k)))
    inked[i + 2] = Math.max(0, Math.min(255, Math.round(artRaw[i + 2] * k)))
    inked[i + 3] = artRaw[i + 3]
  }
  const printed = await sharp(inked, { raw: { width: aw, height: ah, channels: 4 } }).png().toBuffer()

  // Soft grounding shadow from the silhouette, same as the blank renderer.
  const shadowAlpha = await sharp(fitted).extractChannel(3).blur(18).linear(0.35, 0).toBuffer()
  const shadow = await sharp({
    create: { width: info.width, height: info.height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .joinChannel(shadowAlpha)
    .png()
    .toBuffer()

  const left = Math.round((size - info.width) / 2)
  const top = Math.round((size - info.height) / 2)
  const buffer = await sharp({ create: { width: size, height: size, channels: 3, background: ground } })
    .composite([
      { input: shadow, left, top: top + 14 },
      { input: garmentPng, left, top },
      { input: printed, left: left + boxL, top: top + boxT },
    ])
    .png()
    .toBuffer()

  return {
    buffer,
    printBox: { left: left + boxL, top: top + boxT, width: aw, height: ah },
    garmentBox: { left: left + garment.left, top: top + garment.top, width: garment.width, height: garment.height },
  }
}

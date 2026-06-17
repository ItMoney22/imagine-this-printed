// Solid-background knockout for DTF designs.
//
// Our designs are generated on a SOLID shirt-color background (black or white),
// so the right way to isolate the artwork is a COLOR/LUMA KEY of that exact
// background color — not AI subject segmentation (which leaves a dark halo and
// doesn't knock out all the black, per David's report). Sharp has no built-in
// keyer, so we walk the raw RGBA buffer: distance-from-bg-color + a soft alpha
// ramp gives a clean, anti-aliased cutout (standard chroma-key technique).

import sharp from 'sharp'

export type SolidBg = 'black' | 'white'

/** Fraction of pixels (0–1) that are already transparent (downsampled scan). */
export async function transparentFraction(input: Buffer): Promise<number> {
  try {
    const { data, info } = await sharp(input)
      .ensureAlpha()
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (info.channels !== 4) return 0
    const total = info.width * info.height
    if (!total) return 0
    let transparent = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] < 16) transparent++
    return transparent / total
  } catch {
    return 0
  }
}

/**
 * Detect a near-solid black or white background by sampling the image border.
 * Returns null when the border isn't a uniform black/white field (e.g. a photo
 * or a busy edge) — caller should fall back to AI segmentation then.
 */
export async function detectSolidBg(input: Buffer): Promise<SolidBg | null> {
  try {
    const { data, info } = await sharp(input)
      .ensureAlpha()
      .resize(96, 96, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true })
    const { width, height } = info
    const lumas: number[] = []
    const push = (x: number, y: number) => {
      const i = (y * width + x) * 4
      if (data[i + 3] < 16) return // ignore already-transparent border
      lumas.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
    }
    for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1) }
    for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y) }
    if (lumas.length < 24) return null
    const avg = lumas.reduce((a, b) => a + b, 0) / lumas.length
    const std = Math.sqrt(lumas.reduce((a, b) => a + (b - avg) ** 2, 0) / lumas.length)
    if (std > 45) return null // border isn't uniform → not a solid bg
    if (avg < 50) return 'black'
    if (avg > 205) return 'white'
    return null
  } catch {
    return null
  }
}

/**
 * Knock out a solid black/white background to transparency with a soft,
 * anti-aliased edge. `lo`/`hi` define the alpha ramp on "distance from the bg
 * color": <= lo is pure background (alpha 0), >= hi is solid artwork (kept),
 * the band between ramps for a clean edge. Defaults preserve real art colors
 * (e.g. navy shading) while removing the black/white field.
 */
export async function keyOutSolidBackground(
  input: Buffer,
  bg: SolidBg,
  opts: { lo?: number; hi?: number } = {}
): Promise<Buffer> {
  const lo = opts.lo ?? 12
  const hi = opts.hi ?? 56
  const span = Math.max(1, hi - lo)
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const ch = info.channels
  for (let i = 0; i < data.length; i += ch) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    // Distance from the background color: 0 == exactly the bg.
    const key = bg === 'black' ? Math.max(r, g, b) : 255 - Math.min(r, g, b)
    let aMul: number
    if (key <= lo) aMul = 0
    else if (key >= hi) aMul = 1
    else aMul = (key - lo) / span
    data[i + 3] = Math.round(data[i + 3] * aMul)
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: ch } })
    .png()
    .toBuffer()
}

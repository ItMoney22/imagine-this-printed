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

/** Distance-from-background for one pixel: 0 == exactly the background colour. */
function bgKey(r: number, g: number, b: number, bg: SolidBg): number {
  return bg === 'black' ? Math.max(r, g, b) : 255 - Math.min(r, g, b)
}

/**
 * Knock out a solid background using CONNECTIVITY, not just colour.
 *
 * `keyOutSolidBackground` above keys on colour alone, which cannot tell a black
 * BACKGROUND from black ARTWORK. On the Stoic Samurai design (generated on solid
 * black) it ghosted 71% of the dark artwork — the samurai's hair came out white
 * and his navy armour washed out — because those pixels are as close to black as
 * the background is.
 *
 * The background is not "everything dark", it is "the dark region CONNECTED TO
 * THE BORDER". So:
 *   1. Flood-fill inward from the image border through near-background pixels.
 *      Dark artwork enclosed by lighter artwork (hair inside a head) is never
 *      reached, so it keeps full alpha.
 *   2. Enclosed pockets are background too when their mean ink matches the
 *      measured border background — a hole inside a branch is the same ink as
 *      the field around it (0.61 vs a 0.44 border mean on the samurai), while
 *      hair pockets sit well above it (4.4-9.0). `purityMargin` is that
 *      tolerance; at +3 the samurai loses 8px of hair and every branch hole.
 *   3. Only pixels judged background get the soft alpha ramp, so edges stay
 *      anti-aliased.
 *
 * Crucially this is per-pixel, not per-subject: disconnected decorative art (the
 * cherry-blossom branch, the falling petals) survives, which is exactly what AI
 * subject segmentation destroys.
 *
 * `candidate` is the "could be background" cutoff used for the fill. Keep it
 * tight — at the old hi of 56 the fill leaked through the dark navy robe.
 */
export async function keyOutConnectedBackground(
  input: Buffer,
  bg: SolidBg,
  opts: { lo?: number; hi?: number; candidate?: number; purityMargin?: number } = {}
): Promise<Buffer> {
  const lo = opts.lo ?? 2
  const hi = opts.hi ?? 16
  const candidate = opts.candidate ?? Math.max(hi, 16)
  const purityMargin = opts.purityMargin ?? 3
  const span = Math.max(1, hi - lo)

  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = info
  const ch = info.channels
  const n = W * H

  const isCandidate = new Uint8Array(n)
  for (let p = 0; p < n; p++) {
    const i = p * ch
    if (bgKey(data[i], data[i + 1], data[i + 2], bg) <= candidate) isCandidate[p] = 1
  }

  // 1. Flood-fill from every border pixel that could be background.
  const isBg = new Uint8Array(n)
  const stack = new Int32Array(n)
  let sp = 0
  const push = (p: number) => { if (!isBg[p] && isCandidate[p]) { isBg[p] = 1; stack[sp++] = p } }
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x) }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1) }
  while (sp > 0) {
    const p = stack[--sp]
    const x = p % W, y = (p / W) | 0
    if (x > 0) push(p - 1)
    if (x < W - 1) push(p + 1)
    if (y > 0) push(p - W)
    if (y < H - 1) push(p + W)
  }

  // The border background's own mean ink — the reference every pocket is judged against.
  let borderSum = 0, borderCount = 0
  for (let p = 0; p < n; p++) {
    if (!isBg[p]) continue
    const i = p * ch
    borderSum += bgKey(data[i], data[i + 1], data[i + 2], bg)
    borderCount++
  }
  // Nothing reachable => the border isn't background after all; leave the image alone
  // rather than punch holes in it. (detectSolidBg normally prevents this.)
  if (!borderCount) return sharp(data, { raw: { width: W, height: H, channels: ch } }).png().toBuffer()
  const purityCutoff = borderSum / borderCount + purityMargin

  // 2. Enclosed pockets made of the same ink as the background are background.
  const compId = new Int32Array(n).fill(-1)
  const compIsBg: boolean[] = []
  for (let seed = 0; seed < n; seed++) {
    if (!isCandidate[seed] || isBg[seed] || compId[seed] !== -1) continue
    const id = compIsBg.length
    let size = 0, sum = 0
    sp = 0
    compId[seed] = id
    stack[sp++] = seed
    while (sp > 0) {
      const p = stack[--sp]
      const i = p * ch
      size++
      sum += bgKey(data[i], data[i + 1], data[i + 2], bg)
      const x = p % W, y = (p / W) | 0
      const neighbours = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]
      for (const q of neighbours) {
        if (q >= 0 && isCandidate[q] && !isBg[q] && compId[q] === -1) { compId[q] = id; stack[sp++] = q }
      }
    }
    compIsBg.push(sum / size <= purityCutoff)
  }

  // 3. Ramp alpha on background pixels only; artwork keeps the alpha it had.
  for (let p = 0; p < n; p++) {
    const id = compId[p]
    const background = isBg[p] === 1 || (id !== -1 && compIsBg[id])
    if (!background) continue
    const i = p * ch
    const k = bgKey(data[i], data[i + 1], data[i + 2], bg)
    const aMul = k <= lo ? 0 : k >= hi ? 1 : (k - lo) / span
    data[i + 3] = Math.round(data[i + 3] * aMul)
  }

  return sharp(data, { raw: { width: W, height: H, channels: ch } }).png().toBuffer()
}

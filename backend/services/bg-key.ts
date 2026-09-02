// Solid-background knockout for DTF designs.
//
// Our designs are generated on a SOLID shirt-color background (black or white),
// so the right way to isolate the artwork is a COLOR/LUMA KEY of that exact
// background color — not AI subject segmentation (which leaves a dark halo and
// doesn't knock out all the black, per David's report). Sharp has no built-in
// keyer, so we walk the raw RGBA buffer: distance-from-bg-color + a soft alpha
// ramp gives a clean, anti-aliased cutout (standard chroma-key technique).

import sharp from 'sharp'
import {
  borderPatternOf,
  CHECKER_MIN_SEPARATION,
  CHECKER_MAX_SPREAD,
  CHECKER_MIN_LUMA,
  CHECKER_MIN_ALTERNATIONS,
} from './image-metrics.js'

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
 * Is the border a PAINTED checkerboard — fake transparency baked into the
 * pixels, which several of our generated sources carry?
 *
 * It has to be asked at native resolution. Downsampling a fine checker averages
 * its two tones into one flat mid-grey, so the border reads as a perfectly solid
 * light field and a colour key gets chosen — but at full size the key removes
 * only the white squares and leaves the grey ones, printing the checkerboard
 * onto the garment. A key cannot clean this source at all, so it is not a solid
 * background as far as this module is concerned.
 *
 * Reuses the QA gate's own detector (`borderPatternOf` + its thresholds) rather
 * than growing a second opinion about what a checkerboard is.
 */
async function borderIsPaintedCheckerboard(input: Buffer): Promise<boolean> {
  try {
    const meta = await sharp(input).metadata()
    const W = meta.width ?? 0, H = meta.height ?? 0
    if (W < 16 || H < 16) return false
    // Flatten onto white BEFORE greyscale: on an RGBA source .greyscale() keeps
    // the alpha channel and .raw() then emits two bytes per pixel, which reads a
    // genuinely transparent border as a 235/248 checker. Flattening also means
    // real transparency is uniform here, so only PAINTED patterns survive.
    const line = async (left: number, top: number, width: number, height: number) => {
      const b = await sharp(input).extract({ left, top, width, height })
        .flatten({ background: '#ffffff' }).greyscale().raw().toBuffer()
      return b.length === width * height ? [...b] : null
    }
    const edges = await Promise.all([
      line(0, 1, W, 1), line(0, H - 2, W, 1), line(1, 0, 1, H), line(W - 2, 0, 1, H),
    ])
    for (const e of edges) {
      if (!e) continue
      // Artwork touching an edge mid-line drags the two-cluster split onto
      // art-vs-background and hides the pattern, so the corner eighths - almost
      // always pure background - get looked at on their own too.
      const eighth = Math.floor(e.length / 8)
      const candidates = eighth >= 8 ? [e, e.slice(0, eighth), e.slice(-eighth)] : [e]
      for (const c of candidates) {
        const bp = borderPatternOf(c)
        if (bp && bp.separation >= CHECKER_MIN_SEPARATION && bp.spread <= CHECKER_MAX_SPREAD &&
            bp.clusterLow >= CHECKER_MIN_LUMA && bp.alternations >= CHECKER_MIN_ALTERNATIONS) return true
      }
    }
    return false
  } catch {
    return false
  }
}

/**
 * Detect a near-solid black or white background by sampling the image border.
 * Returns null when the border isn't a uniform black/white field (e.g. a photo
 * or a busy edge) — caller should fall back to AI segmentation then.
 *
 * This gate decides WHICH TOOL RUNS, so getting it wrong is expensive: a null
 * here sends the design to AI subject segmentation, which deletes any artwork
 * detached from the main subject.
 *
 * It cannot be judged on the border's mean and standard deviation, which is how
 * the Gnome Abduction design lost its left speech bubble. Artwork routinely runs
 * off the edge of the frame — there, a lime tractor beam and the sparkles around
 * it cross the bottom edge. That is 11.7% of the border ring at luma ~172 on a
 * field whose median is 0.4, which drags the mean to 19 and the deviation to
 * 48.9, just past the old std > 45 rejection. The field is as flat as a field
 * gets; only the bleed-through art is not. So the measurement has to be robust
 * to that art the same way `keyOutConnectedBackground` already is:
 *
 *   1. The MEDIAN is the field's level (bleed-through art is the distribution's
 *      tail, and a median ignores tails).
 *   2. The field must OWN the border — at least half of the ring sits within
 *      `FIELD_TOL` of that level. Art may bleed, it just cannot be most of the
 *      edge.
 *   3. Those field pixels must be FLAT. This is what separates a real field
 *      from a photograph: measured across the live catalogue, genuine solid
 *      fields spread 0.1-9.6 while photographic borders (a misty lake, a desert
 *      sunset, a forest silhouette) spread 14.6-24.9. Nothing lands in between,
 *      so the cutoff sits in that gap.
 */
export async function detectSolidBg(input: Buffer): Promise<SolidBg | null> {
  /** How far off the field's own level a pixel can sit and still be field. */
  const FIELD_TOL = 40
  /** The field has to be most of the border, not a flat corner of it. */
  const MIN_FIELD_SHARE = 0.5
  /** Flatness of the field itself. 12 is the empty gap between our designs
   *  (<= 9.6) and photographic borders (>= 14.6) across the live catalogue. */
  const MAX_FIELD_SPREAD = 12

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

    const sorted = [...lumas].sort((a, b) => a - b)
    const level = sorted[sorted.length >> 1]
    const field: SolidBg | null = level < 50 ? 'black' : level > 205 ? 'white' : null
    if (!field) return null

    const onField = lumas.filter((l) => Math.abs(l - level) <= FIELD_TOL)
    if (onField.length / lumas.length < MIN_FIELD_SHARE) return null

    const avg = onField.reduce((a, b) => a + b, 0) / onField.length
    const spread = Math.sqrt(onField.reduce((a, b) => a + (b - avg) ** 2, 0) / onField.length)
    if (spread > MAX_FIELD_SPREAD) return null

    // Everything above is measured on a 96px sample, which is what makes it
    // robust to art bleeding off the frame - and also what makes it blind to a
    // painted checkerboard. Ask the question the sample cannot answer.
    if (await borderIsPaintedCheckerboard(input)) return null

    return field
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
 * All three thresholds are measured RELATIVE to the background's own ink level,
 * which is sampled from the border ring first. They cannot be absolute: the
 * Aqua Sprinter Cheetah design sits on a black field that is actually ~12/255,
 * and against a fixed ramp of 2..16 those pixels scored 71% opaque, so the
 * "removed" background came out dark grey. Offsetting from the measured level
 * keys that field to zero while leaving a near-pure-black field (the samurai's,
 * at 0.4) behaving exactly as before.
 *
 * `candidate` is the "could be background" offset used for the fill. Keep it
 * tight — at the old hi of 56 the fill leaked through the dark navy robe.
 */
export async function keyOutConnectedBackground(
  input: Buffer,
  bg: SolidBg,
  /** All offsets ABOVE the background's measured ink level, not absolute values. */
  opts: { lo?: number; hi?: number; candidate?: number; purityMargin?: number } = {}
): Promise<Buffer> {
  const purityMargin = opts.purityMargin ?? 3

  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = info
  const ch = info.channels
  const n = W * H

  // How far off the pure background colour this image's field actually sits.
  // Every threshold below is an offset from here, not an absolute value.
  //
  // MEDIAN, not mean: artwork frequently runs off the edge of the frame (the
  // samurai's blossom branch does), and those bright border pixels drag a mean
  // far above the real field - his border averages 8.3 while its 5th through
  // 75th percentiles are all 0. Keying off that inflated number erased his
  // hair. The median ignores the tail and reads 0 for him and 12 for the Aqua
  // Sprinter Cheetah, which is exactly what each one needs.
  const ringKeys: number[] = []
  const sampleRing = (x: number, y: number) => {
    const i = (y * W + x) * ch
    if (data[i + 3] < 16) return
    ringKeys.push(bgKey(data[i], data[i + 1], data[i + 2], bg))
  }
  for (let x = 0; x < W; x++) { sampleRing(x, 0); sampleRing(x, H - 1) }
  for (let y = 0; y < H; y++) { sampleRing(0, y); sampleRing(W - 1, y) }
  ringKeys.sort((a, b) => a - b)
  const median = ringKeys.length ? ringKeys[ringKeys.length >> 1] : 0
  // Bounded on purpose. Adapting to ANY border colour would let a full-bleed
  // image (uniform border, but the border IS artwork) drag the thresholds up to
  // its own ink level and erase the whole picture. 60 is the same tolerance
  // detectSolidBg uses to call a field black or white in the first place, so
  // anything past it is not a background this keyer should be touching.
  const MAX_BASE = 60
  const base = Math.min(median, MAX_BASE)

  const lo = base + (opts.lo ?? 2)
  const hi = base + (opts.hi ?? 16)
  const candidate = base + (opts.candidate ?? 16)
  const span = Math.max(1, hi - lo)

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

/**
 * Put the line work an AI segmentation mask is confident about back INSIDE a
 * colour-keyed cut, without letting it touch the cut's outline.
 *
 * The two tools fail in opposite directions. A colour key judges every pixel on
 * its own, so it keeps artwork that floats free of the subject — but it cannot
 * keep black line work drawn on a black field, because that ink IS the
 * background colour and it drains out through the same connected black:
 * outlines, hatching, shadow bands. On the Gnome Abduction design that cost
 * 39,759 px — the saucer's shadow bands, the gnome's outlines, the streaks
 * inside the tractor beam — while segmentation kept every one of them and threw
 * away the speech bubble instead. No local signal separates that ink from the
 * field (it is the same colour); only the shape of the whole subject does, which
 * is the one thing segmentation is genuinely good at.
 *
 * So take each tool's strength and nothing else:
 *   - the KEY owns the silhouette and the alpha ramp on it,
 *   - the MASK may only fill in ink ENCLOSED by that silhouette — artwork above,
 *     below, left and right of the pixel.
 *
 * That enclosure rule is what makes this safe. A segmenter's soft boundary
 * smears background into the subject, and a plain union of the two alphas would
 * take that at face value and print it as the dark halo this module was written
 * to get rid of. A halo pixel sits OUTSIDE the artwork — open field on at least
 * one side — so it can never satisfy the test, while ink inside the drawing
 * always does. `minMaskAlpha` drops the mask's soft edge for the same reason.
 *
 * Returns the fraction of the image the mask restored, which is worth logging:
 * it is zero on the flat-colour designs the key already handles alone.
 */
export async function restoreEnclosedInk(
  keyed: Buffer,
  mask: Buffer,
  minMaskAlpha = 200
): Promise<{ buffer: Buffer; restored: number }> {
  const cut = await sharp(keyed).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H } = cut.info
  const n = W * H
  const m = await sharp(mask).ensureAlpha().resize(W, H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })

  const isArt = new Uint8Array(n)
  for (let p = 0; p < n; p++) if (cut.data[p * 4 + 3] > 200) isArt[p] = 1

  // Is there artwork somewhere to the left / right / above / below this pixel?
  const left = new Uint8Array(n), right = new Uint8Array(n), up = new Uint8Array(n), down = new Uint8Array(n)
  for (let y = 0; y < H; y++) {
    let seen = 0
    for (let x = 0; x < W; x++) { const p = y * W + x; left[p] = seen; if (isArt[p]) seen = 1 }
    seen = 0
    for (let x = W - 1; x >= 0; x--) { const p = y * W + x; right[p] = seen; if (isArt[p]) seen = 1 }
  }
  for (let x = 0; x < W; x++) {
    let seen = 0
    for (let y = 0; y < H; y++) { const p = y * W + x; up[p] = seen; if (isArt[p]) seen = 1 }
    seen = 0
    for (let y = H - 1; y >= 0; y--) { const p = y * W + x; down[p] = seen; if (isArt[p]) seen = 1 }
  }

  let restored = 0
  for (let p = 0; p < n; p++) {
    const i = p * 4
    const ma = m.data[i + 3]
    if (ma < minMaskAlpha || ma <= cut.data[i + 3]) continue
    if (!(left[p] && right[p] && up[p] && down[p])) continue
    cut.data[i + 3] = ma
    restored++
  }

  return {
    buffer: await sharp(cut.data, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer(),
    restored: restored / n,
  }
}

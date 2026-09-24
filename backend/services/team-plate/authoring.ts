// Team plate — deriving a template from artwork that already exists.
//
// The operator drops in a back design that has a sample name and number on it
// (David's "BEAR 9"). Everything below is a machine GUESS the operator then
// corrects on screen — none of it has to be perfect, it has to be close enough
// that nobody is dragging boxes from scratch.
//
// THE IDEA WORTH KEEPING: once the sample lettering has been erased, we hold
// both the original and the clean plate, so **the pixels that changed are the
// lettering**. That one diff gives us three things for free:
//
//   - the zones (connected components of the changed region),
//   - the distress mask (the changed region's own alpha — the scratches are
//     lifted off the real BEAR rather than faked from a texture library), and
//   - the colours (sampled from inside the changed region).
//
// Nothing here calls an image model except erasePlate.
import sharp from 'sharp'
import { editOpenAIImage } from '../image-flow/providers/openai-image.js'
import type { Stroke, Zone } from '../../shared/team-template.js'

/** Below this share of the canvas a changed blob is upscale noise, not a letter. */
const MIN_COMPONENT_AREA_SHARE = 0.0008
/** Channel distance (0-255) above which a pixel counts as "changed". */
const DIFF_THRESHOLD = 28
/** Working resolution for component finding. Full res is pointless and slow. */
const ANALYSIS_WIDTH = 600

export const ERASE_PROMPT = [
  'Remove the large name text and the large number from this artwork completely,',
  'so that only the background artwork remains.',
  'Fill the space they occupied by continuing the surrounding texture — the paint splatter,',
  'the halftone dots, the brush strokes and the background colours — so there is no trace,',
  'ghost, outline or blurred patch where the text used to be.',
  'Change NOTHING else: keep every other element, the mascot, the colours, the composition',
  'and the framing exactly as they are.',
].join(' ')

/**
 * Erase the sample lettering to leave a clean plate.
 *
 * This is the ONE place an image model is allowed near this feature, and it is
 * allowed here for a specific reason: the model returns ~1024-1536px and the
 * plate has to reach 3600x4800, but a plate is SPLATTER AND HALFTONE, not
 * letterforms. Texture survives a 3x upscale; a "9" does not. That asymmetry is
 * the entire argument (see the design doc) for keeping the AI at authoring time
 * and out of the per-order path.
 *
 * The operator can always upload a clean plate instead — and should, when the
 * layered source file exists, because hiding two layers beats any erase.
 */
export async function erasePlate(
  sourceUrl: string,
  canvas: { w: number; h: number },
  opts: { userId?: string } = {}
): Promise<{ buffer: Buffer; modelId: string }> {
  const ratio = canvas.w / canvas.h
  const size = ratio > 1.15 ? '1536x1024' : ratio < 0.87 ? '1024x1536' : '1024x1024'

  const result = await editOpenAIImage({
    sourceUrl,
    prompt: ERASE_PROMPT,
    size: size as '1024x1024' | '1024x1536' | '1536x1024',
    quality: 'high',
    userId: opts.userId,
  })

  const res = await fetch(result.url)
  if (!res.ok) throw new Error(`Could not fetch erased plate (${res.status})`)
  const raw = Buffer.from(await res.arrayBuffer())

  const buffer = await sharp(raw)
    .resize(canvas.w, canvas.h, { fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toBuffer()

  return { buffer, modelId: result.modelId }
}

export interface DerivedTemplate {
  /** Candidate zones in CANVAS coordinates, ordered top to bottom. */
  zones: Zone[]
  /** Full-canvas greyscale-alpha PNG: opaque where the original had ink. */
  distress: Buffer
}

/**
 * Diff the original against the erased plate and read the lettering out of it.
 *
 * Zones come back ordered TOP TO BOTTOM rather than by size, because that is
 * how the operator reads the artwork: the name is above the number. Sorting by
 * area would put them in a different order on a shirt with a small name and a
 * huge number, which is most of them.
 */
export async function deriveZonesAndDistress(
  original: Buffer,
  plate: Buffer,
  canvas: { w: number; h: number }
): Promise<DerivedTemplate> {
  const height = Math.max(1, Math.round((canvas.h / canvas.w) * ANALYSIS_WIDTH))

  const [a, b] = await Promise.all([
    sharp(original).resize(ANALYSIS_WIDTH, height, { fit: 'fill' }).removeAlpha().raw().toBuffer(),
    sharp(plate).resize(ANALYSIS_WIDTH, height, { fit: 'fill' }).removeAlpha().raw().toBuffer(),
  ])

  // Per-pixel difference magnitude, 0..255.
  const diff = new Uint8Array(ANALYSIS_WIDTH * height)
  for (let i = 0, p = 0; i < diff.length; i++, p += 3) {
    const d = Math.max(
      Math.abs(a[p] - b[p]),
      Math.abs(a[p + 1] - b[p + 1]),
      Math.abs(a[p + 2] - b[p + 2])
    )
    diff[i] = d
  }

  const zones = componentZones(diff, ANALYSIS_WIDTH, height, canvas)

  // The distress mask IS the diff, as alpha: opaque where the original had
  // solid ink, transparent where a scratch let the background through (there
  // the original already equalled the plate, so the diff is ~0). Fed to
  // render.ts with blend 'dest-in', that punches the original's own scratches
  // through the new lettering.
  const distress = await sharp(Buffer.from(diff), {
    raw: { width: ANALYSIS_WIDTH, height, channels: 1 },
  })
    .resize(canvas.w, canvas.h, { fit: 'fill' })
    .toColourspace('b-w')
    .png()
    .toBuffer()

  return { zones, distress }
}

/** Iterative flood fill over the thresholded diff; returns bounding boxes in canvas space. */
function componentZones(
  diff: Uint8Array,
  width: number,
  height: number,
  canvas: { w: number; h: number }
): Zone[] {
  const seen = new Uint8Array(diff.length)
  const minArea = Math.max(8, Math.round(width * height * MIN_COMPONENT_AREA_SHARE))
  const boxes: Array<{ x0: number; y0: number; x1: number; y1: number; area: number }> = []
  const stack: number[] = []

  for (let start = 0; start < diff.length; start++) {
    if (seen[start] || diff[start] < DIFF_THRESHOLD) continue
    let x0 = width
    let y0 = height
    let x1 = -1
    let y1 = -1
    let area = 0

    stack.push(start)
    seen[start] = 1
    while (stack.length > 0) {
      const idx = stack.pop() as number
      const x = idx % width
      const y = (idx - x) / width
      area++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y

      // 8-connected: letters in a distressed face are often only diagonally
      // joined once the scratches have eaten through them, and 4-connectivity
      // would split one word into a dozen fragments.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const nIdx = ny * width + nx
          if (seen[nIdx] || diff[nIdx] < DIFF_THRESHOLD) continue
          seen[nIdx] = 1
          stack.push(nIdx)
        }
      }
    }

    if (area >= minArea) boxes.push({ x0, y0, x1, y1, area })
  }

  // Merge boxes that overlap horizontally and sit on the same band — the
  // letters of one word arrive as separate components and belong to one zone.
  const merged = mergeBands(boxes)

  const kx = canvas.w / width
  const ky = canvas.h / height
  return merged
    .sort((p, q) => p.y0 - q.y0)
    .map((box) => ({
      x: Math.max(0, Math.round(box.x0 * kx)),
      y: Math.max(0, Math.round(box.y0 * ky)),
      w: Math.min(canvas.w, Math.round((box.x1 - box.x0 + 1) * kx)),
      h: Math.min(canvas.h, Math.round((box.y1 - box.y0 + 1) * ky)),
    }))
}

type Box = { x0: number; y0: number; x1: number; y1: number; area: number }

/** Union boxes whose vertical spans overlap — one line of text is one zone. */
function mergeBands(boxes: Box[]): Box[] {
  const out: Box[] = []
  for (const box of [...boxes].sort((p, q) => p.y0 - q.y0)) {
    const host = out.find((o) => verticalOverlap(o, box) > 0.35)
    if (host) {
      host.x0 = Math.min(host.x0, box.x0)
      host.y0 = Math.min(host.y0, box.y0)
      host.x1 = Math.max(host.x1, box.x1)
      host.y1 = Math.max(host.y1, box.y1)
      host.area += box.area
    } else {
      out.push({ ...box })
    }
  }
  return out
}

function verticalOverlap(p: Box, q: Box): number {
  const top = Math.max(p.y0, q.y0)
  const bottom = Math.min(p.y1, q.y1)
  const overlap = bottom - top
  if (overlap <= 0) return 0
  return overlap / Math.min(p.y1 - p.y0 + 1, q.y1 - q.y0 + 1)
}

export interface SampledColours {
  fill: string
  strokes: Stroke[]
}

/**
 * Eyedrop a field's colours out of the original artwork.
 *
 * The most common colour inside the zone is the fill; the next most common
 * that is far enough away in RGB is the first outline. Both are suggestions —
 * the authoring screen shows them as editable swatches.
 */
export async function eyedropColours(
  original: Buffer,
  zone: Zone,
  opts: { ignore?: { r: number; g: number; b: number } } = {}
): Promise<SampledColours> {
  const { data, info } = await sharp(original)
    .extract({ left: zone.x, top: zone.y, width: zone.w, height: zone.h })
    .resize(160, null, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  // Quantize to a 5-bit-per-channel histogram so antialiasing does not read as
  // hundreds of distinct colours. Transparent pixels are skipped: on a cut-out
  // back print they are the empty shirt, and counting them made the "fill"
  // come out black.
  const counts = new Map<number, number>()
  for (let p = 0; p < data.length; p += info.channels) {
    if (data[p + 3] < 128) continue
    // On OPAQUE art the empty shirt is painted in (usually white); inside a
    // box around lettering it outvotes the letters and came back as the
    // "fill" (live 2026-09-24: #F8F8F8 for maroon BEAR). Skip that colour.
    const ig = opts.ignore
    if (ig && Math.abs(data[p] - ig.r) + Math.abs(data[p + 1] - ig.g) + Math.abs(data[p + 2] - ig.b) < 36) continue
    const key = ((data[p] >> 3) << 10) | ((data[p + 1] >> 3) << 5) | (data[p + 2] >> 3)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key)
  const toRgb = (key: number) => ({
    r: ((key >> 10) & 31) << 3,
    g: ((key >> 5) & 31) << 3,
    b: (key & 31) << 3,
  })
  const hex = (c: { r: number; g: number; b: number }) =>
    '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()

  const fill = ranked.length > 0 ? toRgb(ranked[0]) : { r: 0, g: 0, b: 0 }
  const distinct = ranked
    .map(toRgb)
    .find((c) => Math.abs(c.r - fill.r) + Math.abs(c.g - fill.g) + Math.abs(c.b - fill.b) > 120)

  return {
    fill: hex(fill),
    strokes: distinct ? [{ color: hex(distinct), w: Math.max(4, Math.round(zone.h * 0.03)) }] : [],
  }
}

/**
 * The background colour of OPAQUE art: the median of its border pixels, or
 * null when the art has real transparency (then there is nothing to ignore).
 */
export async function borderBackground(original: Buffer): Promise<{ r: number; g: number; b: number } | null> {
  const { data, info } = await sharp(original).resize(200, 200, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const px: number[][] = []
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      if (x > 1 && y > 1 && x < info.width - 2 && y < info.height - 2) continue
      const i = (y * info.width + x) * 4
      if (data[i + 3] < 250) return null
      px.push([data[i], data[i + 1], data[i + 2]])
    }
  const med = (c: number) => px.map((p) => p[c]).sort((a, b) => a - b)[Math.floor(px.length / 2)]
  return { r: med(0), g: med(1), b: med(2) }
}

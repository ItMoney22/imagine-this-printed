// Pet ornament — a flat portrait picture in, a four-colour print map out
// (task 81358f3a).
//
// The image model draws a flat cartoon on white with black lines. This turns
// it into what the A1 can lay down: a grid of PX mm squares, each one of
//
//   0  plate  (the white ground, and any coat that is near-white)
//   1  fur    main coat colour
//   2  fur    second coat colour
//   3  ink    black lines and dark markings
//
// with every colour snapped to a filament the floor stocks, lines thickened
// so a 0.4 mm nozzle can draw them, and slivers and specks the slicer would
// drop folded into their neighbours BEFORE anyone sees the preview. The
// preview is drawn from this map, so the customer sees what prints.
//
// Pure apart from sharp decoding the picture: no network, no storage.
import sharp from 'sharp'
import { FILAMENTS, INK_FILAMENT, PLATE_FILAMENT, type Filament } from '../../shared/pet-ornament.js'
import { GRID_H, GRID_ORIGIN, GRID_W, PORTRAIT_BOX, PORTRAIT_MIN_Y, PX, pixelAllowed } from './layout.js'

export const PLATE = 0
export const FUR1 = 1
export const FUR2 = 2
export const INK = 3

export interface PortraitMap {
  version: 1
  w: number
  h: number
  /** Row-major, top row first, one label (0-3) per pixel. */
  labels: Uint8Array
  /** Filament id per label: [plate, fur1 | null, fur2 | null, ink]. A null fur has no pixels. */
  filaments: [string, string | null, string | null, string]
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

type Lab = [number, number, number]

function srgbToLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b)
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(x), fy = f(y), fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function hexToLab(hex: string): Lab {
  const n = parseInt(hex.slice(1), 16)
  return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255)
}

function dist2(a: Lab, b: Lab): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
}

const FILAMENT_LAB = FILAMENTS.map((f) => ({ f, lab: hexToLab(f.hex) }))

function nearestFilament(lab: Lab, exclude: string[] = []): Filament {
  let best = FILAMENT_LAB[0]
  let bd = Infinity
  for (const c of FILAMENT_LAB) {
    if (exclude.includes(c.f.id)) continue
    const d = dist2(lab, c.lab)
    if (d < bd) { bd = d; best = c }
  }
  return best.f
}

// ---------------------------------------------------------------------------
// k-means (deterministic: farthest-point seeding, no randomness)
// ---------------------------------------------------------------------------

function kmeans(points: Lab[], k: number, iters = 12): { centres: Lab[]; assign: Uint8Array } {
  const centres: Lab[] = [points[0]]
  // Farthest-point seeding from the first pixel (a corner, so the ground).
  while (centres.length < k) {
    let far = 0, fd = -1
    for (let i = 0; i < points.length; i += 7) {
      let d = Infinity
      for (const c of centres) d = Math.min(d, dist2(points[i], c))
      if (d > fd) { fd = d; far = i }
    }
    centres.push(points[far])
  }
  const assign = new Uint8Array(points.length)
  for (let it = 0; it < iters; it++) {
    const sum = centres.map(() => [0, 0, 0, 0])
    for (let i = 0; i < points.length; i++) {
      let bi = 0, bd = Infinity
      for (let c = 0; c < centres.length; c++) {
        const d = dist2(points[i], centres[c])
        if (d < bd) { bd = d; bi = c }
      }
      assign[i] = bi
      const s = sum[bi]
      s[0] += points[i][0]; s[1] += points[i][1]; s[2] += points[i][2]; s[3]++
    }
    for (let c = 0; c < centres.length; c++) if (sum[c][3]) centres[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]]
  }
  return { centres, assign }
}

// ---------------------------------------------------------------------------
// Grid cleanup
// ---------------------------------------------------------------------------

const N8: Array<[number, number]> = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]

/** The most common other label around (x, y), ink losing ties (it is the one that grows). */
function neighbourVote(lab: Uint8Array, w: number, h: number, x: number, y: number, not: number): number {
  const count = [0, 0, 0, 0]
  for (const [dx, dy] of N8) {
    const nx = x + dx, ny = y + dy
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) { count[PLATE]++; continue }
    const v = lab[ny * w + nx]
    if (v !== not) count[v]++
  }
  let best = PLATE
  for (const c of [FUR1, FUR2, PLATE, INK]) if (count[c] > count[best]) best = c
  return best
}

/** Grows `cls` by one pixel (3x3) over whatever it borders. */
function dilate(lab: Uint8Array, w: number, h: number, cls: number): void {
  const grow: number[] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (lab[y * w + x] === cls) continue
    for (const [dx, dy] of N8) {
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && lab[ny * w + nx] === cls) { grow.push(y * w + x); break }
    }
  }
  for (const i of grow) lab[i] = cls
}

/**
 * Morphological opening with a 3x3 square, per colour: any part of a colour
 * narrower than 3 pixels (0.6 mm) is a sliver the slicer would skip, so it is
 * handed to its neighbours instead of printing as a gap.
 */
function dropSlivers(lab: Uint8Array, w: number, h: number, cls: number): number {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : lab[y * w + x])
  const eroded = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (at(x, y) !== cls) continue
    let all = true
    for (const [dx, dy] of N8) if (at(x + dx, y + dy) !== cls) { all = false; break }
    if (all) eroded[y * w + x] = 1
  }
  const kept = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!eroded[y * w + x]) continue
    kept[y * w + x] = 1
    for (const [dx, dy] of N8) {
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) kept[ny * w + nx] = 1
    }
  }
  const drop: number[] = []
  for (let i = 0; i < w * h; i++) if (lab[i] === cls && !kept[i]) drop.push(i)
  for (const i of drop) lab[i] = neighbourVote(lab, w, h, i % w, Math.floor(i / w), cls)
  return drop.length
}

/** Islands of one colour (plate ones too: an eye glint the nozzle cannot draw) under `minPx` pixels are folded into what surrounds them. */
function dropSpecks(lab: Uint8Array, w: number, h: number, minPx: number): number {
  const seen = new Uint8Array(w * h)
  let changed = 0
  const stack: number[] = []
  for (let start = 0; start < w * h; start++) {
    if (seen[start]) continue
    const cls = lab[start]
    const comp: number[] = []
    stack.push(start)
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop()!
      comp.push(i)
      const x = i % w, y = (i - x) / w
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const j = ny * w + nx
        if (!seen[j] && lab[j] === cls) { seen[j] = 1; stack.push(j) }
      }
    }
    if (comp.length >= minPx) continue
    // The colour that borders the island most.
    const count = [0, 0, 0, 0]
    for (const i of comp) {
      const x = i % w, y = (i - x) / w
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) { count[PLATE]++; continue }
        const v = lab[ny * w + nx]
        if (v !== cls) count[v]++
      }
    }
    let to = PLATE
    for (let c = 0; c < 4; c++) if (count[c] > count[to]) to = c
    for (const i of comp) lab[i] = to
    changed += comp.length
  }
  return changed
}

/**
 * Two pixels of one colour touching only at a corner make a print wall of
 * zero thickness (and a non-manifold mesh). Fill the gap with the colour so
 * they join properly.
 */
export function fixSaddles(lab: Uint8Array, w: number, h: number): number {
  let fixed = 0
  for (let pass = 0; pass < 8; pass++) {
    let n = 0
    for (let y = 0; y + 1 < h; y++) for (let x = 0; x + 1 < w; x++) {
      const a = lab[y * w + x], b = lab[y * w + x + 1], c = lab[(y + 1) * w + x], d = lab[(y + 1) * w + x + 1]
      if (a === d && a !== b && a !== c) { lab[y * w + x + 1] = a; n++ }
      else if (b === c && b !== a && b !== d) { lab[y * w + x] = b; n++ }
    }
    fixed += n
    if (!n) break
  }
  return fixed
}

// ---------------------------------------------------------------------------
// Placement: the biggest size at which the pet fits the allowed area
// ---------------------------------------------------------------------------

interface Placement { scale: number; ox: number; oy: number }

/** Where a grid pixel may print, apart from the name band: inside the rim. */
function insideRim(gx: number, gy: number): boolean {
  return pixelAllowed(gx, gy) || gridY(gy) < PORTRAIT_MIN_Y
}

function gridY(gy: number): number {
  return GRID_ORIGIN.y - (gy + 0.5) * PX
}

/**
 * `content` is the pet's pixels in source coordinates. Finds the largest
 * scale (grid px per source px) and a vertical offset at which (almost) none
 * of them cross the rim, so ears are never clipped off. The bottom may run
 * past the name band — a portrait's chest cut off flat reads as a bust, and
 * letting it go is what lets the face fill the disc. At least 85% of the pet
 * must stay, so the face is never what gets cut.
 */
function place(content: Array<[number, number]>, sw: number, sh: number): Placement {
  const sample = content.filter((_, i) => i % Math.max(1, Math.floor(content.length / 3000)) === 0)
  const fit = Math.min(GRID_W / sw, GRID_H / sh)
  for (let scale = fit * 1.5; scale > fit * 0.4; scale *= 0.97) {
    const ox = (GRID_W - sw * scale) / 2
    // Slide the pet from "top at the box top" downwards.
    for (let top = 0; top <= GRID_H * 0.3; top += GRID_H * 0.02) {
      const oy = top
      let out = 0
      let cut = 0
      for (const [sx, sy] of sample) {
        const gx = Math.floor(ox + sx * scale), gy = Math.floor(oy + sy * scale)
        if (gy >= GRID_H || gridY(gy) < PORTRAIT_MIN_Y) { cut++; continue }
        if (gx < 0 || gx >= GRID_W || gy < 0 || !insideRim(gx, gy)) out++
      }
      if (out <= sample.length * 0.002 && cut <= sample.length * 0.15) return { scale, ox, oy }
    }
  }
  return { scale: fit * 0.4, ox: (GRID_W - sw * fit * 0.4) / 2, oy: (GRID_H - sh * fit * 0.4) / 2 }
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

export interface QuantizeReport {
  clusters: number
  slivers: number
  specks: number
  saddles: number
  pixels: [number, number, number, number]
}

export async function quantizePortrait(image: Buffer): Promise<{ map: PortraitMap; report: QuantizeReport }> {
  // 1. The pet only: trim the white ground, keep a 1024 px working copy.
  const trimmed = await sharp(image).flatten({ background: '#ffffff' }).trim({ background: '#ffffff', threshold: 40 }).toBuffer()
  const { data, info } = await sharp(trimmed).resize(512, 512, { fit: 'inside' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const sw = info.width, sh = info.height

  // 2. Cluster the colours.
  const labs: Lab[] = new Array(sw * sh)
  for (let i = 0; i < sw * sh; i++) labs[i] = rgbToLab(data[i * 3], data[i * 3 + 1], data[i * 3 + 2])
  const K = 6
  const { centres, assign } = kmeans(labs, K)
  const area = new Array(K).fill(0)
  for (const a of assign) area[a]++

  // 3. Name the clusters. Ground = near-white; ink = the darkest; the two
  //    biggest of the rest are the coat; anything else (a pink nose, yellow
  //    eyes) goes to whichever of those it is nearest.
  const white = hexToLab('#ffffff')
  const role = new Array<number>(K).fill(-1)
  let ink = 0
  for (let c = 1; c < K; c++) if (centres[c][0] < centres[ink][0]) ink = c
  role[ink] = INK
  for (let c = 0; c < K; c++) if (role[c] < 0 && dist2(centres[c], white) < 12 ** 2) role[c] = PLATE
  const rest = [...Array(K).keys()].filter((c) => role[c] < 0 && area[c] > 0).sort((a, b) => area[b] - area[a])
  const fur = rest.slice(0, 2)
  fur.forEach((c, i) => (role[c] = i === 0 ? FUR1 : FUR2))

  // Snap the coat to filaments now, so two coats that print as the same
  // plastic become one, and a near-white coat becomes plate.
  const furFil: Array<Filament | null> = [null, null]
  fur.forEach((c, i) => (furFil[i] = nearestFilament(centres[c], [INK_FILAMENT])))
  for (let i = 0; i < 2; i++) if (furFil[i]?.id === PLATE_FILAMENT) { role[fur[i]] = PLATE; furFil[i] = null }
  if (furFil[0] && furFil[1] && furFil[0].id === furFil[1].id) { role[fur[1]] = FUR1; furFil[1] = null }
  if (!furFil[0] && furFil[1]) { // keep FUR1 the main coat
    role[fur[1]] = FUR1; furFil[0] = furFil[1]; furFil[1] = null
  }
  const anchors: Array<{ role: number; lab: Lab }> = []
  for (let c = 0; c < K; c++) if (role[c] >= 0) anchors.push({ role: role[c], lab: centres[c] })
  anchors.push({ role: PLATE, lab: white })
  for (let c = 0; c < K; c++) {
    if (role[c] >= 0) continue
    let best = anchors[0], bd = Infinity
    for (const a of anchors) { const d = dist2(centres[c], a.lab); if (d < bd) { bd = d; best = a } }
    role[c] = best.role
  }

  // 4. Onto the print grid, placed so the whole pet fits inside the rim.
  const content: Array<[number, number]> = []
  for (let i = 0; i < sw * sh; i++) if (role[assign[i]] !== PLATE) content.push([i % sw, Math.floor(i / sw)])
  const { scale, ox, oy } = place(content, sw, sh)
  const w = GRID_W, h = GRID_H
  const lab = new Uint8Array(w * h)
  for (let gy = 0; gy < h; gy++) for (let gx = 0; gx < w; gx++) {
    if (!pixelAllowed(gx, gy)) continue
    // Majority of the source pixels under this grid pixel (centre + 4 taps).
    const votes = [0, 0, 0, 0]
    for (const [fx, fy] of [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
      const sx = Math.floor((gx + fx - ox) / scale), sy = Math.floor((gy + fy - oy) / scale)
      if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) { votes[PLATE]++; continue }
      votes[role[assign[sy * sw + sx]]]++
    }
    let best = PLATE
    for (const c of [INK, FUR1, FUR2]) if (votes[c] > votes[best]) best = c
    lab[gy * w + gx] = best
  }

  // 5. Make it printable. Lines a step bolder (the model's are ~0.5 mm at
  //    this size), then slivers and specks out, then corner-touches joined.
  dilate(lab, w, h, INK)
  let slivers = 0
  for (let pass = 0; pass < 3; pass++) {
    let n = 0
    for (const c of [INK, FUR2, FUR1]) n += dropSlivers(lab, w, h, c)
    slivers += n
    if (!n) break
  }
  const specks = dropSpecks(lab, w, h, Math.round(1.5 / (PX * PX)))
  // Nothing outside the allowed area, whatever the cleanup did.
  for (let gy = 0; gy < h; gy++) for (let gx = 0; gx < w; gx++) if (!pixelAllowed(gx, gy)) lab[gy * w + gx] = PLATE

  const pixels: [number, number, number, number] = [0, 0, 0, 0]
  for (const v of lab) pixels[v]++
  const filaments: PortraitMap['filaments'] = [
    PLATE_FILAMENT,
    pixels[FUR1] ? furFil[0]?.id ?? null : null,
    pixels[FUR2] ? furFil[1]?.id ?? null : null,
    INK_FILAMENT,
  ]
  // A fur with no filament (merged away) must not keep pixels.
  if (!filaments[1] || !filaments[2]) for (let i = 0; i < lab.length; i++) {
    if (lab[i] === FUR1 && !filaments[1]) lab[i] = PLATE
    if (lab[i] === FUR2 && !filaments[2]) lab[i] = filaments[1] ? FUR1 : PLATE
  }
  // Last, after every relabel, so no corner-only touch survives into the mesh.
  // (A saddle fix can paint one pixel past the clip; that is 0.2 mm, inside the rim gap.)
  const saddles = fixSaddles(lab, w, h)
  pixels.fill(0)
  for (const v of lab) pixels[v]++
  return {
    map: { version: 1, w, h, labels: lab, filaments },
    report: { clusters: K, slivers, specks, saddles, pixels },
  }
}

// ---------------------------------------------------------------------------
// Storage form (JSON-safe)
// ---------------------------------------------------------------------------

export function encodeMap(map: PortraitMap): string {
  return JSON.stringify({ ...map, labels: Buffer.from(map.labels).toString('base64'), box: PORTRAIT_BOX, px: PX })
}

export function decodeMap(json: string): PortraitMap {
  const raw = JSON.parse(json)
  if (raw?.version !== 1 || raw.w !== GRID_W || raw.h !== GRID_H) throw new Error('Portrait map is from another layout')
  const labels = new Uint8Array(Buffer.from(raw.labels, 'base64'))
  if (labels.length !== raw.w * raw.h) throw new Error('Portrait map is the wrong size')
  return { version: 1, w: raw.w, h: raw.h, labels, filaments: raw.filaments }
}

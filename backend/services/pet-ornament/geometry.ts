// Pet ornament — four-colour print map + name in, one STL per colour out
// (task 81358f3a).
//
// Colours are STACKED by height, one part per colour, so they only share the
// top layers (the dino ornament's recipe, bambu-printing skill):
//
//   plate  0   .. 2.6  disc + cap with the hanging hole        AMS slot 1
//   fur 1  2.6 .. 3.4  main coat                               AMS slot 2
//   fur 2  2.6 .. 3.4  second coat                             AMS slot 3
//   ink    2.6 .. 4.2  outlines, rim and the name              AMS slot 4
//
// The raised parts never overlap each other: each is traced from its own
// pixels of the same grid, along the pixel edges, so two neighbours share an
// edge exactly and nothing is smoothed into the other's ground.
//
// Pure: no network, no storage. The preview SVG is drawn from the same
// outlines the STLs are extruded from.
import { INK_FILAMENT, PLATE_FILAMENT, filamentById } from '../../shared/pet-ornament.js'
import {
  type Pt,
  type Region,
  type Tri,
  circle,
  extrude,
  layoutName,
  loadFont,
  missingGlyphs,
  orient,
  plateRegion,
  pointInRing,
  regionPath,
  signedArea,
} from '../name-print/geometry.js'
import { DISC_R, GRID_ORIGIN, NAME_BOX, PX, RIM_W, Z } from './layout.js'
import { FUR1, FUR2, INK, type PortraitMap } from './quantize.js'

/** Bump on ANY change to the output geometry: it is part of every cached file's path. */
export const PET_GEOMETRY_VERSION = 1

// ---------------------------------------------------------------------------
// Tracing a label grid into regions
// ---------------------------------------------------------------------------

/**
 * Outlines of every pixel island of `cls`, with their holes, in mm (y up).
 *
 * Walks the pixel edges that have `cls` on one side and something else on
 * the other, always with `cls` on the same side — so outers come out one way
 * round and holes the other, and the hole-to-outer pairing is a
 * point-in-polygon test. fixSaddles has already removed corner-only touches,
 * so every grid vertex has at most one way on.
 */
export function traceClass(map: PortraitMap, cls: number): Region[] {
  const { w, h, labels } = map
  const is = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === cls
  const W1 = w + 1
  const next = new Map<number, number[]>()
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const k = ay * W1 + ax
    const list = next.get(k)
    if (list) list.push(by * W1 + bx)
    else next.set(k, [by * W1 + bx])
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!is(x, y)) continue
    // Round the pixel as (x,y) -> (x+1,y) -> (x+1,y+1) -> (x,y+1). In y-down grid
    // coordinates that is positive area; flipped to y-up mm it is negative, so
    // each ring is reversed below to make outers CCW and holes CW.
    if (!is(x, y - 1)) add(x, y, x + 1, y)
    if (!is(x + 1, y)) add(x + 1, y, x + 1, y + 1)
    if (!is(x, y + 1)) add(x + 1, y + 1, x, y + 1)
    if (!is(x - 1, y)) add(x, y + 1, x, y)
  }

  const rings: Pt[][] = []
  for (const [start] of next) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const verts: number[] = []
      let cur = start
      for (let guard = 0; guard < 4 * w * h; guard++) {
        const outs = next.get(cur)
        if (!outs || outs.length === 0) break
        const to = outs.pop()!
        verts.push(cur)
        cur = to
        if (cur === start) break
      }
      // Drop the in-between vertices of straight runs: lossless.
      const pts: Pt[] = []
      const n = verts.length
      for (let i = 0; i < n; i++) {
        const p = verts[(i + n - 1) % n], c = verts[i], q = verts[(i + 1) % n]
        const px = p % W1, py = (p - px) / W1, cx = c % W1, cy = (c - cx) / W1, qx = q % W1, qy = (q - qx) / W1
        if ((cx - px) * (qy - cy) - (cy - py) * (qx - cx) !== 0) pts.push([GRID_ORIGIN.x + cx * PX, GRID_ORIGIN.y - cy * PX])
      }
      if (pts.length >= 4) rings.push(pts.reverse())
    }
  }

  const outers = rings.filter((r) => signedArea(r) > 0).map((r) => ({ r, a: signedArea(r), holes: [] as Pt[][] }))
  for (const r of rings) {
    if (signedArea(r) >= 0) continue
    const host = outers.filter((o) => pointInRing(r[0], o.r)).sort((x, y) => x.a - y.a)[0]
    if (host) host.holes.push(r)
  }
  return outers.map((o) => ({ outer: o.r, holes: o.holes }))
}

/**
 * The solid for every pixel of `cls`, from z0 to z1, meshed straight from the
 * grid — not from traced outlines through a polygon triangulator, which
 * overlapped its own triangles on these many-holed pixel shapes (a cap 15%
 * bigger than its pixels; found by the print check's volume read-back).
 *
 * Each row is cut into runs. A run's top edge carries a vertex wherever the
 * row above changes, its bottom edge wherever the row below changes, so two
 * neighbouring rows share exactly the same vertices along their common line
 * and every wall edge is the edge of a cap triangle: watertight, no
 * T-junctions, no zero-area faces.
 */
export function extrudeMask(map: PortraitMap, cls: number, z0: number, z1: number, out: Tri[]): void {
  const { w, h, labels } = map
  const is = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === cls
  const X = (gx: number) => GRID_ORIGIN.x + gx * PX
  const Y = (gy: number) => GRID_ORIGIN.y - gy * PX
  const wall = (ax: number, ay: number, bx: number, by: number) => {
    // a -> b with the solid on the left (y up): outward-facing quad.
    out.push([ax, ay, z0, bx, by, z0, bx, by, z1])
    out.push([ax, ay, z0, bx, by, z1, ax, ay, z1])
  }
  for (let r = 0; r < h; r++) {
    let x = 0
    while (x < w) {
      if (!is(x, r)) { x++; continue }
      const a = x
      while (x < w && is(x, r)) x++
      const b = x
      // Vertices along the top (line r) and bottom (line r + 1) edges.
      const top = [a], bot = [a]
      for (let k = a + 1; k < b; k++) {
        if (is(k, r - 1) !== is(k - 1, r - 1)) top.push(k)
        if (is(k, r + 1) !== is(k - 1, r + 1)) bot.push(k)
      }
      top.push(b); bot.push(b)
      const yt = Y(r), yb = Y(r + 1)
      // Caps: zip the two edges together, CCW from above on top.
      let i = 0, j = 0
      while (i < top.length - 1 || j < bot.length - 1) {
        const advanceBot = j < bot.length - 1 && (i >= top.length - 1 || bot[j + 1] < top[i + 1])
        if (advanceBot) {
          const [p, q, t] = [X(bot[j]), X(bot[j + 1]), X(top[i])]
          out.push([p, yb, z1, q, yb, z1, t, yt, z1])
          out.push([p, yb, z0, t, yt, z0, q, yb, z0])
          j++
        } else {
          const [p, t1, t0] = [X(bot[j]), X(top[i + 1]), X(top[i])]
          out.push([p, yb, z1, t1, yt, z1, t0, yt, z1])
          out.push([p, yb, z0, t0, yt, z0, t1, yt, z0])
          i++
        }
      }
      // Walls: run ends, then the stretches of top and bottom edge with no solid beyond.
      wall(X(a), yt, X(a), yb)
      wall(X(b), yb, X(b), yt)
      for (let k = top.length - 2; k >= 0; k--) if (!is(top[k], r - 1)) wall(X(top[k + 1]), yt, X(top[k]), yt)
      for (let k = 0; k < bot.length - 1; k++) if (!is(bot[k], r + 1)) wall(X(bot[k]), yb, X(bot[k + 1]), yb)
    }
  }
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export interface PetPart {
  /** 'plate' | 'fur1' | 'fur2' | 'ink' */
  key: 'plate' | 'fur1' | 'fur2' | 'ink'
  /** AMS slot, 1-4. */
  slot: number
  filament: string
  z0: number
  z1: number
  regions: Region[]
  triangles: Tri[]
}

export interface PetModel {
  parts: PetPart[]
  size: { x: number; y: number; z: number }
  nameSize: { w: number; h: number }
}

function rimRegion(): Region {
  return { outer: orient(circle(0, 0, DISC_R - 0.02, 160), true), holes: [orient(circle(0, 0, DISC_R - RIM_W, 160), false)] }
}

export function buildPetModel(map: PortraitMap, fontId: string, name: string): PetModel {
  const font = loadFont(fontId)
  const missing = missingGlyphs(font, name)
  if (missing.length) throw new Error(`The font has no letter for: ${missing.join(' ')}`)
  const nameLayout = name ? layoutName(font, name, NAME_BOX) : { regions: [], width: 0, height: 0 }

  const plate = plateRegion('ornament')
  const specs: Array<{ key: PetPart['key']; cls: number | null; z1: number; filament: string | null }> = [
    { key: 'plate', cls: null, z1: Z.plate, filament: PLATE_FILAMENT },
    { key: 'fur1', cls: FUR1, z1: Z.fur1, filament: map.filaments[1] },
    { key: 'fur2', cls: FUR2, z1: Z.fur2, filament: map.filaments[2] },
    { key: 'ink', cls: INK, z1: Z.ink, filament: INK_FILAMENT },
  ]
  const parts: PetPart[] = []
  for (const s of specs) {
    if (!s.filament) continue
    let regions: Region[]
    let z0: number
    if (s.cls === null) {
      regions = [plate]
      z0 = 0
    } else {
      regions = traceClass(map, s.cls)
      if (s.key === 'ink') regions = [...regions, rimRegion(), ...nameLayout.regions]
      z0 = Z.plate
    }
    if (regions.length === 0) continue
    const triangles: Tri[] = []
    if (s.cls === null) extrude(plate, 0, s.z1, triangles)
    else {
      extrudeMask(map, s.cls, z0, s.z1, triangles)
      if (s.key === 'ink') for (const r of [rimRegion(), ...nameLayout.regions]) extrude(r, z0, s.z1, triangles)
    }
    parts.push({ key: s.key, slot: 0, filament: s.filament, z0, z1: s.z1, regions, triangles })
  }
  // Slots in stack order, so a two-colour pet uses slots 1, 2, 3.
  parts.forEach((p, i) => (p.slot = i + 1))

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of plate.outer) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  return {
    parts,
    size: { x: maxX - minX, y: maxY - minY, z: Math.max(...parts.map((p) => p.z1)) },
    nameSize: { w: nameLayout.width, h: nameLayout.height },
  }
}

// ---------------------------------------------------------------------------
// Preview: the same outlines, seen from above, in the filaments' colours
// ---------------------------------------------------------------------------

export function toPetPreviewSvg(model: PetModel): string {
  const plate = model.parts.find((p) => p.key === 'plate')!
  const pad = 3
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of plate.regions[0].outer) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, -y); maxY = Math.max(maxY, -y)
  }
  const vb = `${(minX - pad).toFixed(2)} ${(minY - pad).toFixed(2)} ${(maxX - minX + 2 * pad).toFixed(2)} ${(maxY - minY + 2 * pad).toFixed(2)}`
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img">`,
    '<defs><filter id="lift" x="-10%" y="-10%" width="120%" height="120%">',
    '<feDropShadow dx="0.25" dy="0.35" stdDeviation="0.25" flood-color="#000" flood-opacity="0.35"/></filter>',
    '<filter id="base" x="-10%" y="-10%" width="120%" height="120%">',
    '<feDropShadow dx="0.6" dy="0.9" stdDeviation="0.9" flood-color="#000" flood-opacity="0.25"/></filter></defs>',
  ]
  for (const part of model.parts) {
    const hex = filamentById(part.filament)?.hex ?? '#999999'
    const d = part.regions.map(regionPath).join('')
    out.push(`<path d="${d}" fill="${hex}" fill-rule="evenodd" filter="url(#${part.key === 'plate' ? 'base' : 'lift'})"/>`)
  }
  out.push('</svg>')
  return out.join('')
}

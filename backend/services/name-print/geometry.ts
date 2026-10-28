// 3D name gifts — name in, printable model out (task bf353160, 2026-10-28).
//
// The customer's name is set in a house font, turned into outlines, fitted
// into the plate's text box and raised above a flat plate:
//
//   z = 0 .. PLATE           the plate (ornament disc with a hanging cap,
//                            or a keychain tag), with its hanging hole
//   z = PLATE-SINK .. TOP    the raised name (and the ornament's rim)
//
// Colour is a HEIGHT on the A1, never a part (bambu-printing skill): one
// filament change at the top of the plate gives a plate in one colour and
// the name in another, for one swap and no purge tower worth the name.
//
// Pure: font bytes in, STL bytes / SVG string out. No network, no GCS, so it
// runs the same in a test, a script, the preview route and checkout.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'
import { ShapeUtils, Vector2 } from 'three'
import type { NamePrintShape } from '../../shared/name-print.js'

/** Bump on ANY change to the output geometry: it is part of every cached file's path. */
export const GEOMETRY_VERSION = 1

export type Pt = [number, number]
/** One solid area of the outline, in mm, y up: an outer ring and the holes cut out of it. */
export interface Region {
  outer: Pt[]
  holes: Pt[][]
}

export interface ShapeSpec {
  /** Plate thickness, mm. The filament change lands here. */
  plate: number
  /** Raised height of the letters above the plate, mm. */
  raise: number
  /** How far the raised parts start INSIDE the plate, so the slicer fuses them (mm). */
  sink: number
  /** The box the name is fitted into, mm, centred on (cx, cy). */
  textBox: { cx: number; cy: number; w: number; h: number }
  /** Width of the raised rim, or 0 for none. */
  rim: number
}

// Plate tops and model tops sit on a REAL layer top for both 0.12 mm and
// 0.2 mm layers (0.2 first layer): 2.6, 3.2, 3.8 and 4.4 are all 0.2 + 0.12n
// and 0.2n. A colour change keyed to a height that is not a layer top is
// dropped by the slicer without a word (bambu-printing skill, trap 8).
export const SHAPES: Record<NamePrintShape, ShapeSpec> = {
  // ~79 mm tall: a 67 mm disc and a 12 mm cap with the hanging hole.
  ornament: { plate: 3.2, raise: 1.2, sink: 0.4, textBox: { cx: 0, cy: 0, w: 52, h: 18 }, rim: 2 },
  // 50 x 18 mm tag, hole at the left end.
  keychain: { plate: 2.6, raise: 1.2, sink: 0.4, textBox: { cx: 5.5, cy: 0, w: 31, h: 11 }, rim: 0 },
}

const ORN_R = 33.5 // disc radius
const CAP_HALF = 6.5 // cap half width = cap top radius
const CAP_CY = 39 // cap top arc centre (and hole centre)
const ORN_HOLE_R = 2.25
const KEY_LEN = 50
const KEY_H = 18
const KEY_HOLE_X = -16
const KEY_HOLE_R = 2.5

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/** House ids this feature may use. Ids, not file names, so a face can be swapped. */
const FONT_FILES: Record<string, string> = {
  'brush-script': 'brush-script.ttf', // Pacifico (OFL)
  'collegiate-slab': 'collegiate-slab.ttf', // Alfa Slab One (OFL)
}

// Source runs from backend/services/name-print, the build from
// backend/dist/services/name-print; tsc does not copy .ttf files, so look in
// both places for backend/assets/fonts rather than shipping a dead path.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FONT_DIRS = [path.join(HERE, '../../assets/fonts'), path.join(HERE, '../../../assets/fonts')]

const fontCache = new Map<string, opentype.Font>()

export function loadFont(id: string): opentype.Font {
  const cached = fontCache.get(id)
  if (cached) return cached
  const file = FONT_FILES[id]
  if (!file) throw new Error(`Unknown name-print font "${id}"`)
  const dir = FONT_DIRS.find((d) => existsSync(path.join(d, file)))
  if (!dir) throw new Error(`Font file ${file} not found in ${FONT_DIRS.join(' or ')}`)
  const bytes = readFileSync(path.join(dir, file))
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  fontCache.set(id, font)
  return font
}

/** Characters the font cannot draw (they would print as an empty box). */
export function missingGlyphs(font: opentype.Font, text: string): string[] {
  return Array.from(new Set(Array.from(text).filter((c) => c !== ' ' && font.charToGlyphIndex(c) === 0)))
}

// ---------------------------------------------------------------------------
// 2D outlines
// ---------------------------------------------------------------------------

function signedArea(ring: Pt[]): number {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  return a / 2
}

function pointInRing(p: Pt, ring: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** CCW for an outer ring, CW for a hole: the side walls rely on it. */
function orient(ring: Pt[], ccw: boolean): Pt[] {
  return signedArea(ring) > 0 === ccw ? ring : [...ring].reverse()
}

/** Bezier steps per curve. 8 is well under a 0.4 mm nozzle at name sizes. */
const CURVE_STEPS = 8

/** Flattens one glyph's path into rings (font units scaled by the path, y flipped to up). */
function pathToRings(p: opentype.Path): Pt[][] {
  const rings: Pt[][] = []
  let cur: Pt[] = []
  let last: Pt = [0, 0]
  const push = (pt: Pt) => {
    const prev = cur[cur.length - 1]
    if (!prev || Math.abs(prev[0] - pt[0]) > 1e-6 || Math.abs(prev[1] - pt[1]) > 1e-6) cur.push(pt)
    last = pt
  }
  const close = () => {
    if (cur.length > 2) {
      const [a, b] = [cur[0], cur[cur.length - 1]]
      if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) cur.pop()
      if (cur.length > 2 && Math.abs(signedArea(cur)) > 1e-6) rings.push(cur)
    }
    cur = []
  }
  for (const c of p.commands as any[]) {
    if (c.type === 'M') {
      close()
      push([c.x, -c.y])
    } else if (c.type === 'L') {
      push([c.x, -c.y])
    } else if (c.type === 'Q') {
      const [x0, y0] = last
      for (let s = 1; s <= CURVE_STEPS; s++) {
        const t = s / CURVE_STEPS
        const u = 1 - t
        push([u * u * x0 + 2 * u * t * c.x1 + t * t * c.x, u * u * y0 + 2 * u * t * -c.y1 + t * t * -c.y])
      }
    } else if (c.type === 'C') {
      const [x0, y0] = last
      for (let s = 1; s <= CURVE_STEPS; s++) {
        const t = s / CURVE_STEPS
        const u = 1 - t
        push([
          u * u * u * x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * y0 + 3 * u * u * t * -c.y1 + 3 * u * t * t * -c.y2 + t * t * t * -c.y,
        ])
      }
    } else if (c.type === 'Z') {
      close()
    }
  }
  close()
  return rings
}

/**
 * One glyph's rings -> solid regions with their holes.
 *
 * TrueType draws outer contours one way round and counters (the hole in an
 * "e") the other; CFF fonts the opposite. So the biggest contour of the glyph
 * — always an outer — names the outer direction, and every contour wound the
 * other way is a hole of the smallest outer that contains it. Per glyph, so
 * a script face whose letters overlap their neighbours stays correct: the
 * overlaps are separate solids and the slicer unions them.
 */
function ringsToRegions(rings: Pt[][]): Region[] {
  if (rings.length === 0) return []
  const areas = rings.map(signedArea)
  let big = 0
  for (let i = 1; i < rings.length; i++) if (Math.abs(areas[i]) > Math.abs(areas[big])) big = i
  const outerSign = Math.sign(areas[big])
  const outers = rings.map((r, i) => ({ r, a: Math.abs(areas[i]), i })).filter((o) => Math.sign(areas[o.i]) === outerSign)
  const regions = new Map<number, Region>(outers.map((o) => [o.i, { outer: orient(o.r, true), holes: [] }]))
  rings.forEach((r, i) => {
    if (Math.sign(areas[i]) === outerSign) return
    const host = outers
      .filter((o) => pointInRing(r[0], o.r))
      .sort((x, y) => x.a - y.a)[0]
    if (host) regions.get(host.i)!.holes.push(orient(r, false))
  })
  return Array.from(regions.values())
}

export interface NameLayout {
  regions: Region[]
  /** Size of the set name in mm. */
  width: number
  height: number
}

/** Sets `text` in `font`, scaled to fit `box` (aspect kept) and centred in it. */
export function layoutName(font: opentype.Font, text: string, box: ShapeSpec['textBox']): NameLayout {
  const raw: Region[] = []
  for (const glyphPath of font.getPaths(text, 0, 0, font.unitsPerEm)) raw.push(...ringsToRegions(pathToRings(glyphPath)))
  if (raw.length === 0) return { regions: [], width: 0, height: 0 }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const reg of raw) for (const [x, y] of reg.outer) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const w = maxX - minX
  const h = maxY - minY
  const scale = Math.min(box.w / w, box.h / h)
  const ox = box.cx - ((minX + maxX) / 2) * scale
  const oy = box.cy - ((minY + maxY) / 2) * scale
  const tx = (p: Pt): Pt => [p[0] * scale + ox, p[1] * scale + oy]
  return {
    regions: raw.map((reg) => ({ outer: reg.outer.map(tx), holes: reg.holes.map((h) => h.map(tx)) })),
    width: w * scale,
    height: h * scale,
  }
}

function circle(cx: number, cy: number, r: number, n = 96): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)])
  }
  return out
}

/** The plate outline with its hanging hole. */
export function plateRegion(shape: NamePrintShape): Region {
  if (shape === 'ornament') {
    // Disc, then up the cap's left edge, over its round top, down its right
    // edge — drawn as one outline so no polygon union is needed.
    const join = Math.asin(CAP_HALF / ORN_R) // angle off vertical where the cap meets the disc
    const outer: Pt[] = []
    const n = 120
    const a0 = Math.PI / 2 + join
    const a1 = Math.PI / 2 - join + Math.PI * 2
    for (let i = 0; i <= n; i++) {
      const t = a0 + ((a1 - a0) * i) / n
      outer.push([ORN_R * Math.cos(t), ORN_R * Math.sin(t)])
    }
    // Now at the right-hand join, heading up the cap.
    for (let i = 0; i <= 24; i++) {
      const t = (i / 24) * Math.PI
      outer.push([CAP_HALF * Math.cos(t), CAP_CY + CAP_HALF * Math.sin(t)])
    }
    return { outer: orient(outer, true), holes: [orient(circle(0, CAP_CY, ORN_HOLE_R, 48), false)] }
  }
  // Keychain: a stadium (fully round ends), hole at the left end.
  const r = KEY_H / 2
  const cxL = -KEY_LEN / 2 + r
  const cxR = KEY_LEN / 2 - r
  const outer: Pt[] = []
  for (let i = 0; i <= 32; i++) {
    const t = -Math.PI / 2 + (i / 32) * Math.PI
    outer.push([cxR + r * Math.cos(t), r * Math.sin(t)])
  }
  for (let i = 0; i <= 32; i++) {
    const t = Math.PI / 2 + (i / 32) * Math.PI
    outer.push([cxL + r * Math.cos(t), r * Math.sin(t)])
  }
  return { outer: orient(outer, true), holes: [orient(circle(KEY_HOLE_X, 0, KEY_HOLE_R, 48), false)] }
}

/** The ornament's raised rim: a ring just inside the disc edge. */
function rimRegion(width: number): Region {
  // 0.02 mm in from the plate edge so its wall never coincides with the plate's.
  return { outer: orient(circle(0, 0, ORN_R - 0.02, 160), true), holes: [orient(circle(0, 0, ORN_R - width, 160), false)] }
}

// ---------------------------------------------------------------------------
// 3D
// ---------------------------------------------------------------------------

type Tri = [number, number, number, number, number, number, number, number, number]

/** Extrudes one region from z0 to z1: bottom cap, top cap, a wall per ring edge. */
function extrude(reg: Region, z0: number, z1: number, out: Tri[]): void {
  const contour = reg.outer.map(([x, y]) => new Vector2(x, y))
  const holes = reg.holes.map((h) => h.map(([x, y]) => new Vector2(x, y)))
  // triangulateShape trims a repeated end point IN PLACE, and its indices are
  // into what is left — so the vertex list is read after the call, not before.
  const faces = ShapeUtils.triangulateShape(contour, holes)
  const pts = [...contour, ...holes.flat()]
  for (const [a, b, c] of faces) {
    const [pa, pb, pc] = [pts[a], pts[b], pts[c]]
    const ccw = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x) > 0
    const [p, q, r] = ccw ? [pa, pb, pc] : [pa, pc, pb]
    out.push([p.x, p.y, z1, q.x, q.y, z1, r.x, r.y, z1]) // top: CCW from above
    out.push([p.x, p.y, z0, r.x, r.y, z0, q.x, q.y, z0]) // bottom: CW from above
  }
  for (const ring of [reg.outer, ...reg.holes]) {
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i]
      const [bx, by] = ring[(i + 1) % ring.length]
      out.push([ax, ay, z0, bx, by, z0, bx, by, z1])
      out.push([ax, ay, z0, bx, by, z1, ax, ay, z1])
    }
  }
}

export interface NameModel {
  triangles: Tri[]
  /** Overall size, mm. */
  size: { x: number; y: number; z: number }
  /** Where the filament change goes: the top of the plate, mm. */
  colourChangeAtMm: number
  /** The 2D pieces, for the SVG preview. */
  plate: Region
  rim: Region | null
  letters: Region[]
  nameSize: { w: number; h: number }
}

export function buildNameModel(shape: NamePrintShape, fontId: string, name: string): NameModel {
  const spec = SHAPES[shape]
  const font = loadFont(fontId)
  const missing = missingGlyphs(font, name)
  if (missing.length) throw new Error(`The font has no letter for: ${missing.join(' ')}`)
  const layout = layoutName(font, name, spec.textBox)
  if (layout.regions.length === 0) throw new Error('Nothing to print: the name is empty')

  const plate = plateRegion(shape)
  const rim = spec.rim > 0 ? rimRegion(spec.rim) : null
  const triangles: Tri[] = []
  const top = spec.plate + spec.raise
  extrude(plate, 0, spec.plate, triangles)
  if (rim) extrude(rim, spec.plate - spec.sink, top, triangles)
  for (const reg of layout.regions) extrude(reg, spec.plate - spec.sink, top, triangles)

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of plate.outer) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  return {
    triangles,
    size: { x: maxX - minX, y: maxY - minY, z: top },
    colourChangeAtMm: spec.plate,
    plate,
    rim,
    letters: layout.regions,
    nameSize: { w: layout.width, h: layout.height },
  }
}

/** Binary STL. Facet normals are computed; slicers recompute them anyway. */
export function toBinaryStl(model: NameModel, label = 'Imagine This Printed name gift'): Buffer {
  const n = model.triangles.length
  const buf = Buffer.alloc(84 + n * 50)
  buf.write(label.slice(0, 79), 0, 'ascii')
  buf.writeUInt32LE(n, 80)
  let o = 84
  for (const t of model.triangles) {
    const ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2]
    const vx = t[6] - t[0], vy = t[7] - t[1], vz = t[8] - t[2]
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len
    for (const v of [nx, ny, nz, ...t]) {
      buf.writeFloatLE(v, o)
      o += 4
    }
    buf.writeUInt16LE(0, o)
    o += 2
  }
  return buf
}

// ---------------------------------------------------------------------------
// Preview: the same outlines, seen from above
// ---------------------------------------------------------------------------

function ringPath(ring: Pt[]): string {
  return 'M' + ring.map(([x, y]) => `${x.toFixed(2)} ${(-y).toFixed(2)}`).join('L') + 'Z'
}

function regionPath(reg: Region): string {
  return ringPath(reg.outer) + reg.holes.map(ringPath).join('')
}

/**
 * The model seen from above, in its two colours, with a soft shadow under the
 * raised parts. Drawn from the SAME outlines the STL is extruded from, so the
 * picture cannot show a name the file does not contain.
 */
export function toPreviewSvg(model: NameModel, colours: { plate: string; letters: string }): string {
  const pad = 3
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of model.plate.outer) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, -y); maxY = Math.max(maxY, -y)
  }
  const vb = `${(minX - pad).toFixed(2)} ${(minY - pad).toFixed(2)} ${(maxX - minX + 2 * pad).toFixed(2)} ${(maxY - minY + 2 * pad).toFixed(2)}`
  const raised = [model.rim ? regionPath(model.rim) : '', ...model.letters.map(regionPath)].filter(Boolean)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img">`,
    '<defs><filter id="lift" x="-10%" y="-10%" width="120%" height="120%">',
    '<feDropShadow dx="0.35" dy="0.5" stdDeviation="0.35" flood-color="#000" flood-opacity="0.45"/></filter>',
    '<filter id="base" x="-10%" y="-10%" width="120%" height="120%">',
    '<feDropShadow dx="0.6" dy="0.9" stdDeviation="0.9" flood-color="#000" flood-opacity="0.25"/></filter></defs>',
    `<path d="${regionPath(model.plate)}" fill="${colours.plate}" fill-rule="evenodd" filter="url(#base)"/>`,
    `<g fill="${colours.letters}" fill-rule="evenodd" filter="url(#lift)">`,
    ...raised.map((d) => `<path d="${d}"/>`),
    '</g></svg>',
  ].join('')
}

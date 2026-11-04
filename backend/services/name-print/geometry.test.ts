import { describe, it, expect } from 'vitest'
import { SHAPES, buildNameModel, layoutName, loadFont, missingGlyphs, toBinaryStl, toPreviewSvg } from './geometry'

type Tri = number[]

/**
 * A closed, consistently wound surface uses every directed edge exactly as
 * often as its reverse. Anything else is a hole or a flipped face, which a
 * slicer "repairs" by guessing.
 */
function unbalancedEdges(tris: Tri[]): number {
  const key = (x: number, y: number, z: number) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`
  const count = new Map<string, number>()
  for (const t of tris) {
    const v = [key(t[0], t[1], t[2]), key(t[3], t[4], t[5]), key(t[6], t[7], t[8])]
    for (let i = 0; i < 3; i++) {
      const a = v[i], b = v[(i + 1) % 3]
      if (a === b) continue
      count.set(`${a}>${b}`, (count.get(`${a}>${b}`) ?? 0) + 1)
    }
  }
  let bad = 0
  for (const [k, n] of count) {
    const [a, b] = k.split('>')
    if ((count.get(`${b}>${a}`) ?? 0) !== n) bad++
  }
  return bad
}

/** Signed volume by the divergence theorem: positive = normals point out. */
function volume(tris: Tri[]): number {
  let v = 0
  for (const t of tris) {
    v += (t[0] * (t[4] * t[8] - t[5] * t[7]) - t[1] * (t[3] * t[8] - t[5] * t[6]) + t[2] * (t[3] * t[7] - t[4] * t[6])) / 6
  }
  return v
}

const isLayerTop = (z: number, layer: number) => Math.abs(((z - 0.2) / layer) - Math.round((z - 0.2) / layer)) < 1e-6

describe('name gift geometry', () => {
  it('builds an ~80 mm ornament with the name raised 1.2 mm on a 3.2 mm plate', () => {
    const m = buildNameModel('ornament', 'brush-script', 'Emma')
    expect(m.size.y).toBeCloseTo(79, 0)
    expect(m.size.x).toBeCloseTo(67, 0)
    expect(m.size.z).toBeCloseTo(4.4, 6)
    expect(m.colourChangeAtMm).toBe(3.2)
  })

  it('builds a 50 mm keychain', () => {
    const m = buildNameModel('keychain', 'brush-script', 'Noah')
    expect(m.size.x).toBeCloseTo(50, 1)
    expect(m.size.y).toBeCloseTo(18, 1)
    expect(m.size.z).toBeCloseTo(3.8, 6)
  })

  it('puts the colour change and the top on a real layer for 0.12 and 0.2 mm layers', () => {
    for (const spec of Object.values(SHAPES)) {
      for (const layer of [0.12, 0.2]) {
        expect(isLayerTop(spec.plate, layer)).toBe(true)
        expect(isLayerTop(spec.plate + spec.raise, layer)).toBe(true)
      }
    }
  })

  it('makes closed, outward-facing shells (no holes for the slicer to guess at)', () => {
    for (const [shape, name] of [['ornament', 'Emma'], ['keychain', 'Zoë & José'], ['ornament', 'Christopher']] as const) {
      const m = buildNameModel(shape, 'brush-script', name)
      expect(unbalancedEdges(m.triangles)).toBe(0)
      expect(volume(m.triangles)).toBeGreaterThan(0)
    }
  })

  it('cuts the counters: the hole in an "e" and an "o" is a hole, not a filled blob', () => {
    const font = loadFont('brush-script')
    const layout = layoutName(font, 'eo', SHAPES.keychain.textBox)
    expect(layout.regions.some((r) => r.holes.length > 0)).toBe(true)
  })

  it('fits any allowed-length name inside the text box', () => {
    for (const shape of ['ornament', 'keychain'] as const) {
      const box = SHAPES[shape].textBox
      for (const name of ['Al', 'Christopher', 'WWWWWWWWWW', 'Mom & Dad']) {
        const m = buildNameModel(shape, 'brush-script', name)
        expect(m.nameSize.w).toBeLessThanOrEqual(box.w + 1e-6)
        expect(m.nameSize.h).toBeLessThanOrEqual(box.h + 1e-6)
      }
    }
  })

  it('is deterministic: the same name gives the same bytes, another name does not', () => {
    const a = toBinaryStl(buildNameModel('keychain', 'brush-script', 'Liam'))
    const b = toBinaryStl(buildNameModel('keychain', 'brush-script', 'Liam'))
    const c = toBinaryStl(buildNameModel('keychain', 'brush-script', 'Lian'))
    expect(a.equals(b)).toBe(true)
    expect(a.equals(c)).toBe(false)
  })

  it('writes a well-formed binary STL', () => {
    const m = buildNameModel('ornament', 'brush-script', 'Ava')
    const stl = toBinaryStl(m)
    expect(stl.readUInt32LE(80)).toBe(m.triangles.length)
    expect(stl.length).toBe(84 + 50 * m.triangles.length)
  })

  it('has a glyph for every character the sanitizer lets through', () => {
    const allowed = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789\'&.-ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝàáâãäåæçèéêëìíîïñòóôõöøùúûüýÿ'
    for (const id of ['brush-script', 'collegiate-slab']) {
      expect(missingGlyphs(loadFont(id), allowed)).toEqual([])
    }
  })

  it('refuses a font it does not know and a name with nothing to print', () => {
    expect(() => buildNameModel('ornament', 'comic-sans', 'Emma')).toThrow(/Unknown/)
    expect(() => buildNameModel('ornament', 'brush-script', '   ')).toThrow(/Nothing to print/)
  })

  it('previews the same outlines it prints, in the template colours', () => {
    const m = buildNameModel('ornament', 'brush-script', 'Emma')
    const svg = toPreviewSvg(m, { plate: '#B3262E', letters: '#F4F1EA' })
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('fill="#B3262E"')
    expect(svg).toContain('fill="#F4F1EA"')
    // plate + rim + every letter region
    expect((svg.match(/<path /g) ?? []).length).toBe(1 + 1 + m.letters.length)
  })
})

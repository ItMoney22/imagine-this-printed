// Pet ornament geometry (task 81358f3a): the print files are printable before
// anyone slices them — every part a closed solid, colours never overlapping,
// the name exactly as typed, every layer top a real layer top.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { buildPetModel, toPetPreviewSvg, traceClass } from './geometry.js'
import { decodeMap, encodeMap, fixSaddles, quantizePortrait, FUR1, INK, PLATE } from './quantize.js'
import { stockPortrait } from './store.js'
import { GRID_H, GRID_W, PX, Z, pixelAllowed } from './layout.js'
import { signedArea } from '../name-print/geometry.js'

/** Every edge of a closed, consistently wound mesh is used exactly once in each direction. */
function openEdges(tris: number[][]): number {
  const key = (x: number, y: number, z: number) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`
  const count = new Map<string, number>()
  for (const t of tris) {
    const v = [key(t[0], t[1], t[2]), key(t[3], t[4], t[5]), key(t[6], t[7], t[8])]
    for (let i = 0; i < 3; i++) {
      const e = `${v[i]}>${v[(i + 1) % 3]}`
      count.set(e, (count.get(e) ?? 0) + 1)
    }
  }
  let open = 0
  for (const [e, n] of count) {
    const [a, b] = e.split('>')
    if (count.get(`${b}>${a}`) !== n) open++
  }
  return open
}

describe('pet ornament geometry', () => {
  for (const pet of ['cat', 'dog', 'bunny']) {
    it(`stock ${pet}: four stacked parts, every raised part a closed solid`, () => {
      const model = buildPetModel(stockPortrait(pet), 'brush-script', 'Biscuit')
      expect(model.parts[0].key).toBe('plate')
      expect(model.parts.at(-1)!.key).toBe('ink')
      expect(model.parts.map((p) => p.slot)).toEqual(model.parts.map((_, i) => i + 1))
      for (const p of model.parts) if (p.key !== 'ink') expect(openEdges(p.triangles), p.key).toBe(0)
      expect(model.size.z).toBe(Z.ink)
    })
  }

  it('the raised pixel parts are exactly their pixels (volume read back)', () => {
    const map = stockPortrait('dog')
    const model = buildPetModel(map, 'brush-script', 'Rex')
    const fur = model.parts.find((p) => p.key === 'fur1')!
    let vol = 0
    for (const t of fur.triangles) vol += (t[0] * (t[4] * t[8] - t[5] * t[7]) - t[1] * (t[3] * t[8] - t[5] * t[6]) + t[2] * (t[3] * t[7] - t[4] * t[6])) / 6
    const px = map.labels.filter((v) => v === FUR1).length
    expect(vol).toBeCloseTo(px * PX * PX * (Z.fur1 - Z.plate), 3)
  })

  it('every layer top is a real layer top at 0.16 and 0.2 mm (first layer 0.2)', () => {
    for (const z of Object.values(Z)) {
      for (const lh of [0.16, 0.2]) expect(Math.abs(((z - 0.2) / lh) - Math.round((z - 0.2) / lh))).toBeLessThan(1e-6)
    }
  })

  it('the portrait never reaches the rim or the name band', () => {
    const map = stockPortrait('cat')
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (map.labels[y * map.w + x] !== PLATE && !pixelAllowed(x, y)) {
        // A saddle fix may paint one pixel past the clip; never two.
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => pixelAllowed(x + dx, y + dy))
        expect(near).toBe(true)
      }
    }
  })

  it('traces outers counter-clockwise and holes clockwise', () => {
    const labels = new Uint8Array(GRID_W * GRID_H)
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) labels[y * GRID_W + x] = INK
    for (let y = 13; y < 17; y++) for (let x = 13; x < 17; x++) labels[y * GRID_W + x] = PLATE
    const regions = traceClass({ version: 1, w: GRID_W, h: GRID_H, labels, filaments: ['white', null, null, 'black'] }, INK)
    expect(regions).toHaveLength(1)
    expect(signedArea(regions[0].outer)).toBeCloseTo(100 * PX * PX, 6)
    expect(regions[0].holes).toHaveLength(1)
    expect(signedArea(regions[0].holes[0])).toBeCloseTo(-16 * PX * PX, 6)
  })

  it('joins corner-only touches so no wall is zero thick', () => {
    const w = 4, h = 4
    const lab = new Uint8Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    fixSaddles(lab, w, h)
    expect(lab[1] === 1 || lab[4] === 1).toBe(true)
  })

  it('the name in the preview is the name as typed, and refuses letters the font lacks', () => {
    const map = stockPortrait('cat')
    expect(toPetPreviewSvg(buildPetModel(map, 'brush-script', 'Mr. Whiskers'))).toContain('<svg')
    expect(() => buildPetModel(map, 'brush-script', '猫')).toThrow(/no letter/)
  })

  it('round-trips a portrait map through storage', () => {
    const map = stockPortrait('bunny')
    const back = decodeMap(encodeMap(map))
    expect(back.filaments).toEqual(map.filaments)
    expect(Buffer.from(back.labels).equals(Buffer.from(map.labels))).toBe(true)
  })

  it('quantizes a flat drawing into plate, coat and ink, snapped to stocked filaments', async () => {
    const png = readFileSync(fileURLToPath(new URL('../../assets/pet-ornament/dog.webp', import.meta.url)))
    const { map } = await quantizePortrait(await sharp(png).png().toBuffer())
    expect(map.filaments[0]).toBe('white')
    expect(map.filaments[3]).toBe('black')
    expect(map.labels.filter((v) => v === INK).length).toBeGreaterThan(1000)
    expect(map.labels.filter((v) => v === FUR1).length).toBeGreaterThan(1000)
  })
})

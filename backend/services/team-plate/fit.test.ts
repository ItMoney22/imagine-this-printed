import { describe, it, expect } from 'vitest'
import { fitToZone, archPlacements, widestNumberString, type StringMetrics, type Zone } from './fit.js'

// A stand-in metrics source so the geometry is tested without a font file:
// every glyph is 100 units wide, ascender 100, descender -20, unitsPerEm 100.
const metrics = (s: string): StringMetrics => ({
  width: s.length * 100,
  ascender: 100,
  descender: -20,
  unitsPerEm: 100,
})

const ZONE: Zone = { x: 0, y: 0, w: 1000, h: 400 }

describe('fitToZone', () => {
  it('scales a short string up to fill the zone width', () => {
    // 'AB' is naturally 200 wide; the zone is 1000 and 400 tall.
    // width scale 5, height scale 400/120 = 3.33 -> height wins.
    const fit = fitToZone('AB', ZONE, metrics)!
    expect(fit.scale).toBeCloseTo(400 / 120, 5)
  })

  it('scales a long string down so it never exceeds the zone', () => {
    const fit = fitToZone('VANDERMEULEN', ZONE, metrics)!
    expect(fit.width).toBeLessThanOrEqual(ZONE.w + 1e-6)
    expect(fit.height).toBeLessThanOrEqual(ZONE.h + 1e-6)
  })

  it('is width-limited when the string is long', () => {
    // 12 glyphs -> natural 1200. Width scale 1000/1200 = 0.833, height scale 3.33.
    const fit = fitToZone('VANDERMEULEN', ZONE, metrics)!
    expect(fit.scale).toBeCloseTo(1000 / 1200, 5)
  })

  it('is height-limited when the zone is short and wide', () => {
    const short: Zone = { x: 0, y: 0, w: 10000, h: 200 }
    const fit = fitToZone('AB', short, metrics)!
    expect(fit.scale).toBeCloseTo(200 / 120, 5)
  })

  it('centres the string horizontally in the zone', () => {
    const fit = fitToZone('A', ZONE, metrics)!
    expect(fit.originX + fit.width / 2).toBeCloseTo(ZONE.x + ZONE.w / 2, 5)
  })

  it('centres the string vertically in the zone', () => {
    const fit = fitToZone('A', ZONE, metrics)!
    const top = fit.baselineY - fit.ascender * fit.scale
    expect(top + fit.height / 2).toBeCloseTo(ZONE.y + ZONE.h / 2, 5)
  })

  it('honours a zone offset from the origin', () => {
    const offset: Zone = { x: 500, y: 200, w: 1000, h: 400 }
    const fit = fitToZone('A', offset, metrics)!
    expect(fit.originX + fit.width / 2).toBeCloseTo(1000, 5)
  })

  it('returns null for an empty string', () => {
    expect(fitToZone('', ZONE, metrics)).toBeNull()
    expect(fitToZone('   ', ZONE, metrics)).toBeNull()
  })

  it('sizes every number to the field capacity, so 1 and 88 match', () => {
    // THE regression this exists for. Fitting each value on its own gives "1"
    // scale 18 and "88" scale 9 in this zone — one kid's number prints at
    // double the cap height of his team mate's. Sizing both to the widest
    // two-digit value is how a real jersey number box works.
    const tall: Zone = { x: 0, y: 0, w: 1800, h: 2400 }
    const ref = widestNumberString(2, metrics)
    const one = fitToZone('1', tall, metrics, { reference: ref })!
    const eightEight = fitToZone('88', tall, metrics, { reference: ref })!
    expect(one.scale).toBeCloseTo(eightEight.scale, 5)
  })

  it('still centres the narrow value inside the capacity-sized box', () => {
    const tall: Zone = { x: 0, y: 0, w: 1800, h: 2400 }
    const one = fitToZone('1', tall, metrics, { reference: widestNumberString(2, metrics) })!
    expect(one.originX + one.width / 2).toBeCloseTo(tall.x + tall.w / 2, 5)
    // ...and it is genuinely narrower than the box it was sized against.
    expect(one.width).toBeLessThan(tall.w)
  })

  it('every number 0..99 renders at one identical height', () => {
    const tall: Zone = { x: 900, y: 1500, w: 1800, h: 2400 }
    const ref = widestNumberString(2, metrics)
    const scales = new Set<number>()
    for (let n = 0; n <= 99; n++) {
      scales.add(fitToZone(String(n), tall, metrics, { reference: ref })!.scale)
    }
    expect(scales.size).toBe(1)
  })

  it('does NOT reference-fit names — a long surname really is set smaller', () => {
    const short = fitToZone('BEAR', ZONE, metrics)!
    const long = fitToZone('VANDERMEULEN', ZONE, metrics)!
    expect(long.scale).toBeLessThan(short.scale)
  })

  it('never lets ink cross the zone bounds, for any name length', () => {
    const corpus = [
      'A', 'BO', 'LEE', 'BEAR', 'SMITH', 'LOPEZ', 'MURPHY', 'JACKSON',
      'ANDERSON', 'RODRIGUEZ', 'BALLINGTON', 'VANDERMEULEN',
    ]
    for (const name of corpus) {
      const fit = fitToZone(name, ZONE, metrics)!
      const top = fit.baselineY - fit.ascender * fit.scale
      expect(fit.originX).toBeGreaterThanOrEqual(ZONE.x - 1e-6)
      expect(fit.originX + fit.width).toBeLessThanOrEqual(ZONE.x + ZONE.w + 1e-6)
      expect(top).toBeGreaterThanOrEqual(ZONE.y - 1e-6)
      expect(top + fit.height).toBeLessThanOrEqual(ZONE.y + ZONE.h + 1e-6)
    }
  })

  it('never lets ink cross the zone bounds, for any number 0..99', () => {
    const tall: Zone = { x: 900, y: 1500, w: 1800, h: 2400 }
    for (let n = 0; n <= 99; n++) {
      const fit = fitToZone(String(n), tall, metrics)!
      expect(fit.originX).toBeGreaterThanOrEqual(tall.x - 1e-6)
      expect(fit.originX + fit.width).toBeLessThanOrEqual(tall.x + tall.w + 1e-6)
    }
  })
})

describe('archPlacements', () => {
  it('returns one placement per glyph', () => {
    expect(archPlacements('BEAR', 18, 1000)).toHaveLength(4)
  })

  it('is a flat baseline at arch 0', () => {
    const flat = archPlacements('BEAR', 0, 1000)
    expect(flat.every((p) => p.rotation === 0)).toBe(true)
    expect(flat.every((p) => p.dy === 0)).toBe(true)
  })

  it('is symmetric: the first and last glyph mirror each other', () => {
    const arc = archPlacements('BEAR', 18, 1000)
    expect(arc[0].rotation).toBeCloseTo(-arc[3].rotation, 5)
    expect(arc[0].dy).toBeCloseTo(arc[3].dy, 5)
  })

  it('is a rainbow for a positive arch: the centre rises, the ends fall', () => {
    // This is the shape of BEAR over the number on the real shirt.
    // SVG y grows downward, so "higher" means a smaller dy.
    const arc = archPlacements('BEARS', 18, 1000)
    const centre = arc[2]
    expect(centre.dy).toBeLessThan(arc[0].dy)
    expect(centre.dy).toBeLessThan(arc[4].dy)
  })

  it('is a valley for a negative arch', () => {
    const arc = archPlacements('BEARS', -18, 1000)
    expect(arc[2].dy).toBeGreaterThan(arc[0].dy)
  })

  it('straddles the baseline instead of sitting entirely above it', () => {
    // If the ends were pinned at 0 the whole string would ride half a sagitta
    // high and an arched name would climb out of the top of its zone.
    const arc = archPlacements('BEARS', 18, 1000)
    const dys = arc.map((p) => p.dy)
    expect(Math.min(...dys)).toBeLessThan(0)
    expect(Math.max(...dys)).toBeGreaterThan(0)
    expect(Math.min(...dys)).toBeCloseTo(-Math.max(...dys), 5)
  })

  it('rotates each glyph to the tangent, increasing left to right', () => {
    const arc = archPlacements('BEARS', 18, 1000)
    for (let i = 1; i < arc.length; i++) {
      expect(arc[i].rotation).toBeGreaterThan(arc[i - 1].rotation)
    }
  })

  it('spans exactly the requested sweep', () => {
    const arc = archPlacements('BEAR', 18, 1000)
    expect(arc[arc.length - 1].rotation - arc[0].rotation).toBeCloseTo(18, 5)
  })

  it('handles a single glyph without dividing by zero', () => {
    const arc = archPlacements('9', 18, 1000)
    expect(arc).toEqual([{ index: 0, dy: 0, rotation: 0 }])
  })

  it('handles an empty string', () => {
    expect(archPlacements('', 18, 1000)).toEqual([])
  })

  it('arches more sharply as the sweep grows', () => {
    const gentle = archPlacements('BEARS', 10, 1000)
    const steep = archPlacements('BEARS', 40, 1000)
    // Compare the centre glyph: the ends are symmetric about the baseline and
    // an end-to-end comparison would miss a change in curvature.
    expect(Math.abs(steep[2].dy)).toBeGreaterThan(Math.abs(gentle[2].dy))
  })
})

describe('fitToZone with an arch', () => {
  it('shrinks an arched string so the risen centre still fits the zone', () => {
    // 'AB' is height-limited in this zone, which is where the arch can bind.
    // (A width-limited string keeps its scale: the arc costs height, not width.)
    const flat = fitToZone('AB', ZONE, metrics, { arch: 0 })!
    const arched = fitToZone('AB', ZONE, metrics, { arch: 30 })!
    expect(arched.scale).toBeLessThan(flat.scale)
  })

  it('also shrinks a WIDTH-limited string, because rotation widens the ends', () => {
    // The arc costs width as well as height: each end glyph is rotated about
    // its own centre, which swings its corners outside the flat chord.
    // Measured on real pixels, VANDERMEULEN at arch 18 overran its zone by
    // 12px at press resolution before the width budget accounted for this.
    const flat = fitToZone('VANDERMEULEN', ZONE, metrics, { arch: 0 })!
    const arched = fitToZone('VANDERMEULEN', ZONE, metrics, { arch: 18 })!
    expect(arched.scale).toBeLessThan(flat.scale)
    // ...but only slightly. A big drop here would mean arched names render
    // noticeably smaller than flat ones for no visible reason.
    expect(arched.scale).toBeGreaterThan(flat.scale * 0.9)
  })

  it('keeps arched ink inside the zone on every axis, for any name length', () => {
    // The bound that the flat-only property test quietly missed: fitting the
    // flat string and then arching it lifts the middle glyphs out of the top.
    const corpus = ['BO', 'BEAR', 'SMITH', 'MURPHY', 'ANDERSON', 'VANDERMEULEN']
    for (const arch of [0, 12, 18, 30, -18]) {
      for (const name of corpus) {
        const fit = fitToZone(name, ZONE, metrics, { arch })!
        const places = archPlacements(name, arch, fit.width)
        const lift = Math.max(...places.map((p) => -p.dy), 0)
        const drop = Math.max(...places.map((p) => p.dy), 0)
        const top = fit.baselineY - fit.ascender * fit.scale - lift
        const bottom = fit.baselineY - metrics(name).descender * fit.scale + drop

        expect(fit.originX).toBeGreaterThanOrEqual(ZONE.x - 1e-6)
        expect(fit.originX + fit.width).toBeLessThanOrEqual(ZONE.x + ZONE.w + 1e-6)
        expect(top).toBeGreaterThanOrEqual(ZONE.y - 1e-6)
        expect(bottom).toBeLessThanOrEqual(ZONE.y + ZONE.h + 1e-6)
      }
    }
  })
})

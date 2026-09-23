import { describe, it, expect } from 'vitest'
import { buildFieldSvg, buildLayerSvg } from './svg.js'
import { loadFont } from './fonts.js'
import type { TeamField } from '../../../shared/team-template.js'

const FIELD: TeamField = {
  key: 'name',
  label: 'Last name',
  type: 'text',
  max: 12,
  uppercase: true,
  zone: { x: 100, y: 100, w: 1000, h: 400 },
  arch: 18,
  font: { family: 'varsity-block', src: 'house' },
  fill: '#8C1D2D',
  strokes: [
    { color: '#F2E0BC', w: 26 },
    { color: '#FFFFFF', w: 12 },
  ],
  offset: { dx: 20, dy: 24, color: '#C9A227' },
}

const flat = (over: Partial<TeamField> = {}): TeamField => ({ ...FIELD, arch: 0, ...over })

async function font() {
  return loadFont({ family: 'varsity-block', src: 'house' })
}

const passes = (svg: string) => [...svg.matchAll(/data-pass="([a-z0-9-]+)"/g)].map((m) => m[1])

describe('buildFieldSvg', () => {
  it('draws shadow, then strokes widest-first, then the fill LAST', async () => {
    const svg = buildFieldSvg('BEAR', flat(), await font())!
    expect(passes(svg)).toEqual(['shadow', 'stroke-0', 'stroke-1', 'fill'])
  })

  it('doubles the EFFECTIVE stroke width, because SVG centres strokes on the path', async () => {
    // A 26px visual outline needs 52 canvas px of stroke: half of it is hidden
    // under the fill drawn on top.
    //
    // Paths are emitted in FONT units inside a scaled group, so the attribute
    // is not 52 — it is 52/scale, and it is the product that has to come out
    // right. Asserting the literal would pass only by accident of scale.
    const svg = buildFieldSvg('BEAR', flat(), await font())!
    const scale = Number(/scale\(([0-9.]+)\)/.exec(svg)![1])
    const widths = [...svg.matchAll(/stroke-width="([0-9.]+)"/g)].map((m) => Number(m[1]) * scale)
    expect(widths[0]).toBeCloseTo(52, 6)
    expect(widths[1]).toBeCloseTo(24, 6)
  })

  it('keeps the offset shadow at its stated canvas distance', async () => {
    // Same trap as the stroke: the shadow translate lives inside the scaled
    // group, so dx/dy must be divided by scale to land 20/24 px away.
    const svg = buildFieldSvg('BEAR', flat(), await font())!
    const scale = Number(/scale\(([0-9.]+)\)/.exec(svg)![1])
    const shadow = /data-pass="shadow"[^>]*transform="translate\(([0-9.]+) ([0-9.]+)\)"/.exec(svg)!
    expect(Number(shadow[1]) * scale).toBeCloseTo(20, 6)
    expect(Number(shadow[2]) * scale).toBeCloseTo(24, 6)
  })

  it('never emits paint-order', async () => {
    // librsvg's support is inconsistent and a silently-ignored attribute ships
    // un-outlined letters with no error anywhere. The stacked copies above are
    // the deliberate alternative.
    const svg = buildFieldSvg('BEAR', flat(), await font())!
    expect(svg).not.toContain('paint-order')
  })

  it('contains no <text> element — there is nothing left to fall back on', async () => {
    const svg = buildFieldSvg('BEAR', flat(), await font())!
    expect(svg).not.toContain('<text')
    expect(svg).not.toContain('font-family')
    expect(svg).toContain('<path')
  })

  it('omits the shadow pass when the field has no offset', async () => {
    const svg = buildFieldSvg('BEAR', flat({ offset: null }), await font())!
    expect(passes(svg)).toEqual(['stroke-0', 'stroke-1', 'fill'])
  })

  it('omits stroke passes when the field has none', async () => {
    const svg = buildFieldSvg('BEAR', flat({ strokes: [], offset: null }), await font())!
    expect(passes(svg)).toEqual(['fill'])
  })

  it('emits one glyph group per character when arched', async () => {
    const svg = buildFieldSvg('BEAR', FIELD, await font())!
    expect([...svg.matchAll(/<g data-glyph="/g)]).toHaveLength(4)
  })

  it('emits a single group when flat — no per-glyph transform is needed', async () => {
    const svg = buildFieldSvg('BEAR', flat(), await font())!
    expect([...svg.matchAll(/<g data-glyph="/g)]).toHaveLength(0)
  })

  it('returns null for an empty value rather than an empty layer', async () => {
    expect(buildFieldSvg('', flat(), await font())).toBeNull()
    expect(buildFieldSvg('   ', flat(), await font())).toBeNull()
  })

  it('sizes numbers to field capacity so 1 and 88 come out the same height', async () => {
    const numberField = flat({ key: 'number', type: 'number', max: 2, strokes: [], offset: null })
    const f = await font()
    const one = buildFieldSvg('1', numberField, f)!
    const eightEight = buildFieldSvg('88', numberField, f)!
    const scaleOf = (svg: string) => Number(/scale\(([0-9.]+)\)/.exec(svg)![1])
    expect(scaleOf(one)).toBeCloseTo(scaleOf(eightEight), 6)
  })

  it('does not capacity-fit a text field', async () => {
    const f = await font()
    const scaleOf = (svg: string) => Number(/scale\(([0-9.]+)\)/.exec(svg)![1])
    const short = buildFieldSvg('BO', flat(), f)!
    const long = buildFieldSvg('VANDERMEULEN', flat(), f)!
    expect(scaleOf(long)).toBeLessThan(scaleOf(short))
  })
})

describe('buildLayerSvg', () => {
  it('wraps every field in one canvas-sized svg', async () => {
    const svg = await buildLayerSvg(
      { w: 3600, h: 4800 },
      [
        { field: FIELD, value: 'BEAR' },
        { field: flat({ key: 'number', type: 'number', max: 2 }), value: '9' },
      ]
    )
    expect(svg).toContain('width="3600"')
    expect(svg).toContain('height="4800"')
    expect(svg).toContain('viewBox="0 0 3600 4800"')
  })

  it('skips fields whose value is empty instead of failing the render', async () => {
    const svg = await buildLayerSvg({ w: 3600, h: 4800 }, [
      { field: FIELD, value: 'BEAR' },
      { field: flat({ key: 'number', type: 'number' }), value: '' },
    ])
    expect(svg).toContain('data-field="name"')
    expect(svg).not.toContain('data-field="number"')
  })

  it('returns null when nothing at all has a value', async () => {
    const svg = await buildLayerSvg({ w: 3600, h: 4800 }, [{ field: FIELD, value: '' }])
    expect(svg).toBeNull()
  })
})

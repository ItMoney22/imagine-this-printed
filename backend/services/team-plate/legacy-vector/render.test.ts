import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { renderTeamPlate } from './render.js'
import type { TeamTemplate } from '../../../shared/team-template.js'

const CANVAS = { w: 1200, h: 1600, dpi: 300 }

const TEMPLATE: TeamTemplate = {
  version: 1,
  side: 'back_image',
  plateAssetId: 'plate',
  sourceAssetId: null,
  distressAssetId: null,
  canvas: CANVAS,
  halftone: false,
  upcharge: 0,
  fields: [
    {
      key: 'name',
      label: 'Last name',
      type: 'text',
      max: 12,
      uppercase: true,
      zone: { x: 100, y: 150, w: 1000, h: 300 },
      arch: 0,
      font: { family: 'varsity-block', src: 'house' },
      fill: '#8C1D2D',
      strokes: [],
      offset: null,
    },
    {
      key: 'number',
      label: 'Number',
      type: 'number',
      max: 2,
      uppercase: false,
      zone: { x: 300, y: 600, w: 600, h: 800 },
      arch: 0,
      font: { family: 'varsity-block', src: 'house' },
      fill: '#C9A227',
      strokes: [],
      offset: null,
    },
  ],
}

/** A flat white plate to composite onto. */
async function plate(): Promise<Buffer> {
  return sharp({
    create: { width: CANVAS.w, height: CANVAS.h, channels: 4, background: '#FFFFFF' },
  })
    .png()
    .toBuffer()
}

/** A mask that is opaque on the left half and transparent on the right. */
async function halfMask(): Promise<Buffer> {
  const left = await sharp({
    create: { width: CANVAS.w / 2, height: CANVAS.h, channels: 4, background: '#000000' },
  })
    .png()
    .toBuffer()
  return sharp({
    create: {
      width: CANVAS.w,
      height: CANVAS.h,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: left, left: 0, top: 0 }])
    .png()
    .toBuffer()
}

/** RGBA at one pixel. */
async function pixelAt(png: Buffer, x: number, y: number) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * info.channels
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] }
}

const near = (actual: number, expected: number, tol = 12) => Math.abs(actual - expected) <= tol

describe('renderTeamPlate', () => {
  it('returns a PNG at the template canvas size by default', async () => {
    const out = await renderTeamPlate(TEMPLATE, { name: 'SMITH', number: '22' }, { plate: await plate() })
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBe(CANVAS.w)
    expect(meta.height).toBe(CANVAS.h)
  })

  it('renders at any requested width, keeping the canvas aspect ratio', async () => {
    const out = await renderTeamPlate(
      TEMPLATE,
      { name: 'SMITH', number: '22' },
      { plate: await plate() },
      { width: 300 }
    )
    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(300)
    expect(meta.height).toBe(400)
  })

  it('draws the name in its fill colour inside the name zone', async () => {
    const out = await renderTeamPlate(TEMPLATE, { name: 'SMITH', number: '' }, { plate: await plate() })
    // Sample a band across the middle of the name zone and find maroon ink.
    const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let maroon = 0
    const y = 300
    for (let x = 100; x < 1100; x++) {
      const i = (y * info.width + x) * info.channels
      if (near(data[i], 0x8c, 24) && near(data[i + 1], 0x1d, 24) && near(data[i + 2], 0x2d, 24)) maroon++
    }
    expect(maroon).toBeGreaterThan(20)
  })

  it('leaves the plate untouched outside every zone', async () => {
    const out = await renderTeamPlate(TEMPLATE, { name: 'SMITH', number: '22' }, { plate: await plate() })
    const corner = await pixelAt(out, 5, 5)
    expect(corner).toEqual({ r: 255, g: 255, b: 255, a: 255 })
  })

  it('returns the bare plate when nothing has been typed yet', async () => {
    const bare = await plate()
    const out = await renderTeamPlate(TEMPLATE, { name: '', number: '' }, { plate: bare })
    const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    let nonWhite = 0
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) nonWhite++
    }
    expect(nonWhite).toBe(0)
  })

  it('renders the same picture at 300px as at 1200px, allowing for resampling', async () => {
    // The guarantee the whole feature rests on: what the customer approved in
    // the preview is what the press receives.
    const big = await renderTeamPlate(TEMPLATE, { name: 'SMITH', number: '22' }, { plate: await plate() })
    const small = await renderTeamPlate(
      TEMPLATE,
      { name: 'SMITH', number: '22' },
      { plate: await plate() },
      { width: 300 }
    )
    const shrunk = await sharp(big).resize(300, 400, { fit: 'fill' }).raw().toBuffer()
    const direct = await sharp(small).raw().toBuffer()
    let diff = 0
    for (let i = 0; i < direct.length; i++) diff += Math.abs(direct[i] - shrunk[i])
    const meanDiff = diff / direct.length
    expect(meanDiff).toBeLessThan(6)
  })

  it('uses the distress mask to REMOVE ink, not to darken it', async () => {
    // dest-in: where the mask is transparent the letters must be gone entirely,
    // leaving the plate showing through — not a darker version of the fill.
    const masked = await renderTeamPlate(
      TEMPLATE,
      { name: 'SMITH', number: '22' },
      { plate: await plate(), distress: await halfMask() }
    )
    const unmasked = await renderTeamPlate(
      TEMPLATE,
      { name: 'SMITH', number: '22' },
      { plate: await plate() }
    )
    const inkIn = async (png: Buffer, from: number, to: number) => {
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let ink = 0
      for (let y = 150; y < 450; y++) {
        for (let x = from; x < to; x++) {
          const i = (y * info.width + x) * info.channels
          if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) ink++
        }
      }
      return ink
    }
    // Right half was masked away entirely; left half survives.
    expect(await inkIn(masked, 600, 1100)).toBe(0)
    expect(await inkIn(unmasked, 600, 1100)).toBeGreaterThan(0)
    expect(await inkIn(masked, 100, 600)).toBeGreaterThan(0)
  })

  it('keeps every drawn pixel inside its zone, for a corpus of names and arches', async () => {
    // Rendered small and reduced to an ink BOUNDING BOX, then asserted once.
    // Scanning 1200x1600 with a per-pixel expect() is ~2M assertions per name
    // and times out long before it tells you anything.
    const W = 300
    const k = W / CANVAS.w
    for (const arch of [0, 18, -18]) {
      const nameOnly = { ...TEMPLATE, fields: [{ ...TEMPLATE.fields[0], arch }] }
      const zone = nameOnly.fields[0].zone
      for (const name of ['A', 'BEAR', 'SMITH', 'ANDERSON', 'VANDERMEULEN']) {
        const out = await renderTeamPlate(nameOnly, { name }, { plate: await plate() }, { width: W })
        const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        for (let y = 0; y < info.height; y++) {
          for (let x = 0; x < info.width; x++) {
            const i = (y * info.width + x) * info.channels
            if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255) continue
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
        // 1px of slack for antialiasing at the glyph edge.
        expect({ name, arch, over: minX >= zone.x * k - 1 }).toEqual({ name, arch, over: true })
        expect({ name, arch, over: maxX <= (zone.x + zone.w) * k + 1 }).toEqual({ name, arch, over: true })
        expect({ name, arch, over: minY >= zone.y * k - 1 }).toEqual({ name, arch, over: true })
        expect({ name, arch, over: maxY <= (zone.y + zone.h) * k + 1 }).toEqual({ name, arch, over: true })
      }
    }
  }, 30_000)
})

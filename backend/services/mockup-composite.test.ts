import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { compositeMockup, garmentBoxFromAlpha } from './mockup-composite.js'

/** A crude white "garment" cut-out: an opaque blob with a fold gradient, on alpha 0. */
async function blankBase(size = 300): Promise<Buffer> {
  const raw = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const inGarment = x > size * 0.15 && x < size * 0.85 && y > size * 0.12 && y < size * 0.9
      // A vertical fold so the shading path has something real to sample.
      const fold = 235 + Math.round(20 * Math.sin((x / size) * Math.PI * 4))
      raw[i] = raw[i + 1] = raw[i + 2] = inGarment ? fold : 0
      raw[i + 3] = inGarment ? 255 : 0
    }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer()
}

/** A saturated design on a transparent field — a print file's shape. */
async function design(size = 200): Promise<Buffer> {
  const raw = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const inArt = Math.hypot(x - size / 2, y - size / 2) < size * 0.35
      raw[i] = 20; raw[i + 1] = 60; raw[i + 2] = 245
      raw[i + 3] = inArt ? 255 : 0
    }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer()
}

async function px(buf: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * 4
  return [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

describe('garmentBoxFromAlpha', () => {
  it('finds the silhouette, not the frame', async () => {
    const base = await blankBase(200)
    const { data, info } = await sharp(base).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const box = garmentBoxFromAlpha(data, info.width, info.height, 4)
    expect(box.left).toBeGreaterThan(20)
    expect(box.top).toBeGreaterThan(15)
    expect(box.width).toBeLessThan(info.width)
    expect(box.height).toBeLessThan(info.height)
  })

  it('falls back to the whole frame when nothing is opaque', () => {
    const empty = Buffer.alloc(10 * 10 * 4)
    expect(garmentBoxFromAlpha(empty, 10, 10, 4)).toEqual({ left: 0, top: 0, width: 10, height: 10 })
  })
})

describe('compositeMockup', () => {
  it('keeps the ink colour, which is the whole point', async () => {
    const r = await compositeMockup({ base: await blankBase(), design: await design(), size: 600 })
    const mid = await px(r.buffer, r.printBox.left + Math.round(r.printBox.width / 2), r.printBox.top + Math.round(r.printBox.height / 2))
    // The source ink is (20, 60, 245). Fold shading may modulate it, but the
    // generative renders lost 15-30% of saturation here and this must not.
    const [red, green, blue] = mid
    expect(blue).toBeGreaterThan(200)
    expect(blue - red).toBeGreaterThan(120)
    expect(blue - green).toBeGreaterThan(100)
  })

  it('does not paint a rectangle around the artwork', async () => {
    // The first attempt at this used sharp's multiply blend, which flattened
    // the design's alpha and stamped an opaque white box onto the garment.
    const r = await compositeMockup({ base: await blankBase(), design: await design(), size: 600, colorHex: '#111111' })
    const corner = await px(r.buffer, r.printBox.left + 3, r.printBox.top + 3)
    // The design is a circle, so its bounding-box corner is transparent and the
    // black garment must show through there.
    expect(corner[0]).toBeLessThan(90)
    expect(corner[2]).toBeLessThan(90)
  })

  it('tints the garment to the exact colour without touching the ink', async () => {
    const r = await compositeMockup({ base: await blankBase(), design: await design(), size: 600, colorHex: '#1f2a44' })
    const shoulder = await px(r.buffer, r.garmentBox.left + 12, r.garmentBox.top + 12)
    expect(shoulder[2]).toBeGreaterThan(shoulder[0]) // navy: blue above red
    expect(shoulder[0]).toBeLessThan(80)
  })

  it('places the print relative to the garment, not the frame', async () => {
    const base = await blankBase()
    const d = await design()
    const small = await compositeMockup({ base, design: d, size: 500 })
    const large = await compositeMockup({ base, design: d, size: 1000 })
    // Same fraction of the garment in both, so the print sits on the same part
    // of the chest whatever the output size.
    const fracSmall = (small.printBox.top - small.garmentBox.top) / small.garmentBox.height
    const fracLarge = (large.printBox.top - large.garmentBox.top) / large.garmentBox.height
    expect(Math.abs(fracSmall - fracLarge)).toBeLessThan(0.02)
  })

  it('honours a wider print box', async () => {
    const base = await blankBase()
    const d = await design()
    const narrow = await compositeMockup({ base, design: d, size: 600, printWidth: 0.3 })
    const wide = await compositeMockup({ base, design: d, size: 600, printWidth: 0.6 })
    expect(wide.printBox.width).toBeGreaterThan(narrow.printBox.width)
  })
})

import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { vectorize } from './vectorize.js'

const W = 200

/** Flat art on a transparent field — the shape a garment print file has. */
async function art(px: (x: number, y: number) => [number, number, number, number]): Promise<Buffer> {
  const raw = Buffer.alloc(W * W * 4)
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const [r, g, b, a] = px(x, y)
    const i = (y * W + x) * 4
    raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a
  }
  return sharp(raw, { raw: { width: W, height: W, channels: 4 } }).png().toBuffer()
}

const inBox = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) =>
  x >= x0 && x <= x1 && y >= y0 && y <= y1

describe('vectorize', () => {
  it('traces artwork into an SVG that carries a viewBox', async () => {
    const img = await art((x, y) => (inBox(x, y, 40, 40, 160, 160) ? [220, 40, 40, 255] : [0, 0, 0, 0]))
    const r = await vectorize(img)
    expect(r.svg).toContain('<svg')
    // Without a viewBox the SVG carries the SAMPLE's pixel size and stops being
    // resolution-independent, which is the entire reason to trace it.
    expect(r.svg).toContain('viewBox')
    expect(r.regions).toBeGreaterThan(0)
    // Reports the SOURCE dimensions, not the downsampled trace size.
    expect(r.width).toBe(W)
    expect(r.height).toBe(W)
  })

  it('renders back to the same artwork', async () => {
    const img = await art((x, y) => (inBox(x, y, 40, 40, 160, 160) ? [220, 40, 40, 255] : [0, 0, 0, 0]))
    const { svg } = await vectorize(img)
    const { data, info } = await sharp(Buffer.from(svg)).resize(W, W, { fit: 'fill' })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const at = (x: number, y: number) => { const i = (y * info.width + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]] }
    const [r, g, b, a] = at(100, 100)
    expect(a).toBeGreaterThan(200)
    expect(r).toBeGreaterThan(150)   // still red
    expect(g).toBeLessThan(120)
    expect(b).toBeLessThan(120)
    expect(at(5, 5)[3]).toBeLessThan(60)  // the transparent field stays empty
  })

  it('drops speckle at a higher floor', async () => {
    // One big shape plus a scatter of single-pixel flecks, the exact thing that
    // turned a real design into 17,913 paths and a 4 MB file.
    const fleck = (x: number, y: number) => x % 20 < 5 && y % 20 < 5
    const img = await art((x, y) => {
      if (inBox(x, y, 40, 40, 160, 160)) return [220, 40, 40, 255]
      if (fleck(x, y)) return [20, 20, 20, 255]
      return [0, 0, 0, 0]
    })
    const loose = await vectorize(img, { despeckle: 0 })
    const tight = await vectorize(img, { despeckle: 64 })
    expect(tight.regions).toBeLessThan(loose.regions)
  })

  it('keeps the palette bounded', async () => {
    const img = await art((x, y) => [x % 256, y % 256, (x * y) % 256, 255])
    const r = await vectorize(img, { colors: 8 })
    expect(r.colors).toBe(8)
    const r2 = await vectorize(img, { colors: 999 })
    expect(r2.colors).toBe(64)
  })
})

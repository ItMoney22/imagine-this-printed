import { describe, it, expect } from 'vitest'
import { silhouette, squareShare, otsu } from './logo-silhouette'

/** A w x h RGBA image filled by a per-pixel function. */
function image(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(px(x, y), (y * w + x) * 4)
  return data
}

describe('logo silhouette (gen.py logo_silhouette in TypeScript)', () => {
  it('prints a dark mark on a white sheet and crops to it', () => {
    const data = image(40, 40, (x, y) => (x >= 10 && x < 30 && y >= 15 && y < 25 ? [60, 30, 20, 255] : [255, 255, 255, 255]))
    const s = silhouette(data, 40, 40)!
    expect([s.w, s.h]).toEqual([20, 10])
    expect(s.mask.every((v) => v === 1)).toBe(true)
  })

  it('reads the background off the border, so a light mark on a dark sheet prints too', () => {
    const data = image(30, 30, (x, y) => (x >= 10 && x < 20 && y >= 10 && y < 20 ? [250, 250, 250, 255] : [20, 20, 90, 255]))
    const s = silhouette(data, 30, 30)!
    expect([s.w, s.h]).toEqual([10, 10])
  })

  it('reads a white logo on a clear sheet against black instead of losing it', () => {
    const data = image(30, 30, (x, y) => (x >= 5 && x < 25 && y >= 5 && y < 25 ? [255, 255, 255, 255] : [0, 0, 0, 0]))
    const s = silhouette(data, 30, 30)!
    expect([s.w, s.h]).toEqual([20, 20])
    expect(squareShare(s)).toBe(1)
  })

  it('finds nothing in a blank sheet', () => {
    expect(silhouette(image(10, 10, () => [255, 255, 255, 255]), 10, 10)).toBeNull()
  })

  it('splits two clear groups with Otsu', () => {
    const t = otsu([10, 12, 11, 200, 205, 198])
    expect(t).toBeGreaterThanOrEqual(12)
    expect(t).toBeLessThan(198)
  })
})

import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { detectSolidBg, keyOutSolidBackground, keyOutConnectedBackground } from './bg-key.js'

const W = 100

/** Build a test image from a per-pixel colour function. */
async function make(px: (x: number, y: number) => [number, number, number]): Promise<Buffer> {
  const raw = Buffer.alloc(W * W * 3)
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = px(x, y)
      const i = (y * W + x) * 3
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b
    }
  }
  return sharp(raw, { raw: { width: W, height: W, channels: 3 } }).png().toBuffer()
}

async function alphaAt(png: Buffer, x: number, y: number): Promise<number> {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return data[(y * W + x) * 4 + 3]
}

const inBox = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) =>
  x >= x0 && x <= x1 && y >= y0 && y <= y1

describe('keyOutConnectedBackground', () => {
  // The bug David hit: the cherry-blossom branch was a separate island of art,
  // so subject segmentation deleted it. A connectivity keyer must keep it.
  it('keeps a disconnected island of artwork that AI subject segmentation drops', async () => {
    const img = await make((x, y) =>
      inBox(x, y, 20, 20, 50, 50) || inBox(x, y, 80, 80, 90, 90) ? [255, 255, 255] : [0, 0, 0])
    const out = await keyOutConnectedBackground(img, 'black')
    expect(await alphaAt(out, 35, 35)).toBe(255)  // main subject
    expect(await alphaAt(out, 85, 85)).toBe(255)  // the "blossoms"
    expect(await alphaAt(out, 5, 5)).toBe(0)      // background
  })

  // The regression the plain colour key caused: black hair read as background.
  it('preserves dark artwork enclosed by lighter artwork (the hair case)', async () => {
    const img = await make((x, y) => {
      if (inBox(x, y, 40, 40, 50, 50)) return [8, 8, 8]        // dark, but real art
      if (inBox(x, y, 20, 20, 70, 70)) return [255, 255, 255]  // encloses it
      return [0, 0, 0]
    })
    const out = await keyOutConnectedBackground(img, 'black')
    expect(await alphaAt(out, 45, 45)).toBe(255)
    // The old colour-only keyer is exactly what got this wrong.
    const old = await keyOutSolidBackground(img, 'black')
    expect(await alphaAt(old, 45, 45)).toBe(0)
  })

  // ...but a hole that is the SAME ink as the background really is background,
  // otherwise gaps inside the branch print as black blobs on a white shirt.
  it('clears an enclosed pocket whose ink matches the background', async () => {
    const img = await make((x, y) => {
      if (inBox(x, y, 40, 40, 50, 50)) return [0, 0, 0]        // same ink as bg
      if (inBox(x, y, 20, 20, 70, 70)) return [255, 255, 255]
      return [0, 0, 0]
    })
    const out = await keyOutConnectedBackground(img, 'black')
    expect(await alphaAt(out, 45, 45)).toBe(0)
    expect(await alphaAt(out, 25, 25)).toBe(255)
  })

  it('works symmetrically on a white background', async () => {
    const img = await make((x, y) =>
      inBox(x, y, 20, 20, 50, 50) || inBox(x, y, 80, 80, 90, 90) ? [0, 0, 0] : [255, 255, 255])
    expect(await detectSolidBg(img)).toBe('white')
    const out = await keyOutConnectedBackground(img, 'white')
    expect(await alphaAt(out, 35, 35)).toBe(255)
    expect(await alphaAt(out, 85, 85)).toBe(255)
    expect(await alphaAt(out, 5, 5)).toBe(0)
  })

  it('leaves the image untouched when no border pixel is background', async () => {
    const img = await make(() => [200, 120, 60]) // full-bleed art, nothing to key
    const out = await keyOutConnectedBackground(img, 'black')
    expect(await alphaAt(out, 5, 5)).toBe(255)
    expect(await alphaAt(out, 50, 50)).toBe(255)
  })

  it('does not let the fill leak through mid-dark artwork touching the edge', async () => {
    // Navy robe (max channel 75) is well above the candidate cutoff, so the
    // fill must stop at it even though it runs to the border.
    const img = await make((x, y) => (y > 60 ? [40, 50, 75] : [0, 0, 0]))
    const out = await keyOutConnectedBackground(img, 'black')
    expect(await alphaAt(out, 50, 80)).toBe(255)
    expect(await alphaAt(out, 50, 10)).toBe(0)
  })
})

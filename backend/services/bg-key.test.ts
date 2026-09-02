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

  // Guard against the thresholds chasing the border colour: a full-bleed image
  // has a uniform border that IS artwork, and adapting to it would erase
  // everything. (detectSolidBg also refuses this image, so in the pipeline it
  // never gets here - this pins the function's own behaviour.)
  it('leaves a full-bleed image untouched instead of adapting to its own ink', async () => {
    const img = await make(() => [200, 120, 60])
    expect(await detectSolidBg(img)).toBeNull()
    const out = await keyOutConnectedBackground(img, 'black')
    expect(await alphaAt(out, 5, 5)).toBe(255)
    expect(await alphaAt(out, 50, 50)).toBe(255)
  })

  // Artwork running off the edge must not drag the thresholds up. The samurai's
  // branch does exactly this: his border averages 8.3 but is truly 0, and a
  // mean-based estimate erased his hair.
  it('ignores artwork touching the border when measuring the field', async () => {
    const img = await make((x, y) => {
      if (y >= 30 && y <= 40) return [230, 190, 200]   // a branch running off both edges
      if (inBox(x, y, 45, 50, 70, 70)) return [9, 9, 9]  // near-black art, enclosed
      return [0, 0, 0]
    })
    const out = await keyOutConnectedBackground(img, 'black')
    expect(await alphaAt(out, 2, 2)).toBe(0)     // field still keyed out
    expect(await alphaAt(out, 5, 35)).toBe(255)  // the branch survives at the edge
    // Near-black ink sitting in the field survives on the ramp. This is the
    // assertion that matters: the mean of this border is ~8 because of the
    // branch, and thresholds built on that erase everything under key 10 -
    // which is what stripped the samurai's hair. The median reads 0, so this
    // keeps real alpha.
    expect(await alphaAt(out, 55, 60)).toBeGreaterThan(100)
  })

  // The Aqua Sprinter Cheetah regression: a 'black' field that actually sits at
  // ~12/255. Absolute thresholds scored it 71% opaque and the background came
  // out dark grey instead of transparent.
  it('fully clears a black field that is dark grey rather than pure black', async () => {
    const img = await make((x, y) =>
      inBox(x, y, 20, 20, 60, 60) ? [240, 180, 60] : [12, 12, 12])
    expect(await detectSolidBg(img)).toBe('black')
    const out = await keyOutConnectedBackground(img, 'black')
    expect(await alphaAt(out, 3, 3)).toBe(0)
    expect(await alphaAt(out, 40, 40)).toBe(255)
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

import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { detectSolidBg, keyOutSolidBackground, keyOutConnectedBackground, restoreEnclosedInk } from './bg-key.js'

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

/** Mean and population std of a 96x96 border ring — the measurement
 *  `detectSolidBg` used to be judged on, kept here so the fixtures below can
 *  PROVE they are the case that measurement gets wrong. */
async function ringMeanStd(png: Buffer): Promise<{ mean: number; std: number }> {
  const { data, info } = await sharp(png).ensureAlpha().resize(96, 96, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  const l: number[] = []
  const at = (x: number, y: number) => { const i = (y * info.width + x) * 4; l.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) }
  for (let x = 0; x < info.width; x++) { at(x, 0); at(x, info.height - 1) }
  for (let y = 0; y < info.height; y++) { at(0, y); at(info.width - 1, y) }
  const mean = l.reduce((a, b) => a + b, 0) / l.length
  return { mean, std: Math.sqrt(l.reduce((a, b) => a + (b - mean) ** 2, 0) / l.length) }
}

describe('detectSolidBg', () => {
  // The Gnome Abduction bug. The design is drawn on dead-flat black, but its
  // lime tractor beam runs off the bottom of the frame. Judged on the whole
  // ring's mean and deviation that reads as "not a solid background", the
  // design falls through to AI subject segmentation, and segmentation deletes
  // the speech bubble floating free in the corner. The field is flat; only the
  // art crossing the edge is not.
  it('sees the field under artwork that bleeds off the frame', async () => {
    const img = await make((x, y) => {
      if (y > 70 && x >= 28 && x <= 74) return [140, 200, 60]   // beam crossing the bottom edge
      if (inBox(x, y, 8, 20, 28, 38)) return [255, 255, 255]    // the detached speech bubble
      if (inBox(x, y, 40, 30, 70, 65)) return [230, 60, 60]     // the subject
      return [0, 0, 0]
    })
    // This fixture IS the hard case: the old whole-ring test rejects it.
    const { std } = await ringMeanStd(img)
    expect(std).toBeGreaterThan(45)

    expect(await detectSolidBg(img)).toBe('black')

    // And through the keyer the bubble survives, which is the whole point.
    const out = await keyOutConnectedBackground(img, 'black')
    expect(await alphaAt(out, 18, 29)).toBe(255)  // the bubble
    expect(await alphaAt(out, 50, 90)).toBe(255)  // the beam at the edge
    expect(await alphaAt(out, 2, 2)).toBe(0)      // field gone
  })

  it('sees a white field under artwork that bleeds off the frame', async () => {
    const img = await make((x, y) => {
      if (y > 70 && x >= 28 && x <= 74) return [20, 40, 30]
      if (inBox(x, y, 8, 20, 28, 38)) return [0, 0, 0]
      return [255, 255, 255]
    })
    expect((await ringMeanStd(img)).std).toBeGreaterThan(45)
    expect(await detectSolidBg(img)).toBe('white')
  })

  // The other half of the gate: a photograph has no flat field to key, and
  // colour-keying one would punch holes in the picture. Across the live
  // catalogue photographic borders spread 14.6-24.9 while real fields spread
  // under 10, so flatness is what separates them - not uniformity of the whole
  // ring, which the fixture above also fails.
  it('refuses a dark photographic border that has no flat field', async () => {
    const img = await make((x, y) => {
      const v = 18 + ((x * 7 + y * 11) % 46) + (y % 5) * 3   // textured near-dark scene
      return [v, v - 4, v + 6]
    })
    expect(await detectSolidBg(img)).toBeNull()
  })

  it('refuses a mid-tone border', async () => {
    expect(await detectSolidBg(await make(() => [130, 130, 130]))).toBeNull()
  })
})

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

describe('restoreEnclosedInk', () => {
  /** An RGBA png whose alpha is `a` — stands in for a segmentation mask. */
  async function mask(a: (x: number, y: number) => number): Promise<Buffer> {
    const raw = Buffer.alloc(W * W * 4)
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      raw[i] = raw[i + 1] = raw[i + 2] = 20; raw[i + 3] = a(x, y)
    }
    return sharp(raw, { raw: { width: W, height: W, channels: 4 } }).png().toBuffer()
  }

  // Black line work on a black field: the key has to drop it (it is the same
  // pixels as the background), segmentation keeps it, and the merge is what
  // gets both. Bar stops short of the shape's edges so art remains on all four
  // sides of it.
  const bar = (x: number, y: number) => inBox(x, y, 30, 48, 70, 52)
  const shape = (x: number, y: number) => inBox(x, y, 20, 20, 80, 80)

  it('restores field-coloured ink that the key drained out of the artwork', async () => {
    const img = await make((x, y) => (shape(x, y) && !bar(x, y) ? [255, 255, 255] : [0, 0, 0]))
    const keyed = await keyOutConnectedBackground(img, 'black')
    expect(await alphaAt(keyed, 50, 50)).toBe(0) // the key cannot keep the bar
    const { buffer, restored } = await restoreEnclosedInk(keyed, await mask((x, y) => (shape(x, y) ? 255 : 0)))
    expect(await alphaAt(buffer, 50, 50)).toBe(255)
    expect(restored).toBeGreaterThan(0)
  })

  // The reason this is a merge and not a plain union of the two alphas. A
  // segmenter's boundary smears background into the subject, and taking that at
  // face value is what puts a dark halo around a cutout. A halo pixel has open
  // field on at least one side, so the enclosure test rejects it.
  it('refuses mask pixels outside the artwork, so no halo comes back', async () => {
    const img = await make((x, y) => (shape(x, y) ? [255, 255, 255] : [0, 0, 0]))
    const keyed = await keyOutConnectedBackground(img, 'black')
    // A mask 6px fatter than the artwork on every side - the classic halo.
    const { buffer, restored } = await restoreEnclosedInk(keyed, await mask((x, y) => (inBox(x, y, 14, 14, 86, 86) ? 255 : 0)))
    expect(await alphaAt(buffer, 16, 50)).toBe(0)
    expect(await alphaAt(buffer, 84, 50)).toBe(0)
    expect(restored).toBe(0)
  })

  it('ignores the mask soft edge and keeps its own ramp', async () => {
    const img = await make((x, y) => (shape(x, y) && !bar(x, y) ? [255, 255, 255] : [0, 0, 0]))
    const keyed = await keyOutConnectedBackground(img, 'black')
    const soft = await mask((x, y) => (shape(x, y) ? (bar(x, y) ? 120 : 255) : 0))
    const { buffer } = await restoreEnclosedInk(keyed, soft)
    expect(await alphaAt(buffer, 50, 50)).toBe(0) // 120 is not a confident mask pixel
  })
})

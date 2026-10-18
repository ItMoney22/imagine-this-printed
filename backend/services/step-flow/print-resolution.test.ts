import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for ensurePrintResolution (backend/services/step-flow/print-resolution.ts).
//
// The orchestration takes `measure` and `upscale` as dependencies precisely so
// this file can pin the decisions — which artwork gets sent to a paid model,
// how many times, and what happens when the model fails — without a network
// call or a $0.006 charge per assertion.
// ---------------------------------------------------------------------------
import sharp from 'sharp'
import { ensurePrintResolution, restoreTransparency, type ArtworkMeasurement, type UpscaledArtwork } from './print-resolution.js'

const REQUIRED = 1200

const small: ArtworkMeasurement = { width: 1122, height: 1402, hasAlpha: true }
const big: ArtworkMeasurement = { width: 3278, height: 4096, hasAlpha: true }

const upscaleOk = (url: string): Promise<UpscaledArtwork> =>
  Promise.resolve({ url: `${url}#upscaled`, path: 'print-ready/p/1.png', width: 3278, height: 4096 })

describe('ensurePrintResolution', () => {
  it('leaves artwork alone when its short edge already clears the bar', async () => {
    const upscale = vi.fn(upscaleOk)
    const out = await ensurePrintResolution(['a.png'], REQUIRED, {
      measure: async () => big,
      upscale,
    })

    expect(upscale).not.toHaveBeenCalled()
    expect(out.get('a.png')).toMatchObject({
      url: 'a.png',
      upscaled: false,
      skipped: 'already_big_enough',
      width: 3278,
    })
  })

  it('upscales artwork whose short edge is under the bar', async () => {
    const upscale = vi.fn(upscaleOk)
    const out = await ensurePrintResolution(['front.png'], REQUIRED, {
      measure: async () => small,
      upscale,
    })

    expect(upscale).toHaveBeenCalledTimes(1)
    expect(out.get('front.png')).toMatchObject({
      url: 'front.png#upscaled',
      originalUrl: 'front.png',
      upscaled: true,
      path: 'print-ready/p/1.png',
      width: 3278,
      height: 4096,
    })
  })

  it('judges on the SHORT edge, not on either dimension alone', async () => {
    // A banner-shaped design: 4000px wide but only 900 tall. Plenty of pixels,
    // still unprintable at 4" across the narrow way.
    const upscale = vi.fn(upscaleOk)
    await ensurePrintResolution(['wide.png'], REQUIRED, {
      measure: async () => ({ width: 4000, height: 900, hasAlpha: false }),
      upscale,
    })
    expect(upscale).toHaveBeenCalledTimes(1)
  })

  it('does both sides of a two-sided product in one pass', async () => {
    const upscale = vi.fn(upscaleOk)
    const out = await ensurePrintResolution(['front.png', 'back.png'], REQUIRED, {
      measure: async () => small,
      upscale,
    })

    expect(upscale).toHaveBeenCalledTimes(2)
    expect(out.get('front.png')?.url).toBe('front.png#upscaled')
    expect(out.get('back.png')?.url).toBe('back.png#upscaled')
  })

  it('runs the upscales in parallel rather than one after the other', async () => {
    let live = 0
    let peak = 0
    const upscale = vi.fn(async (url: string) => {
      live += 1
      peak = Math.max(peak, live)
      await new Promise((r) => setTimeout(r, 10))
      live -= 1
      return { url: `${url}#up`, path: 'p', width: 3278, height: 4096 }
    })

    await ensurePrintResolution(['front.png', 'back.png'], REQUIRED, {
      measure: async () => small,
      upscale,
    })

    // Sequential would never show two in flight. A two-sided product would
    // otherwise cost a minute of waiting instead of thirty seconds.
    expect(peak).toBe(2)
  })

  it('never pays twice for the same file tagged on both sides', async () => {
    const upscale = vi.fn(upscaleOk)
    const out = await ensurePrintResolution(['same.png', 'same.png', 'same.png'], REQUIRED, {
      measure: async () => small,
      upscale,
    })

    expect(upscale).toHaveBeenCalledTimes(1)
    expect(out.size).toBe(1)
  })

  it('reports an unmeasurable image instead of sending it to the upscaler', async () => {
    const upscale = vi.fn(upscaleOk)
    const out = await ensurePrintResolution(['broken.png'], REQUIRED, {
      measure: async () => null,
      upscale,
    })

    expect(upscale).not.toHaveBeenCalled()
    expect(out.get('broken.png')).toMatchObject({
      url: 'broken.png',
      upscaled: false,
      skipped: 'unmeasurable',
      width: null,
    })
  })

  it('keeps the original URL and says why when the upscaler fails', async () => {
    const out = await ensurePrintResolution(['front.png'], REQUIRED, {
      measure: async () => small,
      upscale: async () => {
        throw new Error('REPLICATE_API_TOKEN missing')
      },
    })

    expect(out.get('front.png')).toMatchObject({
      url: 'front.png',
      upscaled: false,
      skipped: 'upscale_failed',
      error: 'REPLICATE_API_TOKEN missing',
    })
  })

  it('one failure does not take the other side down with it', async () => {
    const out = await ensurePrintResolution(['front.png', 'back.png'], REQUIRED, {
      measure: async () => small,
      upscale: async (url: string) => {
        if (url === 'front.png') throw new Error('upstream 502')
        return { url: `${url}#up`, path: 'p', width: 3278, height: 4096 }
      },
    })

    expect(out.get('front.png')?.upscaled).toBe(false)
    expect(out.get('back.png')?.upscaled).toBe(true)
  })

  it('does not retry an upscale that came back still too small', async () => {
    // Synthetic detail twice over adds no information, and retrying here would
    // hold the HTTP request open indefinitely.
    const upscale = vi.fn(async (url: string) => ({
      url: `${url}#up`,
      path: 'p',
      width: 1150,
      height: 1400,
    }))

    const out = await ensurePrintResolution(['front.png'], REQUIRED, {
      measure: async () => small,
      upscale,
    })

    expect(upscale).toHaveBeenCalledTimes(1)
    expect(out.get('front.png')).toMatchObject({ upscaled: true, width: 1150 })
  })

  it('ignores empty and non-string entries', async () => {
    const upscale = vi.fn(upscaleOk)
    const out = await ensurePrintResolution(['', undefined as any, 'real.png'], REQUIRED, {
      measure: async () => small,
      upscale,
    })

    expect(out.size).toBe(1)
    expect(upscale).toHaveBeenCalledTimes(1)
  })
})

describe('restoreTransparency', () => {
  // A 40x40 design on a clear field: a white-filled square with a black rim
  // (the Folgers lettering, in miniature) and a half-clear red edge column.
  async function design(): Promise<Buffer> {
    const px = Buffer.alloc(40 * 40 * 4)
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        const i = (y * 40 + x) * 4
        if (x >= 10 && x < 30 && y >= 10 && y < 30) {
          const rim = x < 12 || x > 27 || y < 12 || y > 27
          px.fill(rim ? 0 : 255, i, i + 3)
          px[i + 3] = 255
        } else if (x === 31 && y >= 10 && y < 30) {
          px[i] = 255; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 128
        }
      }
    }
    return sharp(px, { raw: { width: 40, height: 40, channels: 4 } }).png().toBuffer()
  }

  // What the upscaler hands back: everything flattened onto white, at 2x.
  const upscaled = async (src: Buffer) =>
    sharp(src).flatten({ background: '#ffffff' }).resize(80, 80, { kernel: 'nearest' }).png().toBuffer()

  async function pixel(buf: Buffer, x: number, y: number) {
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const i = (y * info.width + x) * 4
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3], w: info.width }
  }

  it('gives the clear field back instead of shipping it as white', async () => {
    const src = await design()
    const out = await restoreTransparency(src, await upscaled(src))
    expect((await pixel(out, 2, 2)).a).toBe(0)
    expect((await pixel(out, 2, 2)).w).toBe(80)
  })

  it('keeps white artwork white and solid, which the old restore and the cut lost', async () => {
    const src = await design()
    const out = await restoreTransparency(src, await upscaled(src))
    expect(await pixel(out, 40, 40)).toMatchObject({ r: 255, g: 255, b: 255, a: 255 })
    expect(await pixel(out, 21, 21)).toMatchObject({ r: 0, g: 0, b: 0, a: 255 })
  })

  it('takes the white the upscaler blended into a soft edge back out', async () => {
    const src = await design()
    const out = await restoreTransparency(src, await upscaled(src))
    const edge = await pixel(out, 63, 40)
    expect(edge.a).toBeGreaterThan(100)
    expect(edge.a).toBeLessThan(160)
    // Flattened onto white it was pink (255,127,127); unmatted it is red again.
    expect(edge.r).toBeGreaterThan(240)
    expect(edge.g).toBeLessThan(20)
  })
})

import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for ensurePrintResolution (backend/services/step-flow/print-resolution.ts).
//
// The orchestration takes `measure` and `upscale` as dependencies precisely so
// this file can pin the decisions — which artwork gets sent to a paid model,
// how many times, and what happens when the model fails — without a network
// call or a $0.006 charge per assertion.
// ---------------------------------------------------------------------------
import { ensurePrintResolution, type ArtworkMeasurement, type UpscaledArtwork } from './print-resolution.js'

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

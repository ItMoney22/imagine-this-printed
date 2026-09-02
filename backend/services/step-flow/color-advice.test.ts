import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'
import { measureArtworkStats, scoreColor, scoreColorsForGarment, adviseColorsForMetal } from './color-advice.js'
import { COLORS } from '../../shared/catalog-capability.js'

// ---------------------------------------------------------------------------
// Tests for artwork-aware color advice (David 2026-09-01: "a mostly-black
// design should not be pushed onto a black shirt"). Built on synthetic PNGs
// so the scoring math is pinned without any network or model dependency.
// ---------------------------------------------------------------------------

async function solidPng(r: number, g: number, b: number, alpha = 255, size = 64): Promise<Buffer> {
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r, g, b, alpha } },
  })
    .png()
    .toBuffer()
}

/** Left half opaque `fg`, right half fully transparent — a partial-coverage design. */
async function halfOpaquePng(r: number, g: number, b: number, size = 64): Promise<Buffer> {
  const fg = await sharp({ create: { width: size / 2, height: size, channels: 4, background: { r, g, b, alpha: 255 } } })
    .png()
    .toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: fg, left: 0, top: 0 }])
    .png()
    .toBuffer()
}

describe('measureArtworkStats', () => {
  it('reads an all-black opaque image as low luma, high dark share, full coverage', async () => {
    const stats = await measureArtworkStats(await solidPng(0, 0, 0))
    expect(stats.meanLuma).toBeLessThan(0.05)
    expect(stats.darkShare).toBeGreaterThan(0.95)
    expect(stats.lightShare).toBe(0)
    expect(stats.coverage).toBeGreaterThan(0.95)
  })

  it('reads an all-white opaque image as high luma, high light share', async () => {
    const stats = await measureArtworkStats(await solidPng(255, 255, 255))
    expect(stats.meanLuma).toBeGreaterThan(0.95)
    expect(stats.lightShare).toBeGreaterThan(0.95)
    expect(stats.darkShare).toBe(0)
  })

  it('reads a mid-gray opaque image as neither dark- nor light-dominant', async () => {
    const stats = await measureArtworkStats(await solidPng(128, 128, 128))
    expect(stats.meanLuma).toBeGreaterThan(0.3)
    expect(stats.meanLuma).toBeLessThan(0.7)
    expect(stats.darkShare).toBe(0)
    expect(stats.lightShare).toBe(0)
  })

  it('coverage reflects the opaque fraction, not the whole canvas', async () => {
    const stats = await measureArtworkStats(await halfOpaquePng(0, 0, 0))
    expect(stats.coverage).toBeGreaterThan(0.4)
    expect(stats.coverage).toBeLessThan(0.6)
  })

  it('a fully transparent image has zero coverage and does not throw', async () => {
    const stats = await measureArtworkStats(await solidPng(10, 10, 10, 0))
    expect(stats.coverage).toBe(0)
    expect(stats.meanLuma).toBe(0)
  })

  it('a saturated red image reports a dominant hue near red (0/360)', async () => {
    const stats = await measureArtworkStats(await solidPng(220, 20, 20))
    expect(stats.dominantHue).not.toBeNull()
    const hue = stats.dominantHue as number
    expect(hue < 20 || hue > 340).toBe(true)
  })

  it('a grayscale image has no dominant hue', async () => {
    const stats = await measureArtworkStats(await solidPng(128, 128, 128))
    expect(stats.dominantHue).toBeNull()
  })
})

describe('scoreColor / scoreColorsForGarment', () => {
  it('an all-black design grades black poor and white great', async () => {
    const stats = await measureArtworkStats(await solidPng(0, 0, 0))
    const black = scoreColor(stats, COLORS.black)
    const white = scoreColor(stats, COLORS.white)
    expect(black.grade).toBe('poor')
    expect(white.grade).toBe('great')
    expect(black.score).toBeLessThan(white.score)
  })

  it('an all-white design grades white poor and black great (the inverse)', async () => {
    const stats = await measureArtworkStats(await solidPng(255, 255, 255))
    const black = scoreColor(stats, COLORS.black)
    const white = scoreColor(stats, COLORS.white)
    expect(white.grade).toBe('poor')
    expect(black.grade).toBe('great')
  })

  it('mid-tone art grades every offered color ok or great, never poor', async () => {
    const stats = await measureArtworkStats(await solidPng(128, 128, 128))
    const advice = scoreColorsForGarment(stats, 'tshirt')
    expect(advice.length).toBeGreaterThan(0)
    for (const a of advice) {
      expect(a.grade).not.toBe('poor')
    }
  })

  it('ranks the list best-score-first', async () => {
    const stats = await measureArtworkStats(await solidPng(0, 0, 0))
    const advice = scoreColorsForGarment(stats, 'tshirt')
    for (let i = 1; i < advice.length; i++) {
      expect(advice[i - 1].score).toBeGreaterThanOrEqual(advice[i].score)
    }
  })

  it('an image with near-zero coverage grades every color a neutral "ok"', async () => {
    const stats = await measureArtworkStats(await solidPng(0, 0, 0, 0))
    const advice = scoreColorsForGarment(stats, 'tshirt')
    for (const a of advice) {
      expect(a.grade).toBe('ok')
      expect(a.score).toBe(0.5)
    }
  })

  it('hoodie garment only scores hoodie-offered colors (no royal-blue)', async () => {
    const stats = await measureArtworkStats(await solidPng(128, 128, 128))
    const advice = scoreColorsForGarment(stats, 'hoodie')
    expect(advice.find((a) => a.id === 'royal-blue')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Metal art (design doc §14) has no garment/shirt color to advise against —
// adviseColorsForMetal always returns an empty advice list, but still
// measures the artwork.
// ---------------------------------------------------------------------------
describe('adviseColorsForMetal', () => {
  it('returns an empty advice list alongside the measured artwork stats', async () => {
    const png = await solidPng(0, 0, 0)
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { advice, artwork } = await adviseColorsForMetal('https://cdn.example/panel.png')

    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example/panel.png')
    expect(advice).toEqual([])
    expect(artwork.meanLuma).toBeLessThan(0.05)

    vi.unstubAllGlobals()
  })

  it('rejects a blank pngUrl', async () => {
    await expect(adviseColorsForMetal('')).rejects.toThrow(/pngUrl is required/)
  })

  it('throws a clear error when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' })))
    await expect(adviseColorsForMetal('https://cdn.example/missing.png')).rejects.toThrow(/Failed to fetch artwork/)
    vi.unstubAllGlobals()
  })
})

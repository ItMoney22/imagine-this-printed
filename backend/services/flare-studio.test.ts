// Flare Lab recipes, sizing, pricing and mask conversion — no network.
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  backgroundFor,
  buildFlarePrompt,
  buildOpenAIMask,
  flareCost,
  flareSize,
  maskCoverage,
  validateFlareRequest,
  type FlareRequest,
} from './flare-studio.js'

const IMG = 'https://storage.googleapis.com/bucket/design.png'

function req(over: Partial<FlareRequest> = {}): FlareRequest {
  const v = validateFlareRequest({ op: 'edit', imageUrl: IMG, prompt: 'make the helmet gold', ...over })
  if (!v.ok) throw new Error(v.error)
  return { ...v.req, ...over }
}

describe('validateFlareRequest', () => {
  it('refuses unknown tools and non-image URLs', () => {
    expect(validateFlareRequest({ op: 'nuke', imageUrl: IMG }).ok).toBe(false)
    expect(validateFlareRequest({ op: 'edit', imageUrl: 'file:///etc/passwd', prompt: 'x' }).ok).toBe(false)
  })

  it('requires the inputs each tool is about', () => {
    expect(validateFlareRequest({ op: 'edit', imageUrl: IMG }).ok).toBe(false)
    expect(validateFlareRequest({ op: 'inpaint', imageUrl: IMG, prompt: 'x' }).ok).toBe(false)
    expect(validateFlareRequest({ op: 'blend', imageUrl: IMG, prompt: 'x' }).ok).toBe(false)
    expect(validateFlareRequest({ op: 'recolor', imageUrl: IMG, colors: ['red'] }).ok).toBe(false)
    expect(validateFlareRequest({ op: 'text', imageUrl: IMG }).ok).toBe(false)
    expect(validateFlareRequest({ op: 'transparent', imageUrl: IMG }).ok).toBe(true)
  })

  it('refuses a mask combined with references (OpenAI masks image 1 only)', () => {
    const r = validateFlareRequest({
      op: 'inpaint',
      imageUrl: IMG,
      prompt: 'x',
      maskDataUrl: 'data:image/png;base64,AAAA',
      refUrls: [IMG],
    })
    expect(r).toEqual({ ok: false, error: 'A mask cannot be combined with reference images' })
  })

  it('clamps variations and defaults them by tool', () => {
    const v = validateFlareRequest({ op: 'variations', imageUrl: IMG, variations: 99 })
    expect(v.ok && v.req.variations).toBe(4)
    expect(validateFlareRequest({ op: 'variations', imageUrl: IMG }).ok && (validateFlareRequest({ op: 'variations', imageUrl: IMG }) as any).req.variations).toBe(3)
    const e = validateFlareRequest({ op: 'edit', imageUrl: IMG, prompt: 'x' })
    expect(e.ok && e.req.variations).toBe(1)
    expect(e.ok && e.req.quality).toBe('high')
  })
})

describe('buildFlarePrompt', () => {
  it('text swaps quote and spell the new value and hold the lettering style', () => {
    const p = buildFlarePrompt(req({ op: 'text', prompt: '', textFrom: 'BEAR', textTo: 'SMITH' }))
    expect(p).toContain('Replace the text "BEAR" with "SMITH" (5 characters: S-M-I-T-H)')
    expect(p).toContain('same typeface character and weight')
    expect(p).toContain('Add no new text')
  })

  it('edit states the change and what to keep', () => {
    const p = buildFlarePrompt(req())
    expect(p).toContain('CHANGE: make the helmet gold')
    expect(p).toMatch(/KEEP: Keep everything else exactly/)
  })

  it('recolor lists only the given palette', () => {
    const p = buildFlarePrompt(req({ op: 'recolor', prompt: '', colors: ['#7A1F2B', '#C9A96E'] }))
    expect(p).toContain('ONLY this palette: #7A1F2B, #C9A96E')
  })

  it('transparent names the painted checkerboard as fake transparency', () => {
    expect(buildFlarePrompt(req({ op: 'transparent', prompt: '' }))).toContain('checkerboard')
  })
})

describe('backgroundFor', () => {
  it('asks for transparency when the tool or the source calls for it, else leaves it alone', () => {
    expect(backgroundFor(req({ op: 'transparent' }), false)).toBe('transparent')
    expect(backgroundFor(req(), true)).toBe('transparent')
    expect(backgroundFor(req({ transparent: true }), false)).toBe('transparent')
    expect(backgroundFor(req(), false)).toBeUndefined()
  })
})

describe('flareSize', () => {
  it('keeps the source aspect on multiples of 16 inside the pixel budget', () => {
    for (const [w, h] of [
      [3600, 4498],
      [4000, 1000],
      [1000, 4000],
      [1024, 1024],
      [640, 480],
    ]) {
      for (const size of ['standard', 'large'] as const) {
        const out = flareSize(w, h, size)
        expect(out.w % 16).toBe(0)
        expect(out.h % 16).toBe(0)
        expect(out.w * out.h).toBeGreaterThanOrEqual(655_360)
        expect(out.w * out.h).toBeLessThanOrEqual(8_294_400)
        expect(Math.max(out.w, out.h) / Math.min(out.w, out.h)).toBeLessThanOrEqual(3)
      }
    }
    expect(flareSize(3600, 4800, 'standard')).toEqual({ w: 1152, h: 1536 })
    expect(flareSize(3600, 4800, 'large')).toEqual({ w: 1920, h: 2560 })
  })
})

describe('flareCost', () => {
  it('scales with tier, canvas and variations', () => {
    expect(flareCost({ quality: 'high', size: 'standard', variations: 1 })).toBe(40)
    expect(flareCost({ quality: 'low', size: 'standard', variations: 4 })).toBe(40)
    expect(flareCost({ quality: 'max', size: 'large', variations: 1 })).toBe(135)
  })
})

describe('buildOpenAIMask', () => {
  it('inverts painted strokes into transparent (editable) mask pixels at the source size', async () => {
    // 10x10 painting: the left half painted opaque white, the right half empty.
    const raw = Buffer.alloc(10 * 10 * 4)
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 5; x++) {
        const i = (y * 10 + x) * 4
        raw[i] = raw[i + 1] = raw[i + 2] = raw[i + 3] = 255
      }
    const painted = await sharp(raw, { raw: { width: 10, height: 10, channels: 4 } }).png().toBuffer()

    const mask = await buildOpenAIMask(painted, 40, 20)
    const meta = await sharp(mask).metadata()
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([40, 20, true])

    const cover = await maskCoverage(mask)
    expect(cover).toBeGreaterThan(0.45)
    expect(cover).toBeLessThanOrEqual(0.56) // soft brush edge from the resize

    const { data } = await sharp(mask).extractChannel(3).raw().toBuffer({ resolveWithObject: true })
    expect(data[0]).toBe(0) // top-left: painted -> editable
    expect(data[39]).toBe(255) // top-right: untouched -> protected
  })
})

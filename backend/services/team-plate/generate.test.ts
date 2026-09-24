// The flare -> crisp-upscale chain against real pixels, with the paid calls faked.
import { describe, it, expect, vi } from 'vitest'
import sharp from 'sharp'
import type { TeamTemplate } from '../../shared/team-template.js'
import { baseSizeFor, generateBase, upscaleToPress, LETTERING_MODEL, type GenerateDeps } from './generate.js'

const template = (over: Partial<TeamTemplate> = {}): TeamTemplate => ({
  version: 1,
  side: 'back_image',
  plateAssetId: 'plate-asset',
  sourceAssetId: 'source-asset',
  distressAssetId: null,
  canvas: { w: 3600, h: 4800, dpi: 300 },
  halftone: false,
  upcharge: 0,
  styleNotes: '',
  fields: [
    {
      key: 'name', label: 'Last name', type: 'text', max: 12, uppercase: true,
      zone: { x: 100, y: 100, w: 3000, h: 600 }, arch: 0,
      font: { family: 'varsity-block', src: 'house' }, fill: '#8C1D2D', strokes: [], offset: null,
    },
    {
      key: 'number', label: 'Number', type: 'number', max: 2, uppercase: false,
      zone: { x: 1200, y: 1200, w: 1200, h: 2000 }, arch: 0,
      font: { family: 'varsity-block', src: 'house' }, fill: '#C9A227', strokes: [], offset: null,
    },
  ],
  ...over,
})

/** A transparent-surround PNG: opaque art in the middle, clear border. */
async function artwork(w: number, h: number, transparent = true): Promise<Buffer> {
  const bg = transparent ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: 255, g: 255, b: 255, alpha: 1 }
  const inner = await sharp({
    create: { width: Math.round(w / 2), height: Math.round(h / 2), channels: 4, background: { r: 140, g: 29, b: 45, alpha: 1 } },
  }).png().toBuffer()
  return sharp({ create: { width: w, height: h, channels: 4, background: bg } })
    .composite([{ input: inner, left: Math.round(w / 4), top: Math.round(h / 4) }])
    .png()
    .toBuffer()
}

function fakeDeps(opts: { source: Buffer; base: Buffer; upscaled?: Buffer }) {
  const store = new Map<string, Buffer>()
  const deps: GenerateDeps = {
    loadAsset: vi.fn(async (id: string) => ({ url: `signed://${id}`, buffer: opts.source })),
    edit: vi.fn(async (o) => {
      store.set(`signed://${o.objectPath}`, opts.base)
      return { url: `signed://${o.objectPath}`, path: o.objectPath, modelId: `openai/${o.model}` }
    }),
    fetchBuffer: vi.fn(async (url: string) => {
      const b = store.get(url)
      if (!b) throw new Error('not found ' + url)
      return b
    }),
    upscale: vi.fn(async (_url: string, src: Buffer) => {
      const buf = opts.upscaled ?? (await sharp(src).resize(3072, 4096).png().toBuffer())
      const m = await sharp(buf).metadata()
      return { buffer: buf, width: m.width!, height: m.height! }
    }),
  }
  return deps
}

describe('baseSizeFor', () => {
  it('matches the canvas aspect with a 1536 long edge in multiples of 16', () => {
    expect(baseSizeFor({ w: 3600, h: 4800 })).toEqual({ w: 1152, h: 1536 })
    expect(baseSizeFor({ w: 4800, h: 3600 })).toEqual({ w: 1536, h: 1152 })
    expect(baseSizeFor({ w: 3000, h: 3000 })).toEqual({ w: 1536, h: 1536 })
  })

  it('clamps an extreme canvas into the model\'s 1:3..3:1 window', () => {
    const s = baseSizeFor({ w: 100, h: 1000 })
    expect(s).toEqual({ w: 512, h: 1536 })
  })
})

describe('generateBase (flare edit)', () => {
  it('edits the ORIGINAL art with gpt-image-2.5-flare, the new values in the prompt', async () => {
    const deps = fakeDeps({ source: await artwork(1200, 1600), base: await artwork(1152, 1536) })
    const out = await generateBase(template(), { name: 'SMITH', number: '22' }, deps, 'users/team-plates/x-base.png')

    expect(deps.loadAsset).toHaveBeenCalledWith('source-asset')
    const call = (deps.edit as any).mock.calls[0][0]
    expect(call.model).toBe(LETTERING_MODEL)
    expect(call.model).toBe('gpt-image-2.5-flare')
    expect(call.size).toBe('1152x1536')
    expect(call.objectPath).toBe('users/team-plates/x-base.png')
    expect(call.prompt).toContain('"SMITH"')
    expect(call.prompt).toContain('"22"')
    expect(out.mode).toBe('replace')
    expect(out.modelId).toBe('openai/gpt-image-2.5-flare')
    expect(out.width).toBe(1152)
  })

  it('asks for a transparent background only when the source uses one', async () => {
    const transparentDeps = fakeDeps({ source: await artwork(600, 800, true), base: await artwork(1152, 1536) })
    await generateBase(template(), { name: 'A', number: '1' }, transparentDeps, 'p')
    expect((transparentDeps.edit as any).mock.calls[0][0].background).toBe('transparent')

    const opaqueDeps = fakeDeps({ source: await artwork(600, 800, false), base: await artwork(1152, 1536, false) })
    await generateBase(template(), { name: 'A', number: '1' }, opaqueDeps, 'p')
    expect((opaqueDeps.edit as any).mock.calls[0][0].background).toBe('opaque')
  })

  it('falls back to the erased plate when the template has no source art', async () => {
    const deps = fakeDeps({ source: await artwork(600, 800), base: await artwork(1152, 1536) })
    const out = await generateBase(template({ sourceAssetId: null }), { name: 'A', number: '1' }, deps, 'p')
    expect(deps.loadAsset).toHaveBeenCalledWith('plate-asset')
    expect(out.mode).toBe('add')
  })
})

describe('upscaleToPress (crisp upscale)', () => {
  it('produces the full 300 DPI canvas from the base, alpha intact', async () => {
    const base = await artwork(1152, 1536)
    const deps = fakeDeps({ source: base, base })
    const press = await upscaleToPress(template(), { url: 'signed://base', buffer: base }, deps)

    expect(deps.upscale).toHaveBeenCalledWith('signed://base', base)
    expect(press.upscaled).toEqual({ width: 3072, height: 4096 })
    const meta = await sharp(press.buffer).metadata()
    expect(meta.width).toBe(3600)
    expect(meta.height).toBe(4800)
    expect(meta.hasAlpha).toBe(true)

    // Corner stays clear, centre stays ink — the transparency made it through.
    const { data, info } = await sharp(press.buffer).raw().toBuffer({ resolveWithObject: true })
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3]
    expect(alphaAt(10, 10)).toBe(0)
    expect(alphaAt(1800, 2400)).toBe(255)
  })

  it('throws rather than shipping a soft press file when the upscaler fails', async () => {
    const base = await artwork(1152, 1536)
    const deps = fakeDeps({ source: base, base })
    ;(deps.upscale as any).mockRejectedValueOnce(new Error('replicate 503'))
    await expect(upscaleToPress(template(), { url: 'u', buffer: base }, deps)).rejects.toThrow('replicate 503')
  })
})

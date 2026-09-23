// plate-store: cache hit/miss, one bill per file, durable GCS paths.
//
// GCS is an in-memory bucket here; the flare edit and the upscaler are fakes
// that count their calls, because the whole point of this module is how many
// times those get paid for.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'
import type { TeamTemplate } from '../../shared/team-template.js'

const bucket = new Map<string, Buffer>()

vi.mock('../../lib/supabase.js', () => ({ supabase: { from: () => { throw new Error('no db in this test') } } }))

vi.mock('../gcs-storage.js', () => ({
  fileExists: async (p: string) => bucket.has(p),
  downloadFile: async (p: string) => {
    const b = bucket.get(p)
    if (!b) throw new Error('No such object: ' + p)
    return b
  },
  generateSignedUrl: async (p: string) => `https://signed.example/${p}?sig=1`,
}))

vi.mock('../google-cloud-storage.js', () => ({
  uploadImageFromBuffer: async (buf: Buffer, path: string) => {
    bucket.set(path, buf)
    return { publicUrl: `https://signed.example/${path}?sig=1`, path }
  },
}))

const { renderOrGetCached, platePath, pressPlatePath, __setGenerateDeps, ENGINE } = await import('./plate-store.js')

const template: TeamTemplate = {
  version: 1,
  side: 'back_image',
  plateAssetId: 'plate-asset',
  sourceAssetId: 'source-asset',
  distressAssetId: null,
  canvas: { w: 3600, h: 4800, dpi: 300 },
  halftone: false,
  upcharge: 0,
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
}

const SMITH = { name: 'SMITH', number: '22' }
let editCalls = 0
let upscaleCalls = 0

async function png(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer()
}

beforeEach(async () => {
  bucket.clear()
  editCalls = 0
  upscaleCalls = 0
  const source = await png(600, 800)
  __setGenerateDeps({
    loadAsset: async (id) => ({ url: `https://signed.example/${id}`, buffer: source }),
    edit: async (o) => {
      editCalls++
      // A real flare call takes ~20-40s; a tick is enough to expose a race.
      await new Promise((r) => setTimeout(r, 10))
      bucket.set(o.objectPath, await png(1152, 1536))
      return { url: `https://signed.example/${o.objectPath}?sig=1`, path: o.objectPath, modelId: 'openai/gpt-image-2.5-flare' }
    },
    fetchBuffer: async (url) => {
      const path = decodeURIComponent(new URL(url).pathname.slice(1))
      const b = bucket.get(path)
      if (!b) throw new Error('404 ' + path)
      return b
    },
    upscale: async (_url, buf) => {
      upscaleCalls++
      const out = await sharp(buf).resize(3072, 4096).png().toBuffer()
      return { buffer: out, width: 3072, height: 4096 }
    },
  })
})

describe('renderOrGetCached', () => {
  it('preview: a miss runs ONE flare edit and stores the base at its cache path', async () => {
    const first = await renderOrGetCached(template, SMITH, 900)
    expect(first.rendered).toBe(true)
    expect(first.tier).toBe('base')
    expect(first.path).toBe(platePath(template, SMITH, 'base'))
    expect(first.path.startsWith(`users/team-plates/${ENGINE}/`)).toBe(true)
    expect(editCalls).toBe(1)
    expect(upscaleCalls).toBe(0)
    expect(bucket.has(first.path)).toBe(true)
  })

  it('preview: the same name and number again is a cache hit — no second flare bill', async () => {
    await renderOrGetCached(template, SMITH, 900)
    const again = await renderOrGetCached(template, SMITH, 900)
    expect(again.rendered).toBe(false)
    expect(editCalls).toBe(1)
  })

  it('a different name is a miss', async () => {
    await renderOrGetCached(template, SMITH, 900)
    await renderOrGetCached(template, { name: 'LOPEZ', number: '22' }, 900)
    expect(editCalls).toBe(2)
  })

  it('press after preview: upscales the APPROVED base, no second flare edit', async () => {
    await renderOrGetCached(template, SMITH, 900)
    const press = await renderOrGetCached(template, SMITH, 3600)
    expect(press.tier).toBe('press')
    expect(press.rendered).toBe(true)
    expect(editCalls).toBe(1)
    expect(upscaleCalls).toBe(1)
    const meta = await sharp(bucket.get(press.path)!).metadata()
    expect([meta.width, meta.height]).toEqual([3600, 4800])
  })

  it('press cold: flare then upscale, and both tiers land in the bucket', async () => {
    const press = await renderOrGetCached(template, SMITH, 3600)
    expect(editCalls).toBe(1)
    expect(upscaleCalls).toBe(1)
    expect(bucket.has(platePath(template, SMITH, 'base'))).toBe(true)
    expect(bucket.has(press.path)).toBe(true)
  })

  it('press again is a pure cache hit — no AI, no upscale', async () => {
    await renderOrGetCached(template, SMITH, 3600)
    const again = await renderOrGetCached(template, SMITH, 3600)
    expect(again.rendered).toBe(false)
    expect(editCalls).toBe(1)
    expect(upscaleCalls).toBe(1)
  })

  it('concurrent identical requests share one generation', async () => {
    const results = await Promise.all([
      renderOrGetCached(template, SMITH, 900),
      renderOrGetCached(template, SMITH, 900),
      renderOrGetCached(template, SMITH, 3600),
      renderOrGetCached(template, SMITH, 3600),
    ])
    expect(editCalls).toBe(1)
    expect(upscaleCalls).toBe(1)
    expect(new Set(results.map((r) => r.path)).size).toBe(2)
  })

  it('the press path is durable and known BEFORE the file exists (checkout writes it early)', async () => {
    const known = pressPlatePath(template, SMITH)
    expect(known).not.toMatch(/sig=|https?:/)
    const press = await renderOrGetCached(template, SMITH, 3600)
    expect(press.path).toBe(known)
  })

  it('never returns the in-memory buffer to a caller', async () => {
    const r = (await renderOrGetCached(template, SMITH, 900)) as any
    expect(r.buffer).toBeUndefined()
  })

  it('a failed generation is not cached — the next request retries', async () => {
    let fail = true
    __setGenerateDeps({
      loadAsset: async (id) => ({ url: id, buffer: await png(600, 800) }),
      edit: async (o) => {
        editCalls++
        if (fail) throw new Error('flare 500')
        bucket.set(o.objectPath, await png(1152, 1536))
        return { url: `https://signed.example/${o.objectPath}`, path: o.objectPath, modelId: 'm' }
      },
      fetchBuffer: async (url) => bucket.get(decodeURIComponent(new URL(url).pathname.slice(1)))!,
      upscale: async () => ({ buffer: await png(3072, 4096), width: 3072, height: 4096 }),
    })
    await expect(renderOrGetCached(template, SMITH, 900)).rejects.toThrow('flare 500')
    fail = false
    const ok = await renderOrGetCached(template, SMITH, 900)
    expect(ok.rendered).toBe(true)
    expect(editCalls).toBe(2)
  })
})

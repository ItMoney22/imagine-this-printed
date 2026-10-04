import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { templateCacheKey, type TeamTemplate } from '../../shared/team-template.js'

// Cache hit, cache miss, and the durable path. The paid calls are mocks.
// What this pins: flare is asked once, the upscaler receives the flare URL,
// and the order path is a gcs object name — never the signed URL.

const h = vi.hoisted(() => ({
  files: new Set<string>(),
  buffers: new Map<string, Buffer>(),
  edits: [] as any[],
  upscales: [] as string[],
  uploads: [] as Array<{ gcsPath: string; metadata: any }>,
  assets: [] as any[],
  products: [] as any[],
  holdEdit: null as Promise<void> | null,
  upscaleError: null as string | null,
}))

vi.mock('../../lib/supabase.js', () => {
  function query(table: string) {
    const filters: Array<[string, unknown]> = []
    const rows = () => {
      const all = table === 'product_assets' ? h.assets : table === 'products' ? h.products : []
      return all.filter((row) => filters.every(([key, value]) => row[key] === value))
    }
    const chain: any = {
      select: () => chain,
      eq: (key: string, value: unknown) => {
        filters.push([key, value])
        return chain
      },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: any, reject: any) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
    }
    return chain
  }
  return { supabase: { from: (table: string) => query(table) } }
})

vi.mock('../gcs-storage.js', () => ({
  fileExists: async (path: string) => h.files.has(path),
  downloadFile: async (path: string) => {
    const buf = h.buffers.get(path)
    if (!buf) throw new Error(`missing ${path}`)
    return buf
  },
  generateSignedUrl: async (path: string) => `https://signed.example/${path}`,
  uploadFile: async (buffer: Buffer, opts: any) => {
    const gcsPath = `users/${opts.userId}/${opts.folder}/${opts.filename}`
    h.files.add(gcsPath)
    h.buffers.set(gcsPath, buffer)
    h.uploads.push({ gcsPath, metadata: opts.metadata })
    return { gcsPath, publicUrl: `https://signed.example/${gcsPath}`, filename: opts.filename }
  },
}))

vi.mock('../image-flow/providers/openai-image.js', () => ({
  editOpenAIImage: async (opts: any) => {
    h.edits.push(opts)
    if (h.holdEdit) await h.holdEdit
    return {
      url: 'https://flare.example/edit.png',
      path: 'users/team-plates/flare-edits/x.png',
      modelId: 'openai/gpt-image-2.5-flare',
    }
  },
}))

vi.mock('../step-flow/print-resolution.js', () => ({
  upscaleArtwork: async (url: string) => {
    h.upscales.push(url)
    if (h.upscaleError) throw new Error(h.upscaleError)
    return { url: 'https://upscaled.example/out.png', path: 'print-ready/prod-1/team-plate.png', width: 3278, height: 4096 }
  },
}))

const { renderOrGetCached, forgetTemplateLayers } = await import('./plate-store.js')

const TEMPLATE: TeamTemplate = {
  version: 1,
  side: 'back_image',
  plateAssetId: 'plate-1',
  distressAssetId: null,
  canvas: { w: 640, h: 800, dpi: 300 },
  halftone: false,
  upcharge: 0,
  fields: [
    {
      key: 'name',
      label: 'Last name',
      type: 'text',
      max: 12,
      uppercase: true,
      zone: { x: 40, y: 40, w: 560, h: 160 },
      arch: 0,
      font: { family: 'varsity-block', src: 'house' },
      fill: '#8C1D2D',
      strokes: [],
      offset: null,
    },
    {
      key: 'number',
      label: 'Number',
      type: 'number',
      max: 2,
      uppercase: false,
      zone: { x: 180, y: 240, w: 280, h: 400 },
      arch: 0,
      font: { family: 'varsity-block', src: 'house' },
      fill: '#C9A227',
      strokes: [],
      offset: null,
    },
  ],
}

const sourcePng = await sharp({
  create: { width: 32, height: 40, channels: 4, background: { r: 140, g: 20, b: 40, alpha: 1 } },
})
  .png()
  .toBuffer()

const upPng = await sharp({
  create: { width: 48, height: 60, channels: 4, background: { r: 10, g: 30, b: 80, alpha: 1 } },
})
  .png()
  .toBuffer()

function seedCatalog() {
  h.products = [
    {
      id: 'prod-1',
      metadata: { print_artwork: { back_image: 'https://cdn.example/tagged-back.png' } },
    },
  ]
  h.assets = [
    {
      id: 'plate-1',
      product_id: 'prod-1',
      path: 'graphics/plate.png',
      url: 'https://cdn.example/plate.png',
      asset_role: 'team_plate_back',
      is_primary: false,
    },
    {
      id: 'back-1',
      product_id: 'prod-1',
      path: 'graphics/back.png',
      url: 'https://cdn.example/back-stored.png',
      asset_role: 'back_image',
      is_primary: true,
    },
  ]
}

beforeEach(() => {
  h.files.clear()
  h.buffers.clear()
  h.edits.length = 0
  h.upscales.length = 0
  h.uploads.length = 0
  h.holdEdit = null
  h.upscaleError = null
  seedCatalog()
  forgetTemplateLayers(TEMPLATE)
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    const body = url.includes('upscaled.example') ? upPng : sourcePng
    return new Response(body)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const pressPath = () => {
  const key = templateCacheKey(TEMPLATE, { name: 'SMITH', number: '22' })
  return `users/team-plates/ai-generated/${key}-640.png`
}

describe('renderOrGetCached', () => {
  it('on a miss, edits the tagged back with flare and upscales that output into a durable path', async () => {
    const plate = await renderOrGetCached(TEMPLATE, { name: 'smith', number: '22' }, 640)

    expect(h.edits).toHaveLength(1)
    expect(h.edits[0].model).toBe('gpt-image-2.5-flare')
    expect(h.edits[0].sourceUrl).toBe('https://signed.example/graphics/back.png')
    expect(h.edits[0].prompt).toContain('exactly "SMITH"')
    expect(h.edits[0].prompt).toContain('exactly "22"')
    expect(h.upscales).toEqual(['https://flare.example/edit.png'])

    expect(plate.rendered).toBe(true)
    expect(plate.path).toBe(pressPath())
    expect(plate.path.startsWith('http')).toBe(false)
    expect(plate.url).toBe(`https://signed.example/${plate.path}`)
    expect(plate.url).not.toBe(plate.path)

    const stored = h.uploads.find((row) => row.gcsPath === plate.path)
    expect(stored?.metadata.engine).toBe('gpt-image-2.5-flare+recraft-crisp-upscale')
    expect(stored?.metadata.upscalePath).toBe('print-ready/prod-1/team-plate.png')
    const meta = await sharp(h.buffers.get(plate.path)!).metadata()
    expect(meta.width).toBe(640)
    expect(meta.height).toBe(800)
  })

  it('serves the same name and number from cache, including a case-only repeat', async () => {
    await renderOrGetCached(TEMPLATE, { name: 'SMITH', number: '22' }, 640)
    const again = await renderOrGetCached(TEMPLATE, { name: 'smith', number: '22' }, 640)

    expect(again.rendered).toBe(false)
    expect(again.path).toBe(pressPath())
    expect(h.edits).toHaveLength(1)
    expect(h.upscales).toHaveLength(1)
  })

  it('downscales a preview from the press file and does not call the model again at checkout width', async () => {
    const preview = await renderOrGetCached(TEMPLATE, { name: 'SMITH', number: '22' }, 160)
    expect(preview.rendered).toBe(true)
    expect(preview.path.endsWith('-160.png')).toBe(true)
    expect(h.edits).toHaveLength(1)

    const press = await renderOrGetCached(TEMPLATE, { name: 'SMITH', number: '22' }, 640)
    expect(press.rendered).toBe(false)
    expect(press.path).toBe(pressPath())
    expect(h.edits).toHaveLength(1)
    expect(h.upscales).toHaveLength(1)

    const previewMeta = await sharp(h.buffers.get(preview.path)!).metadata()
    expect(previewMeta.width).toBe(160)
    expect(previewMeta.height).toBe(200)
  })

  it('coalesces two in-flight requests for the same name into one edit', async () => {
    let release!: () => void
    h.holdEdit = new Promise((resolve) => {
      release = resolve
    })
    const first = renderOrGetCached(TEMPLATE, { name: 'SMITH', number: '22' }, 640)
    const second = renderOrGetCached(TEMPLATE, { name: 'SMITH', number: '22' }, 640)
    for (let i = 0; i < 50 && h.edits.length < 1; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(h.edits).toHaveLength(1)
    release()
    const [a, b] = await Promise.all([first, second])
    expect(h.upscales).toHaveLength(1)
    expect(a.path).toBe(b.path)
    expect(a.rendered).toBe(true)
    expect(b.rendered).toBe(true)
  })

  it('does not store a press file when the upscale fails', async () => {
    h.upscaleError = 'upscaler down'
    await expect(renderOrGetCached(TEMPLATE, { name: 'SMITH', number: '22' }, 640)).rejects.toThrow(/upscaler down/)
    expect(h.files.size).toBe(0)
    expect(h.uploads).toHaveLength(0)
  })

  it('does not call the model when the name and number sanitize to nothing', async () => {
    await expect(renderOrGetCached(TEMPLATE, { name: '!!!', number: 'xx' }, 640)).rejects.toThrow(/required/i)
    expect(h.edits).toHaveLength(0)
    expect(h.upscales).toHaveLength(0)
  })

  it('falls back to the tagged print_artwork URL when the side asset is missing', async () => {
    h.assets = h.assets.filter((row) => row.asset_role !== 'back_image')
    await renderOrGetCached(TEMPLATE, { name: 'SMITH', number: '22' }, 640)
    expect(h.edits[0].sourceUrl).toBe('https://cdn.example/tagged-back.png')
    expect(h.edits[0].prompt.startsWith('Replace')).toBe(true)
  })

  it('paints onto the erased plate when no tagged back exists', async () => {
    h.assets = h.assets.filter((row) => row.asset_role !== 'back_image')
    h.products = [{ id: 'prod-1', metadata: {} }]
    await renderOrGetCached(TEMPLATE, { name: 'SMITH', number: '22' }, 640)
    expect(h.edits[0].sourceUrl).toBe('https://signed.example/graphics/plate.png')
    expect(h.edits[0].prompt.startsWith('Add player lettering')).toBe(true)
  })

  it('throws before spending when the template has no artwork at all', async () => {
    h.assets = []
    h.products = []
    await expect(renderOrGetCached(TEMPLATE, { name: 'SMITH', number: '22' }, 640)).rejects.toThrow(/no tagged artwork/i)
    expect(h.edits).toHaveLength(0)
  })
})

describe('order path quarantine', () => {
  const text = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

  it('does not import the vector engine from the cache, checkout, or the customer route', () => {
    const store = text('./plate-store.ts')
    const checkout = text('../../routes/stripe.ts')
    const route = text('../../routes/team-plate.ts')
    expect(store).not.toMatch(/from '\.\/(render|fit|svg|fonts)\.js'/)
    expect(store).not.toMatch(/retired\/(render|fit|svg|fonts)/)
    expect(checkout).not.toMatch(/team-plate\/(fit|fonts|svg|render|retired)/)
    expect(route).not.toMatch(/team-plate\/(fit|svg|render)\.js/)
    expect(route).toMatch(/retired\/fonts\.js/)
    expect(route).toMatch(/renderOrGetCached/)
  })
})

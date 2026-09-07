import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'

// ---------------------------------------------------------------------------
// Tests for the Step Flow "Print prep" panel (design doc §10, David
// 2026-09-02): a TEAM-ONLY halftone print file, plus a MEASURED
// recommendation for whether a design needs one.
//
// measurePrintAdviceStats/decidePrintAdvice are pure over decoded/measured
// buffers (mirrors color-advice.test.ts's split of measureArtworkStats vs
// scoreColor) so the recommendation rule is pinned with synthetic PNGs, no
// network. buildPrintFile's fetch + GCS upload + product_assets writes are
// stubbed exactly like details-card.test.ts's renderDetailsCard tests.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.GCS_PROJECT_ID ||= 'test-project'
process.env.GCS_BUCKET_NAME ||= 'test-bucket'

const uploadFile = vi.fn()
vi.mock('../gcs-storage.js', () => ({ uploadFile: (...args: any[]) => uploadFile(...args) }))

let insertedRows: any[] = []
let deletedFilters: any[] = []
const fromCalls: string[] = []
const insertMock = vi.fn((row: any) => {
  insertedRows.push(row)
  return {
    select: () => ({
      single: async () => ({ data: { id: 'asset-print-1', ...row }, error: null }),
    }),
  }
})
/** Mocks `.delete().eq(k1, v1).eq(k2, v2)` — a thenable chain (mirrors the real
 * PostgrestFilterBuilder): `.eq()` accumulates filters and returns itself
 * synchronously; only `await`-ing the chain triggers `.then()`, which is when
 * the accumulated filters are recorded and the "query" resolves. */
const deleteMock = vi.fn((table: string) => {
  const filters: Record<string, any> = {}
  const chain: any = {
    eq: (k: string, v: any) => {
      filters[k] = v
      return chain
    },
    then: (resolve: any, reject?: any) => {
      deletedFilters.push({ table, ...filters })
      return Promise.resolve({ data: null, error: null }).then(resolve, reject)
    },
  }
  return chain
})
vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    from: (table: string) => {
      fromCalls.push(table)
      return {
        delete: () => deleteMock(table),
        insert: (row: any) => insertMock(row),
      }
    },
  },
}))

const {
  measurePrintAdviceStats,
  decidePrintAdvice,
  computePrintAdvice,
  buildPrintFile,
} = await import('./print-prep.js')

beforeEach(() => {
  insertedRows = []
  deletedFilters = []
  fromCalls.length = 0
  uploadFile.mockReset()
  insertMock.mockClear()
  deleteMock.mockClear()
})

// ---------------------------------------------------------------------------
// Synthetic PNG builders
// ---------------------------------------------------------------------------

/** Left half opaque red, right half opaque blue — flat colors, one hard edge, no gradients. */
async function flatTwoColorPng(size = 128): Promise<Buffer> {
  const left = await sharp({
    create: { width: size / 2, height: size, channels: 4, background: { r: 220, g: 20, b: 20, alpha: 255 } },
  })
    .png()
    .toBuffer()
  const right = await sharp({
    create: { width: size / 2, height: size, channels: 4, background: { r: 20, g: 20, b: 220, alpha: 255 } },
  })
    .png()
    .toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 255 } } })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: right, left: size / 2, top: 0 },
    ])
    .png()
    .toBuffer()
}

/** A smooth horizontal grayscale ramp (0..255), fully opaque — a small per-pixel gradient everywhere. */
async function smoothGradientPng(width = 120, height = 120): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.round((x / (width - 1)) * 255)
      const i = (y * width + x) * 4
      raw[i] = v
      raw[i + 1] = v
      raw[i + 2] = v
      raw[i + 3] = 255
    }
  }
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer()
}

async function solidPng(r: number, g: number, b: number, alpha = 255, size = 64): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 4, background: { r, g, b, alpha } } })
    .png()
    .toBuffer()
}

// ---------------------------------------------------------------------------

describe('measurePrintAdviceStats / decidePrintAdvice', () => {
  it('flat two-color hard-edge art measures near-zero smooth share and recommends clean', async () => {
    const stats = await measurePrintAdviceStats(await flatTwoColorPng())
    expect(stats.smoothShare).toBeLessThan(0.1)
    expect(stats.colorCount).toBeLessThanOrEqual(4)
    const advice = decidePrintAdvice(stats)
    expect(advice.recommend).toBe('clean')
    expect(advice.reason).toMatch(/smooth shading/)
  })

  it('a smooth photoreal-style gradient measures a high smooth share and recommends halftone', async () => {
    const stats = await measurePrintAdviceStats(await smoothGradientPng())
    expect(stats.smoothShare).toBeGreaterThan(0.5)
    const advice = decidePrintAdvice(stats)
    expect(advice.recommend).toBe('halftone')
    expect(advice.confidence).toBeGreaterThan(0)
    expect(advice.reason).toMatch(/smooth shading/)
    expect(advice.reason).toMatch(/\d+%/)
  })

  it('confidence scales with smoothShare within each recommendation branch', () => {
    const halftoneLow = decidePrintAdvice({ smoothShare: 0.4, colorCount: 3, softEdgeShare: 0 })
    const halftoneHigh = decidePrintAdvice({ smoothShare: 0.9, colorCount: 3, softEdgeShare: 0 })
    expect(halftoneLow.recommend).toBe('halftone')
    expect(halftoneHigh.recommend).toBe('halftone')
    expect(halftoneHigh.confidence).toBeGreaterThan(halftoneLow.confidence)

    // Clean: LOWER smoothShare (flatter art) is a MORE confident "clean" call.
    const cleanConfident = decidePrintAdvice({ smoothShare: 0.05, colorCount: 3, softEdgeShare: 0 })
    const cleanBorderline = decidePrintAdvice({ smoothShare: 0.3, colorCount: 3, softEdgeShare: 0 })
    expect(cleanConfident.recommend).toBe('clean')
    expect(cleanBorderline.recommend).toBe('clean')
    expect(cleanConfident.confidence).toBeGreaterThan(cleanBorderline.confidence)
  })

  it('invertDark follows the approved primary color luma (light shirt -> true keeps dark ink solid, dark shirt -> false knocks darks out, unset -> false)', () => {
    const stats = { smoothShare: 0.5, colorCount: 10, softEdgeShare: 0 }
    expect(decidePrintAdvice(stats, { primaryLuma: 0.02 }).suggested.invertDark).toBe(false) // black
    expect(decidePrintAdvice(stats, { primaryLuma: 0.98 }).suggested.invertDark).toBe(true) // white
    expect(decidePrintAdvice(stats, {}).suggested.invertDark).toBe(false) // default
  })

  it('suggests a tighter frequency for low quantized color counts', () => {
    const lineArt = decidePrintAdvice({ smoothShare: 0.5, colorCount: 3, softEdgeShare: 0 })
    const busy = decidePrintAdvice({ smoothShare: 0.5, colorCount: 2000, softEdgeShare: 0 })
    expect(lineArt.suggested.frequency).toBe(45)
    expect(busy.suggested.frequency).toBe(35)
  })

  it('softEdgeShare reflects the alpha-16..240 band, not opaque or fully-transparent pixels', async () => {
    // Fully opaque solid: no soft edges at all.
    const opaqueStats = await measurePrintAdviceStats(await solidPng(10, 10, 10, 255))
    expect(opaqueStats.softEdgeShare).toBe(0)
  })
})

describe('computePrintAdvice (fetch stubbed)', () => {
  it('fetches the artwork URL and returns a full advice object', async () => {
    const bytes = await smoothGradientPng()
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const advice = await computePrintAdvice('https://cdn.example/nobg.png', { primaryLuma: 0.02 })

    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example/nobg.png')
    expect(advice.recommend).toBe('halftone')
    expect(advice.suggested.invertDark).toBe(false) // black primary → knock the darks out
    expect(advice.stats.smoothShare).toBeGreaterThan(0)

    vi.unstubAllGlobals()
  })

  it('throws a clear error when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' })))
    await expect(computePrintAdvice('https://cdn.example/missing.png')).rejects.toThrow(/Failed to fetch artwork/)
    vi.unstubAllGlobals()
  })
})

describe('buildPrintFile (fetch + halftone + upload + DB stubbed)', () => {
  it('writes a kind:print / asset_role:print_halftone row, deletes any prior one, and never touches products', async () => {
    // A dark-on-transparent design (bright ring on a fully transparent
    // background) — closer to what a real nobg PNG looks like than a flat
    // opaque square, and exercises the alpha re-masking path.
    const size = 64
    const raw = Buffer.alloc(size * size * 4)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4
        const inCircle = Math.hypot(x - size / 2, y - size / 2) < size / 3
        raw[i] = 255
        raw[i + 1] = 255
        raw[i + 2] = 255
        raw[i + 3] = inCircle ? 255 : 0
      }
    }
    const artwork = await sharp(raw, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer()

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => artwork.buffer.slice(artwork.byteOffset, artwork.byteOffset + artwork.byteLength),
    }))
    vi.stubGlobal('fetch', fetchMock)

    uploadFile.mockResolvedValueOnce({
      gcsPath: 'users/system/mockups/p1-print-halftone-123.png',
      publicUrl: 'https://signed.example/p1-print-halftone-123.png',
      filename: 'p1-print-halftone-123.png',
    })

    const result = await buildPrintFile('p1', 'https://cdn.example/nobg.png', { frequency: 35, angle: 23.5 }, 'admin-1')

    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example/nobg.png')
    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(uploadFile.mock.calls[0][1]).toMatchObject({ folder: 'mockups', contentType: 'image/png' })

    expect(result.assetId).toBe('asset-print-1')
    expect(result.url).toBe('https://signed.example/p1-print-halftone-123.png')
    expect(result.options).toMatchObject({ method: 'halftone' })

    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0]).toMatchObject({
      product_id: 'p1',
      kind: 'print',
      asset_role: 'print_halftone',
    })

    // One print file per product, WHICHEVER way it was made: the sweep clears
    // every print role, so switching between a halftone screen and a vector
    // trace replaces the file instead of leaving both behind.
    expect(deletedFilters).toHaveLength(2)
    expect(deletedFilters.map((f: any) => f.asset_role).sort()).toEqual(['print_halftone', 'print_vector'])
    for (const f of deletedFilters) expect(f).toMatchObject({ table: 'product_assets', product_id: 'p1' })

    // Structural guarantee that products.images is never touched by this
    // pipeline: buildPrintFile never even opens a `products` table handle.
    expect(fromCalls.every((t) => t === 'product_assets')).toBe(true)
    expect(fromCalls).not.toContain('products')

    vi.unstubAllGlobals()
  })

  // David 2026-09-03: "lets have vectorizer as a add on just like we do with
  // halftone". Same slot, same team-only role family, different tool.
  it("method:'vector' writes an SVG print_vector row instead of a screened PNG", async () => {
    const size = 64
    const raw = Buffer.alloc(size * size * 4)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const inCircle = Math.hypot(x - size / 2, y - size / 2) < size / 3
      raw[i] = 220; raw[i + 1] = 40; raw[i + 2] = 40; raw[i + 3] = inCircle ? 255 : 0
    }
    const artwork = await sharp(raw, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, statusText: 'OK',
      arrayBuffer: async () => artwork.buffer.slice(artwork.byteOffset, artwork.byteOffset + artwork.byteLength),
    })))
    uploadFile.mockResolvedValueOnce({
      gcsPath: 'users/system/mockups/p1-print-vector-123.svg',
      publicUrl: 'https://signed.example/p1-print-vector-123.svg',
      filename: 'p1-print-vector-123.svg',
    })

    const result = await buildPrintFile('p1', 'https://cdn.example/nobg.png', { method: 'vector' }, 'admin-1')

    // Uploaded as an SVG, not a PNG - a print file the press can scale.
    expect(uploadFile.mock.calls[0][1]).toMatchObject({ folder: 'mockups', contentType: 'image/svg+xml' })
    expect(uploadFile.mock.calls[0][0].toString('utf8')).toContain('<svg')
    expect(insertedRows[0]).toMatchObject({ product_id: 'p1', kind: 'print', asset_role: 'print_vector' })
    expect(result.options).toMatchObject({ method: 'vector', format: 'svg' })
    // Still team-only, still never near the storefront gallery.
    expect(fromCalls).not.toContain('products')

    vi.unstubAllGlobals()
  })

  it('the print file stays transparent where the source nobg PNG was transparent', async () => {
    const size = 64
    const raw = Buffer.alloc(size * size * 4)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4
        const inCircle = Math.hypot(x - size / 2, y - size / 2) < size / 3
        // Deliberately bright, non-black RGB under the transparent region —
        // the exact case that would "leak" halftone dots if applyHalftone's
        // rebuilt alpha were trusted on its own.
        raw[i] = 250
        raw[i + 1] = 200
        raw[i + 2] = 50
        raw[i + 3] = inCircle ? 255 : 0
      }
    }
    const artwork = await sharp(raw, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => artwork.buffer.slice(artwork.byteOffset, artwork.byteOffset + artwork.byteLength),
      }))
    )
    uploadFile.mockImplementationOnce(async (buf: Buffer) => {
      // Capture the actual PNG bytes buildPrintFile uploaded so we can assert
      // on its alpha channel directly.
      ;(globalThis as any).__lastUploadedBuffer = buf
      return {
        gcsPath: 'users/system/mockups/p2-print-halftone-1.png',
        publicUrl: 'https://signed.example/p2.png',
        filename: 'p2.png',
      }
    })

    await buildPrintFile('p2', 'https://cdn.example/nobg2.png', {}, 'admin-1')

    const uploaded: Buffer = (globalThis as any).__lastUploadedBuffer
    const { data, info } = await sharp(uploaded).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    // Sample the four corners — well outside the circle, originally alpha:0.
    const corners = [
      0,
      (info.width - 1) * 4,
      (info.height - 1) * info.width * 4,
      ((info.height - 1) * info.width + info.width - 1) * 4,
    ]
    for (const o of corners) {
      expect(data[o + 3]).toBe(0)
    }

    vi.unstubAllGlobals()
  })
})

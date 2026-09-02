import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'

// ---------------------------------------------------------------------------
// Tests for the Step Flow "details" card (backend/services/step-flow/details-card.ts).
//
// composeDetailsCardPng is pure (no network, no upload) so the size/shape
// contract — always exactly 1500x1500 (square, per David 2026-09-02: "the
// text is way too small" + Etsy crops non-square thumbnails) — is pinned
// directly. renderDetailsCard wraps that with fetch + GCS upload + a
// product_assets insert, all stubbed below.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.GCS_PROJECT_ID ||= 'test-project'
process.env.GCS_BUCKET_NAME ||= 'test-bucket'

const uploadFile = vi.fn()
vi.mock('../gcs-storage.js', () => ({ uploadFile: (...args: any[]) => uploadFile(...args) }))

let insertedRows: any[] = []
const insertMock = vi.fn((row: any) => {
  insertedRows.push(row)
  return {
    select: () => ({
      single: async () => ({ data: { id: 'asset-details-1', ...row }, error: null }),
    }),
  }
})
const deleteChain = { eq: () => ({ eq: async () => ({ data: null, error: null }) }) }
vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    from: (_table: string) => ({
      delete: () => deleteChain,
      insert: (row: any) => insertMock(row),
    }),
  },
}))

const { composeDetailsCardPng, renderDetailsCard, buildDetailsSvg } = await import('./details-card.js')

async function solidPng(size = 400): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 30, g: 30, b: 30, alpha: 255 } } })
    .png()
    .toBuffer()
}

/** Every `font-size="N"` (attribute or on a bare number) that appears in the SVG. */
function allFontSizes(svg: string): number[] {
  return [...svg.matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]))
}

beforeEach(() => {
  insertedRows = []
  uploadFile.mockReset()
  insertMock.mockClear()
})

describe('composeDetailsCardPng', () => {
  it('always renders exactly 1500x1500 (square) regardless of mockup source size', async () => {
    const mockup = await solidPng(777) // deliberately non-matching aspect ratio
    const png = await composeDetailsCardPng(mockup, {
      garment: 'tshirt',
      color: 'black',
      title: 'Hip-Hop Street Monkey',
      printWidthInches: 11,
    })
    const meta = await sharp(png).metadata()
    expect(meta.width).toBe(1500)
    expect(meta.height).toBe(1500)
    expect(meta.format).toBe('png')
  })

  it('works for the hoodie garment too', async () => {
    const mockup = await solidPng(500)
    const png = await composeDetailsCardPng(mockup, {
      garment: 'hoodie',
      color: 'navy',
      title: 'Cozy Hoodie Design',
      printWidthInches: 10,
    })
    const meta = await sharp(png).metadata()
    expect(meta.width).toBe(1500)
    expect(meta.height).toBe(1500)
  })
})

describe('buildDetailsSvg', () => {
  it('includes the DTF pitch, blank spec, care line, and a size row for every chart size', () => {
    const svg = buildDetailsSvg({ garment: 'tshirt', color: 'black', title: 'Test Design', printWidthInches: 11 })
    expect(svg).toMatch(/Printed with DTF/)
    expect(svg).toMatch(/vivid, stretch-safe, wash-tested/)
    expect(svg).toMatch(/Gildan 5000 Heavy Cotton/)
    expect(svg).toMatch(/Design width/)
    expect(svg).toMatch(/~11 in/)
    expect(svg).toMatch(/DTF heat transfer/)
    expect(svg).toMatch(/Unisex, true to size/)
    expect(svg).toMatch(/Wash cold inside out/)
    for (const size of ['S', 'M', 'L', 'XL', '2XL', '3XL']) {
      expect(svg).toContain(`>${size}<`)
    }
  })

  // The card floor: nothing on it may render below 28px, anywhere, ever.
  it('never renders a font-size below the 28px floor', () => {
    const titles = [
      'x',
      'Test Design',
      'A Perfectly Normal Two Line Title For A Tee',
      'This Is A Genuinely Long Product Title For The Details Card That Keeps Going',
    ]
    for (const title of titles) {
      for (const garment of ['tshirt', 'hoodie'] as const) {
        const svg = buildDetailsSvg({ garment, color: 'black', title, printWidthInches: 11 })
        const sizes = allFontSizes(svg)
        expect(sizes.length).toBeGreaterThan(0)
        for (const size of sizes) {
          expect(size).toBeGreaterThanOrEqual(28)
        }
      }
    }
  })

  it('escapes an ampersand in the title exactly once', () => {
    const svg = buildDetailsSvg({ garment: 'tshirt', color: 'black', title: 'Rock & Roll Tour', printWidthInches: 11 })
    const matches = svg.match(/&amp;/g) ?? []
    expect(matches).toHaveLength(1)
    expect(svg).not.toMatch(/&amp;amp;/)
  })

  it('escapes XML-unsafe characters in the title', () => {
    const svg = buildDetailsSvg({ garment: 'tshirt', color: 'black', title: 'Rock & Roll <Tour>', printWidthInches: 11 })
    expect(svg).not.toMatch(/<Tour>/)
    expect(svg).toMatch(/&amp;|&lt;Tour&gt;/)
  })

  // Fix #7 (carried forward): the title used to be escaped ONCE up front
  // (`escapeXml(...)`) and then split/rejoined/escaped a SECOND time while
  // wrapping across lines — every "&" came out as "&amp;amp;" instead of
  // "&amp;". Escaping now happens exactly once, at push time, on the
  // wrapped (raw) line.
  it('never double-escapes an ampersand, even in a title long enough to wrap across lines', () => {
    const svg = buildDetailsSvg({
      garment: 'tshirt',
      color: 'black',
      title: 'Rock & Roll Forever & Ever Tour Deluxe Edition',
      printWidthInches: 11,
    })
    expect(svg).not.toMatch(/&amp;amp;/)
    expect(svg).toMatch(/&amp;/)
  })

  // 2 lines max at 72px; a title that needs a 3rd line shrinks to 60px — the
  // floor for the title block — instead of being silently cut off.
  it('wraps a long title across a 3rd line at 60px instead of silently truncating it', () => {
    const longTitle = 'This Is A Genuinely Long Product Title For The Details Card'
    const svg = buildDetailsSvg({ garment: 'tshirt', color: 'black', title: longTitle, printWidthInches: 11 })
    // The early words of the title must still be present somewhere in the
    // SVG — nothing before the wrap point silently disappears.
    expect(svg).toContain('This')
    expect(svg).toContain('Genuinely')
    expect(svg).toContain('Product')
    // The 60px shrink kicks in, and never goes smaller than that.
    expect(svg).toMatch(/font-size="60"/)
  })

  it('keeps a short title at the full 72px size', () => {
    const svg = buildDetailsSvg({ garment: 'tshirt', color: 'black', title: 'Cozy Hoodie', printWidthInches: 11 })
    expect(svg).toMatch(/font-size="72"/)
  })

  it('renders the full blank name for both garments without truncating a name that fits', () => {
    const tshirt = buildDetailsSvg({ garment: 'tshirt', color: 'black', title: 'x', printWidthInches: 11 })
    expect(tshirt).toMatch(/Gildan 5000 Heavy Cotton</)
    const hoodie = buildDetailsSvg({ garment: 'hoodie', color: 'navy', title: 'x', printWidthInches: 11 })
    expect(hoodie).toMatch(/Gildan 18500 Heavy Blend</)
  })

  it('uses a font stack with a Linux-available fallback (Render has no Arial/Helvetica)', () => {
    const svg = buildDetailsSvg({ garment: 'tshirt', color: 'black', title: 'x', printWidthInches: 11 })
    expect(svg).toContain(`font-family="Arial, Helvetica, 'DejaVu Sans', sans-serif"`)
    expect(svg).not.toContain('font-family="Arial, Helvetica, sans-serif"')
  })
})

describe('renderDetailsCard (fetch + upload + DB stubbed)', () => {
  it('fetches the mockup, uploads the composed card, and inserts a mockup_details asset', async () => {
    const mockupBytes = await solidPng(400)
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => mockupBytes.buffer.slice(mockupBytes.byteOffset, mockupBytes.byteOffset + mockupBytes.byteLength),
    }))
    vi.stubGlobal('fetch', fetchMock)

    uploadFile.mockResolvedValueOnce({
      gcsPath: 'users/system/mockups/p1-details-123.png',
      publicUrl: 'https://signed.example/p1-details-123.png',
      filename: 'p1-details-123.png',
    })

    const result = await renderDetailsCard({
      productId: 'p1',
      mockupUrl: 'https://cdn.example/mockup.png',
      garment: 'tshirt',
      color: 'black',
      title: 'Street Monkey',
      printWidthInches: 11,
    })

    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example/mockup.png')
    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(result.url).toBe('https://signed.example/p1-details-123.png')
    expect(result.path).toBe('users/system/mockups/p1-details-123.png')
    expect(result.assetId).toBe('asset-details-1')

    const meta = await sharp(result.buffer).metadata()
    expect(meta.width).toBe(1500)
    expect(meta.height).toBe(1500)

    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0]).toMatchObject({ product_id: 'p1', kind: 'mockup', asset_role: 'mockup_details' })

    vi.unstubAllGlobals()
  })

  it('throws a clear error when the mockup fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' })))
    await expect(
      renderDetailsCard({
        productId: 'p1',
        mockupUrl: 'https://cdn.example/missing.png',
        garment: 'tshirt',
        color: 'black',
        title: 'x',
        printWidthInches: 11,
      })
    ).rejects.toThrow(/Failed to fetch mockup/)
    vi.unstubAllGlobals()
  })
})

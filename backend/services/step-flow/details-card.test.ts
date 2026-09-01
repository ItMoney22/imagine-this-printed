import { describe, it, expect, vi, beforeEach } from 'vitest'
import sharp from 'sharp'

// ---------------------------------------------------------------------------
// Tests for the Step Flow "details" card (backend/services/step-flow/details-card.ts).
//
// composeDetailsCardPng is pure (no network, no upload) so the size/shape
// contract — always exactly 1200x1500 — is pinned directly. renderDetailsCard
// wraps that with fetch + GCS upload + a product_assets insert, all stubbed
// below per the plan ("Test: returns a PNG buffer of 1200x1500, upload
// stubbed").
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

beforeEach(() => {
  insertedRows = []
  uploadFile.mockReset()
  insertMock.mockClear()
})

describe('composeDetailsCardPng', () => {
  it('always renders exactly 1200x1500 regardless of mockup source size', async () => {
    const mockup = await solidPng(777) // deliberately non-matching aspect ratio
    const png = await composeDetailsCardPng(mockup, {
      garment: 'tshirt',
      color: 'black',
      title: 'Hip-Hop Street Monkey',
      printWidthInches: 11,
    })
    const meta = await sharp(png).metadata()
    expect(meta.width).toBe(1200)
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
    expect(meta.width).toBe(1200)
    expect(meta.height).toBe(1500)
  })
})

describe('buildDetailsSvg', () => {
  it('includes the DTF pitch, blank spec, care bullets, and a size row for every chart size', () => {
    const svg = buildDetailsSvg({ garment: 'tshirt', color: 'black', title: 'Test Design', printWidthInches: 11 })
    expect(svg).toMatch(/Printed with DTF/)
    expect(svg).toMatch(/Gildan 5000/)
    expect(svg).toMatch(/Design width ~11 in/)
    for (const size of ['S', 'M', 'L', 'XL', '2XL', '3XL']) {
      expect(svg).toContain(`>${size}<`)
    }
  })

  it('escapes XML-unsafe characters in the title', () => {
    const svg = buildDetailsSvg({ garment: 'tshirt', color: 'black', title: 'Rock & Roll <Tour>', printWidthInches: 11 })
    expect(svg).not.toMatch(/<Tour>/)
    expect(svg).toMatch(/&amp;|&lt;Tour&gt;/)
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
    expect(meta.width).toBe(1200)
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

// Tests for "render this buyer's Team/Name/Number onto THIS product's real
// print file and put the result somewhere the floor can fetch it".
//
// personalization-render.ts owns the pixels; this module owns the plumbing
// around them — which product, which artwork, what happens when any of it is
// missing. Every dependency is injected, so none of this touches Supabase, GCS
// or the network.
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'

// personalization-print.ts imports backend/lib/supabase.ts for its DEFAULT
// deps, and that module builds its client eagerly at load. These tests inject
// their own deps and never touch it, but the env has to exist before the
// dynamic import below (a static import would hoist above these assignments).
// Mirrors etsy-variations.test.ts and etsy-receipt-ingest.test.ts.
process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { renderPersonalizedPrintForProduct } = await import('./personalization-print.js')
type PersonalizedPrintDeps = import('./personalization-print.js').PersonalizedPrintDeps

const ZONES = [
  { field: 'team', x: 20, y: 20, width: 360, height: 50 },
  { field: 'name', x: 20, y: 120, width: 360, height: 50 },
  { field: 'number', x: 20, y: 240, width: 360, height: 100 }
]

const personalizedProduct = (zones: unknown = ZONES) => ({
  id: 'prod-1',
  metadata: { personalization: { enabled: true, zones } }
})

const pngBuffer = (width = 400, height = 400): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .png()
    .toBuffer()

/** Records what the service asked for, so the tests can assert on the plumbing. */
function makeDeps(overrides: Partial<PersonalizedPrintDeps> = {}) {
  const uploads: { key: string; buffer: Buffer }[] = []
  const fetched: string[] = []
  const deps: PersonalizedPrintDeps = {
    loadProduct: async () => personalizedProduct(),
    loadBasePrintUrl: async () => 'https://cdn.example.com/print/design.png',
    fetchImage: async (url) => { fetched.push(url); return pngBuffer() },
    upload: async (key, buffer) => {
      uploads.push({ key, buffer })
      return { publicUrl: `https://cdn.example.com/${key}`, path: `gs://bucket/${key}` }
    },
    ...overrides
  }
  return { deps, uploads, fetched }
}

const VALUES = { team: 'Wildcats', name: 'Smith', number: '12' }

describe('renderPersonalizedPrintForProduct', () => {
  it('renders and uploads a PNG, returning where it landed', async () => {
    const { deps, uploads } = makeDeps()
    const result = await renderPersonalizedPrintForProduct({ productId: 'prod-1', values: VALUES }, deps)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.url).toBe(`https://cdn.example.com/${uploads[0].key}`)
    expect(result.path).toContain('gs://bucket/')
    expect(uploads).toHaveLength(1)
    expect(await sharp(uploads[0].buffer).metadata()).toMatchObject({ format: 'png', width: 400 })
  })

  it('fetches the product OWN print file, not something invented', async () => {
    const { deps, fetched } = makeDeps()
    await renderPersonalizedPrintForProduct({ productId: 'prod-1', values: VALUES }, deps)
    expect(fetched).toEqual(['https://cdn.example.com/print/design.png'])
  })

  it('names the upload after the product so a stray file is traceable', async () => {
    const { deps, uploads } = makeDeps()
    await renderPersonalizedPrintForProduct({ productId: 'prod-1', values: VALUES }, deps)
    expect(uploads[0].key).toContain('prod-1')
    expect(uploads[0].key.endsWith('.png')).toBe(true)
  })

  it('actually burns the text in — the upload differs from the untouched artwork', async () => {
    const { deps, uploads } = makeDeps()
    const original = await pngBuffer()
    await renderPersonalizedPrintForProduct({ productId: 'prod-1', values: VALUES }, deps)
    expect(Buffer.compare(original, uploads[0].buffer)).not.toBe(0)
  })

  it('reports a missing product instead of throwing', async () => {
    const { deps } = makeDeps({ loadProduct: async () => null })
    const result = await renderPersonalizedPrintForProduct({ productId: 'nope', values: VALUES }, deps)
    expect(result).toEqual({ ok: false, reason: 'product-not-found' })
  })

  it('refuses a product that is not personalizable', async () => {
    const { deps, uploads } = makeDeps({ loadProduct: async () => ({ id: 'p', metadata: {} }) })
    const result = await renderPersonalizedPrintForProduct({ productId: 'p', values: VALUES }, deps)
    expect(result).toEqual({ ok: false, reason: 'not-personalizable' })
    expect(uploads).toHaveLength(0)
  })

  it('names the missing zones explicitly — this is the setup step admins forget', async () => {
    const { deps } = makeDeps({ loadProduct: async () => personalizedProduct([]) })
    const result = await renderPersonalizedPrintForProduct({ productId: 'prod-1', values: VALUES }, deps)
    expect(result).toEqual({ ok: false, reason: 'no-zones' })
  })

  it('reports when the buyer supplied nothing to print', async () => {
    const { deps, uploads } = makeDeps()
    const result = await renderPersonalizedPrintForProduct({ productId: 'prod-1', values: {} }, deps)
    expect(result).toEqual({ ok: false, reason: 'nothing-to-print' })
    expect(uploads).toHaveLength(0)
  })

  it('reports a product that has no print file to print onto', async () => {
    const { deps } = makeDeps({ loadBasePrintUrl: async () => null })
    const result = await renderPersonalizedPrintForProduct({ productId: 'prod-1', values: VALUES }, deps)
    expect(result).toEqual({ ok: false, reason: 'no-print-file' })
  })

  it('sanitizes the values before they reach the print file', async () => {
    // Same guard the checkout path uses: a control character must never reach
    // the SVG text node, even if a crafted admin preview payload contains one.
    const { deps, uploads } = makeDeps()
    const clean = await renderPersonalizedPrintForProduct({ productId: 'prod-1', values: VALUES }, deps)
    const dirty = await renderPersonalizedPrintForProduct(
      { productId: 'prod-1', values: { team: 'Wildcats', name: 'Sm\u0000ith', number: '12' } },
      deps
    )
    expect(clean.ok && dirty.ok).toBe(true)
    // 'Smith' sanitizes to 'Smith', so the two renders must be identical.
    expect(Buffer.compare(uploads[0].buffer, uploads[1].buffer)).toBe(0)
  })

  it('lets a misconfigured zone fail loudly rather than uploading a broken sheet', async () => {
    // A zone hanging off the edge of the artwork is a product-config bug.
    const offCanvas = [{ field: 'name', x: 380, y: 10, width: 300, height: 50 }]
    const { deps, uploads } = makeDeps({ loadProduct: async () => personalizedProduct(offCanvas) })
    await expect(renderPersonalizedPrintForProduct({ productId: 'prod-1', values: VALUES }, deps))
      .rejects.toThrow(/outside/i)
    expect(uploads).toHaveLength(0)
  })

  it('only renders the fields the buyer filled', async () => {
    const { deps, uploads } = makeDeps()
    await renderPersonalizedPrintForProduct({ productId: 'prod-1', values: VALUES }, deps)
    await renderPersonalizedPrintForProduct({ productId: 'prod-1', values: { name: 'Smith' } }, deps)
    expect(Buffer.compare(uploads[0].buffer, uploads[1].buffer)).not.toBe(0)
  })
})

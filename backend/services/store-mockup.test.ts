import { describe, it, expect, vi, beforeEach } from 'vitest'

// Her assistant's mockups render through the product builder's own mockup call and its fidelity check, never a second
// engine (task 820ff916). The builder's calls are faked here; what must hold is what this file hands them.
const calls = vi.hoisted(() => ({ mockup: [] as any[], verify: [] as any[], upload: [] as any[] }))
vi.mock('./image-flow/worker-helpers.js', () => ({
  runImageFlowMockup: async (opts: any) => {
    calls.mockup.push(opts)
    return { url: `https://replicate.test/${calls.mockup.length}.png`, modelId: 'builder-default' }
  },
}))
vi.mock('./mockup-qa.js', () => ({
  verifyWithOneRetry: async (designUrl: string, firstUrl: string, placement: string, rerender: (r: string) => Promise<string | null>, label: string, size: number) => {
    calls.verify.push({ designUrl, firstUrl, placement, label, size })
    // The check sends one back, the way it does when the print came out wrong.
    const retry = await rerender('the print is too large')
    return { url: retry || firstUrl, check: { ok: true, retried: true } }
  },
}))
vi.mock('./google-cloud-storage.js', () => ({
  uploadImageFromUrl: async (url: string, path: string) => {
    calls.upload.push({ url, path })
    return { publicUrl: 'https://signed.test/x', path }
  },
}))
vi.mock('./imagination-pricing.js', () => ({ pricingService: { getPricing: async () => ({ current_cost: 15 }) } }))
vi.mock('./step-flow/color-advice.js', () => ({
  measureArtworkStats: async () => ({ meanLuma: 0.05, darkShare: 0.9, lightShare: 0, coverage: 0.5, dominantHue: null }),
  scoreColorsForGarment: () => [{ id: 'white' }, { id: 'heather-grey' }, { id: 'black' }],
}))

const realFetch = globalThis.fetch
globalThis.fetch = (async (url: any, init: any) =>
  String(url).startsWith('https://media.test/') ? new Response(Buffer.from('89504e47', 'hex'), { status: 200 }) : realFetch(url, init)) as any

const { renderStoreMockup, mockupPriceItc } = await import('./store-mockup.js')

beforeEach(() => {
  calls.mockup.length = 0
  calls.verify.length = 0
  calls.upload.length = 0
})

describe('renderStoreMockup', () => {
  it('puts her picture on the builder’s product shot, checks it, and saves it in her store folder', async () => {
    const stages: string[] = []
    const out = await renderStoreMockup({
      slug: 'crystal',
      designUrl: 'https://media.test/products/vendor-stores/crystal/assistant/abc.png',
      choice: { product: 'tshirt', color: 'black', size: null },
      onStage: s => { stages.push(s) },
    })
    expect(calls.mockup[0]).toMatchObject({
      template: 'ghost_mannequin',
      designImageUrl: 'https://media.test/products/vendor-stores/crystal/assistant/abc.png',
      productType: 'tshirt',
      shirtColor: 'black',
      printPlacement: 'front-center',
      printSizeInches: 11,
    })
    // The check's one re-render tells the builder what to fix, and the kept picture is the one saved.
    expect(calls.mockup[1]).toMatchObject({ template: 'ghost_mannequin', retryNote: 'the print is too large' })
    expect(calls.verify[0]).toMatchObject({ firstUrl: 'https://replicate.test/1.png', placement: 'front-center', size: 11 })
    expect(calls.upload[0].url).toBe('https://replicate.test/2.png')
    expect(calls.upload[0].path).toMatch(/^products\/vendor-stores\/crystal\/assistant\/mockups\/[\w-]{12}\.png$/)
    expect(out).toMatchObject({ path: calls.upload[0].path, color: 'black', qaOk: true })
    expect(stages).toEqual(['Getting it ready…', 'Putting your picture on it…', 'Checking it against your picture…', 'Saving it…'])
  })

  it('with no colour named, uses the colour her picture shows best on', async () => {
    const out = await renderStoreMockup({
      slug: 'crystal',
      designUrl: 'https://media.test/d.png',
      choice: { product: 'youth-tshirt', color: null, size: null },
    })
    expect(calls.mockup[0]).toMatchObject({ productType: 'youth-tshirt', shirtColor: 'white', printSizeInches: 8 })
    expect(out.color).toBe('white')
  })

  it('a metal print is the builder’s wall scene at her size, with no garment colour', async () => {
    const out = await renderStoreMockup({ slug: 'crystal', designUrl: 'https://media.test/d.png', choice: { product: 'metal', color: null, size: '4x6' } })
    expect(calls.mockup[0]).toMatchObject({ template: 'metal_wall', metalSize: '4x6' })
    expect(out.color).toBeNull()
  })

  it('is priced as one picture at the Imagination rate', async () => {
    expect(await mockupPriceItc()).toBe(15)
  })
})

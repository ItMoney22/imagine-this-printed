import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for the Order Management production-file bundle (2026-08-09).
//
// The trap worth pinning: the halftone press file is NOT stored as
// kind='halftone'. services/image-flow/api/halftone.ts writes kind='source'
// with asset_role='design_halftone', so a kind-only query returns the CLEAN
// design and labels it as the press file. Handing the floor clean art labelled
// "halftone" would get a shirt printed wrong, and nothing downstream would
// catch it — both are valid PNGs at the same product.
//
// Second property: a product with no assets must yield empty arrays/nulls, not
// throw, because the only product ordered in prod today has zero asset rows.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

let assetRows: any[] = []
let productRows: any[] = []
let assetError: { message: string } | null = null

vi.mock('../lib/supabase.js', () => {
  const makeChain = (resolve: () => any) => {
    const chain: any = {}
    for (const m of ['select', 'in', 'eq', 'order', 'limit']) chain[m] = () => chain
    chain.then = (onOk: any, onErr?: any) => Promise.resolve(resolve()).then(onOk, onErr)
    return chain
  }
  return {
    supabase: {
      from: (table: string) => ({
        select: (...args: any[]) =>
          makeChain(() =>
            table === 'product_assets'
              ? { data: assetError ? null : assetRows, error: assetError }
              : { data: productRows, error: null }
          ).select(...args),
      }),
    },
  }
})

const { getProductFilesFor, attachProductFiles, emptyProductFiles } = await import('./product-files.js')

const asset = (over: Partial<any>) => ({
  id: 'a1',
  product_id: 'p1',
  kind: 'source',
  url: 'https://cdn/x.png',
  asset_role: 'design',
  is_primary: false,
  display_order: 1,
  ...over,
})

beforeEach(() => {
  assetRows = []
  productRows = []
  assetError = null
})

describe('getProductFilesFor', () => {
  it('does NOT mistake the halftone source row for the clean design', async () => {
    assetRows = [
      asset({ id: 'clean', kind: 'source', asset_role: 'design', url: 'https://cdn/clean.png' }),
      asset({ id: 'ht', kind: 'source', asset_role: 'design_halftone', url: 'https://cdn/halftone.png' }),
    ]
    const files = (await getProductFilesFor(['p1']))['p1']

    expect(files.halftone).toBe('https://cdn/halftone.png')
    expect(files.design).toBe('https://cdn/clean.png')
    // The specific regression: design must never be the halftone file.
    expect(files.design).not.toBe(files.halftone)
    expect(files.designAssetId).toBe('clean')
  })

  it('reports no halftone when only a halftone-less source exists', async () => {
    assetRows = [asset({ id: 'clean', asset_role: 'design', url: 'https://cdn/clean.png' })]
    const files = (await getProductFilesFor(['p1']))['p1']
    expect(files.halftone).toBeNull()
    expect(files.design).toBe('https://cdn/clean.png')
  })

  it('picks the halftone even when it is the only source row', async () => {
    assetRows = [asset({ id: 'ht', asset_role: 'design_halftone', url: 'https://cdn/ht.png' })]
    const files = (await getProductFilesFor(['p1']))['p1']
    expect(files.halftone).toBe('https://cdn/ht.png')
    // No clean design exists — must be null, not the halftone standing in.
    expect(files.design).toBeNull()
    expect(files.designAssetId).toBeNull()
  })

  it('collects every mockup with its role, and the dtf press file', async () => {
    assetRows = [
      asset({ id: 'm1', kind: 'mockup', asset_role: 'mockup_ghost_mannequin', url: 'https://cdn/g.png' }),
      asset({ id: 'm2', kind: 'mockup', asset_role: 'mockup_flat_lay', url: 'https://cdn/f.png' }),
      asset({ id: 'd', kind: 'dtf', asset_role: 'design', url: 'https://cdn/dtf.png' }),
    ]
    const files = (await getProductFilesFor(['p1']))['p1']
    expect(files.mockups.map((m) => m.role)).toEqual(['mockup_ghost_mannequin', 'mockup_flat_lay'])
    expect(files.dtf).toBe('https://cdn/dtf.png')
  })

  it('orders primary first, then display_order', async () => {
    assetRows = [
      asset({ id: 'm1', kind: 'mockup', url: 'https://cdn/third.png', display_order: 5 }),
      asset({ id: 'm2', kind: 'mockup', url: 'https://cdn/first.png', is_primary: true, display_order: 9 }),
      asset({ id: 'm3', kind: 'mockup', url: 'https://cdn/second.png', display_order: 2 }),
    ]
    const files = (await getProductFilesFor(['p1']))['p1']
    expect(files.mockups.map((m) => m.url)).toEqual([
      'https://cdn/first.png',
      'https://cdn/second.png',
      'https://cdn/third.png',
    ])
  })

  it('falls back to the legacy metadata.assets bundle without overriding real rows', async () => {
    assetRows = [asset({ id: 'clean', asset_role: 'design', url: 'https://cdn/real-design.png' })]
    productRows = [
      { id: 'p1', metadata: { assets: { clean: 'https://cdn/legacy.png', halftone: 'https://cdn/legacy-ht.png' } } },
    ]
    const files = (await getProductFilesFor(['p1']))['p1']
    // Real asset row wins for design...
    expect(files.design).toBe('https://cdn/real-design.png')
    // ...but the legacy bundle fills the gap the rows didn't cover.
    expect(files.halftone).toBe('https://cdn/legacy-ht.png')
  })

  it('folds in a legacy single metadata.mockup_url when no mockup rows exist', async () => {
    productRows = [{ id: 'p1', metadata: { mockup_url: 'https://cdn/old-mockup.png' } }]
    const files = (await getProductFilesFor(['p1']))['p1']
    expect(files.mockups).toEqual([{ role: 'mockup', url: 'https://cdn/old-mockup.png' }])
  })

  it('returns an empty bundle for a product with no assets at all', async () => {
    const files = (await getProductFilesFor(['ghost']))['ghost']
    expect(files).toEqual(emptyProductFiles())
  })

  it('skips asset rows with no url', async () => {
    assetRows = [asset({ id: 'broken', kind: 'mockup', url: null })]
    const files = (await getProductFilesFor(['p1']))['p1']
    expect(files.mockups).toEqual([])
  })

  it('degrades to empty rather than throwing when the asset read fails', async () => {
    assetError = { message: 'permission denied' }
    const files = await getProductFilesFor(['p1'])
    expect(files['p1']).toEqual(emptyProductFiles())
  })

  it('does no query at all for an empty id list', async () => {
    expect(await getProductFilesFor([])).toEqual({})
  })
})

describe('attachProductFiles', () => {
  it('attaches a bundle to every line, using client_product_id when product_id is null', async () => {
    assetRows = [asset({ product_id: 'p1', id: 'clean', url: 'https://cdn/clean.png' })]
    const orders = [
      {
        id: 'o1',
        order_items: [
          { id: 'i1', product_id: 'p1', metadata: {} },
          { id: 'i2', product_id: null, metadata: { client_product_id: 'p1' } },
        ],
      },
    ]
    const [out] = await attachProductFiles(orders as any)
    expect((out.order_items as any)[0].product_files.design).toBe('https://cdn/clean.png')
    // The snapshot-reconstructed line resolves through client_product_id.
    expect((out.order_items as any)[1].product_files.design).toBe('https://cdn/clean.png')
  })

  it('gives a line with no resolvable product an empty bundle, not undefined', async () => {
    const orders = [{ id: 'o1', order_items: [{ id: 'i1', product_id: null, metadata: {} }] }]
    const [out] = await attachProductFiles(orders as any)
    expect((out.order_items as any)[0].product_files).toEqual(emptyProductFiles())
  })

  it('leaves orders untouched when there are no items', async () => {
    const orders = [{ id: 'o1', order_items: [] }]
    const [out] = await attachProductFiles(orders as any)
    expect(out.order_items).toEqual([])
  })
})

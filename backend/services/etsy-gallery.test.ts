import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for Etsy Gallery resolution and superseded photo handling:
// - resolveEtsyListingImages in backend/services/etsy.ts
// - syncProductImagesOnShotDone & removeProductImage in backend/services/step-flow/shots.ts
// ---------------------------------------------------------------------------

type Row = Record<string, any>
let db: Record<string, Row[]> = { products: [], product_assets: [] }

function resetDb() {
  db = { products: [], product_assets: [] }
}

function matches(row: Row, filters: [string, any][]): boolean {
  return filters.every(([k, v]) => row[k] === v)
}

vi.mock('../lib/supabase.js', () => {
  const builder = (table: string) => {
    let mode: 'select' | 'insert' | 'update' | 'delete' | null = null
    let payload: any = null
    const filters: [string, any][] = []

    const exec = (): { data: any; error: any } => {
      const rows = db[table] || (db[table] = [])
      if (mode === 'insert') {
        const items = Array.isArray(payload) ? payload : [payload]
        db[table] = [...rows, ...items]
        return { data: items.length === 1 ? items[0] : items, error: null }
      }
      if (mode === 'update') {
        db[table] = rows.map((r) => (matches(r, filters) ? { ...r, ...payload } : r))
        return { data: db[table].filter((r) => matches(r, filters)), error: null }
      }
      if (mode === 'delete') {
        db[table] = rows.filter((r) => !matches(r, filters))
        return { data: null, error: null }
      }
      const matched = rows.filter((r) => matches(r, filters))
      return { data: matched, error: null }
    }

    const chain: any = {
      select: () => {
        mode = mode ?? 'select'
        return chain
      },
      insert: (p: any) => {
        mode = 'insert'
        payload = p
        return chain
      },
      update: (p: any) => {
        mode = 'update'
        payload = p
        return chain
      },
      delete: () => {
        mode = 'delete'
        return chain
      },
      eq: (k: string, v: any) => {
        filters.push([k, v])
        return chain
      },
      single: async () => {
        const { data } = exec()
        const row = Array.isArray(data) ? data[0] : data
        return { data: row ?? null, error: row ? null : { message: 'not found' } }
      },
      maybeSingle: async () => {
        const { data } = exec()
        const row = Array.isArray(data) ? data[0] : data
        return { data: row ?? null, error: null }
      },
      then: (onOk: any, onErr?: any) => Promise.resolve(exec()).then(onOk, onErr),
    }
    return chain
  }
  return { supabase: { from: (t: string) => builder(t) } }
})

const { resolveEtsyListingImages } = await import('./etsy.js')
const { syncProductImagesOnShotDone, removeProductImage } = await import('./step-flow/shots.js')

describe('resolveEtsyListingImages', () => {
  beforeEach(() => {
    resetDb()
  })

  it('excludes superseded photos from the Etsy listing payload', async () => {
    const product = {
      id: 'p1',
      category: 't-shirts',
      metadata: {
        superseded_images: ['https://cdn/model-take-1.png', 'https://cdn/old-hanger.png'],
        etsy_shots: {
          images: ['https://cdn/model-take-1.png', 'https://cdn/model-take-2.png'],
        },
      },
    }
    const assets = [
      { id: 'a1', asset_role: 'mockup_ghost_mannequin', url: 'https://cdn/ghost.png', kind: 'mockup' },
      { id: 'a2', asset_role: 'mockup_hanger', url: 'https://cdn/new-hanger.png', kind: 'mockup' },
      { id: 'a3', asset_role: 'mockup_hanger', url: 'https://cdn/old-hanger.png', kind: 'mockup' },
    ]

    const images = await resolveEtsyListingImages(product, assets as any)

    expect(images).not.toContain('https://cdn/model-take-1.png')
    expect(images).not.toContain('https://cdn/old-hanger.png')
    expect(images).toContain('https://cdn/model-take-2.png')
    expect(images).toContain('https://cdn/ghost.png')
    expect(images).toContain('https://cdn/new-hanger.png')
  })

  it('orders garment listings with model shot leading as hero (rank 1), followed by flat mockups', async () => {
    const product = {
      id: 'p1',
      category: 't-shirts',
      metadata: {
        etsy_shots: {
          images: ['https://cdn/model-hero.png'],
        },
      },
    }
    const assets = [
      { id: 'a1', asset_role: 'mockup_ghost_mannequin', url: 'https://cdn/ghost.png', kind: 'mockup' },
      { id: 'a2', asset_role: 'mockup_flat_lay', url: 'https://cdn/flat.png', kind: 'mockup' },
      { id: 'a3', asset_role: 'mockup_hanger', url: 'https://cdn/hanger.png', kind: 'mockup' },
      { id: 'a4', asset_role: 'mockup_details', url: 'https://cdn/details.png', kind: 'mockup' },
      { id: 'a5', asset_role: 'design_watermarked', url: 'https://cdn/watermark.png', kind: 'design_preview' },
    ]

    const images = await resolveEtsyListingImages(product, assets as any)

    expect(images[0]).toBe('https://cdn/model-hero.png')
    expect(images).toEqual([
      'https://cdn/model-hero.png',
      'https://cdn/ghost.png',
      'https://cdn/flat.png',
      'https://cdn/hanger.png',
      'https://cdn/details.png',
      'https://cdn/watermark.png',
    ])
  })

  it('orders metal prints with watermarked artwork leading as hero, and scenes following', async () => {
    const product = {
      id: 'p-metal',
      category: 'metal-art',
      metadata: {
        step_flow: { brief: { productKind: 'metal' } },
        etsy_shots: {
          // Metal prints should not include model shots even if erroneously present
          images: ['https://cdn/accidental-model.png'],
        },
      },
    }
    const assets = [
      { id: 'a1', asset_role: 'mockup_metal_8x10', url: 'https://cdn/scene-8x10.png', kind: 'mockup' },
      { id: 'a2', asset_role: 'mockup_metal_4x6', url: 'https://cdn/scene-4x6.png', kind: 'mockup' },
      { id: 'a3', asset_role: 'design_watermarked', url: 'https://cdn/watermark-art.png', kind: 'design_preview' },
      { id: 'a4', asset_role: 'mockup_details', url: 'https://cdn/metal-details.png', kind: 'mockup' },
    ]

    const images = await resolveEtsyListingImages(product, assets as any)

    expect(images[0]).toBe('https://cdn/watermark-art.png')
    expect(images).not.toContain('https://cdn/accidental-model.png')
    expect(images).toEqual([
      'https://cdn/watermark-art.png',
      'https://cdn/scene-8x10.png',
      'https://cdn/scene-4x6.png',
      'https://cdn/metal-details.png',
    ])
  })

  it('excludes model shots rejected by design fidelity QA check', async () => {
    const product = {
      id: 'p1',
      category: 't-shirts',
      metadata: {
        etsy_shots: {
          images: ['https://cdn/model-failed-qa.png', 'https://cdn/model-passed.png'],
          checks: [
            { ok: false, reason: 'text redrawn' },
            { ok: true, reason: 'looks good' },
          ],
        },
      },
    }
    const assets = [
      { id: 'a1', asset_role: 'mockup_ghost_mannequin', url: 'https://cdn/ghost.png', kind: 'mockup' },
    ]

    const images = await resolveEtsyListingImages(product, assets as any)

    expect(images).not.toContain('https://cdn/model-failed-qa.png')
    expect(images).toContain('https://cdn/model-passed.png')
    expect(images).toContain('https://cdn/ghost.png')
  })

  it('preserves valid multi-photo listings without replacements up to 10 photos', async () => {
    const product = {
      id: 'p1',
      category: 't-shirts',
      metadata: {
        etsy_shots: {
          images: ['https://cdn/model1.png', 'https://cdn/model2.png'],
        },
      },
    }
    const assets = [
      { id: 'a1', asset_role: 'mockup_ghost_mannequin', url: 'https://cdn/ghost.png', kind: 'mockup' },
      { id: 'a2', asset_role: 'mockup_flat_lay', url: 'https://cdn/flat.png', kind: 'mockup' },
      { id: 'a3', asset_role: 'mockup_hanger', url: 'https://cdn/hanger.png', kind: 'mockup' },
      { id: 'a4', asset_role: 'mockup_back', url: 'https://cdn/back.png', kind: 'mockup' },
      { id: 'a5', asset_role: 'mockup_details', url: 'https://cdn/details.png', kind: 'mockup' },
      { id: 'a6', asset_role: 'mockup_color_black', url: 'https://cdn/black.png', kind: 'mockup' },
      { id: 'a7', asset_role: 'mockup_color_white', url: 'https://cdn/white.png', kind: 'mockup' },
      { id: 'a8', asset_role: 'design_watermarked', url: 'https://cdn/watermark.png', kind: 'design_preview' },
      { id: 'a9', asset_role: 'mockup_pocket', url: 'https://cdn/pocket.png', kind: 'mockup' },
    ]

    const images = await resolveEtsyListingImages(product, assets as any)

    expect(images.length).toBe(10)
    // Model shot is hero
    expect(images[0]).toBe('https://cdn/model1.png')
    // No duplicate entries
    expect(new Set(images).size).toBe(10)
  })

  it('filters superseded photos in fallback mode when no product_assets are present', async () => {
    const product = {
      id: 'p-legacy',
      category: 't-shirts',
      images: ['https://cdn/old-shot.png', 'https://cdn/good-shot.png'],
      metadata: {
        superseded_images: ['https://cdn/old-shot.png'],
        etsy_shots: {
          images: ['https://cdn/model.png'],
        },
      },
    }

    const images = await resolveEtsyListingImages(product, [])

    expect(images).not.toContain('https://cdn/old-shot.png')
    expect(images).toContain('https://cdn/model.png')
    expect(images).toContain('https://cdn/good-shot.png')
  })
})

describe('syncProductImagesOnShotDone and removeProductImage', () => {
  beforeEach(() => {
    resetDb()
  })

  it('replaces the re-shot image in products.images and marks priorUrl as superseded', async () => {
    db.products = [
      {
        id: 'p1',
        category: 't-shirts',
        images: ['https://cdn/take-1.png', 'https://cdn/hanger.png'],
        metadata: {
          superseded_images: [],
        },
      },
    ]

    await syncProductImagesOnShotDone('p1', 'model', 'https://cdn/take-2.png', 'https://cdn/take-1.png')

    const updated = db.products.find((p) => p.id === 'p1')!
    expect(updated.images).toEqual(['https://cdn/take-2.png', 'https://cdn/hanger.png'])
    expect(updated.metadata.superseded_images).toContain('https://cdn/take-1.png')
  })

  it('removes deleted shot URL from products.images and records in superseded_images on removeProductImage', async () => {
    db.products = [
      {
        id: 'p1',
        category: 't-shirts',
        images: ['https://cdn/model1.png', 'https://cdn/model2.png', 'https://cdn/hanger.png'],
        metadata: {
          superseded_images: [],
        },
      },
    ]

    await removeProductImage('p1', 'https://cdn/model2.png')

    const updated = db.products.find((p) => p.id === 'p1')!
    expect(updated.images).toEqual(['https://cdn/model1.png', 'https://cdn/hanger.png'])
    expect(updated.metadata.superseded_images).toContain('https://cdn/model2.png')
  })
})

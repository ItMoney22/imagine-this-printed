import { describe, it, expect, vi } from 'vitest'

// backend/lib/supabase.ts creates its client eagerly at module load, so
// these must exist before print-bridge.ts is evaluated. Same pattern as
// kiosk.test.ts / coupons.test.ts.
process.env.SUPABASE_URL ||= 'https://test-project.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

// ---------------------------------------------------------------------------
// Watchtower task 5b49d774 — notifyWorkers() was matching catalog 3D print
// items with `.startsWith('catalog-toy')`, but catalog items carry their raw
// product UUID as their cart/order-metadata id (see storefront.ts and
// stripe.ts's snapshotCartItems) — never a literal "catalog-toy"-prefixed
// string. That check always evaluated false, so printItems was always empty
// for catalog-toy orders and notifyWorkers fell back to listing every item
// in the cart, including unrelated non-print items in mixed carts.
//
// The fix resolves catalog-toy ids against the `products` table using the
// same predicate /queue already uses (category === '3d-prints' or
// metadata.print3d.enabled === true), mirrored into a standalone
// filterPrintNotificationItems() so the matching logic is testable without a
// live DB or mail sender.
// ---------------------------------------------------------------------------

function makeFakeProductsDb(products: Array<{ id: string; category?: string; metadata?: any }>) {
  const inCalls: string[][] = []
  const db = {
    from(table: string) {
      if (table !== 'products') throw new Error(`makeFakeProductsDb: unexpected table "${table}"`)
      const builder: any = {
        select: () => builder,
        in: async (col: string, vals: string[]) => {
          inCalls.push(vals)
          const matched = products.filter(p => vals.includes(p.id))
          return { data: matched, error: null }
        }
      }
      return builder
    }
  }
  return { db, inCalls }
}

describe('filterPrintNotificationItems — pure item filter', () => {
  it('matches a standard custom-mini item by PRINT_ITEM_PREFIX', async () => {
    const { filterPrintNotificationItems } = await import('./print-bridge.js')
    const items = [{ id: '3d-print-abc123', name: 'Custom Figurine', quantity: 1 }]
    const result = filterPrintNotificationItems(items, new Set())
    expect(result).toEqual(items)
  })

  it('matches a catalog-toy item whose id is a resolved catalog-toy product id', async () => {
    const { filterPrintNotificationItems } = await import('./print-bridge.js')
    const toyId = '11111111-1111-1111-1111-111111111111'
    const items = [{ id: toyId, name: 'Catalog Dino', quantity: 2 }]
    const result = filterPrintNotificationItems(items, new Set([toyId]))
    expect(result).toEqual(items)
  })

  it('excludes an ordinary catalog item (UUID id not in the resolved catalog-toy set)', async () => {
    const { filterPrintNotificationItems } = await import('./print-bridge.js')
    const shirtId = '22222222-2222-2222-2222-222222222222'
    const items = [{ id: shirtId, name: 'Cotton Tee', quantity: 1 }]
    const result = filterPrintNotificationItems(items, new Set())
    expect(result).toEqual([])
  })

  it('mixed cart: keeps only the custom-mini and catalog-toy items, drops the rest', async () => {
    const { filterPrintNotificationItems } = await import('./print-bridge.js')
    const toyId = '33333333-3333-3333-3333-333333333333'
    const shirtId = '44444444-4444-4444-4444-444444444444'
    const items = [
      { id: '3d-print-xyz789', name: 'Custom Figurine', quantity: 1 },
      { id: toyId, name: 'Catalog Dino', quantity: 2 },
      { id: shirtId, name: 'Cotton Tee', quantity: 3 },
    ]
    const result = filterPrintNotificationItems(items, new Set([toyId]))
    expect(result).toEqual([items[0], items[1]])
  })

  it('falls back to no matches (caller decides whether to list everything) when nothing qualifies', async () => {
    const { filterPrintNotificationItems } = await import('./print-bridge.js')
    const items = [{ id: '55555555-5555-5555-5555-555555555555', name: 'Cotton Tee', quantity: 1 }]
    const result = filterPrintNotificationItems(items, new Set())
    expect(result).toEqual([])
  })
})

describe('resolveCatalogToyProductIds — matches /queue\'s printable-catalog predicate', () => {
  it('returns an empty set for no candidates without querying the DB', async () => {
    vi.resetModules()
    const { db, inCalls } = makeFakeProductsDb([])
    vi.doMock('../lib/supabase.js', () => ({ supabase: db }))
    const { resolveCatalogToyProductIds } = await import('./print-bridge.js')

    const result = await resolveCatalogToyProductIds([])
    expect(result).toEqual(new Set())
    expect(inCalls.length).toBe(0)
  })

  it('includes products with category "3d-prints"', async () => {
    vi.resetModules()
    const toyId = '66666666-6666-6666-6666-666666666666'
    const { db } = makeFakeProductsDb([{ id: toyId, category: '3d-prints' }])
    vi.doMock('../lib/supabase.js', () => ({ supabase: db }))
    const { resolveCatalogToyProductIds } = await import('./print-bridge.js')

    const result = await resolveCatalogToyProductIds([toyId])
    expect(result).toEqual(new Set([toyId]))
  })

  it('includes products flagged via metadata.print3d.enabled outside the "3d-prints" category', async () => {
    vi.resetModules()
    const toyId = '77777777-7777-7777-7777-777777777777'
    const { db } = makeFakeProductsDb([{ id: toyId, category: 'collectibles', metadata: { print3d: { enabled: true } } }])
    vi.doMock('../lib/supabase.js', () => ({ supabase: db }))
    const { resolveCatalogToyProductIds } = await import('./print-bridge.js')

    const result = await resolveCatalogToyProductIds([toyId])
    expect(result).toEqual(new Set([toyId]))
  })

  it('excludes an ordinary catalog product (no 3d-prints category, no print3d flag)', async () => {
    vi.resetModules()
    const shirtId = '88888888-8888-8888-8888-888888888888'
    const { db } = makeFakeProductsDb([{ id: shirtId, category: 'apparel' }])
    vi.doMock('../lib/supabase.js', () => ({ supabase: db }))
    const { resolveCatalogToyProductIds } = await import('./print-bridge.js')

    const result = await resolveCatalogToyProductIds([shirtId])
    expect(result).toEqual(new Set())
  })
})

describe('notifyWorkers — worker email item list', () => {
  it('lists only the custom-mini item in a mixed cart (regression: PRINT_ITEM_PREFIX still works)', async () => {
    vi.resetModules()
    const shirtId = '99999999-9999-9999-9999-999999999999'
    const { db } = makeFakeProductsDb([{ id: shirtId, category: 'apparel' }])
    const sendEmailMock = vi.fn(async () => true)
    vi.doMock('../lib/supabase.js', () => ({ supabase: db }))
    vi.doMock('../utils/email.js', () => ({ sendEmail: sendEmailMock }))
    const { notifyWorkers } = await import('./print-bridge.js')

    const order = {
      id: 'order-0001-full-uuid-goes-here',
      metadata: {
        items: [
          { id: '3d-print-model42', name: 'Custom Figurine', quantity: 1 },
          { id: shirtId, name: 'Cotton Tee', quantity: 3 },
        ]
      }
    }
    await notifyWorkers(order, 'insert_pause', {})

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const html = sendEmailMock.mock.calls[0][0].htmlContent as string
    expect(html).toContain('Custom Figurine')
    expect(html).not.toContain('Cotton Tee')
  })

  it('lists only the catalog-toy item in a mixed cart (the bug: was falling back to every item)', async () => {
    vi.resetModules()
    const toyId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const shirtId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    const { db } = makeFakeProductsDb([
      { id: toyId, category: '3d-prints' },
      { id: shirtId, category: 'apparel' },
    ])
    const sendEmailMock = vi.fn(async () => true)
    vi.doMock('../lib/supabase.js', () => ({ supabase: db }))
    vi.doMock('../utils/email.js', () => ({ sendEmail: sendEmailMock }))
    const { notifyWorkers } = await import('./print-bridge.js')

    const order = {
      id: 'order-0002-full-uuid-goes-here',
      metadata: {
        items: [
          { id: toyId, name: 'Catalog Dino', quantity: 2 },
          { id: shirtId, name: 'Cotton Tee', quantity: 3 },
        ]
      }
    }
    await notifyWorkers(order, 'ready_for_packing', {})

    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const html = sendEmailMock.mock.calls[0][0].htmlContent as string
    expect(html).toContain('Catalog Dino')
    expect(html).not.toContain('Cotton Tee')
  })

  it('still falls back to listing every item when none resolve as print items (no false-empty email)', async () => {
    vi.resetModules()
    const shirtId = 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      mugId = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    const { db } = makeFakeProductsDb([
      { id: shirtId, category: 'apparel' },
      { id: mugId, category: 'drinkware' },
    ])
    const sendEmailMock = vi.fn(async () => true)
    vi.doMock('../lib/supabase.js', () => ({ supabase: db }))
    vi.doMock('../utils/email.js', () => ({ sendEmail: sendEmailMock }))
    const { notifyWorkers } = await import('./print-bridge.js')

    const order = {
      id: 'order-0003-full-uuid-goes-here',
      metadata: {
        items: [
          { id: shirtId, name: 'Cotton Tee', quantity: 1 },
          { id: mugId, name: 'Ceramic Mug', quantity: 1 },
        ]
      }
    }
    await notifyWorkers(order, 'insert_pause', {})

    const html = sendEmailMock.mock.calls[0][0].htmlContent as string
    expect(html).toContain('Cotton Tee')
    expect(html).toContain('Ceramic Mug')
  })
})

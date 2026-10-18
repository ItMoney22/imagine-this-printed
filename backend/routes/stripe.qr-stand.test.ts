// The checkout trust boundary for the custom QR counter stand (task deebfdca).
//
// The cart line is a browser's: its price, its name, its logo URL and its
// reseller ref could all say anything. What lands on the order line has to be
// the server's reading of it.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertedRows: any[] = []

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'products') return { select: () => ({ in: async () => ({ data: [], error: null }) }) }
      if (table === 'order_items') {
        return {
          delete: () => ({ eq: async () => ({ error: null }) }),
          insert: async (rows: any[]) => {
            insertedRows.push(...rows)
            return { error: null }
          },
        }
      }
      throw new Error('unexpected table ' + table)
    },
  },
}))

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.SUPABASE_JWT_SECRET ||= 'test-only-secret-do-not-use-in-prod-0123456789'
process.env.STRIPE_SECRET_KEY ||= 'sk_test_qr_stand'
const KEY = 'sk_test_darrell_storefront_key_0123456789'
process.env.STOREFRONT_CREATOR_KEYS = JSON.stringify({ darrell: { key: KEY, creatorUserId: 'creator-1' } })

const { replaceOrderItems } = await import('./stripe.js')
const { signResellerRef } = await import('../services/qr-stand-reseller.js')
const { resetStorefrontKeyCache } = await import('../middleware/requireStorefrontSecret.js')

const LOGO = 'qr-stand-logos/0f8fad5b-d9cb-469f-a165-70867728950e.png'
const line = (personalization: Record<string, string>, over: Record<string, any> = {}) => ({
  product: { id: 'qr-stand-1700000000', name: 'Anything The Browser Says', price: 0.01, images: [] },
  quantity: 2,
  personalization,
  ...over,
})
const req: any = { log: { error: vi.fn(), warn: vi.fn() } }

beforeEach(() => {
  insertedRows.length = 0
  resetStorefrontKeyCache()
})

describe('checkout: QR counter stand line', () => {
  it('writes the server\'s price, name and checked fields', async () => {
    await replaceOrderItems(
      'order-1',
      [line({ qr_link: 'bellascafe.com/menu', qr_caption: 'Scan For Menu', qr_logo_path: LOGO, qr_logo_url: 'https://x/y.png' })],
      req
    )
    const row = insertedRows[0]
    expect(row.product_id).toBeNull()
    expect(row.product_name).toBe('Custom QR Counter Stand')
    expect(row.unit_price).toBe(17.95)
    expect(row.subtotal).toBeCloseTo(35.9)
    expect(row.metadata.qr_stand).toEqual({
      line_index: 0,
      link: 'https://bellascafe.com/menu',
      caption: 'Scan For Menu',
      logo_path: LOGO,
      reseller: null,
    })
    expect(row.metadata.personalization).toEqual({ qr_link: 'https://bellascafe.com/menu', qr_caption: 'Scan For Menu' })
  })

  it('drops a logo that is a URL rather than our own upload', async () => {
    await replaceOrderItems('order-1', [line({ qr_link: 'x.co/a', qr_caption: 'Pay Here', qr_logo_path: 'https://evil.example/x.png' })], req)
    expect(insertedRows[0].metadata.qr_stand.logo_path).toBeNull()
  })

  it('keeps a reseller only when its ref is signed by that site\'s key', async () => {
    const good = signResellerRef('darrell', 'client-123', KEY)
    const bad = signResellerRef('darrell', 'client-123', 'sk_not_the_key_not_the_key_000')
    await replaceOrderItems(
      'order-1',
      [
        line({ qr_link: 'x.co/a', qr_caption: 'Pay Here', qr_ref: good }),
        line({ qr_link: 'x.co/b', qr_caption: 'Pay Here', qr_ref: bad }),
      ],
      req
    )
    expect(insertedRows[0].metadata.qr_stand.reseller).toEqual({ vendor: 'darrell', client_ref: 'client-123' })
    expect(insertedRows[1].metadata.qr_stand.reseller).toBeNull()
    expect(insertedRows[1].metadata.qr_stand.line_index).toBe(1)
  })
})

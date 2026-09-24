// The checkout trust boundary for personalized team shirts.
//
// A cart line is client-controlled: the values, the product's metadata copy,
// and any file URL on it all came from a browser. What gets written onto the
// order has to come from the server. These tests pin that.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const templateFor = (canvasW = 3600) => ({
  version: 1,
  side: 'back_image',
  plateAssetId: 'plate-asset',
  distressAssetId: null,
  canvas: { w: canvasW, h: 4800, dpi: 300 },
  halftone: false,
  upcharge: 0,
  styleNotes: '',
  fields: [
    {
      key: 'name',
      label: 'Last name',
      type: 'text',
      max: 12,
      uppercase: true,
      zone: { x: 100, y: 100, w: 3000, h: 600 },
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
      zone: { x: 1200, y: 1200, w: 1200, h: 2000 },
      arch: 0,
      font: { family: 'varsity-block', src: 'house' },
      fill: '#C9A227',
      strokes: [],
      offset: null,
    },
  ],
})

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'

const insertedRows: any[] = []
const updatedRows: Array<{ id: string; metadata: any }> = []
const renderCalls: Array<{ values: Record<string, string>; width: number }> = []
let renderDelayMs = 0

vi.mock('../lib/supabase.js', () => {
  const productRow = { id: PRODUCT_ID, metadata: { team_template: templateFor() } }
  return {
    supabase: {
      from: (table: string) => {
        if (table === 'products') {
          return { select: () => ({ in: async () => ({ data: [productRow], error: null }) }) }
        }
        if (table === 'order_items') {
          return {
            delete: () => ({ eq: async () => ({ error: null }) }),
            select: () => ({
              eq: async () => ({
                data: insertedRows.map((r, i) => ({ id: `row-${i}`, metadata: r.metadata })),
                error: null,
              }),
            }),
            update: (patch: any) => ({
              eq: async (_col: string, id: string) => {
                updatedRows.push({ id, metadata: patch.metadata })
                return { error: null }
              },
            }),
            insert: async (rows: any[]) => {
              insertedRows.push(...rows)
              return { error: null }
            },
          }
        }
        throw new Error('unexpected table ' + table)
      },
    },
  }
})

const pathFor = (values: Record<string, string>) =>
  `users/team-plates/flare-v1/${Object.entries(values).map(([k, v]) => `${k}=${v}`).join('&')}-press.png`

vi.mock('../services/team-plate/plate-store.js', () => ({
  renderOrGetCached: async (_t: any, values: Record<string, string>, width: number) => {
    renderCalls.push({ values, width })
    if (renderDelayMs) await new Promise((r) => setTimeout(r, renderDelayMs))
    return { url: 'signed://display-only', path: pathFor(values), rendered: true, tier: 'press' }
  },
  pressPlatePath: (_t: any, values: Record<string, string>) => pathFor(values),
}))

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.SUPABASE_JWT_SECRET ||= 'test-only-secret-do-not-use-in-prod-0123456789'
process.env.STRIPE_SECRET_KEY ||= 'sk_test_personalization'

const { replaceOrderItems } = await import('./stripe.js')

const line = (over: Record<string, any> = {}) => ({
  product: { id: PRODUCT_ID, name: 'Spartans Tee', images: [] },
  quantity: 1,
  selectedSize: 'YL',
  personalization: { name: 'SMITH', number: '22' },
  ...over,
})

const req: any = { log: { error: vi.fn(), warn: vi.fn() } }

beforeEach(() => {
  insertedRows.length = 0
  updatedRows.length = 0
  renderCalls.length = 0
  renderDelayMs = 0
  delete process.env.TEAM_PLATE_PRESS_WAIT_MS
})

describe('checkout personalization', () => {
  it('writes the sanitized values onto order_items.metadata', async () => {
    await replaceOrderItems('order-1', [line()], req)
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0].metadata.personalization).toEqual({ name: 'SMITH', number: '22' })
  })

  it('IGNORES a client-supplied print file url and uses the server render', async () => {
    await replaceOrderItems(
      'order-1',
      [line({ printFileUrl: 'https://evil.example.com/anything.png', print_file_path: 'x' })],
      req
    )
    const meta = insertedRows[0].metadata
    expect(meta.print_file_path).toBe('users/team-plates/flare-v1/name=SMITH&number=22-press.png')
    expect(meta.print_file_status).toBe('ready')
    expect(JSON.stringify(meta)).not.toContain('evil.example.com')
  })

  it('re-sanitizes the values rather than trusting the page', async () => {
    await replaceOrderItems(
      'order-1',
      [line({ personalization: { name: 'sm<script>ith', number: '2x2' } })],
      req
    )
    expect(insertedRows[0].metadata.personalization).toEqual({ name: 'SMSCRIPTITH', number: '22' })
    expect(renderCalls[0].values).toEqual({ name: 'SMSCRIPTITH', number: '22' })
  })

  it('renders at press width, not preview width', async () => {
    await replaceOrderItems('order-1', [line()], req)
    expect(renderCalls[0].width).toBe(3600)
  })

  it('ignores a template the CART claims the product has', async () => {
    // The cart's product.metadata is client-supplied. Only the row in the
    // database decides whether a product is personalizable and how.
    await replaceOrderItems(
      'order-1',
      [line({ product: { id: PRODUCT_ID, name: 'x', images: [], metadata: { team_template: templateFor(99) } } })],
      req
    )
    expect(renderCalls[0].width).toBe(3600)
  })

  it('records the values and flags the line when the render fails, without failing checkout', async () => {
    const store = await import('../services/team-plate/plate-store.js')
    vi.spyOn(store, 'renderOrGetCached').mockRejectedValueOnce(new Error('GCS down'))

    await expect(replaceOrderItems('order-1', [line()], req)).resolves.not.toThrow()
    const meta = insertedRows[0].metadata
    expect(meta.personalization).toEqual({ name: 'SMITH', number: '22' })
    expect(meta.print_file_path).toBeNull()
    expect(meta.print_file_error).toBe('GCS down')
    expect(meta.print_file_status).toBe('failed')
  })

  it(`leaves an ordinary product's line untouched`, async () => {
    const plainId = '22222222-2222-4222-8222-222222222222'
    await replaceOrderItems(
      'order-1',
      [{ product: { id: plainId, name: 'Plain Tee', images: [] }, quantity: 1 }],
      req
    )
    expect(insertedRows[0].metadata.personalization).toBeNull()
    expect(insertedRows[0].metadata.print_file_path).toBeNull()
  })

  it('keeps two players on two rows with their own files', async () => {
    await replaceOrderItems(
      'order-1',
      [line(), line({ personalization: { name: 'LOPEZ', number: '41' } })],
      req
    )
    expect(insertedRows).toHaveLength(2)
    const paths = insertedRows.map((r) => r.metadata.print_file_path)
    expect(new Set(paths).size).toBe(2)
  })

  it('does not hold checkout hostage to a slow generation: writes the durable path, settles later', async () => {
    process.env.TEAM_PLATE_PRESS_WAIT_MS = '20'
    renderDelayMs = 120

    await replaceOrderItems('order-1', [line()], req)
    const meta = insertedRows[0].metadata
    expect(meta.print_file_status).toBe('rendering')
    // The press file's path is deterministic, so it is on the order already —
    // and it is a gcsPath, never a signed URL.
    expect(meta.print_file_path).toBe('users/team-plates/flare-v1/name=SMITH&number=22-press.png')
    expect(meta.print_file_path).not.toMatch(/^https?:|sig=/)
    expect(updatedRows).toHaveLength(0)

    await new Promise((r) => setTimeout(r, 250))
    expect(updatedRows).toHaveLength(1)
    expect(updatedRows[0].metadata.print_file_status).toBe('ready')
    expect(updatedRows[0].metadata.print_file_path).toBe(meta.print_file_path)
  })

  it('carries review flags through to the line', async () => {
    await replaceOrderItems('order-1', [line({ personalization: { name: 'NIKE', number: '1' } })], req)
    expect(insertedRows[0].metadata.personalization_flags).toEqual([
      { field: 'name', reason: 'reads "NIKE" — possible trademark' },
    ])
  })
})

// The checkout trust boundary for 3D name gifts (task bf353160).
//
// Same posture as a team shirt (stripe.personalization.test.ts): the cart line
// is client-controlled, so the template comes from the DATABASE row, the name
// is re-sanitized here, and the print file is built here.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ORNAMENT_ID = '33333333-3333-4333-8333-333333333333'

const nameTemplate = {
  version: 1,
  shape: 'ornament',
  font: 'brush-script',
  field: { key: 'name', label: 'Name', max: 12 },
  colours: { plate: { name: 'Red', hex: '#B3262E' }, letters: { name: 'White', hex: '#F4F1EA' } },
  upcharge: 0,
}

const insertedRows: any[] = []
const stored: Array<{ shape: string; name: string }> = []
let storeFails = false

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'products') {
        return {
          select: () => ({
            in: async () => ({ data: [{ id: ORNAMENT_ID, metadata: { name_print: nameTemplate } }], error: null }),
          }),
        }
      }
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

vi.mock('../services/name-print/store.js', () => ({
  storeNamePrint: async (template: any, name: string) => {
    if (storeFails) throw new Error('GCS down')
    stored.push({ shape: template.shape, name })
    return { path: `users/name-prints/geo-v1/${template.shape}-${name}.stl`, built: true, colourChangeAtMm: 3.2 }
  },
}))

// Never reached for a name line; mocked so importing stripe.ts stays offline.
vi.mock('../services/team-plate/plate-store.js', () => ({
  renderOrGetCached: async () => {
    throw new Error('a name gift must not reach the team-plate renderer')
  },
  pressPlatePath: () => 'unused',
}))

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.SUPABASE_JWT_SECRET ||= 'test-only-secret-do-not-use-in-prod-0123456789'
process.env.STRIPE_SECRET_KEY ||= 'sk_test_name_print'

const { replaceOrderItems } = await import('./stripe.js')

const line = (over: Record<string, any> = {}) => ({
  product: { id: ORNAMENT_ID, name: 'Personalized Name Ornament', images: [] },
  quantity: 1,
  personalization: { name: 'Emma' },
  ...over,
})

const req: any = { log: { error: vi.fn(), warn: vi.fn() } }

beforeEach(() => {
  insertedRows.length = 0
  stored.length = 0
  storeFails = false
})

describe('checkout: 3D name gifts', () => {
  it('builds the print file from the name the customer typed, case kept', async () => {
    await replaceOrderItems('order-1', [line()], req)
    const meta = insertedRows[0].metadata
    expect(stored).toEqual([{ shape: 'ornament', name: 'Emma' }])
    expect(meta.personalization).toEqual({ name: 'Emma' })
    expect(meta.print_file_path).toBe('users/name-prints/geo-v1/ornament-Emma.stl')
    expect(meta.print_file_status).toBe('ready')
  })

  it('re-sanitizes the name and ignores a client-supplied file', async () => {
    await replaceOrderItems(
      'order-1',
      [line({ personalization: { name: '  Zoë<script>  ' }, print_file_path: 'https://evil.example.com/x.stl' })],
      req
    )
    const meta = insertedRows[0].metadata
    expect(meta.personalization).toEqual({ name: 'Zoëscript' })
    expect(stored[0].name).toBe('Zoëscript')
    expect(JSON.stringify(meta)).not.toContain('evil.example.com')
  })

  it('keeps two names of the same ornament on two rows with their own files', async () => {
    await replaceOrderItems('order-1', [line(), line({ personalization: { name: 'Noah' } })], req)
    expect(insertedRows.map((r) => r.metadata.print_file_path)).toEqual([
      'users/name-prints/geo-v1/ornament-Emma.stl',
      'users/name-prints/geo-v1/ornament-Noah.stl',
    ])
  })

  it('flags a line with no name instead of printing a blank plate', async () => {
    await replaceOrderItems('order-1', [line({ personalization: { name: '🎄' } })], req)
    const meta = insertedRows[0].metadata
    expect(stored).toHaveLength(0)
    expect(meta.print_file_path).toBeNull()
    expect(meta.print_file_status).toBe('failed')
    expect(meta.print_file_error).toMatch(/No name/)
  })

  it('records a failed build on the line without failing checkout', async () => {
    storeFails = true
    await expect(replaceOrderItems('order-1', [line()], req)).resolves.not.toThrow()
    const meta = insertedRows[0].metadata
    expect(meta.personalization).toEqual({ name: 'Emma' })
    expect(meta.print_file_status).toBe('failed')
    expect(meta.print_file_error).toBe('GCS down')
  })

  it('passes the name through the same review flags as a team shirt', async () => {
    await replaceOrderItems('order-1', [line({ personalization: { name: 'Disney' } })], req)
    expect(insertedRows[0].metadata.personalization_flags).toEqual([
      { field: 'name', reason: 'reads "Disney" — possible trademark' },
    ])
  })
})

// The print bridge hands the factory a name gift's OWN file (task bf353160).
//
// A name ornament's product row has no mesh worth printing — the mesh is per
// order line, with the customer's name on it. So /queue must send each line's
// print_file_path (signed), keep two names of one ornament as two prints, and
// never fall back to a static mesh when the line's file is missing.
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.SUPABASE_URL ||= 'https://test-project.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.PRINT_BRIDGE_TOKEN = 'bridge-test-token'

const ORNAMENT_ID = '55555555-5555-4555-8555-555555555555'

const tables: Record<string, any[]> = {}

vi.mock('../lib/supabase.js', () => {
  const query = (table: string) => {
    const filters: Array<(r: any) => boolean> = []
    const b: any = {
      select: () => b,
      order: () => b,
      limit: () => b,
      gt: () => b,
      eq: (col: string, val: any) => {
        filters.push((r) => r[col] === val)
        return b
      },
      in: (col: string, vals: any[]) => {
        filters.push((r) => vals.includes(r[col]))
        return b
      },
      single: async () => ({ data: (tables[table] ?? []).find((r) => filters.every((f) => f(r))) ?? null, error: null }),
      then: (resolve: any) => resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null }),
    }
    return b
  }
  return { supabase: { from: query } }
})

vi.mock('../services/name-print/store.js', () => ({
  signNamePrint: async (path: string) => `https://signed.example/${path}`,
}))

const { default: router } = await import('./print-bridge.js')

async function queue(): Promise<any> {
  const layer = (router as any).stack.find((l: any) => l.route?.path === '/queue')
  const handlers = layer.route.stack.map((s: any) => s.handle)
  let body: any
  const res: any = {
    status: () => res,
    json: (b: any) => {
      body = b
      return res
    },
  }
  const req: any = { query: {}, headers: { authorization: 'Bearer bridge-test-token' }, log: { error: vi.fn() } }
  await handlers[0](req, res, () => handlers[1](req, res))
  // the queue handler is async; let it settle
  await new Promise((r) => setTimeout(r, 0))
  return body
}

const ornament = {
  id: ORNAMENT_ID,
  name: 'Personalized Name Ornament',
  category: '3d-prints',
  images: ['https://img.example/ornament.png'],
  metadata: {
    print3d: { enabled: true, material: 'PLA', magnet_sockets: 0, stl_url: 'https://static.example/blank.stl' },
    name_print: {
      version: 1,
      shape: 'ornament',
      font: 'brush-script',
      field: { key: 'name', label: 'Name', max: 12 },
      colours: { plate: { name: 'Red', hex: '#B3262E' }, letters: { name: 'White', hex: '#F4F1EA' } },
      upcharge: 0,
    },
  },
}

const row = (name: string, path: string | null, extra: Record<string, any> = {}) => ({
  order_id: 'order-1',
  product_id: ORNAMENT_ID,
  product_name: 'Personalized Name Ornament',
  quantity: 1,
  subtotal: 16.99,
  metadata: { personalization: { name }, print_file_path: path, ...extra },
})

beforeEach(() => {
  tables.orders = [{ id: 'order-1', created_at: '2026-11-30T12:00:00Z', payment_status: 'paid', metadata: {} }]
  tables.products = [ornament]
})

describe('print bridge: name gifts', () => {
  it("sends each line's own file and keeps two names as two prints", async () => {
    tables.order_items = [
      row('Emma', 'users/name-prints/geo-v1/ornament-aaa.stl'),
      row('Noah', 'users/name-prints/geo-v1/ornament-bbb.stl'),
    ]
    const { orders } = await queue()
    expect(orders).toHaveLength(2)
    expect(orders.map((o: any) => o.stlUrl)).toEqual([
      'https://signed.example/users/name-prints/geo-v1/ornament-aaa.stl',
      'https://signed.example/users/name-prints/geo-v1/ornament-bbb.stl',
    ])
    expect(orders.map((o: any) => o.personalization)).toEqual([{ name: 'Emma' }, { name: 'Noah' }])
    expect(orders.map((o: any) => o.lineItemId)).toEqual([`${ORNAMENT_ID}:ornament-aaa`, `${ORNAMENT_ID}:ornament-bbb`])
    expect(orders[0].colourChangeAtMm).toBe(3.2)
    expect(orders[0].nameColours).toEqual({ plate: 'Red', letters: 'White' })
    expect(orders[0].magnetSockets).toBe(0)
  })

  it('never falls back to the static mesh when the line has no file', async () => {
    tables.order_items = [row('Emma', null, { print_file_error: 'GCS down' })]
    const { orders } = await queue()
    expect(orders).toHaveLength(1)
    expect(orders[0].stlUrl).toBeUndefined()
    expect(orders[0].printFileError).toBe('GCS down')
  })
})

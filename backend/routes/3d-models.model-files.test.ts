import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'

// ---------------------------------------------------------------------------
// Watchtower task 1417e863 (2026-10-07): the paid 3D files are private.
//
// model.stl / model.glb used to sit in the PUBLIC bucket and every model row
// carried 1-year links, which GET /:id and /list handed to the owner whether
// or not they had bought the download license. Now rows hold gs:// references
// and only the license route signs the files to keep.
//
// These run the REAL 3d-models and print-bridge routers on an ephemeral port;
// only Supabase and GCS are faked.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.PRINT_BRIDGE_TOKEN = 'bridge-test-token'
process.env.SUPABASE_JWT_SECRET ||= 'test-jwt-secret'

const OWNER = '3e409705-2d5f-4ef8-a819-c7579f226961'
const LICENSED = '2d7eaa60-fb44-4a12-9357-cebeccb408f5'
const UNLICENSED = '84fd8a67-3b38-45b0-b3dd-d577c4b8fe2d'
const TOY_PRODUCT = '5eac6a81-6521-472a-a287-9ca15292280c'
const PRIVATE = 'imagine-this-printed-products'
const ref = (id: string, f: 'stl' | 'glb') => `gs://${PRIVATE}/3d-models/${id}/model.${f}`

let tables: Record<string, any[]> = {}
function builder(table: string) {
  const filters: [string, any][] = []
  const rows = () => {
    let r = tables[table] ?? []
    for (const [col, val] of filters) r = r.filter(x => (Array.isArray(val) ? val.includes(x[col]) : x[col] === val))
    return r
  }
  const b: any = {
    select: () => b,
    eq: (c: string, v: any) => { filters.push([c, v]); return b },
    in: (c: string, v: any[]) => { filters.push([c, v]); return b },
    gt: () => b,
    order: () => b,
    range: () => b,
    limit: () => b,
    single: async () => (rows()[0] ? { data: rows()[0], error: null } : { data: null, error: { message: 'not found' } }),
    then: (ok: any, err: any) => Promise.resolve({ data: rows(), error: null }).then(ok, err),
  }
  return b
}
const fakeDb = {
  from: (t: string) => builder(t),
  auth: { getUser: async (token: string) => (token === 'owner-token' ? { data: { user: { id: OWNER } }, error: null } : { data: { user: null }, error: { message: 'bad' } }) },
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeDb }))
vi.mock('../lib/supabase.js', () => ({ supabase: fakeDb }))

const signs: { bucket: string; path: string; ttl: number; downloadName?: string }[] = []
vi.mock('../services/google-cloud-storage.js', () => ({
  uploadBufferToBucket: async (_b: string, _buf: Buffer, path: string) => path,
  uploadImageFromUrl: async () => ({ publicUrl: 'https://unused.test', path: 'unused' }),
  signObjectInBucket: async (bucket: string, path: string, ttl: number, downloadName?: string) => {
    signs.push({ bucket, path, ttl, downloadName })
    return `https://signed.test/${bucket}/${path}?ttl=${ttl}`
  },
}))

const { default: modelsRouter } = await import('./3d-models.js')
const { default: bridgeRouter } = await import('./print-bridge.js')

let base = ''
let server: ReturnType<ReturnType<typeof express>['listen']>
beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/3d-models', modelsRouter)
  app.use('/api/print-bridge', bridgeRouter)
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()) })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server?.close() })

const model = (id: string, extra: Record<string, any> = {}) => ({
  id, user_id: OWNER, prompt: 'robo rascal', style: 'cartoon', status: 'ready',
  glb_url: ref(id, 'glb'), stl_url: ref(id, 'stl'), concept_image_url: `https://cdn.test/${id}/concept.png`,
  purchased_licenses: [], print_price_usd: 25, metadata: {}, ...extra,
})

beforeEach(() => {
  signs.length = 0
  tables = {
    user_3d_models: [model(LICENSED, { purchased_licenses: ['personal'] }), model(UNLICENSED)],
    products: [], orders: [], order_items: [],
  }
})

const get = (path: string, token = 'owner-token') => fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } })

describe('GET /api/3d-models/:id/download/:format — the license gate', () => {
  it('an entitled buyer gets a short-lived signed link to their own file, saved under a friendly name', async () => {
    const res = await get(`/api/3d-models/${LICENSED}/download/stl`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.downloadUrl).toBe(`https://signed.test/${PRIVATE}/3d-models/${LICENSED}/model.stl?ttl=60`)
    expect(body.filename).toBe('figurine-2d7eaa60.stl')
    expect(signs).toEqual([{ bucket: PRIVATE, path: `3d-models/${LICENSED}/model.stl`, ttl: 60, downloadName: 'figurine-2d7eaa60.stl' }])
  })

  it('an unentitled caller is refused (402) and nothing is signed', async () => {
    const res = await get(`/api/3d-models/${UNLICENSED}/download/stl`)
    expect(res.status).toBe(402)
    expect(signs).toEqual([])
  })

  it('no token: 401, nothing signed', async () => {
    const res = await get(`/api/3d-models/${LICENSED}/download/glb`, 'nope')
    expect(res.status).toBe(401)
    expect(signs).toEqual([])
  })

  it("a row pointing at some other object is not signed (404), even with a license", async () => {
    tables.user_3d_models[0].stl_url = `gs://${PRIVATE}/print-files/merch-studio/darrell/aJCwdWaaoI/front.png`
    const res = await get(`/api/3d-models/${LICENSED}/download/stl`)
    expect(res.status).toBe(404)
    expect(signs).toEqual([])
  })
})

describe('owner reads carry no file to keep', () => {
  it('GET /:id: GLB as a 60-minute preview link, STL reference removed', async () => {
    const res = await get(`/api/3d-models/${UNLICENSED}`)
    expect(res.status).toBe(200)
    const { model: m } = await res.json()
    expect(m.glb_url).toBe(`https://signed.test/${PRIVATE}/3d-models/${UNLICENSED}/model.glb?ttl=60`)
    expect(m.stl_url).toBeNull()
    expect(JSON.stringify(m)).not.toContain('gs://')
  })

  it('GET /list: same shape for every model', async () => {
    const res = await get('/api/3d-models/list')
    const { models } = await res.json()
    expect(models).toHaveLength(2)
    for (const m of models) {
      expect(m.stl_url).toBeNull()
      expect(m.glb_url).toMatch(/^https:\/\/signed\.test\/imagine-this-printed-products\/3d-models\/.+\/model\.glb\?ttl=60$/)
    }
  })

  it('POST /:id/order: the cart product (it rides into the order snapshot) carries no mesh at all', async () => {
    const res = await fetch(`${base}/api/3d-models/${UNLICENSED}/order`, {
      method: 'POST', headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' }, body: '{}',
    })
    expect(res.status).toBe(200)
    const { product } = await res.json()
    expect(product.metadata.model_id).toBe(UNLICENSED)
    expect(product.metadata).not.toHaveProperty('stl_url')
    expect(product.metadata).not.toHaveProperty('glb_url')
  })
})

describe('GET /api/print-bridge/queue — the print floor still gets fetchable files', () => {
  it('signs fresh 12-hour links for a custom mini and a catalog toy', async () => {
    tables.orders = [{ id: 'order-1', order_number: 'ITP-1', customer_email: 'a@b.test', customer_name: 'A', total: 50, created_at: '2026-10-07T20:00:00Z', payment_status: 'paid', metadata: {} }]
    tables.order_items = [
      { order_id: 'order-1', product_id: null, product_name: 'Custom Figurine', quantity: 1, unit_price: 25, subtotal: 25, metadata: { client_product_id: `3d-print-${UNLICENSED}` } },
      { order_id: 'order-1', product_id: TOY_PRODUCT, product_name: 'Toy: Robo Rascal', quantity: 1, unit_price: 25, subtotal: 25, metadata: {} },
    ]
    tables.products = [{
      id: TOY_PRODUCT, name: 'Toy: Robo Rascal', category: '3d-prints', images: [],
      metadata: { print3d: { enabled: true, glb_url: ref(LICENSED, 'glb'), stl_url: ref(LICENSED, 'stl') } },
    }]

    const res = await get('/api/print-bridge/queue', 'bridge-test-token')
    expect(res.status).toBe(200)
    const { orders } = await res.json()
    const mini = orders.find((o: any) => o.line === 'custom-mini')
    const toy = orders.find((o: any) => o.line === 'custom-toy')
    expect(mini.stlUrl).toBe(`https://signed.test/${PRIVATE}/3d-models/${UNLICENSED}/model.stl?ttl=720`)
    expect(mini.glbUrl).toBe(`https://signed.test/${PRIVATE}/3d-models/${UNLICENSED}/model.glb?ttl=720`)
    expect(toy.stlUrl).toBe(`https://signed.test/${PRIVATE}/3d-models/${LICENSED}/model.stl?ttl=720`)
    expect(toy.glbUrl).toBe(`https://signed.test/${PRIVATE}/3d-models/${LICENSED}/model.glb?ttl=720`)
    expect(JSON.stringify(orders)).not.toContain('gs://')
  })
})

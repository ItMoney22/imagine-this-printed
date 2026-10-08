import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'

// ---------------------------------------------------------------------------
// Watchtower task b312de9c (2026-10-07): a creator's print file must never
// reach the public products row.
//
// products is readable with the site's anon key ("Anyone can view products"
// USING (true)). Publish used to write Darrell McCutchen's print-ready
// front.png into metadata.print_files.front + assets.clean + assets.dtf as a
// 1-year signed link in the PUBLIC bucket, so anyone could take his art.
//
// These run the REAL storefront router (multer, the publish and checkout
// handlers) on an ephemeral port; only Supabase, GCS and Stripe are faked.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.STRIPE_SECRET_KEY ||= 'sk_test_fake'

const CREATOR = '41c6873c-68a5-4365-8f6f-3ce3f1c6ae9e'
const NEW_PRODUCT_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const WALK_BY_FAITH = 'e387149e-ae76-4a61-877d-8005896a8c99'
const PRIVATE_BUCKET = 'imagine-this-printed-products'

// --- fake Supabase: records every write, answers reads from `tables` --------
let tables: Record<string, any[]> = {}
let failPrintFileUpsert = false
const writes: { table: string; op: string; payload?: any; filters?: [string, any][] }[] = []

function builder(table: string) {
  let op = 'select'
  let payload: any
  const filters: [string, any][] = []
  const result = (one: boolean) => {
    if (op === 'insert') {
      const row = Array.isArray(payload) ? payload[0] : payload
      const id = table === 'products' ? NEW_PRODUCT_ID : table === 'orders' ? 'order-1' : 'row-1'
      const out = { id, status: row?.status, slug: row?.slug, ...row }
      return { data: one ? out : [out], error: null }
    }
    if (op === 'upsert') {
      return { data: null, error: table === 'product_print_files' && failPrintFileUpsert ? { message: 'denied' } : null }
    }
    if (op !== 'select') return { data: null, error: null }
    let rows = tables[table] ?? []
    for (const [col, val] of filters) rows = rows.filter(r => (Array.isArray(val) ? val.includes(r[col]) : r[col] === val))
    return one ? { data: rows[0] ?? null, error: rows[0] ? null : { message: 'not found' } } : { data: rows, error: null }
  }
  const b: any = {
    select: () => b,
    insert: (p: any) => { op = 'insert'; payload = p; writes.push({ table, op, payload: p }); return b },
    upsert: (p: any) => { op = 'upsert'; payload = p; writes.push({ table, op, payload: p }); return b },
    update: (p: any) => { op = 'update'; payload = p; writes.push({ table, op, payload: p, filters }); return b },
    delete: () => { op = 'delete'; writes.push({ table, op, filters }); return b },
    eq: (col: string, val: any) => { filters.push([col, val]); return b },
    in: (col: string, vals: any[]) => { filters.push([col, vals]); return b },
    like: () => b,
    order: () => b,
    limit: () => b,
    single: async () => result(true),
    maybeSingle: async () => result(true),
    then: (ok: any, err: any) => Promise.resolve(result(false)).then(ok, err),
  }
  return b
}

vi.mock('../lib/supabase.js', () => ({ supabase: { from: (t: string) => builder(t) } }))

// A creator-mapped storefront key (Darrell's Merch Studio).
vi.mock('../middleware/requireStorefrontSecret.js', () => ({
  requireStorefrontSecret: (req: any, _res: any, next: any) => {
    req.storefront = { creatorUserId: CREATOR, vendor: 'darrell' }
    next()
  },
}))

// --- fake GCS: the public bucket hands back signed links, the private one paths
const publicUploads: string[] = []
const privateUploads: { bucket: string; path: string }[] = []
vi.mock('../services/google-cloud-storage.js', () => ({
  uploadImageFromBuffer: async (_buf: Buffer, path: string) => {
    publicUploads.push(path)
    return { publicUrl: `https://storage.googleapis.com/imagine-this-printed-main/${path}?Signature=public`, path }
  },
  uploadBufferToBucket: async (bucket: string, _buf: Buffer, path: string) => {
    privateUploads.push({ bucket, path })
    return path
  },
  signObjectInBucket: async (bucket: string, path: string, ttl: number) => `https://signed.test/${bucket}/${path}?ttl=${ttl}`,
}))

vi.mock('stripe', () => ({
  default: class {
    checkout = { sessions: { create: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1' }) } }
  },
}))

const { default: storefrontRouter } = await import('./storefront.js')

let base = ''
let server: ReturnType<ReturnType<typeof express>['listen']>
beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/storefront', storefrontRouter)
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()) })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server?.close() })

beforeEach(() => {
  tables = { products: [], product_categories: [{ id: 'cat-shirts', slug: 'shirts' }], user_profiles: [{ id: CREATOR, display_name: 'Darrell McCutchen' }] }
  failPrintFileUpsert = false
  writes.length = 0
  publicUploads.length = 0
  privateUploads.length = 0
})

const png = () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' })

async function publish(opts: { back?: boolean; mockups?: number } = {}) {
  const fd = new FormData()
  fd.set('name', 'Walk By Faith')
  fd.set('retailPrice', '24.99')
  fd.set('colors', '["Maroon"]')
  fd.set('front_print', png(), 'front.png')
  if (opts.back) fd.set('back_print', png(), 'back.png')
  for (let i = 0; i < (opts.mockups ?? 2); i++) fd.append('mockups', png(), `mockup-${i + 1}.png`)
  const res = await fetch(`${base}/api/storefront/products`, { method: 'POST', body: fd })
  return { status: res.status, body: await res.json() as any }
}

const productInsert = () => writes.find(w => w.table === 'products' && w.op === 'insert')?.payload

describe('POST /api/storefront/products — the print file stays private', () => {
  it('puts no print-file link anywhere on the public products row', async () => {
    const { status } = await publish({ back: true })
    expect(status).toBe(201)

    const row = productInsert()
    const text = JSON.stringify(row)
    expect(text).not.toMatch(/front\.png|back\.png|print-files\//)
    expect(row.metadata.print_files).toBeUndefined()
    expect(row.metadata.assets).toEqual({ mockups: expect.any(Array) })
    expect(row.metadata.print_file_placements).toEqual(['front', 'back'])
    expect(row.images.every((u: string) => /mockup-\d\.png/.test(u))).toBe(true)
    // Still a direct-print creator product as far as the rest of ITP knows.
    expect(row.metadata.source).toBe('merch-studio')
    expect(row.print_locations).toEqual(['front_image', 'back_image'])
  })

  it('saves the print files to the private bucket and records only their paths', async () => {
    await publish({ back: true })
    expect(privateUploads.map(u => u.bucket)).toEqual([PRIVATE_BUCKET, PRIVATE_BUCKET])
    expect(privateUploads[0].path).toMatch(/^print-files\/merch-studio\/darrell\/[\w-]{10}\/front\.png$/)
    expect(privateUploads[1].path).toMatch(/\/back\.png$/)
    // The public bucket only ever receives the mockups.
    expect(publicUploads.every(p => /mockup-\d\.png$/.test(p))).toBe(true)

    const refs = writes.find(w => w.table === 'product_print_files' && w.op === 'upsert')?.payload
    expect(refs).toMatchObject({
      product_id: NEW_PRODUCT_ID,
      bucket: PRIVATE_BUCKET,
      front_path: privateUploads[0].path,
      back_path: privateUploads[1].path,
    })
    expect(JSON.stringify(refs)).not.toMatch(/https?:/)
  })

  it('answers the storefront with short-lived links only', async () => {
    const { body } = await publish()
    expect(body.files.front).toBe(`https://signed.test/${PRIVATE_BUCKET}/${privateUploads[0].path}?ttl=60`)
    expect(body.files.back).toBeUndefined()
  })

  it('never uses the print file as the listing picture when no mockups came', async () => {
    await publish({ mockups: 0 })
    const row = productInsert()
    expect(row.images).toEqual([])
    expect(JSON.stringify(row)).not.toMatch(/front\.png/)
  })

  it('removes the product when its print files cannot be recorded', async () => {
    failPrintFileUpsert = true
    const { status } = await publish()
    expect(status).toBe(500)
    const del = writes.find(w => w.table === 'products' && w.op === 'delete')
    expect(del?.filters).toEqual([['id', NEW_PRODUCT_ID]])
  })
})

describe('POST /api/storefront/checkout — the order line points at the private copy', () => {
  beforeEach(() => {
    tables.products = [{
      id: WALK_BY_FAITH,
      name: 'Walk By Faith',
      price: 24.99,
      images: ['https://storage.googleapis.com/imagine-this-printed-main/merch-studio/darrell/aJCwdWaaoI/mockup-1.png?sig'],
      is_active: true,
      status: 'active',
      colors: ['maroon'],
      metadata: { source: 'merch-studio', print_file_placements: ['front'], assets: { mockups: [] } },
    }]
    tables.product_print_files = [{
      product_id: WALK_BY_FAITH,
      bucket: PRIVATE_BUCKET,
      front_path: 'print-files/merch-studio/darrell/aJCwdWaaoI/front.png',
      back_path: null,
    }]
  })

  async function checkout(item: Record<string, unknown> = {}) {
    const res = await fetch(`${base}/api/storefront/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ type: 'catalog', productId: WALK_BY_FAITH, size: 'L', ...item }], customer: { email: 'buyer@example.com' } }),
    })
    return { status: res.status, body: await res.json() as any }
  }

  it('snapshots the private refs for the DTF queue and stores no print-file link', async () => {
    const { status, body } = await checkout()
    expect(status).toBe(200)
    expect(body.url).toBe('https://checkout.stripe.test/cs_test_1')

    const items = writes.find(w => w.table === 'order_items' && w.op === 'insert')?.payload
    expect(items).toHaveLength(1)
    expect(items[0].metadata.print_file_refs).toEqual({
      bucket: PRIVATE_BUCKET,
      front: 'print-files/merch-studio/darrell/aJCwdWaaoI/front.png',
      back: null,
    })
    expect(items[0].metadata.print_files).toBeUndefined()
    expect(items[0].metadata.design_url).toBeNull()
    // Daisy's one-colour lock still rides along (c25fa1e).
    expect(items[0].metadata.color).toBe('maroon')

    const order = writes.find(w => w.table === 'orders' && w.op === 'insert')?.payload
    expect(order.metadata.items[0].designUrl).toBeNull()
    expect(JSON.stringify(order)).not.toMatch(/front\.png/)
  })

  it('still honours a design URL the storefront sends itself', async () => {
    await checkout({ designUrl: 'https://darrell.example/art.png' })
    const items = writes.find(w => w.table === 'order_items' && w.op === 'insert')?.payload
    expect(items[0].metadata.design_url).toBe('https://darrell.example/art.png')
    expect(items[0].metadata.print_file_refs.front).toMatch(/front\.png$/)
  })

  it('writes no refs for a product without private print files', async () => {
    tables.product_print_files = []
    await checkout()
    const items = writes.find(w => w.table === 'order_items' && w.op === 'insert')?.payload
    expect(items[0].metadata).not.toHaveProperty('print_file_refs')
  })
})

// Watchtower task 1417e863: the creator 3D lane's mesh (model_file) is a
// print-ready deliverable too, so it follows the print files into the private
// bucket and the row holds only a gs:// reference.
describe('POST /api/storefront/products — a creator 3D mesh stays private', () => {
  async function publish3d(filename: string) {
    const fd = new FormData()
    fd.set('name', 'Robo Charm')
    fd.set('retailPrice', '24.99')
    fd.set('categorySlug', '3d-prints')
    fd.set('placement', JSON.stringify({ print3d: { material: 'PLA', color_mode: 'grey' } }))
    fd.set('front_print', png(), 'front.png')
    fd.set('model_file', new Blob([new Uint8Array([0x73, 0x6f, 0x6c, 0x69, 0x64])]), filename)
    const res = await fetch(`${base}/api/storefront/products`, { method: 'POST', body: fd })
    return { status: res.status, body: await res.json() as any }
  }

  it('saves the STL to the private bucket and stores a gs:// reference, not a link', async () => {
    const { status, body } = await publish3d('robo.stl')
    expect(status).toBe(201)
    const mesh = privateUploads.find(u => u.path.endsWith('/model.stl'))
    expect(mesh?.bucket).toBe(PRIVATE_BUCKET)
    expect(mesh?.path).toMatch(/^print-files\/merch-studio\/darrell\/[\w-]{10}\/model\.stl$/)
    expect(publicUploads.some(p => /model\.(stl|glb)$/.test(p))).toBe(false)

    const print3d = productInsert().metadata.print3d
    expect(print3d.stl_url).toBe(`gs://${PRIVATE_BUCKET}/${mesh!.path}`)
    expect(print3d.glb_url).toBeNull()
    expect(JSON.stringify(productInsert())).not.toMatch(/model\.stl\?|https?:\/\/[^"]*model\.stl/)
    // The storefront can check what it sent with a 60-minute link.
    expect(body.files.model).toBe(`https://signed.test/${PRIVATE_BUCKET}/${mesh!.path}?ttl=60`)
  })

  it('a GLB lands the same way, as print3d.glb_url', async () => {
    await publish3d('robo.glb')
    const mesh = privateUploads.find(u => u.path.endsWith('/model.glb'))
    expect(productInsert().metadata.print3d.glb_url).toBe(`gs://${PRIVATE_BUCKET}/${mesh!.path}`)
  })
})

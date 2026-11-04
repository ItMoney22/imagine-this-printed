import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'

// ---------------------------------------------------------------------------
// Watchtower task 28ab467c (2026-10-12): approving a creator product no longer
// files anything it cannot identify as 'shirts'.
//
//   - The admin's category, sent with the approval, wins outright and is
//     stamped as the admin's word (metadata.category_source = 'admin').
//   - A product nothing identifies, or whose own fields disagree, is refused
//     with a 409 that asks the admin to pick — no row is written.
//   - What the old template sniff got right (a metal or 3D submission takes its
//     own category; a submitted 'shirts' stays shirts) still holds.
// Runs the REAL router; Supabase, auth, email, SEO and the watermarker are faked.
// Jev is not reachable here (no key), which is the fail-open path.
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

let product: any = null
const updates: any[] = []

vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    from: (table: string) => {
      const b: any = {
        select: () => b,
        eq: () => b,
        single: async () => table === 'user_profiles'
          ? { data: { role: 'admin', email: null }, error: null }
          : { data: product, error: product ? null : { message: 'none' } },
        update: (patch: any) => { updates.push(patch); return { eq: async () => ({ error: null }) } },
      }
      return b
    },
  },
}))
vi.mock('../../middleware/supabaseAuth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { sub: 'admin-1' }; next() },
}))
vi.mock('../../utils/email.js', () => ({ sendEmail: vi.fn(), sendProductApprovalEmail: vi.fn() }))
vi.mock('../../services/seo-pack.js', () => ({ generateSeoPackForProduct: vi.fn(async () => undefined) }))
vi.mock('../../services/watermark.js', () => ({ watermarkUrlToGcs: vi.fn(async () => 'https://cdn/watermarked.png') }))

const { default: router } = await import('./user-product-approvals.js')

let base = ''
let server: ReturnType<ReturnType<typeof express>['listen']>
beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/admin/user-products', router)
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()) })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server?.close() })

beforeEach(() => {
  updates.length = 0
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

const approve = async (body: Record<string, unknown> = {}) => {
  const res = await fetch(`${base}/api/admin/user-products/p1/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ force: true, ...body }),
  })
  return { status: res.status, body: await res.json() as any }
}

const submitted = (over: Record<string, any> = {}, metadata: Record<string, any> = {}) => ({
  id: 'p1',
  name: 'Camper Apology',
  category: null,
  print_locations: [],
  images: ['https://cdn/art.png'],
  ...over,
  metadata: { user_submitted: true, creator_id: null, mockup_url: 'https://cdn/m.png', assets: { clean: 'https://cdn/art.png' }, ...metadata },
})

describe('approving a creator product: what is it?', () => {
  it('refuses to file an unidentifiable product as shirts and asks the admin to pick', async () => {
    product = submitted()
    const { status, body } = await approve()
    expect(status).toBe(409)
    expect(body.needs_category).toBe(true)
    expect(body.error).toMatch(/Nothing on this product says what it is/)
    expect(body.categories).toEqual(expect.arrayContaining(['shirts', 'hoodies', 'metal-art', '3d-prints']))
    expect(updates).toEqual([])
  })

  it("files it under the admin's pick and records that the admin chose it", async () => {
    product = submitted()
    const { status } = await approve({ category: 'hoodies' })
    expect(status).toBe(200)
    expect(updates[0].category).toBe('hoodies')
    expect(updates[0].metadata.category_source).toBe('admin')
    expect(updates[0].metadata.product_kind).toMatchObject({ kind: 'hoodie', source: 'admin', needs_review: false, category: 'hoodies' })
  })

  it('ignores a category the shop does not have', async () => {
    product = submitted()
    const { status } = await approve({ category: 'polos' })
    expect(status).toBe(409)
  })

  it('asks when the product\'s own fields disagree (a polo filed under shirts)', async () => {
    product = submitted({ category: 'shirts', name: 'Golf Dad Polo' }, { product_type: 'polo' })
    const { status, body } = await approve()
    expect(status).toBe(409)
    expect(body.error).toMatch(/fields disagree.*category: tee.*product_type: other/)
    expect(updates).toEqual([])
  })

  it('keeps what the old template sniff got right', async () => {
    product = submitted({}, { product_template: 'metal-art', category: 'metal-art' })
    expect((await approve()).status).toBe(200)
    expect(updates[0].category).toBe('metal-art')

    updates.length = 0
    product = submitted({ name: 'Epic Black Tee Design' }, { category: 'shirts', source: 'create_design_modal' })
    expect((await approve()).status).toBe(200)
    expect(updates[0].category).toBe('shirts')
    expect(updates[0].print_locations).toEqual(['front_image'])
    expect(updates[0].metadata.product_kind).toMatchObject({ kind: 'tee', source: 'floor', category: 'shirts' })
  })

  it('leaves an already-categorised product in its category', async () => {
    product = submitted({ category: 'dtf-transfers', name: 'Patriotic Heartbeat DTF' }, { product_type: 'tshirt' })
    expect((await approve()).status).toBe(200)
    expect(updates[0].category).toBeUndefined()
    expect(updates[0].metadata.product_kind).toMatchObject({ kind: 'transfer', category: 'dtf-transfers' })
  })
})

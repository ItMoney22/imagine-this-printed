import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'node:net'

// ---------------------------------------------------------------------------
// Watchtower task b312de9c (2026-10-07): approving a creator's product after
// their print file went private.
//
//   - The row no longer carries print_files / assets.dtf; it lists placements
//     in metadata.print_file_placements. The direct-print gate must read that,
//     or every new creator product lands 'incomplete' (missing halftone + DTF).
//   - Approval used to watermark the print file into a PUBLIC assets.display:
//     the full design at 3072x4096 with one small corner mark — a printable
//     copy. A creator's own apparel must get none.
// Runs the REAL router; Supabase, auth, email, SEO and the watermarker are faked.
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
const watermarkUrlToGcs = vi.fn(async () => 'https://storage.googleapis.com/imagine-this-printed-main/watermarked/x.png')
vi.mock('../../services/watermark.js', () => ({ watermarkUrlToGcs }))

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
  watermarkUrlToGcs.mockClear()
})

const approve = async (body: Record<string, unknown> = {}) => {
  const res = await fetch(`${base}/api/admin/user-products/p1/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() as any }
}

describe('approving a creator product whose print file is private', () => {
  beforeEach(() => {
    product = {
      id: 'p1',
      name: 'Walk By Faith',
      category: 'shirts',
      print_locations: ['front_image'],
      images: ['https://cdn/mockup-1.png'],
      metadata: {
        user_submitted: true,
        source: 'merch-studio',
        creator_id: 'creator-1',
        print_file_placements: ['front'],
        mockup_url: 'https://cdn/mockup-1.png',
        assets: { mockups: ['https://cdn/mockup-1.png'] },
      },
    }
  })

  it('goes live: the private print file counts as print-ready (no halftone/DTF demanded)', async () => {
    const { status, body } = await approve()
    expect(status).toBe(200)
    expect(body.status).toBe('active')
    expect(body.missingGenerations).toEqual([])
    expect(updates[0]).toMatchObject({ status: 'active', is_active: true })
  })

  it('makes no public watermarked copy of the creator art', async () => {
    await approve()
    expect(watermarkUrlToGcs).not.toHaveBeenCalled()
    expect(updates[0].metadata.assets).not.toHaveProperty('display')
    expect(JSON.stringify(updates[0])).not.toMatch(/watermarked\//)
  })
})

describe('a house design still gets its watermarked display', () => {
  it('watermarks the clean art as before', async () => {
    product = {
      id: 'p1',
      name: 'House Tee',
      category: 'shirts',
      print_locations: ['front_image'],
      images: ['https://cdn/clean.png'],
      metadata: {
        user_submitted: true,
        mockup_url: 'https://cdn/m.png',
        assets: { clean: 'https://cdn/clean.png', halftone: 'https://cdn/h.png', dtf: 'https://cdn/d.png' },
      },
    }
    const { body } = await approve()
    expect(body.status).toBe('active')
    expect(watermarkUrlToGcs).toHaveBeenCalledWith('https://cdn/clean.png', expect.stringMatching(/^watermarked\/p1-display-/))
    expect(updates[0].metadata.assets.display).toMatch(/watermarked\/x\.png$/)
  })
})

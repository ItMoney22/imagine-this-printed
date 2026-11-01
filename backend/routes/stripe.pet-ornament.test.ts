// The checkout trust boundary for the create-your-own pet ornament (task 81358f3a).
//
// The cart line is client-controlled: the template comes from the DATABASE
// row, every value is re-checked here (pet from the template's list, name
// through the name sanitizer, portrait only as a server-minted id), and the
// print files are built here.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const PET_ID = '44444444-4444-4444-8444-444444444444'
const PORTRAIT = 'a1b2c3d4e5f6a1b2c3d4e5f6'

const petTemplate = { version: 1, pets: ['cat', 'dog'], font: 'brush-script', field: { key: 'name', label: "Your pet's name", max: 12 }, photo: true, upcharge: 0 }

const insertedRows: any[] = []
const stored: any[] = []
let storeFails = false

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'products') {
        return { select: () => ({ in: async () => ({ data: [{ id: PET_ID, metadata: { pet_ornament: petTemplate } }], error: null }) }) }
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

vi.mock('../services/pet-ornament/store.js', () => ({
  storePetPrint: async (_template: any, values: any) => {
    if (storeFails) throw new Error('GCS down')
    stored.push(values)
    return { path: `users/pet-ornaments/geo-v1/${values.pet}-${values.name}-${values.portrait || 'stock'}/print-spec.json`, built: true, spec: {} }
  },
}))

vi.mock('../services/team-plate/plate-store.js', () => ({
  renderOrGetCached: async () => {
    throw new Error('a pet ornament must not reach the team-plate renderer')
  },
  pressPlatePath: () => 'unused',
}))

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
process.env.SUPABASE_JWT_SECRET ||= 'test-only-secret-do-not-use-in-prod-0123456789'
process.env.STRIPE_SECRET_KEY ||= 'sk_test_pet_ornament'

const { replaceOrderItems } = await import('./stripe.js')

const line = (over: Record<string, any> = {}) => ({
  product: { id: PET_ID, name: 'Create Your Own Pet Ornament', images: [] },
  quantity: 1,
  personalization: { pet: 'cat', name: 'Ginger', portrait: PORTRAIT },
  ...over,
})

const req: any = { log: { error: vi.fn(), warn: vi.fn() } }

beforeEach(() => {
  insertedRows.length = 0
  stored.length = 0
  storeFails = false
})

describe('checkout: pet ornament', () => {
  it('builds the print files from their pet, their photo portrait and the name as typed', async () => {
    await replaceOrderItems('order-1', [line()], req)
    const meta = insertedRows[0].metadata
    expect(stored).toEqual([{ pet: 'cat', name: 'Ginger', portrait: PORTRAIT }])
    expect(meta.personalization).toEqual({ pet: 'cat', name: 'Ginger', portrait: PORTRAIT })
    expect(meta.print_file_path).toBe(`users/pet-ornaments/geo-v1/cat-Ginger-${PORTRAIT}/print-spec.json`)
    expect(meta.print_file_status).toBe('ready')
  })

  it('re-checks every value: unknown pet, a crafted portrait path, a stray tag', async () => {
    await replaceOrderItems(
      'order-1',
      [line({ personalization: { pet: 'tiger', name: ' Mr. Whiskers<b> ', portrait: '../../etc/passwd' }, print_file_path: 'https://evil.example.com/x.stl' })],
      req
    )
    // 12 characters at most: the tag is dropped, then the name is cut to fit.
    expect(stored[0]).toEqual({ pet: 'cat', name: 'Mr. Whiskers', portrait: '' })
    expect(JSON.stringify(insertedRows[0].metadata)).not.toContain('evil.example.com')
    expect(JSON.stringify(insertedRows[0].metadata)).not.toContain('passwd')
  })

  it('no photo = the stock portrait for the pet', async () => {
    await replaceOrderItems('order-1', [line({ personalization: { pet: 'dog', name: 'Biscuit' } })], req)
    expect(stored[0]).toEqual({ pet: 'dog', name: 'Biscuit', portrait: '' })
  })

  it('flags a line with no name instead of printing a nameless ornament', async () => {
    await replaceOrderItems('order-1', [line({ personalization: { pet: 'cat', name: '🐱' } })], req)
    const meta = insertedRows[0].metadata
    expect(stored).toHaveLength(0)
    expect(meta.print_file_status).toBe('failed')
    expect(meta.print_file_error).toMatch(/No pet name/)
  })

  it('records a failed build on the line without failing checkout', async () => {
    storeFails = true
    await expect(replaceOrderItems('order-1', [line()], req)).resolves.not.toThrow()
    expect(insertedRows[0].metadata.print_file_status).toBe('failed')
    expect(insertedRows[0].metadata.print_file_error).toBe('GCS down')
  })
})

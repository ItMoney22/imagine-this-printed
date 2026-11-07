import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import express from 'express'
import type { AddressInfo } from 'net'

// Drives the REAL GET /api/invoices/stats/summary over HTTP, with the REAL
// buildInvoiceStats behind it. Only the database and the auth lookup are faked.
// Task e12614ba: the route ran its own loop and added every row to total_billed,
// void included, so the 5 invoices voided on 11/7 ($995) still read as billed.

type Row = {
  status: string
  subtotal_cents: number
  founder_earnings_cents: number
  founder_id: string | null
}

const db = vi.hoisted(() => ({
  rows: [] as Row[],
  error: null as { message: string } | null,
  tables: [] as string[],
}))

vi.mock('../lib/supabase.js', () => ({
  supabase: {
    from(table: string) {
      db.tables.push(table)
      const filters: Array<[string, unknown]> = []
      let columns: string[] = []
      const builder: any = {
        select(cols: string) {
          columns = cols.split(',').map((c) => c.trim())
          return builder
        },
        eq(col: string, val: unknown) {
          filters.push([col, val])
          return builder
        },
        // Hands back only the columns the route selected, as PostgREST does, so
        // a route that reads a column it never asked for sees undefined here too.
        then(resolve: (v: unknown) => void) {
          if (db.error) return resolve({ data: null, error: db.error })
          const data = db.rows
            .filter((row) => filters.every(([col, val]) => (row as any)[col] === val))
            .map((row) => Object.fromEntries(columns.map((c) => [c, (row as any)[c]])))
          return resolve({ data, error: null })
        },
      }
      return builder
    },
  },
}))

vi.mock('../middleware/supabaseAuth.js', () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    const id = String(req.headers['x-test-user'] || '')
    req.user = { id, sub: id }
    next()
  },
  requireRole: (roles: string[]) => (req: any, res: any, next: () => void) => {
    const role = String(req.headers['x-test-role'] || '')
    if (!roles.includes(role)) return res.status(403).json({ error: 'Insufficient permissions' })
    req.user.role = role
    next()
  },
}))

vi.mock('../utils/email.js', () => ({ sendInvoiceEmail: async () => {} }))

// invoices.ts builds its Stripe client at module load. This route never calls it.
process.env.STRIPE_SECRET_KEY = 'sk_test_invoice_stats_summary'
const { default: router } = await import('./invoices.js')

let base = ''
let server: ReturnType<express.Express['listen']>

beforeAll(async () => {
  const app = express()
  app.use('/api/invoices', router)
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/invoices/stats/summary`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

beforeEach(() => {
  db.rows = []
  db.error = null
  db.tables = []
})

async function summary(role = 'admin', user = 'admin-1') {
  const res = await fetch(base, { headers: { 'x-test-role': role, 'x-test-user': user } })
  return { status: res.status, body: (await res.json()) as any }
}

function invoice(status: string, subtotal_cents: number, founder_earnings_cents = 0, founder_id: string | null = null): Row {
  return { status, subtotal_cents, founder_earnings_cents, founder_id }
}

// The live ledger as the admin Invoices page read it on 11/7: three invoices sent
// for $105.10, five voided for $995. The tile read $1,100.10 with all eight in it.
const SENT_11_7 = [invoice('sent', 10_000), invoice('sent', 500), invoice('sent', 10)]
const VOIDED_11_7 = [
  invoice('void', 22_250),
  invoice('void', 22_250),
  invoice('void', 50_000),
  invoice('void', 2_500),
  invoice('void', 2_500),
]

describe('Total Billed leaves out money nobody owes', () => {
  it('does not count the five invoices voided on 11/7', async () => {
    db.rows = [...SENT_11_7, ...VOIDED_11_7]

    const { status, body } = await summary()

    expect(status).toBe(200)
    expect(VOIDED_11_7.reduce((sum, row) => sum + row.subtotal_cents, 0)).toBe(99_500)
    expect(body.stats.total_billed_cents).toBe(10_510)
    expect(body.stats.total_billed).toBe(105.1)
    expect(body.stats.total_collected).toBe(0)
    expect(body.stats).toMatchObject({ total_invoices: 8, sent: 3, void: 5 })
  })

  it('does not count an uncollectible invoice', async () => {
    db.rows = [invoice('paid', 10_000), invoice('uncollectible', 40_000)]

    const { body } = await summary()

    expect(body.stats.total_billed_cents).toBe(10_000)
    expect(body.stats.total_billed).toBe(100)
  })

  it('still counts every invoice that is really billed', async () => {
    db.rows = [invoice('sent', 1_000), invoice('overdue', 2_000), invoice('paid', 4_000)]

    const { body } = await summary()

    expect(body.stats.total_billed_cents).toBe(7_000)
    expect(body.stats.total_billed).toBe(70)
  })

  it('reads $0.00 when every invoice is dead', async () => {
    db.rows = [...VOIDED_11_7, invoice('uncollectible', 5_000)]

    const { body } = await summary()

    expect(body.stats.total_billed).toBe(0)
    expect(body.stats.total_collected).toBe(0)
  })
})

describe('Collected does not move', () => {
  it('counts paid invoices and nothing else', async () => {
    db.rows = [
      invoice('paid', 10_000, 3_500),
      invoice('paid', 2_550, 892),
      invoice('sent', 20_000, 7_000),
      invoice('overdue', 5_000, 1_750),
      invoice('draft', 8_000, 2_800),
      invoice('void', 99_999, 34_999),
      invoice('uncollectible', 99_999, 34_999),
    ]

    const { body } = await summary()

    expect(body.stats.total_collected_cents).toBe(12_550)
    expect(body.stats.total_collected).toBe(125.5)
    expect(body.stats.total_earnings_cents).toBe(4_392)
    expect(body.stats.total_earnings).toBe(43.92)
  })
})

describe('the rest of the payload the two dashboards read', () => {
  it('keeps the same counters, with dead rows still in the invoice count', async () => {
    db.rows = [
      invoice('draft', 100),
      invoice('sent', 100),
      invoice('sent', 100),
      invoice('paid', 100),
      invoice('overdue', 100),
      invoice('void', 100),
      invoice('uncollectible', 100),
    ]

    const { body } = await summary()

    expect(body.stats).toMatchObject({ total_invoices: 7, draft: 1, sent: 2, paid: 1, overdue: 1, void: 1 })
  })

  it('answers the exact keys it always has, and no stray uncollectible key', async () => {
    db.rows = [invoice('paid', 100), invoice('uncollectible', 100)]

    const { body } = await summary()

    expect(Object.keys(body).sort()).toEqual(['ok', 'stats'])
    expect(body.ok).toBe(true)
    expect(Object.keys(body.stats).sort()).toEqual([
      'draft',
      'overdue',
      'paid',
      'pending_earnings',
      'pending_earnings_cents',
      'sent',
      'total_billed',
      'total_billed_cents',
      'total_collected',
      'total_collected_cents',
      'total_earnings',
      'total_earnings_cents',
      'total_invoices',
      'void',
    ])
  })

  it('counts an overdue founder share as pending, because it is still owed', async () => {
    db.rows = [invoice('sent', 20_000, 7_000), invoice('overdue', 5_000, 1_750), invoice('void', 9_000, 3_150)]

    const { body } = await summary()

    expect(body.stats.pending_earnings_cents).toBe(8_750)
    expect(body.stats.pending_earnings).toBe(87.5)
  })

  it('answers all zeros on an empty ledger', async () => {
    const { status, body } = await summary()

    expect(status).toBe(200)
    expect(body.stats.total_invoices).toBe(0)
    expect(body.stats.total_billed).toBe(0)
  })
})

describe('who sees what, and what happens on a bad read', () => {
  beforeEach(() => {
    db.rows = [
      invoice('paid', 10_000, 3_500, 'founder-a'),
      invoice('void', 20_000, 7_000, 'founder-a'),
      invoice('paid', 40_000, 14_000, 'founder-b'),
    ]
  })

  it('shows a founder only their own invoices', async () => {
    const { body } = await summary('founder', 'founder-a')

    expect(body.stats.total_invoices).toBe(2)
    expect(body.stats.total_billed).toBe(100)
    expect(body.stats.total_collected).toBe(100)
  })

  it('shows an admin every invoice', async () => {
    const { body } = await summary('admin', 'admin-1')

    expect(body.stats.total_invoices).toBe(3)
    expect(body.stats.total_billed).toBe(500)
  })

  it('refuses a customer', async () => {
    const { status } = await summary('customer', 'customer-1')

    expect(status).toBe(403)
    expect(db.tables).toEqual([])
  })

  it('answers 500 when the read fails, never a false $0.00', async () => {
    db.error = { message: 'connection refused' }

    const { status, body } = await summary()

    expect(status).toBe(500)
    expect(body).toEqual({ error: 'Failed to fetch statistics' })
  })
})

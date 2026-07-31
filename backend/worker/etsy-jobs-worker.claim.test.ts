import { describe, it, expect } from 'vitest'

// etsy-jobs-worker.ts transitively imports backend/lib/supabase.ts, which calls
// createClient() eagerly at module load and throws without a URL/key. These
// tests never touch a real Supabase client — claimEtsyListing/requeueStaleEtsyJobs
// take an injected fake `db` — so dummy values are fine. A dynamic import after
// setting the env vars (rather than a static import, which ESM hoists ahead of
// any code in this file) is what makes the ordering work — mirrors
// ai-jobs-worker.claim.test.ts.
process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { claimEtsyListing, requeueStaleEtsyJobs } = await import('./etsy-jobs-worker.js')

interface FakeRow { id: string; state: string; updated_at?: string }

/**
 * Fake etsy_listings table + Supabase-shaped query builder. Keeps real
 * mutable row state (rather than mocking promise resolution directly) so the
 * WHERE-guard semantics of both real call shapes are actually exercised:
 *   - claim:   .update(...).eq('id', x).eq('state', 'queued').select('id')
 *   - requeue: .update(...).in('state', [...]).lt('updated_at', x).select('id')
 * `rows` is exposed so tests can assert on post-call row state.
 */
function makeFakeEtsyListingsDb(initialRows: Record<string, FakeRow>) {
  const rows: Record<string, FakeRow> = { ...initialRows }
  return {
    rows,
    from(table: string) {
      if (table !== 'etsy_listings') throw new Error(`fake db: unexpected table "${table}"`)
      let patch: Record<string, any> = {}
      const eqFilters: Array<[string, any]> = []
      const inFilters: Array<[string, any[]]> = []
      const ltFilters: Array<[string, any]> = []
      const builder = {
        update(p: Record<string, any>) { patch = p; return builder },
        eq(col: string, val: any) { eqFilters.push([col, val]); return builder },
        in(col: string, vals: any[]) { inFilters.push([col, vals]); return builder },
        lt(col: string, val: any) { ltFilters.push([col, val]); return builder },
        select() {
          const idFilter = eqFilters.find(([col]) => col === 'id')?.[1]
          if (idFilter !== undefined) {
            // Single-row claim path.
            const row = rows[idFilter]
            const matches = !!row && eqFilters.every(([col, val]) => (row as any)[col] === val)
            if (matches) {
              Object.assign(row!, patch)
              return Promise.resolve({ data: [{ id: row!.id }], error: null })
            }
            return Promise.resolve({ data: [], error: null })
          }
          // Bulk stale-requeue path (in + lt filters, no id filter).
          const matched = Object.values(rows).filter(
            (row) =>
              inFilters.every(([col, vals]) => vals.includes((row as any)[col])) &&
              ltFilters.every(([col, val]) => (row as any)[col] < val)
          )
          for (const row of matched) Object.assign(row, patch)
          return Promise.resolve({ data: matched.map((r) => ({ id: r.id })), error: null })
        }
      }
      return builder
    }
  }
}

describe('claimEtsyListing', () => {
  it('claims a row that is currently queued', async () => {
    const db = makeFakeEtsyListingsDb({ 'row-1': { id: 'row-1', state: 'queued' } })
    const outcome = await claimEtsyListing(db, 'row-1')
    expect(outcome.claimed).toBe(true)
    expect(outcome.row).toEqual({ id: 'row-1' })
    expect(db.rows['row-1'].state).toBe('processing')
  })

  it('denies a second claimant once the first has already claimed the row (prevents duplicate Etsy listings)', async () => {
    const db = makeFakeEtsyListingsDb({ 'row-1': { id: 'row-1', state: 'queued' } })
    const first = await claimEtsyListing(db, 'row-1')
    const second = await claimEtsyListing(db, 'row-1')
    expect(first.claimed).toBe(true)
    expect(second.claimed).toBe(false)
    expect(second.row).toBeNull()
  })

  it('does not claim a row that is already processing', async () => {
    const db = makeFakeEtsyListingsDb({ 'row-1': { id: 'row-1', state: 'processing' } })
    const outcome = await claimEtsyListing(db, 'row-1')
    expect(outcome.claimed).toBe(false)
  })

  it('does not claim a nonexistent row', async () => {
    const db = makeFakeEtsyListingsDb({})
    const outcome = await claimEtsyListing(db, 'does-not-exist')
    expect(outcome.claimed).toBe(false)
    expect(outcome.row).toBeNull()
  })
})

describe('requeueStaleEtsyJobs', () => {
  it('requeues processing/pending rows older than 15 minutes back to queued', async () => {
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    const fresh = new Date().toISOString()
    const db = makeFakeEtsyListingsDb({
      'stale-processing': { id: 'stale-processing', state: 'processing', updated_at: stale },
      'stale-pending': { id: 'stale-pending', state: 'pending', updated_at: stale },
      'fresh-processing': { id: 'fresh-processing', state: 'processing', updated_at: fresh },
      'stale-but-terminal': { id: 'stale-but-terminal', state: 'draft', updated_at: stale }
    })

    const n = await requeueStaleEtsyJobs(db)

    expect(n).toBe(2)
    expect(db.rows['stale-processing'].state).toBe('queued')
    expect(db.rows['stale-pending'].state).toBe('queued')
    expect(db.rows['fresh-processing'].state).toBe('processing') // untouched — not stale yet
    expect(db.rows['stale-but-terminal'].state).toBe('draft') // untouched — already terminal, not a stuck claim
  })

  it('is a no-op when nothing is stale', async () => {
    const fresh = new Date().toISOString()
    const db = makeFakeEtsyListingsDb({ 'row-1': { id: 'row-1', state: 'processing', updated_at: fresh } })
    const n = await requeueStaleEtsyJobs(db)
    expect(n).toBe(0)
    expect(db.rows['row-1'].state).toBe('processing')
  })
})

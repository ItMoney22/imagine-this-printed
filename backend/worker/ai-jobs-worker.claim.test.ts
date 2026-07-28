import { describe, it, expect } from 'vitest'

// ai-jobs-worker.ts transitively imports backend/lib/supabase.ts, which calls
// createClient() eagerly at module load and throws without a URL/key. These
// tests never touch a real Supabase client — claimQueuedJob takes an injected
// fake `db` — so dummy values are fine. A dynamic import after setting the
// env vars (rather than a static import, which ESM hoists ahead of any code
// in this file) is what makes the ordering work; mirrors the same pattern in
// backend/services/order-pricing.test.ts.
process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { claimQueuedJob } = await import('./ai-jobs-worker.js')

/**
 * Fake ai_jobs table + Supabase-shaped query builder. Unlike mocking the
 * promise resolution directly (see backend/lib/webhook-helpers.test.ts's
 * claimOnce tests), this keeps real mutable row state so the WHERE-guard
 * semantics of `.update(...).eq('id', x).eq('status', 'queued').select()`
 * are actually exercised: a second call only sees whatever the first call's
 * update left behind, exactly like two workers hitting real Postgres.
 */
function makeFakeAiJobsDb(initialRows: Record<string, { id: string; status: string }>) {
  const rows: Record<string, { id: string; status: string }> = { ...initialRows }
  return {
    from(table: string) {
      if (table !== 'ai_jobs') throw new Error(`fake db: unexpected table "${table}"`)
      let patch: Record<string, any> = {}
      const filters: Array<[string, any]> = []
      const builder = {
        update(p: Record<string, any>) {
          patch = p
          return builder
        },
        eq(col: string, val: any) {
          filters.push([col, val])
          return builder
        },
        select(_cols?: string) {
          const idFilter = filters.find(([col]) => col === 'id')?.[1]
          const row = idFilter ? rows[idFilter] : undefined
          const matches = !!row && filters.every(([col, val]) => (row as any)[col] === val)
          if (matches) {
            Object.assign(row!, patch)
            return Promise.resolve({ data: [{ id: row!.id }], error: null })
          }
          return Promise.resolve({ data: [], error: null })
        },
      }
      return builder
    },
  }
}

describe('claimQueuedJob', () => {
  it('claims a job that is currently queued', async () => {
    const db = makeFakeAiJobsDb({ 'job-1': { id: 'job-1', status: 'queued' } })
    const outcome = await claimQueuedJob(db, 'job-1')
    expect(outcome.claimed).toBe(true)
    expect(outcome.row).toEqual({ id: 'job-1' })
    expect(outcome.error).toBeNull()
  })

  it('denies a second claimant once the first has already claimed the job (the core anti-duplicate-spend guarantee)', async () => {
    const db = makeFakeAiJobsDb({ 'job-1': { id: 'job-1', status: 'queued' } })

    const first = await claimQueuedJob(db, 'job-1')
    const second = await claimQueuedJob(db, 'job-1')

    expect(first.claimed).toBe(true)
    expect(second.claimed).toBe(false)
    expect(second.row).toBeNull()
  })

  it('does not claim a job that is not queued (already running)', async () => {
    const db = makeFakeAiJobsDb({ 'job-1': { id: 'job-1', status: 'running' } })
    const outcome = await claimQueuedJob(db, 'job-1')
    expect(outcome.claimed).toBe(false)
  })

  it('does not claim a job that is not queued (already succeeded)', async () => {
    const db = makeFakeAiJobsDb({ 'job-1': { id: 'job-1', status: 'succeeded' } })
    const outcome = await claimQueuedJob(db, 'job-1')
    expect(outcome.claimed).toBe(false)
  })

  it('does not claim a nonexistent job id', async () => {
    const db = makeFakeAiJobsDb({})
    const outcome = await claimQueuedJob(db, 'does-not-exist')
    expect(outcome.claimed).toBe(false)
    expect(outcome.row).toBeNull()
  })
})

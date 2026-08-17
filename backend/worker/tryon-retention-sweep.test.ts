// Tests for the try-on photo retention sweep — Watchtower task f3bf450c.
//
// Everything runs against an in-memory fake of RetentionDeps, so no test
// touches Supabase or GCS. The properties under test are the four ways this
// sweep can do real damage:
//   1. nulling a path whose bytes are still in the bucket (orphaned photo,
//      unreachable even by the shopper's own Delete button),
//   2. leaving an expired photo behind because a sibling object failed,
//   3. deleting the run row and taking the conversion economics with it,
//   4. expiring photos that are still inside the retention window.

import { describe, it, expect, beforeEach } from 'vitest'

import type { ExpiredRun, PurgePatch, RetentionDeps } from './tryon-retention-sweep.js'

// tryon-retention-sweep.ts transitively imports backend/lib/supabase.ts, which
// calls createClient() eagerly at module load and throws without a URL/key.
// These tests never touch a real client — the sweep takes injected deps — so
// dummy values are fine. The dynamic import (rather than a static one, which
// ESM hoists ahead of any code in this file) is what makes the ordering work;
// mirrors etsy-jobs-worker.claim.test.ts.
process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { sweepExpiredTryOnPhotos, retentionCutoff, isStorageConfigured, makeSupabaseRetentionDeps } =
  await import('./tryon-retention-sweep.js')

const NOW = new Date('2026-08-16T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

interface Fake extends RetentionDeps {
  state: {
    rows: ExpiredRun[]
    bucket: Set<string>
    /** Object paths whose delete should throw a non-404 error. */
    failDeletes: Set<string>
    /** Row ids whose purge write should throw. */
    failPurges: Set<string>
    patches: Array<{ id: string; patch: PurgePatch }>
    deleted: string[]
    /** Rows the sweep asked for, so we can assert nothing outside the window is touched. */
    queried: Array<{ cutoff: string; limit: number }>
  }
}

function makeRun(overrides: Partial<ExpiredRun> = {}): ExpiredRun {
  return {
    id: 'run-1',
    created_at: new Date(NOW.getTime() - 40 * DAY).toISOString(),
    model_photo_path: 'tryon/user-1/photo.jpg',
    result_paths: ['tryon/user-1/result-0.jpg'],
    result_url: 'https://storage.googleapis.com/b/tryon/user-1/result-0.jpg',
    ...overrides
  }
}

function makeDeps(overrides: Partial<Fake['state']> = {}): Fake {
  const state: Fake['state'] = {
    rows: [makeRun()],
    bucket: new Set(['tryon/user-1/photo.jpg', 'tryon/user-1/result-0.jpg']),
    failDeletes: new Set(),
    failPurges: new Set(),
    patches: [],
    deleted: [],
    queried: [],
    ...overrides
  }

  return {
    state,

    async findExpiredRuns(cutoffIso, limit) {
      state.queried.push({ cutoff: cutoffIso, limit })
      return state.rows.filter((r) => r.created_at < cutoffIso).slice(0, limit)
    },

    async deleteObject(path) {
      if (state.failDeletes.has(path)) throw new Error('bucket unavailable')
      if (!state.bucket.has(path)) return 'missing'
      state.bucket.delete(path)
      state.deleted.push(path)
      return 'deleted'
    },

    async purgeRow(id, patch) {
      if (state.failPurges.has(id)) throw new Error('write failed')
      state.patches.push({ id, patch })
      const row = state.rows.find((r) => r.id === id)
      if (!row) return
      if ('model_photo_path' in patch) row.model_photo_path = null
      if ('result_paths' in patch) row.result_paths = []
      if ('result_url' in patch) row.result_url = null
    },

    now: () => NOW
  }
}

describe('retentionCutoff', () => {
  it('is exactly N days behind the clock', () => {
    expect(retentionCutoff(NOW, 30)).toBe(new Date(NOW.getTime() - 30 * DAY).toISOString())
  })
})

describe('isStorageConfigured', () => {
  it('is false with no GCS credentials at all', () => {
    expect(isStorageConfigured({} as NodeJS.ProcessEnv)).toBe(false)
  })

  it('is true once a project or credentials are present', () => {
    expect(isStorageConfigured({ GCS_PROJECT_ID: 'itp' } as NodeJS.ProcessEnv)).toBe(true)
    expect(isStorageConfigured({ GCS_CREDENTIALS: '{}' } as NodeJS.ProcessEnv)).toBe(true)
  })
})

describe('sweepExpiredTryOnPhotos', () => {
  let deps: Fake

  beforeEach(() => {
    deps = makeDeps()
  })

  it('deletes the photo and the results, then nulls their pointers', async () => {
    const summary = await sweepExpiredTryOnPhotos(deps, { retentionDays: 30 })

    expect(deps.state.bucket.size).toBe(0)
    expect(summary.objectsDeleted).toBe(2)
    expect(summary.rowsPurged).toBe(1)
    expect(summary.rowsDeferred).toBe(0)

    const { patch } = deps.state.patches[0]
    expect(patch.model_photo_path).toBeNull()
    expect(patch.result_paths).toEqual([])
    expect(patch.result_urls).toEqual([])
    expect(patch.result_url).toBeNull()
  })

  it('never deletes the run row — only the image pointers', async () => {
    await sweepExpiredTryOnPhotos(deps, { retentionDays: 30 })

    // The row survives so the keep-or-kill conversion report still has it.
    expect(deps.state.rows).toHaveLength(1)
    expect(deps.state.rows[0].id).toBe('run-1')
    // And the patch carries nothing beyond the four image columns.
    expect(Object.keys(deps.state.patches[0].patch).sort()).toEqual([
      'model_photo_path',
      'result_paths',
      'result_url',
      'result_urls'
    ])
  })

  it('leaves the path in place when the object delete fails, so the bytes stay reachable', async () => {
    deps = makeDeps({ failDeletes: new Set(['tryon/user-1/photo.jpg']) })

    const summary = await sweepExpiredTryOnPhotos(deps, { retentionDays: 30 })

    expect(summary.objectsFailed).toBe(1)
    // THE invariant: a photo still in the bucket keeps its pointer, or it is
    // orphaned forever.
    expect(deps.state.patches[0].patch.model_photo_path).toBeUndefined()
    expect(deps.state.rows[0].model_photo_path).toBe('tryon/user-1/photo.jpg')
  })

  it('still expires the results when only the source photo fails to delete', async () => {
    deps = makeDeps({ failDeletes: new Set(['tryon/user-1/photo.jpg']) })

    await sweepExpiredTryOnPhotos(deps, { retentionDays: 30 })

    // The two groups are independent — one bucket error must not buy the other
    // group another day of retention.
    expect(deps.state.bucket.has('tryon/user-1/result-0.jpg')).toBe(false)
    expect(deps.state.patches[0].patch.result_url).toBeNull()
  })

  it('treats an already-deleted object as success and clears the pointer', async () => {
    // The shopper pressed Delete on the object but the row still points at it.
    deps = makeDeps({ bucket: new Set() })

    const summary = await sweepExpiredTryOnPhotos(deps, { retentionDays: 30 })

    expect(summary.objectsMissing).toBe(2)
    expect(summary.objectsFailed).toBe(0)
    expect(summary.rowsPurged).toBe(1)
    expect(deps.state.patches[0].patch.model_photo_path).toBeNull()
  })

  it('leaves runs inside the retention window completely alone', async () => {
    deps = makeDeps({
      rows: [makeRun({ id: 'fresh', created_at: new Date(NOW.getTime() - 3 * DAY).toISOString() })]
    })

    const summary = await sweepExpiredTryOnPhotos(deps, { retentionDays: 30 })

    expect(summary.scanned).toBe(0)
    expect(deps.state.deleted).toEqual([])
    expect(deps.state.bucket.size).toBe(2)
  })

  it('honours a shorter configured retention window', async () => {
    deps = makeDeps({
      rows: [makeRun({ id: 'ten-days', created_at: new Date(NOW.getTime() - 10 * DAY).toISOString() })]
    })

    expect((await sweepExpiredTryOnPhotos(deps, { retentionDays: 30 })).scanned).toBe(0)
    expect((await sweepExpiredTryOnPhotos(deps, { retentionDays: 7 })).rowsPurged).toBe(1)
  })

  it('keeps the rendered results when keepResults is on, but still expires the photo', async () => {
    const summary = await sweepExpiredTryOnPhotos(deps, { retentionDays: 30, keepResults: true })

    expect(deps.state.bucket.has('tryon/user-1/photo.jpg')).toBe(false)
    expect(deps.state.bucket.has('tryon/user-1/result-0.jpg')).toBe(true)
    expect(summary.rowsPurged).toBe(1)

    const { patch } = deps.state.patches[0]
    expect(patch.model_photo_path).toBeNull()
    expect(patch.result_paths).toBeUndefined()
    expect(patch.result_url).toBeUndefined()
  })

  it('clears a stale result_url even when no result objects were ever stored', async () => {
    // A render we failed to copy into our own bucket: result_url points at
    // FASHN's CDN, which has long since expired.
    deps = makeDeps({
      rows: [makeRun({ model_photo_path: null, result_paths: [], result_url: 'https://cdn.fashn.ai/x.jpg' })],
      bucket: new Set()
    })

    const summary = await sweepExpiredTryOnPhotos(deps, { retentionDays: 30 })

    expect(summary.rowsPurged).toBe(1)
    expect(deps.state.patches[0].patch.result_url).toBeNull()
  })

  it('defers the row when the database write fails, leaving it for the next sweep', async () => {
    deps = makeDeps({ failPurges: new Set(['run-1']) })

    const summary = await sweepExpiredTryOnPhotos(deps, { retentionDays: 30 })

    expect(summary.rowsPurged).toBe(0)
    expect(summary.rowsDeferred).toBe(1)
    // Self-healing: the bytes are gone, so the retry's deletes come back
    // `missing` and only the nulling is repeated.
    expect(deps.state.bucket.size).toBe(0)
  })

  it('caps one tick at the batch size', async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRun({
        id: `run-${i}`,
        model_photo_path: `tryon/user-1/photo-${i}.jpg`,
        result_paths: [],
        result_url: null
      })
    )
    deps = makeDeps({ rows, bucket: new Set(rows.map((r) => r.model_photo_path as string)) })

    const summary = await sweepExpiredTryOnPhotos(deps, { retentionDays: 30, batchSize: 2 })

    expect(summary.scanned).toBe(2)
    expect(deps.state.queried[0].limit).toBe(2)
    expect(deps.state.bucket.size).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// The Supabase wiring: the query the sweep actually issues, and the behaviour
// when 20260816_02_tryon_photo_retention.sql has not been applied.
// ---------------------------------------------------------------------------

interface Call { table: string; op: string; args: unknown[] }

/**
 * Supabase-shaped query builder that records the chain instead of running it.
 * `updateError` simulates PostgREST rejecting the write.
 */
function makeFakeDb(opts: { rows?: unknown[]; updateError?: { code?: string; message?: string } } = {}) {
  const calls: Call[] = []
  const updates: Array<Record<string, unknown>> = []
  let updateErrorsLeft = opts.updateError ? 1 : 0

  const builder = (table: string, op: string): any => {
    const self: any = {}
    const record = (name: string) => (...args: unknown[]) => {
      calls.push({ table, op: name, args })
      return self
    }
    for (const m of ['select', 'lt', 'not', 'or', 'order', 'eq']) self[m] = record(m)
    self.limit = (n: number) => {
      calls.push({ table, op: 'limit', args: [n] })
      return Promise.resolve({ data: opts.rows ?? [], error: null })
    }
    // An update chain is awaited directly after .eq(), so the builder itself
    // has to be thenable.
    self.then = (resolve: (v: any) => void) => {
      if (op === 'update' && updateErrorsLeft > 0) {
        updateErrorsLeft--
        return resolve({ data: null, error: opts.updateError })
      }
      return resolve({ data: [], error: null })
    }
    return self
  }

  return {
    calls,
    updates,
    from(table: string) {
      return {
        select: (...args: unknown[]) => {
          calls.push({ table, op: 'select', args })
          return builder(table, 'select')
        },
        update: (patch: Record<string, unknown>) => {
          updates.push(patch)
          calls.push({ table, op: 'update', args: [patch] })
          return builder(table, 'update')
        }
      }
    }
  }
}

describe('makeSupabaseRetentionDeps', () => {
  it('asks only for rows past the cutoff that still hold an image pointer', async () => {
    const db = makeFakeDb()
    await makeSupabaseRetentionDeps(db, false).findExpiredRuns('2026-07-17T12:00:00.000Z', 200)

    const ops = db.calls.map((c) => c.op)
    expect(ops).toContain('lt')
    // Without this OR the batch refills with already-purged rows every tick and
    // the expired ones behind them are never reached.
    const or = db.calls.find((c) => c.op === 'or')
    expect(or?.args[0]).toBe('model_photo_path.not.is.null,result_url.not.is.null')
    expect(db.calls.find((c) => c.op === 'order')?.args[1]).toEqual({ ascending: true })
    expect(db.calls.find((c) => c.op === 'limit')?.args[0]).toBe(200)
  })

  it('drops the result_url clause when results are kept, so those rows stop matching', async () => {
    const db = makeFakeDb()
    await makeSupabaseRetentionDeps(db, true).findExpiredRuns('2026-07-17T12:00:00.000Z', 50)

    expect(db.calls.find((c) => c.op === 'or')).toBeUndefined()
    expect(db.calls.find((c) => c.op === 'not')?.args).toEqual(['model_photo_path', 'is', null])
  })

  it('stamps photos_purged_at on the purge write', async () => {
    const db = makeFakeDb()
    await makeSupabaseRetentionDeps(db, false).purgeRow('run-1', { model_photo_path: null })

    expect(db.updates[0]).toHaveProperty('model_photo_path', null)
    expect(typeof db.updates[0].photos_purged_at).toBe('string')
  })

  it('still purges when the photos_purged_at migration has not been applied', async () => {
    // PGRST204 = column missing from the schema cache. This repo has already
    // taken a production outage from deployed code touching an unapplied
    // column, so the stamp must be optional, not load-bearing.
    const db = makeFakeDb({
      updateError: { code: 'PGRST204', message: "Could not find the 'photos_purged_at' column" }
    })

    await expect(
      makeSupabaseRetentionDeps(db, false).purgeRow('run-1', { model_photo_path: null })
    ).resolves.toBeUndefined()

    expect(db.updates).toHaveLength(2)
    expect(db.updates[1]).toEqual({ model_photo_path: null })
    expect(db.updates[1]).not.toHaveProperty('photos_purged_at')
  })

  it('surfaces a genuine write error instead of swallowing it', async () => {
    const db = makeFakeDb({ updateError: { code: '42501', message: 'permission denied' } })

    await expect(
      makeSupabaseRetentionDeps(db, false).purgeRow('run-1', { model_photo_path: null })
    ).rejects.toThrow('permission denied')
  })
})

// ---------------------------------------------------------------------------
// Automatic photo-retention sweep for buyer-side virtual try-on.
// Watchtower task f3bf450c (follow-up to 3b362203).
//
// THE LIABILITY THIS CLOSES
// A try-on upload is a photograph of a customer's face and body. Before this
// file, those objects sat in `tryon/<userId>/…` forever unless the shopper
// pressed Delete. Failed renders were cleaned up immediately and
// `DELETE /api/tryon/:id` removed the bytes, but the shopper who ran one
// try-on in March and never came back left their photo in our bucket
// indefinitely. This sweep gives every upload a hard expiry.
//
// THE ONE RULE THAT MATTERS: DELETE THE BYTES BEFORE NULLING THE PATH.
// `model_photo_path` is the ONLY pointer we hold to the object. Nulling it
// first — or nulling it after a failed delete — orphans a customer's photo in
// the bucket with nothing left in the database that can ever find it again.
// That is strictly worse than keeping it, because it is unreachable by the
// shopper's own Delete button too. So: every purge below only clears a column
// after the bytes it points at are confirmed gone (deleted, or already 404).
// A delete that errors for any other reason leaves the row untouched and the
// next sweep retries it.
//
// The row itself is NEVER deleted. `cost_usd`, `itc_charged`, `status` and
// `used_free_daily` are the keep-or-kill conversion report
// (services/virtual-tryon.ts, summarizeConversion) — dropping the row to
// delete a photo would quietly destroy the economics data the feature is
// judged on. Only the image pointers are cleared.
//
// Every I/O touch goes through an injected `RetentionDeps` so the unit tests
// (tryon-retention-sweep.test.ts) run with no database, no GCS and no clock.
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase.js'
import { deleteImage } from '../services/google-cloud-storage.js'

/**
 * How long a shopper's try-on photo is allowed to live. 30 days is the default
 * the brief asked for: long enough that the try-on is still in the shopper's
 * history while they're deciding on the purchase, short enough that we are not
 * sitting on a year of customer faces.
 */
export const TRYON_PHOTO_RETENTION_DAYS = Math.max(1, Number(process.env.TRYON_PHOTO_RETENTION_DAYS) || 30)

/**
 * Sweep cadence. Daily, not hourly: the retention window is measured in weeks,
 * so the only thing a faster tick buys is query load. Worst-case
 * over-retention is therefore RETENTION_DAYS + one interval.
 */
export const TRYON_RETENTION_SWEEP_HOURS = Math.max(1, Number(process.env.TRYON_RETENTION_SWEEP_HOURS) || 24)

/**
 * Whether the RENDERED results expire along with the uploaded photo.
 *
 * Default: they do. A FASHN result is not an anonymous product mockup — it is
 * the shopper's own body wearing the garment, generated from their photo. It
 * is at least as identifying as the input, so deleting the upload while
 * keeping the render would be privacy theatre. Set
 * TRYON_RETENTION_KEEP_RESULTS=true to keep renders in the shopper's history
 * past the window and expire only the source photo.
 */
export const TRYON_RETENTION_KEEP_RESULTS = process.env.TRYON_RETENTION_KEEP_RESULTS === 'true'

/** Rows per tick. Bounds one sweep's work so a large backlog drains over several days instead of hanging the worker. */
export const TRYON_RETENTION_BATCH = Math.max(1, Number(process.env.TRYON_RETENTION_BATCH) || 200)

/** Delay before the first sweep after boot, so a deploy doesn't sweep mid-rollout. */
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000

export interface ExpiredRun {
  id: string
  created_at: string
  model_photo_path: string | null
  result_paths: string[] | null
  result_url: string | null
}

/** The columns a purge clears. Deliberately narrow — nothing analytic is touched. */
export interface PurgePatch {
  model_photo_path?: null
  result_paths?: never[]
  result_url?: null
  result_urls?: never[]
}

export interface RetentionDeps {
  /** Oldest-first page of runs created before `cutoffIso` that still hold image pointers. */
  findExpiredRuns(cutoffIso: string, limit: number): Promise<ExpiredRun[]>
  /**
   * Remove one object. MUST resolve (not reject) when the object is already
   * gone — an object deleted by the shopper's own Delete button is a success
   * for our purposes, not a reason to keep the pointer.
   */
  deleteObject(path: string): Promise<'deleted' | 'missing'>
  /** Clear image pointers on a row. Never deletes the row. */
  purgeRow(id: string, patch: PurgePatch): Promise<void>
  now(): Date
}

export interface SweepSummary {
  cutoff: string
  scanned: number
  rowsPurged: number
  objectsDeleted: number
  /** Already gone when we got there — counted as success. */
  objectsMissing: number
  /** Delete errored; the pointer was left in place for the next sweep. */
  objectsFailed: number
  /** Rows whose bytes could not all be removed, so nothing was nulled. */
  rowsDeferred: number
}

/** True when the GCS client has credentials to act with. */
export function isStorageConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GCS_PROJECT_ID || env.GCS_CREDENTIALS)
}

/** The instant before which a run's photos have outlived the retention window. */
export function retentionCutoff(now: Date, days: number = TRYON_PHOTO_RETENTION_DAYS): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Delete every expired shopper photo (and, by default, every rendered result)
 * from storage, then null the pointers on the rows whose bytes are confirmed
 * gone.
 *
 * The upload and the results are handled as two INDEPENDENT groups: a bucket
 * error on one render must not hold the shopper's face in the bucket for
 * another day. Retrying a whole group is safe because an already-deleted
 * object comes back `missing`, which counts as success.
 */
export async function sweepExpiredTryOnPhotos(
  deps: RetentionDeps,
  opts: {
    retentionDays?: number
    keepResults?: boolean
    batchSize?: number
  } = {}
): Promise<SweepSummary> {
  const retentionDays = opts.retentionDays ?? TRYON_PHOTO_RETENTION_DAYS
  const keepResults = opts.keepResults ?? TRYON_RETENTION_KEEP_RESULTS
  const batchSize = opts.batchSize ?? TRYON_RETENTION_BATCH

  const cutoff = retentionCutoff(deps.now(), retentionDays)
  const summary: SweepSummary = {
    cutoff,
    scanned: 0,
    rowsPurged: 0,
    objectsDeleted: 0,
    objectsMissing: 0,
    objectsFailed: 0,
    rowsDeferred: 0
  }

  const runs = await deps.findExpiredRuns(cutoff, batchSize)
  summary.scanned = runs.length

  for (const run of runs) {
    // Removes one group of objects. `ok` is false if ANY of them errored, in
    // which case the caller leaves that group's columns alone.
    const removeAll = async (paths: string[]): Promise<boolean> => {
      let ok = true
      for (const path of paths) {
        try {
          const outcome = await deps.deleteObject(path)
          if (outcome === 'missing') summary.objectsMissing++
          else summary.objectsDeleted++
        } catch (err: any) {
          summary.objectsFailed++
          ok = false
          console.error(
            `[tryon-retention] object delete failed (kept the pointer, will retry): ${path}:`,
            err?.message || String(err)
          )
        }
      }
      return ok
    }

    const patch: PurgePatch = {}

    if (typeof run.model_photo_path === 'string' && run.model_photo_path.length > 0) {
      if (await removeAll([run.model_photo_path])) patch.model_photo_path = null
    }

    if (!keepResults) {
      const resultPaths = (Array.isArray(run.result_paths) ? run.result_paths : []).filter(
        (p): p is string => typeof p === 'string' && p.length > 0
      )
      // `result_url` is nulled with the objects even when result_paths is empty
      // — that case is a render we never managed to copy into our own bucket,
      // so the column points at a FASHN CDN URL that has long since expired.
      const hadResultPointer = resultPaths.length > 0 || Boolean(run.result_url)
      if (hadResultPointer && (await removeAll(resultPaths))) {
        patch.result_paths = []
        patch.result_urls = []
        patch.result_url = null
      }
    }

    if (Object.keys(patch).length === 0) {
      summary.rowsDeferred++
      continue
    }

    try {
      await deps.purgeRow(run.id, patch)
      summary.rowsPurged++
    } catch (err: any) {
      // The bytes are gone but the pointer survived. Harmless and self-healing:
      // the next sweep re-selects the row, the deletes come back `missing`, and
      // the nulling is retried.
      summary.rowsDeferred++
      console.error(`[tryon-retention] row purge failed for ${run.id}:`, err?.message || String(err))
    }
  }

  return summary
}

// ---------------------------------------------------------------------------
// Supabase + GCS wiring
// ---------------------------------------------------------------------------

/**
 * PostgREST reports a column the schema cache has never seen as PGRST204.
 * `photos_purged_at` ships in 20260816_02_tryon_photo_retention.sql, and this
 * repo has already taken one production outage from deployed code querying a
 * column whose migration was never applied (social_outbox.scheduled_for). So
 * the audit stamp is best-effort: if the column isn't there, the purge still
 * happens without it rather than the whole sweep dying.
 */
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === 'PGRST204' || /photos_purged_at/i.test(error.message || '')
}

/**
 * The real deps. `db` is injected so the tests can exercise the query chain and
 * the missing-column fallback without a database — see the
 * `makeSupabaseRetentionDeps` block in tryon-retention-sweep.test.ts.
 */
export function makeSupabaseRetentionDeps(
  db: { from: (table: string) => any } = supabase,
  keepResults: boolean = TRYON_RETENTION_KEEP_RESULTS
): RetentionDeps {
  return {
    async findExpiredRuns(cutoffIso, limit) {
      let query = db
        .from('virtual_tryon_runs')
        .select('id, created_at, model_photo_path, result_paths, result_url')
        .lt('created_at', cutoffIso)

      // The filter has to be narrowed to rows that still hold a pointer,
      // otherwise every tick refills the batch with rows it already purged and
      // the genuinely-expired ones behind them are never reached.
      query = keepResults
        ? query.not('model_photo_path', 'is', null)
        : query.or('model_photo_path.not.is.null,result_url.not.is.null')

      const { data, error } = await query.order('created_at', { ascending: true }).limit(limit)
      if (error) throw new Error(error.message)
      return (data || []) as ExpiredRun[]
    },

    async deleteObject(path) {
      try {
        await deleteImage(path)
        return 'deleted'
      } catch (err: any) {
        // GCS returns 404 for an object the shopper already deleted. That is
        // the outcome we wanted, so it must not block the pointer being cleared.
        const code = err?.code ?? err?.response?.status
        if (code === 404 || /no such object|not found/i.test(err?.message || '')) return 'missing'
        throw err
      }
    },

    async purgeRow(id, patch) {
      const stampedAt = new Date().toISOString()
      const { error } = await db
        .from('virtual_tryon_runs')
        .update({ ...patch, photos_purged_at: stampedAt })
        .eq('id', id)

      if (error && isMissingColumnError(error)) {
        const { error: retryError } = await db.from('virtual_tryon_runs').update(patch).eq('id', id)
        if (retryError) throw new Error(retryError.message)
        return
      }
      if (error) throw new Error(error.message)
    },

    now: () => new Date()
  }
}

/** The default instance the worker runs with. */
export const supabaseRetentionDeps: RetentionDeps = makeSupabaseRetentionDeps()

/** One tick: sweep, then log a single line an operator can grep. */
export async function runRetentionSweep(deps: RetentionDeps = supabaseRetentionDeps): Promise<SweepSummary | null> {
  if (!isStorageConfigured()) {
    // Without a storage client we could only null the pointers, which would
    // strand the photos in the bucket unreachable forever. Doing nothing is
    // the safe failure here.
    console.warn('[tryon-retention] skipped: GCS is not configured, so photos cannot actually be deleted')
    return null
  }

  try {
    const summary = await sweepExpiredTryOnPhotos(deps)
    if (summary.scanned > 0 || summary.objectsFailed > 0) {
      console.log(
        `[tryon-retention] 🧹 swept ${summary.rowsPurged}/${summary.scanned} run(s) older than ` +
          `${TRYON_PHOTO_RETENTION_DAYS}d — ${summary.objectsDeleted} object(s) deleted, ` +
          `${summary.objectsMissing} already gone, ${summary.objectsFailed} failed, ` +
          `${summary.rowsDeferred} deferred`
      )
    }
    return summary
  } catch (err: any) {
    console.error('[tryon-retention] sweep failed:', err?.message || String(err))
    return null
  }
}

/**
 * Start the daily sweep. Safe to run on several worker replicas at once:
 * deleting an object twice yields `missing`, and nulling an already-null
 * column is a no-op, so there is nothing to claim or lock.
 */
export function startTryOnRetentionSweep(): void {
  if (process.env.TRYON_RETENTION_ENABLED === 'false') {
    console.log('[tryon-retention] disabled (TRYON_RETENTION_ENABLED=false)')
    return
  }

  const intervalMs = TRYON_RETENTION_SWEEP_HOURS * 60 * 60 * 1000
  console.log(
    `[tryon-retention] 🧵 starting photo retention sweep — ${TRYON_PHOTO_RETENTION_DAYS}d window, ` +
      `every ${TRYON_RETENTION_SWEEP_HOURS}h, results ${TRYON_RETENTION_KEEP_RESULTS ? 'kept' : 'expired with the photo'}`
  )

  setInterval(() => { void runRetentionSweep() }, intervalMs)
  setTimeout(() => { void runRetentionSweep() }, FIRST_RUN_DELAY_MS)
}

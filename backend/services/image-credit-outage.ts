// ---------------------------------------------------------------------------
// The image queue PAUSES when a provider runs out of credit (task dbce13a8).
//
// Before this, an empty Replicate account turned every queued mockup into a
// failure: 65 of the 72 failed mockups in 90 days were a 402 "Insufficient
// credit" (8/24, 8/30), each one a job that would have rendered fine once
// somebody topped the account up, and each one needing a person to notice and
// press Redo. Now:
//
//   1. A job that hits a credit error goes to status 'blocked', not 'failed',
//      with a plain reason in `error` and the provider in `output.blocked`.
//   2. Every QUEUED image job that needs the same provider is held the same
//      way, and the worker stops dequeuing them (other providers keep going —
//      an empty OpenAI wallet must not stall Replicate mockups).
//   3. ONE alert per outage: team email + admin bell + Becky (Christina) and
//      Jessica (David). The outage is a row in admin_settings keyed per
//      provider, and the key is the primary key, so exactly one process — API
//      or worker, however many 402s land at once — wins the insert and sends
//      the alert. A second 402 while paused finds the row and stays quiet.
//   4. Every PROBE_INTERVAL the worker asks the provider whether it will take a
//      call again (probeReplicateCredit / probeOpenAIImageCredit — a refused
//      call is free). The first yes deletes the outage row, the held jobs go
//      back to 'queued', and they run like any other job. No manual re-queue.
//
// Why a status value and not a flag on 'queued': ai_jobs.status has no CHECK
// constraint in prod (read 2026-10-07), so 'blocked' needs no migration, the
// worker's `status = 'queued'` fetch skips it for free, and both stall sweeps
// (12-min reset, Step Flow stall) only touch 'running' rows, so a long outage
// can never be "recovered" into a failure. `select * from ai_jobs where
// status = 'blocked'` is the whole picture.
//
// Deliberately NOT here: 3D jobs (their own ITC deduct/refund lifecycle, and no
// recorded credit failures) and Mrs. Imagine batches (not queue jobs, and David
// stopped her building unattended on 2026-09-02 — auto-resuming a batch hours
// later would be exactly that). Both keep today's behaviour.
// ---------------------------------------------------------------------------

import {
  CREDIT_PROVIDER_LABEL,
  creditProviderOf,
  type CreditProbeResult,
  type CreditProvider,
} from './provider-credit.js'

export const CREDIT_PROVIDERS: readonly CreditProvider[] = ['replicate', 'openai']
export const BLOCKED_STATUS = 'blocked'
export const OUTAGE_KEY_PREFIX = 'image_credit_outage:'
const LAST_OUTAGE_KEY_PREFIX = 'image_credit_outage_last:'

/** How often a paused provider is asked whether credit is back. Failed probes are free. */
export const PROBE_INTERVAL_MS = Math.max(1, Number(process.env.IMAGE_CREDIT_PROBE_MINUTES) || 5) * 60_000

/**
 * How often blocked rows with no open outage are put back in the queue. That is
 * the crash-safe half of resuming: a close that died before releasing its jobs,
 * or an admin deleting the outage row by hand, both heal on the next scan.
 */
const RELEASE_SCAN_MS = 60_000

/**
 * What a held job's `error` says. Shown in admin views; names no engine
 * (David's rule for anything a customer could see) and tells the reader the
 * one thing that matters — there is nothing to redo.
 */
export const BLOCKED_REASON =
  'Paused, not failed: the image service is out of credit. This job runs again by itself once credit is added. Nothing to redo.'

/** The ai_jobs types the pause holds — everything the worker renders with a paid image provider. */
export const PAUSABLE_JOB_TYPES: ReadonlySet<string> = new Set([
  'replicate_image',
  'replicate_image_v2',
  'replicate_mockup',
  'replicate_mockup_v2',
  'replicate_rembg',
  'ghost_mannequin',
  'replicate_upscale',
])

/**
 * Which providers a job will call. Mockups render on Replicate unless the admin
 * forced the Flare path (OpenAI). Design jobs pick their model at run time and
 * the fan-out spans both, so they wait on either.
 */
export function creditProvidersForJob(job: { type?: string; input?: any }): CreditProvider[] {
  switch (job?.type) {
    case 'replicate_mockup':
    case 'replicate_mockup_v2':
      return job.input?.engine === 'print-true' ? ['openai'] : ['replicate']
    case 'replicate_rembg':
    case 'ghost_mannequin':
    case 'replicate_upscale':
      return ['replicate']
    case 'replicate_image':
    case 'replicate_image_v2':
      return ['replicate', 'openai']
    default:
      return []
  }
}

/** The out-of-credit provider this job would run into, or null if it can run. */
export function dryProviderFor(job: { type?: string; input?: any }, dry: ReadonlySet<CreditProvider>): CreditProvider | null {
  return creditProvidersForJob(job).find((p) => dry.has(p)) ?? null
}

function isProvider(p: unknown): p is CreditProvider {
  return p === 'replicate' || p === 'openai'
}

function messageOf(err: unknown): string {
  const e = err as any
  return String(e?.message ?? e ?? '').slice(0, 500)
}

/** The admin_settings value for one open outage. */
export interface OutageRecord {
  provider: CreditProvider
  opened_at: string
  /** The provider's own words, for whoever reads the row. */
  detail: string
  first_job_id: string | null
  first_job_type: string | null
  held_jobs?: number
  alert?: AlertResult & { sent_at: string }
  probes?: number
  last_probe_at?: string
  last_probe?: CreditProbeResult
}

export interface OutageAlert {
  provider: CreditProvider
  detail: string
  firstJobId: string | null
  firstJobType: string | null
  /** Jobs on hold besides the one that hit it. */
  heldJobs: number
  probeMinutes: number
}

export interface AlertResult {
  email: boolean
  bell: boolean
  becky: boolean
  jessica: boolean
  errors: string[]
}

export interface OutageDeps {
  db: { from(table: string): any }
  now(): Date
  sendAlert(alert: OutageAlert): Promise<AlertResult>
  probe(provider: CreditProvider): Promise<CreditProbeResult>
  probeIntervalMs?: number
}

export async function readOpenOutages(deps: Pick<OutageDeps, 'db'>): Promise<Map<CreditProvider, OutageRecord>> {
  const { data, error } = await deps.db
    .from('admin_settings')
    .select('key, value')
    .in('key', CREDIT_PROVIDERS.map((p) => OUTAGE_KEY_PREFIX + p))
  if (error) throw new Error(`could not read image credit outages: ${error.message}`)
  const open = new Map<CreditProvider, OutageRecord>()
  for (const row of data || []) {
    const provider = String(row.key).slice(OUTAGE_KEY_PREFIX.length)
    if (isProvider(provider)) open.set(provider, row.value as OutageRecord)
  }
  return open
}

/**
 * Status 'blocked' + the reason. `onlyFrom` guards the write: a hold only
 * touches a row that is still 'queued', so a job another worker just claimed is
 * left to finish (and block itself, if it must).
 */
async function blockJob(
  deps: OutageDeps,
  job: { id: string; output?: any },
  provider: CreditProvider,
  detail: string,
  onlyFrom: string[],
  knownOutput?: any
): Promise<boolean> {
  let output = knownOutput
  if (output === undefined) {
    const { data } = await deps.db.from('ai_jobs').select('output').eq('id', job.id).maybeSingle()
    output = data?.output
  }
  const now = deps.now().toISOString()
  const { data, error } = await deps.db
    .from('ai_jobs')
    .update({
      status: BLOCKED_STATUS,
      error: BLOCKED_REASON,
      output: { ...(output || {}), blocked: { provider, since: now, detail: detail.slice(0, 300) } },
      updated_at: now,
    })
    .eq('id', job.id)
    .in('status', onlyFrom)
    .select('id')
  if (error) {
    console.error(`[credit-pause] could not block job ${job.id}:`, error.message)
    return false
  }
  return (data?.length ?? 0) > 0
}

async function holdQueuedJobs(deps: OutageDeps, dry: ReadonlySet<CreditProvider>): Promise<number> {
  const { data, error } = await deps.db
    .from('ai_jobs')
    .select('id, type, input, output')
    .eq('status', 'queued')
    .in('type', [...PAUSABLE_JOB_TYPES])
    .limit(500)
  if (error) throw new Error(`could not read queued jobs: ${error.message}`)
  let held = 0
  for (const job of data || []) {
    const provider = dryProviderFor(job, dry)
    if (!provider) continue
    if (await blockJob(deps, job, provider, 'held: queued while the provider is out of credit', ['queued'], job.output ?? null)) held++
  }
  return held
}

/**
 * Put back in the queue every blocked job whose provider has no open outage.
 * The outages are read AFTER the blocked rows: a job is only ever blocked once
 * its outage row exists (handleFailure inserts first), so a row seen here
 * always has its outage visible to the read that follows.
 */
async function releaseBlockedJobs(deps: OutageDeps): Promise<number> {
  const { data: rows, error } = await deps.db.from('ai_jobs').select('id, output').eq('status', BLOCKED_STATUS).limit(500)
  if (error) throw new Error(`could not read blocked jobs: ${error.message}`)
  if (!rows?.length) return 0
  const open = await readOpenOutages(deps)
  const now = deps.now().toISOString()
  let released = 0
  for (const row of rows) {
    const blocked = row.output?.blocked
    // A 'blocked' row this module did not write is not ours to release.
    if (!blocked || !isProvider(blocked.provider) || open.has(blocked.provider)) continue
    const { blocked: _done, ...rest } = row.output
    const { data, error: updateError } = await deps.db
      .from('ai_jobs')
      .update({
        status: 'queued',
        error: null,
        output: { ...rest, credit_hold: { provider: blocked.provider, blocked_at: blocked.since, released_at: now } },
        updated_at: now,
      })
      .eq('id', row.id)
      .eq('status', BLOCKED_STATUS)
      .select('id')
    if (updateError) console.error(`[credit-pause] could not release job ${row.id}:`, updateError.message)
    else if (data?.length) released++
  }
  if (released) console.log(`[credit-pause] ▶️ ${released} held image job(s) back in the queue`)
  return released
}

/** Deletes the outage row; true only for the one caller that actually removed it. */
async function closeOutage(deps: OutageDeps, provider: CreditProvider, record: OutageRecord, probe: CreditProbeResult): Promise<boolean> {
  const { data, error } = await deps.db
    .from('admin_settings')
    .delete()
    .eq('key', OUTAGE_KEY_PREFIX + provider)
    .select('key')
  if (error) {
    console.error(`[credit-pause] could not close the ${provider} outage:`, error.message)
    return false
  }
  if (!data?.length) return false
  const closedAt = deps.now().toISOString()
  // Kept so "what happened last time" is one row away after the live row is gone.
  await deps.db
    .from('admin_settings')
    .upsert({ key: LAST_OUTAGE_KEY_PREFIX + provider, value: { ...record, closed_at: closedAt, closed_by: probe }, updated_at: closedAt })
  console.log(`[credit-pause] ✅ ${CREDIT_PROVIDER_LABEL[provider]} credit is back (${probe.detail}) — resuming the image queue`)
  return true
}

export interface ImageCreditGate {
  /** Providers known to be out of credit as of the last tick (plus any this process hit since). */
  dryProviders(): Set<CreditProvider>
  /** The dry provider this job needs, or null when it can run now. */
  dryProviderFor(job: { type?: string; input?: any }): CreditProvider | null
  /** Once per worker loop: probe what is due, release what recovered, refresh the dry set. */
  tick(): Promise<Set<CreditProvider>>
  /** A queued job the worker will not start while its provider is dry. */
  hold(job: { id: string; type?: string; input?: any; output?: any }, provider: CreditProvider): Promise<boolean>
  /**
   * Called from a job's failure path. True = it was a credit error and the job
   * is now blocked (the caller must NOT mark it failed); false = an ordinary
   * failure, handle it exactly as before.
   */
  handleFailure(job: { id: string; type?: string; input?: any }, err: unknown): Promise<boolean>
}

export function createImageCreditGate(deps: OutageDeps): ImageCreditGate {
  const probeIntervalMs = deps.probeIntervalMs ?? PROBE_INTERVAL_MS
  let dry = new Set<CreditProvider>()
  let lastReleaseScan = 0

  async function probeDue(open: Map<CreditProvider, OutageRecord>): Promise<CreditProvider[]> {
    const closed: CreditProvider[] = []
    const nowMs = deps.now().getTime()
    for (const [provider, record] of open) {
      const last = Date.parse(record.last_probe_at || record.opened_at)
      if (Number.isFinite(last) && nowMs - last < probeIntervalMs) continue
      let result: CreditProbeResult
      try {
        result = await deps.probe(provider)
      } catch (err) {
        result = { outcome: 'inconclusive', detail: messageOf(err) }
      }
      if (result.outcome === 'ok') {
        if (await closeOutage(deps, provider, record, result)) closed.push(provider)
        continue
      }
      const at = deps.now().toISOString()
      await deps.db
        .from('admin_settings')
        .update({ value: { ...record, probes: (record.probes ?? 0) + 1, last_probe_at: at, last_probe: result }, updated_at: at })
        .eq('key', OUTAGE_KEY_PREFIX + provider)
      console.log(`[credit-pause] ⏸️ ${CREDIT_PROVIDER_LABEL[provider]} still paused (${result.outcome}: ${result.detail})`)
    }
    return closed
  }

  return {
    dryProviders: () => new Set(dry),

    dryProviderFor: (job) => dryProviderFor(job, dry),

    async tick() {
      const open = await readOpenOutages(deps)
      const closed = open.size ? await probeDue(open) : []
      for (const p of closed) open.delete(p)
      dry = new Set(open.keys())
      const nowMs = deps.now().getTime()
      if (closed.length || nowMs - lastReleaseScan >= RELEASE_SCAN_MS) {
        lastReleaseScan = nowMs
        await releaseBlockedJobs(deps)
      }
      return new Set(dry)
    },

    async hold(job, provider) {
      return blockJob(deps, job, provider, 'held: queued while the provider is out of credit', ['queued'], job.output)
    },

    async handleFailure(job, err) {
      const provider = creditProviderOf(err)
      if (!provider || !job?.id || !PAUSABLE_JOB_TYPES.has(String(job.type))) return false
      const detail = messageOf(err)
      const label = CREDIT_PROVIDER_LABEL[provider]
      dry.add(provider)

      // 1. Claim the outage FIRST. The primary key on admin_settings.key makes
      //    this the one-alert guarantee: exactly one insert succeeds per outage.
      const key = OUTAGE_KEY_PREFIX + provider
      const record: OutageRecord = {
        provider,
        opened_at: deps.now().toISOString(),
        detail,
        first_job_id: job.id,
        first_job_type: job.type ?? null,
        probes: 0,
      }
      let opened = false
      try {
        const { error } = await deps.db.from('admin_settings').insert({ key, value: record })
        if (!error) opened = true
        else if (error.code !== '23505') console.error(`[credit-pause] could not record the ${provider} outage:`, error.message)
      } catch (e) {
        console.error(`[credit-pause] could not record the ${provider} outage:`, messageOf(e))
      }

      // 2. This job: blocked, not failed. From any live state — the worker
      //    claimed it ('running'), an inline Step Flow render pre-claimed it,
      //    or it is a re-run that blocked again.
      const blocked = await blockJob(deps, job, provider, detail, ['running', 'queued', BLOCKED_STATUS])
      if (!blocked) return false

      // 3. Everything else waiting on the same provider.
      let held = 0
      try {
        held = await holdQueuedJobs(deps, new Set([provider]))
      } catch (e) {
        console.error('[credit-pause] could not hold the queued jobs:', messageOf(e))
      }

      console.warn(
        `[credit-pause] ⏸️ ${label} is out of credit — job ${job.id} (${job.type}) blocked, ${held} queued job(s) held` +
          (opened ? ', alerting the team' : ' (already paused, no new alert)')
      )

      // 4. The one alert, from the one caller that opened the outage.
      if (opened) {
        let alert: AlertResult
        try {
          alert = await deps.sendAlert({
            provider,
            detail,
            firstJobId: job.id,
            firstJobType: job.type ?? null,
            heldJobs: held,
            probeMinutes: Math.round(probeIntervalMs / 60_000),
          })
        } catch (e) {
          alert = { email: false, bell: false, becky: false, jessica: false, errors: [messageOf(e)] }
        }
        const at = deps.now().toISOString()
        await deps.db
          .from('admin_settings')
          .update({ value: { ...record, held_jobs: held, alert: { ...alert, sent_at: at } }, updated_at: at })
          .eq('key', key)
      }
      return true
    },
  }
}

// ---------------------------------------------------------------------------
// The alert itself
// ---------------------------------------------------------------------------

const BILLING_URL: Record<CreditProvider, string> = {
  replicate: 'https://replicate.com/account/billing',
  openai: 'https://platform.openai.com/settings/organization/billing',
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Every wording the alert uses, in one pure place so the test can read it. */
export function outageAlertCopy(a: OutageAlert) {
  const label = CREDIT_PROVIDER_LABEL[a.provider]
  const waiting = a.heldJobs + 1
  const jobs = `${waiting} image job${waiting === 1 ? '' : 's'}`
  const firstJob = a.firstJobId ? `${a.firstJobType ?? 'job'} ${a.firstJobId.slice(0, 8)}` : 'a job'
  return {
    subject: `Image queue paused: ${label} is out of credit`,
    bellTitle: `Image queue paused: ${label} is out of credit`,
    bellMessage:
      `${jobs} on hold, not failed. They restart by themselves within ${a.probeMinutes} minutes of credit being added. ` +
      `First hit: ${firstJob}.`,
    html:
      `<p><strong>The image queue is paused because ${label} is out of credit.</strong></p>` +
      `<p>${jobs} are on hold. None of them failed and nothing needs to be re-queued: the worker checks ${label} every ` +
      `${a.probeMinutes} minutes and puts every held job back in the queue the moment it accepts a call again.</p>` +
      `<p>To resume, add credit: <a href="${BILLING_URL[a.provider]}">${BILLING_URL[a.provider]}</a></p>` +
      `<p>First job to hit it: ${escapeHtml(firstJob)}<br>${label} said: <code>${escapeHtml(a.detail.slice(0, 300))}</code></p>` +
      `<p>This is the only alert for this outage. To see what is held: <code>select id, type, updated_at from ai_jobs where status = 'blocked'</code></p>`,
    /** Plain line for the phones: no links, no codes. */
    spoken:
      `The shop's image engine ran out of ${label} credit, so ${jobs} ${waiting === 1 ? 'is' : 'are'} on hold. ` +
      `Nothing is lost: they finish on their own once ${label} credit is added.`,
  }
}

type AlertFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>

/**
 * The live alert: admin bell, team email, Becky (Christina's phone, through the
 * same PRINT_BRIDGE_TOKEN bridge as the order and support pings) and Jessica
 * (David, through davidtrinidad.com's household notify, WATCHTOWER_INTERNAL_SECRET).
 * Each channel is tried once and reported; one channel failing never stops the
 * others, and nothing is retried (a retry is how one alert becomes two).
 */
export function makeOutageAlertSender(opts: {
  db: { from(table: string): any }
  sendEmail: (o: { to: string; subject: string; htmlContent: string }) => Promise<boolean>
  fetchImpl?: AlertFetch
  env?: Record<string, string | undefined>
}): (alert: OutageAlert) => Promise<AlertResult> {
  return async (alert) => {
    const env = opts.env ?? process.env
    const doFetch = opts.fetchImpl ?? (fetch as unknown as AlertFetch)
    const copy = outageAlertCopy(alert)
    const result: AlertResult = { email: false, bell: false, becky: false, jessica: false, errors: [] }
    const watchtower = (env.WATCHTOWER_URL || 'https://davidtrinidad.com').replace(/\/$/, '')

    try {
      const { error } = await opts.db.from('admin_notifications').insert({
        type: 'health_alert',
        title: copy.bellTitle,
        message: copy.bellMessage,
      })
      if (error) result.errors.push(`bell: ${error.message}`)
      else result.bell = true
    } catch (e) {
      result.errors.push(`bell: ${messageOf(e)}`)
    }

    try {
      result.email = await opts.sendEmail({
        to: env.ADMIN_ALERT_EMAIL || 'wecare@imaginethisprinted.com',
        subject: copy.subject,
        htmlContent: copy.html,
      })
      if (!result.email) result.errors.push('email: not sent')
    } catch (e) {
      result.errors.push(`email: ${messageOf(e)}`)
    }

    const bridgeToken = env.PRINT_BRIDGE_TOKEN
    if (!bridgeToken) result.errors.push('becky: PRINT_BRIDGE_TOKEN not set')
    else {
      try {
        const res = await doFetch(`${watchtower}/api/phone/ops-ping`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${bridgeToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'image_credit_outage', provider: alert.provider, title: copy.bellTitle, message: copy.spoken }),
          signal: AbortSignal.timeout(5000),
        })
        result.becky = res.ok
        if (!res.ok) result.errors.push(`becky: ${res.status}`)
      } catch (e) {
        result.errors.push(`becky: ${messageOf(e)}`)
      }
    }

    const secret = env.WATCHTOWER_INTERNAL_SECRET
    if (!secret) result.errors.push('jessica: WATCHTOWER_INTERNAL_SECRET not set')
    else {
      try {
        const res = await doFetch(`${watchtower}/api/notify/household`, {
          method: 'POST',
          headers: { 'x-internal-secret': secret, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: 'david', subject: copy.subject, body: copy.spoken, urgency: 'urgent', event: 'itp.image_credit_outage' }),
          signal: AbortSignal.timeout(5000),
        })
        result.jessica = res.ok
        if (!res.ok) result.errors.push(`jessica: ${res.status}`)
      } catch (e) {
        result.errors.push(`jessica: ${messageOf(e)}`)
      }
    }

    if (result.errors.length) console.warn('[credit-pause] alert channels that did not land:', result.errors.join('; '))
    return result
  }
}

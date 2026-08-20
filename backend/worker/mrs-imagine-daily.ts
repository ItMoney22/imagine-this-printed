// Mrs. Imagine's daily clock (David 2026-08-20: "she needs to do all the work
// e2e — im just gonna sign into etsy and change drafts to active").
//
// The admin card's Run button stays for manual runs, but nobody should have to
// press it: once a day, at MRS_IMAGINE_DAILY_HOUR_UTC, the worker starts a
// full batch by itself. The batch orchestrator runs in THIS process — that is
// fine by construction: it is all async I/O, and the mockup jobs it enqueues
// are drained by this same process's ai-jobs poll loop running independently.
//
// Guard rails:
//   - one batch per 20h window (keyed on ai_jobs rows of type
//     'mrs_imagine_batch', any status) — restarts can't double-run a day,
//   - a 'running' batch with a stale heartbeat (>20 min without an update,
//     i.e. killed by a deploy) is marked failed so it can't wedge the clock,
//   - MRS_IMAGINE_DAILY=false switches the whole clock off.

import { supabase } from '../lib/supabase.js'
import { startMrsImagineBatch } from '../services/mrs-imagine.js'

const CHECK_INTERVAL_MS = 10 * 60 * 1000
const RUN_WINDOW_HOURS = 20
const STALE_RUNNING_MS = 20 * 60 * 1000

function dailyEnabled(): boolean {
  return process.env.MRS_IMAGINE_DAILY !== 'false'
}

function targetHourUtc(): number {
  const h = Number(process.env.MRS_IMAGINE_DAILY_HOUR_UTC)
  // Default 11:00 UTC ≈ 6-7am ET — briefs land before the US shopping day.
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 11
}

async function tick(): Promise<void> {
  if (!dailyEnabled()) return
  if (new Date().getUTCHours() !== targetHourUtc()) return

  // Clear a batch that died mid-run (deploy/restart) so it can't wedge things.
  const { data: running } = await supabase
    .from('ai_jobs')
    .select('id, updated_at')
    .eq('type', 'mrs_imagine_batch')
    .eq('status', 'running')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (running) {
    const silentFor = Date.now() - new Date(running.updated_at).getTime()
    if (silentFor < STALE_RUNNING_MS) return // a live batch is already working
    await supabase
      .from('ai_jobs')
      .update({ status: 'failed', error: 'stale — no heartbeat for 20 min (process restarted?)', updated_at: new Date().toISOString() })
      .eq('id', running.id)
    console.log('[mrs-imagine-daily] cleared stale batch', running.id)
  }

  // One batch per 20h window, whatever its outcome — the day's run happened.
  const windowStart = new Date(Date.now() - RUN_WINDOW_HOURS * 3600 * 1000).toISOString()
  const { count } = await supabase
    .from('ai_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('type', 'mrs_imagine_batch')
    .gte('created_at', windowStart)
  if ((count ?? 0) > 0) return

  try {
    const { batchId } = await startMrsImagineBatch({ requestedBy: 'mrs-imagine-daily' })
    console.log('[mrs-imagine-daily] 🌅 daily batch started:', batchId)
  } catch (e: any) {
    console.error('[mrs-imagine-daily] failed to start daily batch:', e?.message)
  }
}

export function startMrsImagineDaily(): void {
  if (!dailyEnabled()) {
    console.log('[mrs-imagine-daily] disabled (MRS_IMAGINE_DAILY=false)')
    return
  }
  console.log(`[mrs-imagine-daily] armed — daily batch at ${String(targetHourUtc()).padStart(2, '0')}:00 UTC`)
  setInterval(() => {
    void tick().catch((e) => console.error('[mrs-imagine-daily] tick error:', e?.message))
  }, CHECK_INTERVAL_MS)
  // Also check shortly after boot so a deploy landing inside the target hour
  // doesn't skip that day's run.
  setTimeout(() => {
    void tick().catch((e) => console.error('[mrs-imagine-daily] boot tick error:', e?.message))
  }, 30_000)
}

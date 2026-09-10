// Mrs. Imagine's daily clock — now a SCOUT sweep, not a build.
//
// History, because the default flipped twice and the reason matters:
//   2026-08-20  David: "she needs to do all the work e2e — im just gonna sign
//               into etsy and change drafts to active." Clock ran her full
//               autonomous batch, default ON.
//   2026-09-02  David: "i dont want her creating designs on her own anymore
//               but i do like this new stepflow." Batch default flipped OFF.
//   2026-09-09  David: "mrs imagine is a scout she finds great designs that
//               are selling ... she drops a list of her top 10 everyday and i
//               just have to click on it it goes to step flow."
//
// So the clock is armed again, but it now runs something categorically
// different. The batch spent real money unattended — GPT Image renders,
// Replicate mockups, live Etsy drafts — which is why it had to be opt-in. The
// scout (services/mrs-imagine-scout.ts) reads the public Etsy API, proves what
// sold with buyer reviews, and writes ten ideas to a row. No images, no
// listings, no storefront writes. Nothing it does needs undoing, so it
// defaults ON and MRS_IMAGINE_SCOUT=false turns it off.
//
// THE BATCH IS NOT REACHABLE FROM HERE ANY MORE. This file no longer imports
// services/mrs-imagine.js at all — that is the structural guarantee that the
// clock cannot start an unattended build, rather than a flag someone could
// flip back by accident.
//
// Guard rails:
//   - one sweep per 20h window (keyed on ai_jobs rows of type
//     'mrs_imagine_scout', any status) — restarts can't double-run a day,
//   - a 'running' sweep with a stale heartbeat (>15 min, i.e. killed by a
//     deploy) is marked failed so it can't wedge the clock.

import { supabase } from '../lib/supabase.js'
import { runAndRecordScout, SCOUT_JOB_TYPE } from '../services/mrs-imagine-scout.js'

const CHECK_INTERVAL_MS = 10 * 60 * 1000
const RUN_WINDOW_HOURS = 20
const STALE_RUNNING_MS = 15 * 60 * 1000

/** On unless explicitly disabled with the exact string "false". */
function scoutEnabled(): boolean {
  return process.env.MRS_IMAGINE_SCOUT !== 'false'
}

export const SCOUT_OFF_MESSAGE =
  'Mrs. Imagine scout is OFF (MRS_IMAGINE_SCOUT=false) — no daily top 10 will be posted'

/** The autonomous batch this clock used to run. Kept as an exported constant
 *  so the reason is greppable from the flag someone may still have set on
 *  Render: MRS_IMAGINE_DAILY does nothing now. */
export const BATCH_RETIRED_MESSAGE =
  'MRS_IMAGINE_DAILY is retired (David 2026-09-09) — the daily clock runs the scout; nothing builds products unattended'

function targetHourUtc(): number {
  const h = Number(process.env.MRS_IMAGINE_SCOUT_HOUR_UTC ?? process.env.MRS_IMAGINE_DAILY_HOUR_UTC)
  // Default 11:00 UTC ≈ 6-7am ET — the list is waiting before David's day.
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : 11
}

async function tick(): Promise<void> {
  if (!scoutEnabled()) return
  if (new Date().getUTCHours() !== targetHourUtc()) return

  // Clear a sweep that died mid-run (deploy/restart) so it can't wedge things.
  const { data: running } = await supabase
    .from('ai_jobs')
    .select('id, updated_at')
    .eq('type', SCOUT_JOB_TYPE)
    .eq('status', 'running')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (running) {
    const silentFor = Date.now() - new Date(running.updated_at).getTime()
    if (silentFor < STALE_RUNNING_MS) return // a live sweep is already working
    await supabase
      .from('ai_jobs')
      .update({ status: 'failed', error: 'stale — no heartbeat for 15 min (process restarted?)', updated_at: new Date().toISOString() })
      .eq('id', running.id)
    console.log('[mrs-imagine-scout] cleared stale sweep', running.id)
  }

  // One sweep per 20h window, whatever its outcome — the day's run happened.
  const windowStart = new Date(Date.now() - RUN_WINDOW_HOURS * 3600 * 1000).toISOString()
  const { count } = await supabase
    .from('ai_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('type', SCOUT_JOB_TYPE)
    .gte('created_at', windowStart)
  if ((count ?? 0) > 0) return

  const run = await runAndRecordScout({ requestedBy: 'mrs-imagine-daily' })
  if (run.status === 'failed') {
    console.error('[mrs-imagine-scout] daily sweep failed:', run.error)
    return
  }
  console.log(`[mrs-imagine-scout] 🌅 daily sweep done — ${run.output?.picks.length ?? 0} picks from ${run.output?.proven ?? 0} proven sellers`)
}

export function startMrsImagineDaily(): void {
  if (!scoutEnabled()) {
    console.log(`[mrs-imagine-scout] ${SCOUT_OFF_MESSAGE}`)
    return
  }
  if (process.env.MRS_IMAGINE_DAILY === 'true') {
    console.log(`[mrs-imagine-scout] ${BATCH_RETIRED_MESSAGE}`)
  }
  console.log(`[mrs-imagine-scout] armed — daily scout sweep at ${String(targetHourUtc()).padStart(2, '0')}:00 UTC`)
  setInterval(() => {
    void tick().catch((e) => console.error('[mrs-imagine-scout] tick error:', e?.message))
  }, CHECK_INTERVAL_MS)
  // Also check shortly after boot so a deploy landing inside the target hour
  // doesn't skip that day's run.
  setTimeout(() => {
    void tick().catch((e) => console.error('[mrs-imagine-scout] boot tick error:', e?.message))
  }, 30_000)
}

// Worker liveness heartbeat.
//
// WHY THIS EXISTS. On Render a background worker simply runs. On Fly, machines
// are parked by the PROXY when the services they back go idle — and a worker
// backs no service at all, which is exactly the shape that gets parked by a
// config copied from a web app. When that happens nothing errors: the Etsy
// queue, AI jobs, delivery tracking, the step-flow sweep and the daily timers
// just stop, and the first symptom is a customer noticing days later.
//
// The existing signal is an hourly `worker_heartbeat` row in audit_logs, read
// by GET /api/health/worker. It is real, but hourly granularity means up to an
// hour of silence is indistinguishable from death, and it needs a database
// round trip to read. This adds a second, cheaper signal on top: one stdout
// line a minute, visible in `fly logs -a imagine-this-printed-worker`, costing
// no queries and no money.
//
// WHAT MAKES IT USEFUL IS `uptime`, NOT the line itself. A bare "worker alive"
// tick cannot distinguish a process that has been up for six hours from one
// that Fly parked and restarted four times — both print the same line. Uptime
// that walks forward monotonically is proof of continuous running; uptime that
// resets to ~0 is the signature of a parked-and-restarted machine, which is
// the specific failure fly.worker.toml is written to prevent.
//
// The per-job tick counters answer the other half: a process can be alive and
// still have a dead poll loop (an interval that threw its way out of
// existence, a claim query failing every time). Counters that stop climbing
// while uptime keeps climbing say "alive but not working" — a different bug
// with a different fix.

const startedAt = Date.now()
const ticks = new Map<string, number>()
let lastBeatAt = Date.now()

/**
 * Record one pass of a polling loop. Cheap by design — an in-memory counter,
 * no I/O — so it can sit inside a 5-second interval without costing anything.
 */
export function noteTick(job: string): void {
  ticks.set(job, (ticks.get(job) || 0) + 1)
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rem = s % 60
  return d > 0 ? `${d}d${h}h${m}m` : h > 0 ? `${h}h${m}m${rem}s` : `${m}m${rem}s`
}

export interface HeartbeatOptions {
  /** Seconds between beats. Default 60, overridable with WORKER_HEARTBEAT_SECONDS. */
  intervalSeconds?: number
}

/**
 * Starts the heartbeat log. Returns the interval handle so a test can stop it;
 * production never does.
 */
export function startHeartbeat(options: HeartbeatOptions = {}): NodeJS.Timeout {
  const seconds = options.intervalSeconds
    ?? Number(process.env.WORKER_HEARTBEAT_SECONDS || 60)
  const intervalMs = Math.max(5, seconds) * 1000

  // Machine/region/app come from Fly's own environment. Empty on Render and in
  // local dev, which is fine — the line is still useful, it just has less to
  // say about where it is running. FLY_MACHINE_ID in particular is how you
  // tell "the same machine has been up for three hours" from "three different
  // machines have each been up for an hour".
  const where = [
    process.env.FLY_APP_NAME && `app=${process.env.FLY_APP_NAME}`,
    process.env.FLY_MACHINE_ID && `machine=${process.env.FLY_MACHINE_ID}`,
    process.env.FLY_REGION && `region=${process.env.FLY_REGION}`,
  ].filter(Boolean).join(' ')

  console.log(`[worker] 💓 heartbeat every ${intervalMs / 1000}s${where ? ` — ${where}` : ''}`)

  const timer = setInterval(() => {
    const now = Date.now()
    const drift = now - lastBeatAt
    lastBeatAt = now

    const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024)
    const counts = [...ticks.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([job, n]) => `${job}=${n}`)
      .join(' ')

    console.log(
      `[worker] 💓 alive uptime=${formatUptime(now - startedAt)} rss=${rssMb}MB` +
      `${counts ? ` ticks: ${counts}` : ' ticks: none yet'}${where ? ` — ${where}` : ''}`
    )

    // A beat that lands far later than scheduled means the event loop was
    // blocked or the whole machine was suspended. Fly can suspend a machine
    // and resume it with the process's clock intact, in which case uptime
    // keeps climbing and would NOT expose the gap — this is the only line
    // that would. Two intervals of slack absorbs ordinary GC and I/O stalls.
    if (drift > intervalMs * 2) {
      console.warn(
        `[worker] ⚠️ heartbeat gap: ${Math.round(drift / 1000)}s since the last beat ` +
        `(expected ~${intervalMs / 1000}s). The event loop was blocked or this machine was suspended.`
      )
    }
  }, intervalMs)

  // Never let the heartbeat itself be the reason the process stays alive: if
  // every real loop died, the process should be allowed to exit and be
  // restarted by the platform rather than idle forever printing "alive".
  timer.unref()
  return timer
}

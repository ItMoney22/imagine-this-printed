/**
 * Print stations — the machines that physically own a printer.
 *
 * Workstations here are named after planets. Pluto is the packing table: an
 * Omarchy box on the tailnet with a 4x6 thermal printer on USB. When a label is
 * bought, the order is stamped with a print job for a station, and that
 * station's agent picks it up and prints it. Nobody at the table touches a
 * print dialog.
 *
 * The agent PULLS. It polls this API over the public internet with a shared
 * bearer token; the API never reaches into the tailnet. That matters because
 * the API runs on Render, which is not on the tailnet and should not have to
 * be — Tailscale is how David reaches Pluto, not how Pluto gets its work. A
 * pull loop also survives the station being asleep, rebooted or unplugged: the
 * job simply waits.
 *
 * The queue lives in `orders.metadata.print_station`, not a new table. That is
 * the same call routes/print-bridge.ts made for the 3D print factory, for the
 * same reason: it ships without a migration, and a print job is a fact about an
 * order rather than an entity with a life of its own. If stations ever print
 * things that are not orders — packing slips, pick lists — that is the moment
 * to promote this to a real table.
 */

export type PrintJobStatus = 'queued' | 'printing' | 'printed' | 'failed'

export interface PrintJobState {
  station: string
  status: PrintJobStatus
  kind: 'shipping_label'
  copies: number
  queued_at: string
  claimed_at?: string | null
  printed_at?: string | null
  attempts?: number
  error?: string | null
  /** Set when an admin gave up and printed it from the browser instead. */
  cancelled_at?: string | null
}

/** The station a job goes to unless the caller names another one. */
export function defaultStation(): string {
  return (process.env.PRINT_STATION_DEFAULT || 'pluto').trim().toLowerCase()
}

/**
 * Whether any station agent can exist at all.
 *
 * With no token there is nothing to authenticate, so queueing a job would
 * strand it — the station screen falls back to printing through the browser
 * instead, which is how it worked before any of this existed.
 */
export function stationEnabled(): boolean {
  return Boolean((process.env.PRINT_STATION_TOKEN || '').trim())
}

export function stationTokenMatches(authorizationHeader: string | undefined): boolean {
  const token = (process.env.PRINT_STATION_TOKEN || '').trim()
  if (!token) return false
  return (authorizationHeader || '') === `Bearer ${token}`
}

/** A freshly queued job, ready to be written onto the order. */
export function newPrintJob(station: string, copies = 1): PrintJobState {
  return {
    station: station.trim().toLowerCase(),
    status: 'queued',
    kind: 'shipping_label',
    copies: Math.max(1, Math.min(5, Math.floor(copies) || 1)),
    queued_at: new Date().toISOString(),
    claimed_at: null,
    printed_at: null,
    attempts: 0,
    error: null
  }
}

/**
 * Liveness, kept in memory on purpose.
 *
 * "Is Pluto plugged in right now" is a question about the last thirty seconds,
 * not a fact worth a row and a write on every poll. A process restart forgets
 * it and the next heartbeat — one poll interval later — restores it, which is
 * the right failure mode for a status dot.
 */
interface Heartbeat {
  lastSeenAt: string
  printer?: string | null
  agentVersion?: string | null
  note?: string | null
}

const heartbeats = new Map<string, Heartbeat>()

/** How long after its last poll a station is still considered online. */
const ONLINE_WINDOW_MS = 90_000

export function recordHeartbeat(station: string, info: Omit<Heartbeat, 'lastSeenAt'> = {}): void {
  heartbeats.set(station.trim().toLowerCase(), {
    lastSeenAt: new Date().toISOString(),
    printer: info.printer ?? null,
    agentVersion: info.agentVersion ?? null,
    note: info.note ?? null
  })
}

export function stationStatus(station: string): {
  station: string
  online: boolean
  lastSeenAt: string | null
  printer: string | null
  agentVersion: string | null
} {
  const slug = station.trim().toLowerCase()
  const beat = heartbeats.get(slug)
  const online = Boolean(beat && Date.now() - new Date(beat.lastSeenAt).getTime() < ONLINE_WINDOW_MS)
  return {
    station: slug,
    online,
    lastSeenAt: beat?.lastSeenAt ?? null,
    printer: beat?.printer ?? null,
    agentVersion: beat?.agentVersion ?? null
  }
}

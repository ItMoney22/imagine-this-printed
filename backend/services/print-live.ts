import { supabase } from '../lib/supabase.js'

/**
 * Live printer cam, ITP side (Watchtower task 528180f9).
 *
 * Watchtower can reach ITP but not the reverse, so it pushes each printing order
 * line's live view here about every 45 s. We keep the newest one per line in
 * order_print_live and hand it only to the order's signed-in owner.
 *
 * The push stops the moment a print ends or the engine goes down, so nothing
 * stored can be trusted as current: customerLiveView re-judges freshness and link
 * expiry at read time instead of repeating what the last push said.
 */

/** Same limit as Watchtower's FRAME_STALE_MS: past this a frame reads "Last update". */
export const LIVE_FRAME_STALE_MS = 150_000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATES = ['printing', 'waiting', 'done', 'stopped'] as const
const MAX_TEXT = 300
const MAX_LINE_ID = 200

export type PrintLiveState = (typeof STATES)[number]

export interface PrintLive {
  state: PrintLiveState
  printerName: string | null
  headline: string
  layer: number | null
  totalLayers: number | null
  progress: number | null
  minutesLeftLabel: string | null
  frameUrl: string | null
  frameAt: string | null
  frameStale: boolean
  timelapseUrl: string | null
  liveOptIn: boolean
}

export interface PrintLivePush {
  orderId: string
  lineItemId: string
  live: PrintLive
  sentAt: string | null
}

export interface PrintLiveRow {
  line_item_id: string
  live: PrintLive
  updated_at: string
}

/** Only what the order page shows: no printer name, no opt-in. */
export interface CustomerLiveView {
  lineItemId: string
  state: PrintLiveState
  headline: string
  progress: number | null
  frameUrl: string | null
  frameAt: string | null
  isLive: boolean
  timelapseUrl: string | null
}

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : ''
  return s || null
}

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

const isoDate = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const ms = Date.parse(v)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

// These land in an <img src> and an <a href> on a customer page, so nothing but
// https gets stored, whatever the sender says.
const httpsUrl = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  try {
    return new URL(v).protocol === 'https:' ? v : null
  } catch {
    return null
  }
}

export function parseLivePush(body: unknown): { push: PrintLivePush } | { error: string } {
  const b = (body ?? {}) as Record<string, any>
  if (typeof b.itpOrderId !== 'string' || !UUID_RE.test(b.itpOrderId)) return { error: 'itpOrderId must be an order id' }

  // A custom print has no lineItemId at all (see /queue), so absent is valid.
  const lineItemId = b.lineItemId === undefined || b.lineItemId === null ? '' : b.lineItemId
  if (typeof lineItemId !== 'string' || lineItemId.length > MAX_LINE_ID) return { error: 'lineItemId must be a short string' }

  const l = b.live
  if (!l || typeof l !== 'object' || Array.isArray(l)) return { error: 'live is required' }
  if (!STATES.includes(l.state)) return { error: `live.state must be one of ${STATES.join(', ')}` }
  const headline = text(l.headline)
  if (!headline) return { error: 'live.headline is required' }

  const progress = count(l.progress)
  return {
    push: {
      orderId: b.itpOrderId,
      lineItemId: lineItemId.trim(),
      sentAt: isoDate(b.sentAt),
      live: {
        state: l.state,
        printerName: text(l.printerName),
        headline,
        layer: count(l.layer),
        totalLayers: count(l.totalLayers),
        progress: progress === null ? null : Math.min(progress, 100),
        minutesLeftLabel: text(l.minutesLeftLabel),
        frameUrl: httpsUrl(l.frameUrl),
        frameAt: isoDate(l.frameAt),
        frameStale: l.frameStale === true,
        timelapseUrl: httpsUrl(l.timelapseUrl),
        liveOptIn: l.liveOptIn === true,
      },
    },
  }
}

/** Newest view wins. False when the order does not exist. Throws on anything else. */
export async function saveLiveView(push: PrintLivePush): Promise<boolean> {
  const { error } = await supabase.from('order_print_live').upsert(
    {
      order_id: push.orderId,
      line_item_id: push.lineItemId,
      live: push.live,
      sent_at: push.sentAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'order_id,line_item_id' },
  )
  if (!error) return true
  if (error.code === '23503') return false
  throw new Error(error.message)
}

export async function readLiveRows(orderId: string): Promise<PrintLiveRow[]> {
  const { data, error } = await supabase
    .from('order_print_live')
    .select('line_item_id, live, updated_at')
    .eq('order_id', orderId)
    .order('line_item_id', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as PrintLiveRow[]
}

/**
 * True once a signed link can no longer open. Frame links last 15 minutes and
 * timelapse links 6 hours, and a finished print gets no more pushes, so a stored
 * link dies quietly. A link with no signature dates is left alone.
 */
export function signedLinkExpired(url: string, now: number): boolean {
  let params: URLSearchParams
  try {
    params = new URL(url).searchParams
  } catch {
    return true
  }
  const signed = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(params.get('X-Amz-Date') ?? '')
  const seconds = Number(params.get('X-Amz-Expires'))
  if (!signed || !Number.isFinite(seconds) || seconds <= 0) return false
  const [, y, mo, d, h, mi, s] = signed.map(Number)
  return now >= Date.UTC(y, mo - 1, d, h, mi, s) + seconds * 1000
}

export function customerLiveView(row: PrintLiveRow, now: number): CustomerLiveView {
  const { live } = row
  const openable = (url: string | null) => (url && !signedLinkExpired(url, now) ? url : null)
  const frameUrl = openable(live.frameUrl)
  const frameMs = live.frameAt ? Date.parse(live.frameAt) : NaN
  const fresh = !live.frameStale && Number.isFinite(frameMs) && now - frameMs <= LIVE_FRAME_STALE_MS

  return {
    lineItemId: row.line_item_id,
    state: live.state,
    headline: live.headline,
    progress: live.progress,
    frameUrl,
    frameAt: live.frameAt,
    isLive: live.state === 'printing' && !!frameUrl && fresh,
    timelapseUrl: openable(live.timelapseUrl),
  }
}

/** The stamp both checkout paths put on the order. Absent means this call said nothing, so keep what is there. */
export function liveOptInStamp(value: unknown): { live_opt_in?: boolean } {
  return typeof value === 'boolean' ? { live_opt_in: value } : {}
}

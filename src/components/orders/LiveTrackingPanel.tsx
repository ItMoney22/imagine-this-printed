// Live carrier tracking for one order, inside the Manage Order modal.
//
// Before this, the tracking number was write-only: an admin pasted it, the
// customer got a link, and the only way to learn where the parcel actually was
// was to open UPS.com by hand. This panel asks the carrier (through
// GET /api/orders/:id/tracking → Shippo) and shows the real scan history.
//
// Opening the modal serves a cached read; "Check now" forces a fresh poll. If
// the carrier reports DELIVERED, that same call marks the order delivered and
// emails the customer their thank-you coupon — so this panel reports that back
// to the page, which is why onDelivered exists.
import React, { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'

export type ShipmentStatus =
  | 'pre_transit' | 'in_transit' | 'out_for_delivery'
  | 'delivered' | 'returned' | 'failure' | 'unknown'

export interface TrackingScan {
  status: ShipmentStatus
  detail: string
  date: string | null
  location: string | null
}

export interface LiveTrackingPayload {
  trackingNumber: string | null
  carrier: string | null
  trackingUrl: string | null
  status: ShipmentStatus | null
  statusLabel: string | null
  statusDetail: string | null
  statusAt: string | null
  location: string | null
  eta: string | null
  service?: string | null
  events: TrackingScan[]
  checkedAt: string | null
  error: string | null
}

interface TrackingResponse {
  tracking: LiveTrackingPayload | null
  cached?: boolean
  reason?: 'no_tracking' | 'no_token' | 'unsupported_carrier'
  message?: string
  deliveredNow?: boolean
  customerEmailed?: boolean
  couponCode?: string | null
  error?: string | null
}

const STATUS_STYLES: Record<ShipmentStatus, { chip: string; dot: string; label: string }> = {
  pre_transit: { chip: 'bg-slate-500/15 text-slate-600 dark:text-slate-300', dot: 'bg-slate-400', label: 'Label created' },
  in_transit: { chip: 'bg-blue-500/15 text-blue-600 dark:text-blue-300', dot: 'bg-blue-500', label: 'In transit' },
  out_for_delivery: { chip: 'bg-amber-500/15 text-amber-600 dark:text-amber-300', dot: 'bg-amber-500', label: 'Out for delivery' },
  delivered: { chip: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300', dot: 'bg-emerald-500', label: 'Delivered' },
  returned: { chip: 'bg-orange-500/15 text-orange-600 dark:text-orange-300', dot: 'bg-orange-500', label: 'Returned to sender' },
  failure: { chip: 'bg-red-500/15 text-red-600 dark:text-red-300', dot: 'bg-red-500', label: 'Delivery problem' },
  unknown: { chip: 'bg-slate-500/15 text-slate-600 dark:text-slate-300', dot: 'bg-slate-400', label: 'No scans yet' },
}

// How far along the journey each status is — the bar is the at-a-glance answer
// to "where is it", which is the whole reason David wanted this on screen.
const STATUS_PROGRESS: Record<ShipmentStatus, number> = {
  unknown: 8, pre_transit: 20, in_transit: 55, out_for_delivery: 85,
  delivered: 100, returned: 100, failure: 100,
}

const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null

const fmtDay = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : null

const ago = (iso?: string | null): string | null => {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff) || diff < 0) return 'just now'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

interface Props {
  /** orders.id (the uuid the API knows), not the display order number. */
  orderId: string
  trackingNumber?: string | null
  /** Called when this poll is what moved the order to delivered. */
  onDelivered?: (info: { emailed: boolean; couponCode: string | null }) => void
}

export const LiveTrackingPanel: React.FC<Props> = ({ orderId, trackingNumber, onDelivered }) => {
  const [data, setData] = useState<TrackingResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async (force: boolean) => {
    setLoading(true)
    setLoadError(null)
    try {
      const res: TrackingResponse = await apiFetch(`/api/orders/${orderId}/tracking${force ? '?refresh=1' : ''}`)
      setData(res)
      if (res.deliveredNow) {
        onDelivered?.({ emailed: !!res.customerEmailed, couponCode: res.couponCode || null })
      }
    } catch (err: any) {
      // Render and Vercel deploy independently: a frontend that knows about
      // this endpoint can reach an API that doesn't have it yet. Say so plainly
      // instead of showing a broken panel.
      const msg = String(err?.message || err)
      setLoadError(msg.includes('404') ? 'This API build has no live tracking yet — try again after the next deploy.' : msg)
    } finally {
      setLoading(false)
    }
  }, [orderId, onDelivered])

  useEffect(() => {
    if (trackingNumber) void load(false)
    else setData(null)
  }, [trackingNumber, load])

  if (!trackingNumber) return null

  const tracking = data?.tracking || null
  const status = (tracking?.status || null) as ShipmentStatus | null
  const style = status ? STATUS_STYLES[status] : STATUS_STYLES.unknown
  const unavailable = data?.reason === 'no_token' || data?.reason === 'unsupported_carrier'

  return (
    <div className="mt-3 rounded-xl border border-blue-500/20 bg-card/60 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${style.chip}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
            {tracking?.statusLabel || style.label}
          </span>
          {tracking?.carrier && (
            <span className="text-xs text-muted truncate">
              {tracking.carrier}{tracking.service ? ` · ${tracking.service}` : ''}
            </span>
          )}
        </div>
        <button
          onClick={() => void load(true)}
          disabled={loading}
          className="shrink-0 px-3 py-1.5 rounded-lg border border-blue-500/30 text-blue-600 dark:text-blue-300 text-xs font-semibold hover:bg-blue-500/10 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Checking…' : 'Check now'}
        </button>
      </div>

      {/* Progress, not a spinner: the bar doubles as the journey and as the
          "we're talking to the carrier" signal while a poll is in flight. */}
      <div className="h-1.5 rounded-full bg-bg overflow-hidden mb-3">
        <div
          className={`h-full transition-all duration-700 ${
            status === 'delivered' ? 'bg-emerald-500'
              : status === 'returned' || status === 'failure' ? 'bg-orange-500'
              : 'bg-gradient-to-r from-blue-500 to-indigo-500'
          } ${loading ? 'animate-pulse' : ''}`}
          style={{ width: `${status ? STATUS_PROGRESS[status] : 8}%` }}
        />
      </div>

      {loading && !tracking && (
        <p className="text-xs text-muted">Asking the carrier for the latest scan…</p>
      )}

      {loadError && <p className="text-xs text-red-500">{loadError}</p>}

      {unavailable && (
        <p className="text-xs text-muted">
          {data?.reason === 'no_token'
            ? 'Live tracking is off (no Shippo token on this environment) — the carrier link below still works.'
            : 'Could not tell which carrier this number belongs to, so there is no live status. Set the carrier above to fix it.'}
        </p>
      )}

      {tracking && !unavailable && (
        <>
          <p className="text-sm text-text">
            {tracking.statusDetail || 'The carrier has not scanned this parcel yet.'}
          </p>
          <p className="text-xs text-muted mt-1">
            {[
              tracking.location,
              tracking.statusAt ? fmtDateTime(tracking.statusAt) : null,
              tracking.eta ? `ETA ${fmtDay(tracking.eta)}` : null,
            ].filter(Boolean).join(' · ')}
          </p>

          {tracking.events.length > 1 && (
            <ol className="mt-3 space-y-2 border-l border-blue-500/20 pl-3">
              {tracking.events.slice(0, 6).map((scan, i) => (
                <li key={`${scan.date || i}-${i}`} className="relative">
                  <span className={`absolute -left-[17px] top-1.5 w-2 h-2 rounded-full ${STATUS_STYLES[scan.status]?.dot || 'bg-slate-400'}`} />
                  <p className="text-xs text-text leading-snug">{scan.detail || STATUS_STYLES[scan.status]?.label}</p>
                  <p className="text-[11px] text-muted">
                    {[scan.location, fmtDateTime(scan.date)].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ol>
          )}

          <div className="flex items-center justify-between gap-3 mt-3 pt-2 border-t border-blue-500/10">
            <p className="text-[11px] text-muted">
              {tracking.checkedAt
                ? `Checked ${ago(tracking.checkedAt)}${data?.cached ? ' (cached)' : ''}`
                : 'Not checked yet'}
              {tracking.error ? ` · last poll failed: ${tracking.error}` : ''}
            </p>
            {tracking.trackingUrl && (
              <a
                href={tracking.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-semibold text-blue-600 dark:text-blue-300 hover:underline whitespace-nowrap"
              >
                Open {tracking.carrier || 'carrier'} page ↗
              </a>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default LiveTrackingPanel

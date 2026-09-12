// Shipping Station — the screen that lives on the packing table next to the
// 4x6 thermal printer, not on an office desk.
//
// Order Management is a management screen: tabs, notes, refunds, a modal to
// confirm a label. That is the wrong shape for someone standing at a table with
// a box in one hand. This screen does one job — the next unshipped paid order,
// its address, its weight, one button that buys the label and throws it at the
// printer — and it does that job in as few movements as possible.
//
// Two things make the printing part work:
//   * The label is bought as PDF_4x6 (backend/routes/orders.ts), so the PDF's
//     page IS the label. A plain 'PDF' is a US-Letter sheet with the label in
//     one corner, which a thermal printer cannot crop.
//   * The bytes come back through our own origin
//     (GET /api/orders/:id/shipping-label/file), so the page can hold them as a
//     blob and call print() itself. A carrier's own URL is cross-origin and the
//     browser will not let a script touch it — that is the difference between
//     one keystroke and "new tab, scroll, hunt for the print button".
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { useToast } from '../hooks/useToast'
import { apiFetch, apiFetchBlob } from '../lib/api'
import ProgressBar from '../components/studio/ProgressBar'

interface StationOrderItem {
  id: string
  product_name: string
  quantity: number
  unit_price: number
  metadata?: {
    size?: string | null
    color?: string | null
    print_location?: string | null
    image_url?: string | null
  } | null
}

interface StationOrder {
  id: string
  order_number: string | null
  customer_name: string | null
  customer_email: string | null
  status: string
  payment_status: string | null
  total: number
  created_at: string
  tracking_number: string | null
  tracking_company: string | null
  shipping_label_url: string | null
  shipping_address: Record<string, any> | null
  order_items?: StationOrderItem[]
  metadata?: Record<string, any> | null
}

/** The address in the one shape the label needs, from any checkout generation. */
function readAddress(order: StationOrder) {
  const a = order.shipping_address || {}
  const name = order.customer_name
    || a.name
    || [a.firstName, a.lastName].filter(Boolean).join(' ').trim()
    || 'Customer'
  return {
    name,
    street1: a.street1 || a.address1 || a.address || a.line1 || '',
    street2: a.street2 || a.address2 || a.line2 || '',
    city: a.city || '',
    state: a.state || a.province || '',
    zip: a.zip || a.zipCode || a.postal_code || a.postalCode || '',
    country: a.country || 'US'
  }
}

function addressIsComplete(order: StationOrder): boolean {
  const a = readAddress(order)
  return Boolean(a.street1 && a.city && a.state && a.zip)
}

/** Same default the backend and the checkout quote use: 0.5 lb per unit. */
function defaultWeightLb(order: StationOrder): number {
  const lines = order.order_items && order.order_items.length > 0
    ? order.order_items
    : (Array.isArray(order.metadata?.items) ? order.metadata!.items : [])
  const total = (lines as any[]).reduce((sum, line) => sum + (Number(line?.quantity) || 1) * 0.5, 0)
  return Math.max(0.5, Math.round(total * 100) / 100)
}

function money(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? '$' + n.toFixed(2) : '—'
}

function sinceOrdered(iso: string): string {
  const hours = (Date.now() - new Date(iso).getTime()) / 36e5
  if (hours < 1) return 'just now'
  if (hours < 24) return Math.floor(hours) + 'h ago'
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : days + ' days ago'
}

function errorText(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  const stripped = raw.replace(/^HTTP \d+:\s*/, '').trim()
  if (!stripped) return fallback
  try {
    const parsed = JSON.parse(stripped)
    return parsed?.error || parsed?.message || fallback
  } catch {
    return stripped.slice(0, 220)
  }
}

type BuyStage = 'idle' | 'rates' | 'buying' | 'printing' | 'done' | 'failed'

const STAGE_LABEL: Record<BuyStage, string> = {
  idle: '',
  rates: 'Getting live USPS and UPS rates for this address…',
  buying: 'Buying the cheapest label…',
  printing: 'Sending the 4×6 to the printer…',
  done: 'Label printed',
  failed: 'Label failed'
}

export default function ShippingStation() {
  const { user } = useAuth()
  const toast = useToast()

  const [orders, setOrders] = useState<StationOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [weightInput, setWeightInput] = useState<string>('')

  const [stage, setStage] = useState<BuyStage>('idle')
  const [stageStartedAt, setStageStartedAt] = useState<number>(0)
  const [stageError, setStageError] = useState<string | null>(null)
  const [lastLabelUrl, setLastLabelUrl] = useState<string | null>(null)

  const printFrameRef = useRef<HTMLIFrameElement | null>(null)
  const blobUrlRef = useRef<string | null>(null)

  const canBuy = user?.role === 'admin' || user?.role === 'manager'

  useEffect(() => {
    void loadOrders()
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
    }
  }, [])

  const loadOrders = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const result = await apiFetch('/api/orders?limit=200')
      setOrders((result?.orders || []) as StationOrder[])
    } catch (err) {
      setLoadError(errorText(err, 'Could not load orders.'))
    } finally {
      setLoading(false)
    }
  }

  // The queue is strictly PAID work with no label yet. Payment status is the
  // gate, not order status: unpaid checkout drafts used to surface as things to
  // ship, and a box nearly went out for an order Stripe never charged.
  const queue = useMemo(() => {
    return orders
      .filter(o => (o.payment_status || '').toLowerCase() === 'paid')
      .filter(o => !['cancelled', 'canceled', 'refunded'].includes((o.status || '').toLowerCase()))
      .filter(o => !o.tracking_number && !o.shipping_label_url)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  }, [orders])

  const labelled = useMemo(() => {
    return orders
      .filter(o => o.shipping_label_url || o.metadata?.shipping_label?.label_url)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 12)
  }, [orders])

  const selected = useMemo(
    () => orders.find(o => o.id === selectedId) || null,
    [orders, selectedId]
  )

  // Land on the oldest waiting order so the station opens ready to work.
  useEffect(() => {
    if (!selectedId && queue.length > 0) setSelectedId(queue[0].id)
  }, [queue, selectedId])

  useEffect(() => {
    if (selected) setWeightInput(String(defaultWeightLb(selected)))
    setStage('idle')
    setStageError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  /**
   * Pull the label through our own origin and open the print dialog on it.
   * Returns the blob URL so the caller can offer a manual fallback if the
   * browser refuses to script the print (some PDF viewers do).
   */
  const printLabel = async (orderId: string): Promise<string> => {
    const blob = await apiFetchBlob('/api/orders/' + orderId + '/shipping-label/file')
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
    const url = URL.createObjectURL(blob)
    blobUrlRef.current = url
    setLastLabelUrl(url)

    const frame = printFrameRef.current
    if (!frame) return url

    await new Promise<void>(resolve => {
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        resolve()
      }
      frame.onload = done
      frame.src = url
      // Never hang the station on a frame that refuses to fire onload.
      window.setTimeout(done, 4000)
    })

    try {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
    } catch {
      // Print blocked — the "Open the label" button is the way out.
    }
    return url
  }

  const buyAndPrint = async (order: StationOrder) => {
    if (!canBuy) return
    if (!addressIsComplete(order)) {
      toast.error('Address incomplete', 'This order is missing a street, city, state or ZIP — fix it in Order Management first.')
      return
    }

    const weight = Number(weightInput)
    if (!Number.isFinite(weight) || weight <= 0) {
      toast.error('Check the weight', 'Enter the parcel weight in pounds before buying.')
      return
    }

    setStageError(null)
    setStageStartedAt(Date.now())
    setStage('rates')
    try {
      // One call does rates + purchase server-side; the stage flip is the
      // honest midpoint of that call, not an invented step.
      window.setTimeout(() => setStage(s => (s === 'rates' ? 'buying' : s)), 1800)

      const result = await apiFetch('/api/orders/' + order.id + '/shipping-label', {
        method: 'POST',
        body: JSON.stringify({ weightLb: weight })
      })

      if (result?.mock) {
        setStage('failed')
        setStageError('Shippo is not configured on the server (SHIPPO_API_TOKEN) — that was a demo label and nothing was bought.')
        toast.error('No carrier configured', 'The server returned a demo label. Set SHIPPO_API_TOKEN on the API service.')
        return
      }

      const label = result?.label || {}
      toast.success(
        'Label bought',
        [label.carrier || 'Carrier', label.service, money(label.cost), label.trackingNumber]
          .filter(Boolean).join(' · ')
      )

      setStage('printing')
      await printLabel(order.id)
      setStage('done')

      // Refresh so the order leaves the queue and joins the reprint list.
      await loadOrders()
    } catch (err) {
      setStage('failed')
      const message = errorText(err, 'The label could not be purchased.')
      setStageError(message)
      toast.error('Label failed', message)
    }
  }

  const reprint = async (order: StationOrder) => {
    setStageError(null)
    setStageStartedAt(Date.now())
    setStage('printing')
    try {
      await printLabel(order.id)
      setStage('done')
    } catch (err) {
      setStage('failed')
      const message = errorText(err, 'Could not fetch that label to reprint.')
      setStageError(message)
      toast.error('Reprint failed', message)
    }
  }

  const busy = stage === 'rates' || stage === 'buying' || stage === 'printing'
  const address = selected ? readAddress(selected) : null

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* Hidden frame holds the label PDF so the page can print it directly. */}
      <iframe ref={printFrameRef} title="label-print-frame" className="hidden" aria-hidden="true" />

      <header className="border-b border-white/10 bg-card/70 backdrop-blur sticky top-0 z-20">
        <div className="px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-4">
            <h1 className="font-display text-2xl font-bold tracking-tight">Shipping Station</h1>
            <span className="text-sm text-muted">
              {loading ? 'loading…' : queue.length + ' paid ' + (queue.length === 1 ? 'order' : 'orders') + ' waiting'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden md:inline text-xs text-muted">4×6 thermal · prints straight from this screen</span>
            <button
              onClick={() => void loadOrders()}
              disabled={loading || busy}
              className="px-4 py-2 rounded-lg border border-white/10 bg-card hover:border-primary/50 text-sm font-medium disabled:opacity-40"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      {loadError && (
        <div className="mx-6 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {loadError}
        </div>
      )}

      {!canBuy && (
        <div className="mx-6 mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
          Buying labels is limited to admin and manager accounts. You can see the queue, but the button is off.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 p-6">
        {/* Queue */}
        <aside className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">Waiting to ship</h2>

          {!loading && queue.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-card p-6 text-center">
              <p className="text-lg font-semibold">Nothing waiting</p>
              <p className="text-sm text-muted mt-1">Every paid order has a label.</p>
            </div>
          )}

          <div className="space-y-2 max-h-[calc(100vh-16rem)] overflow-y-auto pr-1">
            {queue.map(order => {
              const queueAddress = readAddress(order)
              const active = order.id === selectedId
              return (
                <button
                  key={order.id}
                  onClick={() => setSelectedId(order.id)}
                  disabled={busy}
                  className={'w-full text-left rounded-xl border p-4 transition-colors disabled:opacity-50 ' + (
                    active
                      ? 'border-primary bg-primary/10 shadow-glowSm'
                      : 'border-white/10 bg-card hover:border-primary/40'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{order.order_number || order.id.slice(0, 8).toUpperCase()}</span>
                    <span className="text-xs text-muted">{sinceOrdered(order.created_at)}</span>
                  </div>
                  <p className="text-sm mt-1 truncate">{queueAddress.name}</p>
                  <p className="text-xs text-muted truncate">
                    {queueAddress.city}{queueAddress.city && queueAddress.state ? ', ' : ''}{queueAddress.state} · {money(order.total)}
                  </p>
                  {!addressIsComplete(order) && (
                    <p className="text-xs text-red-400 mt-1">Address incomplete</p>
                  )}
                </button>
              )
            })}
          </div>
        </aside>

        {/* Detail + action */}
        <main className="space-y-5">
          {!selected && !loading && (
            <div className="rounded-xl border border-white/10 bg-card p-10 text-center text-muted">
              Pick an order from the queue.
            </div>
          )}

          {selected && address && (
            <>
              <section className="rounded-xl border border-white/10 bg-card p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-muted">Ship to</p>
                    <p className="text-2xl font-semibold mt-1">{address.name}</p>
                    <address className="not-italic text-lg leading-snug mt-2">
                      {address.street1}<br />
                      {address.street2 && <>{address.street2}<br /></>}
                      {address.city}, {address.state} {address.zip}
                    </address>
                    {selected.customer_email && (
                      <p className="text-sm text-muted mt-2">{selected.customer_email}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-widest text-muted">Order</p>
                    <p className="text-xl font-semibold mt-1">
                      {selected.order_number || selected.id.slice(0, 8).toUpperCase()}
                    </p>
                    <p className="text-sm text-muted mt-1">{money(selected.total)} · {sinceOrdered(selected.created_at)}</p>
                    {selected.metadata?.shipping?.method && (
                      <p className="text-sm text-muted mt-1">
                        Paid {money(Number(selected.metadata.shipping.amount))} for {selected.metadata.shipping.method}
                      </p>
                    )}
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-white/10 bg-card p-6">
                <p className="text-xs uppercase tracking-widest text-muted mb-3">In the box</p>
                <ul className="divide-y divide-white/5">
                  {(selected.order_items || []).map(item => (
                    <li key={item.id} className="py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{item.product_name}</p>
                        <p className="text-sm text-muted">
                          {[item.metadata?.size, item.metadata?.color, item.metadata?.print_location]
                            .filter(Boolean).join(' · ') || 'no options'}
                        </p>
                      </div>
                      <span className="text-xl font-semibold tabular-nums shrink-0">×{item.quantity}</span>
                    </li>
                  ))}
                  {(selected.order_items || []).length === 0 && (
                    <li className="py-3 text-sm text-muted">No line items recorded on this order.</li>
                  )}
                </ul>
              </section>

              <section className="rounded-xl border border-white/10 bg-card p-6">
                <div className="flex flex-wrap items-end gap-6">
                  <label className="block">
                    <span className="text-xs uppercase tracking-widest text-muted">Parcel weight (lb)</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={weightInput}
                      onChange={e => setWeightInput(e.target.value)}
                      disabled={busy}
                      className="mt-2 w-40 rounded-lg bg-bg border border-white/15 px-4 py-3 text-2xl tabular-nums focus:border-primary focus:outline-none disabled:opacity-50"
                    />
                    <span className="block text-xs text-muted mt-1">Weigh the box; default is ½ lb per item.</span>
                  </label>

                  <button
                    onClick={() => void buyAndPrint(selected)}
                    disabled={!canBuy || busy || !addressIsComplete(selected)}
                    className="flex-1 min-w-[16rem] rounded-xl bg-gradient-to-r from-primary to-secondary px-8 py-5 text-xl font-bold text-white shadow-glow disabled:opacity-40 disabled:shadow-none transition-transform active:scale-[0.99]"
                  >
                    {busy ? 'Working…' : 'Buy label & print'}
                  </button>
                </div>

                {busy && (
                  <div className="mt-5">
                    <ProgressBar
                      label={STAGE_LABEL[stage]}
                      startedAt={stageStartedAt}
                      expectedMs={9000}
                      size="lg"
                    />
                  </div>
                )}

                {stage === 'failed' && stageError && (
                  <div className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                    {stageError}
                  </div>
                )}

                {stage === 'done' && (
                  <div className="mt-5 flex flex-wrap items-center gap-4 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3">
                    <span className="text-sm text-green-300 font-medium">
                      Label printed, and the customer has been emailed the tracking.
                    </span>
                    {lastLabelUrl && (
                      <button
                        onClick={() => window.open(lastLabelUrl, '_blank')}
                        className="text-sm underline text-green-200 hover:text-white"
                      >
                        Nothing came out? Open the label
                      </button>
                    )}
                  </div>
                )}
              </section>
            </>
          )}

          {/* Reprint — the label lives on the order, so a jam or a bad roll is
              not a second purchase. */}
          {labelled.length > 0 && (
            <section className="rounded-xl border border-white/10 bg-card p-6">
              <p className="text-xs uppercase tracking-widest text-muted mb-3">Already labelled — reprint</p>
              <ul className="divide-y divide-white/5">
                {labelled.map(order => (
                  <li key={order.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {order.order_number || order.id.slice(0, 8).toUpperCase()} · {readAddress(order).name}
                      </p>
                      <p className="text-sm text-muted truncate">
                        {[order.tracking_company || 'Carrier', order.tracking_number].filter(Boolean).join(' ')}
                      </p>
                    </div>
                    <button
                      onClick={() => void reprint(order)}
                      disabled={busy}
                      className="shrink-0 rounded-lg border border-white/10 bg-bg px-4 py-2 text-sm font-medium hover:border-primary/50 disabled:opacity-40"
                    >
                      Reprint
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}

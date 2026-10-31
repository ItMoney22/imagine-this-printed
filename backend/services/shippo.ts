// The one Shippo client (SHIPPO_API_TOKEN, server-only). Every ITP path that rates a parcel or buys a label goes
// through here: the main checkout's quote (routes/shipping.ts), an admin's order label (routes/orders.ts) and a store
// seller's own label (routes/vendor-store.ts), so a quote and the label it pays for follow the same rules. A refunded
// order hands its unscanned labels back through here too (services/order-refunds.ts).

export const SHIPPO_BASE_URL = 'https://api.goshippo.com'

// Hidden handling markup applied on top of every carrier rate (kept per product decision 2026-06-15): ITP's cut of
// shipping. The buyer pays the marked-up rate; the label costs the carrier's rate.
export const SHIPPING_MARKUP = 0.05

export type ShippoAddress = {
  name: string
  company?: string
  street1: string
  street2?: string
  city: string
  state: string
  zip: string
  country: string
  phone?: string
  email?: string
}

/** One carrier service for one parcel, as ITP quotes it. */
export type QuotedRate = {
  /** Shippo's rate object_id, or a fixed id for an estimate. */
  id: string
  provider: string
  /** Shippo's servicelevel token (usps_ground_advantage, ups_ground...): the same service across two shipments. */
  service: string
  name: string
  /** What the buyer pays: the carrier's rate plus ITP's cut, in cents. */
  chargeCents: number
  currency: string
  estimatedDays: number
}

const round2 = (n: number) => Math.round(n * 100) / 100
export const withMarkup = (base: number) => round2(base * (1 + SHIPPING_MARKUP))
/** What the carrier charges for a label the buyer paid chargeCents for: the charge without ITP's cut. */
export const labelCentsOf = (chargeCents: number) => Math.round(chargeCents / (1 + SHIPPING_MARKUP))

/** USPS Ground Advantage / Priority / Express and UPS Ground / 2nd Day / Next Day: the carriers buyers expect. */
export function isQuotableRate(rate: any): boolean {
  const svc = rate?.servicelevel?.token?.toLowerCase() || ''
  const provider = rate?.provider?.toLowerCase() || ''
  return (provider === 'usps' && (svc.includes('priority') || svc.includes('express') || svc.includes('ground'))) ||
         (provider === 'ups' && (svc.includes('ground') || svc.includes('2nd') || svc.includes('next') || svc.includes('saver')))
}

/** One box per order, sized for folded apparel: weight is what moves the rate. */
export function parcelOf(weightLb: number) {
  return { length: '10', width: '8', height: '4', distance_unit: 'in', weight: Math.max(0.1, weightLb).toFixed(2), mass_unit: 'lb' }
}

const shippoToken = () => process.env.SHIPPO_API_TOKEN || ''
export const shippoConfigured = () => !!shippoToken()

const shippoFetch = (path: string, body: unknown) =>
  fetch(`${SHIPPO_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Authorization': `ShippoToken ${shippoToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

/** Creates a shipment and returns every rate Shippo offers for it (unfiltered). */
export async function createShipment(input: { addressFrom: ShippoAddress; addressTo: ShippoAddress; weightLb: number }):
  Promise<{ ok: true; rates: any[] } | { ok: false; status: number; detail: string }> {
  const res = await shippoFetch('/shipments/', {
    address_from: input.addressFrom,
    address_to: input.addressTo,
    parcels: [parcelOf(input.weightLb)],
    async: false
  })
  if (!res.ok) return { ok: false, status: res.status, detail: await res.text().catch(() => res.statusText) }
  const shipment = await res.json() as { rates?: any[] }
  return { ok: true, rates: shipment.rates || [] }
}

/** Buys the label for one rate: a real charge on ITP's Shippo account. */
export async function buyLabel(rateId: string, metadata?: string):
  Promise<{ ok: true; transaction: any } | { ok: false; status: number; error: string }> {
  const res = await shippoFetch('/transactions/', {
    rate: rateId,
    label_file_type: 'PDF',
    async: false,
    ...(metadata ? { metadata: metadata.slice(0, 100) } : {})
  })
  const transaction = await res.json().catch(() => ({})) as any
  if (!res.ok || transaction?.status !== 'SUCCESS' || !transaction?.label_url) {
    const messages = Array.isArray(transaction?.messages)
      ? transaction.messages.map((m: any) => m?.text).filter(Boolean).join('; ')
      : ''
    return { ok: false, status: res.status, error: messages || `Shippo could not purchase the label (${res.status})` }
  }
  return { ok: true, transaction }
}

/**
 * A label's latest tracking status (Shippo's tracking_status on the transaction: UNKNOWN or PRE_TRANSIT until the
 * carrier scans the box, then TRANSIT / DELIVERED / RETURNED / FAILURE), or null when Shippo can't say. Free.
 */
export async function labelTrackingStatus(transactionId: string): Promise<string | null> {
  try {
    const res = await fetch(`${SHIPPO_BASE_URL}/transactions/${encodeURIComponent(transactionId)}`, {
      headers: { 'Authorization': `ShippoToken ${shippoToken()}` }
    })
    if (!res.ok) return null
    const transaction = await res.json().catch(() => null) as any
    return typeof transaction?.tracking_status === 'string' ? transaction.tracking_status.toUpperCase() : null
  } catch {
    return null
  }
}

/** Tracking statuses that mean the carrier has had the box: Shippo refuses the refund and the box is gone. */
export const SCANNED_TRACKING_STATUSES = new Set(['TRANSIT', 'DELIVERED', 'RETURNED', 'FAILURE'])

/**
 * Asks Shippo to refund an unused label (one per request). Shippo answers QUEUED / PENDING (waits up to 14 days on
 * the carrier's tracking) / SUCCESS / ERROR (the label was used); the money comes back as a credit on ITP's next
 * Shippo invoice and the label is void from the moment the refund is asked for.
 */
export async function refundLabel(transactionId: string):
  Promise<{ ok: true; refund: { id: string | null; status: string } } | { ok: false; status: number; error: string }> {
  try {
    const res = await shippoFetch('/refunds/', { transaction: transactionId, async: false })
    const refund = await res.json().catch(() => ({})) as any
    if (!res.ok || typeof refund?.status !== 'string') {
      const detail = typeof refund?.detail === 'string' ? refund.detail
        : Array.isArray(refund?.transaction) ? refund.transaction.join('; ')
        : Array.isArray(refund?.__all__) ? refund.__all__.join('; ')
        : ''
      return { ok: false, status: res.status, error: detail || `Shippo could not refund the label (${res.status})` }
    }
    return { ok: true, refund: { id: refund.object_id || null, status: refund.status.toUpperCase() } }
  } catch (err) {
    return { ok: false, status: 0, error: `Shippo refund request failed: ${(err as Error)?.message || String(err)}` }
  }
}

const toQuoted = (rate: any): QuotedRate => ({
  id: rate.object_id,
  provider: rate.provider,
  service: String(rate.servicelevel?.token || '').toLowerCase(),
  name: rate.servicelevel?.name || `${rate.provider} ${rate.servicelevel?.token || ''}`.trim(),
  chargeCents: Math.round(withMarkup(parseFloat(rate.amount)) * 100),
  currency: rate.currency || 'USD',
  estimatedDays: rate.estimated_days || 5
})

/**
 * Weight-aware USPS + UPS estimates, used when SHIPPO_API_TOKEN is not set or Shippo returns no usable rates. These
 * scale with parcel weight and only ever surface USPS/UPS so the customer sees the carriers they expect. Markup is
 * baked in via withMarkup(). The service tokens are Shippo's, so an estimate lines up with a live rate.
 */
export function estimateCarrierRates(weightLb: number): QuotedRate[] {
  const w = Math.max(0.1, weightLb)
  const est = (id: string, provider: string, service: string, name: string, base: number, estimatedDays: number): QuotedRate =>
    ({ id, provider, service, name, chargeCents: Math.round(withMarkup(base) * 100), currency: 'USD', estimatedDays })
  return [
    est('usps-ground-est', 'USPS', 'usps_ground_advantage', 'USPS Ground Advantage', 6.49 + 0.55 * w, 5),
    est('usps-priority-est', 'USPS', 'usps_priority', 'USPS Priority Mail', 9.49 + 0.85 * w, 3),
    est('ups-ground-est', 'UPS', 'ups_ground', 'UPS Ground', 11.49 + 0.65 * w, 5),
    est('ups-2day-est', 'UPS', 'ups_second_day_air', 'UPS 2nd Day Air', 19.99 + 1.2 * w, 2),
    est('ups-nextday-est', 'UPS', 'ups_next_day_air_saver', 'UPS Next Day Air Saver', 34.99 + 2.0 * w, 1)
  ]
}

/**
 * Live USPS + UPS rates for one parcel with ITP's cut on top, or the weight-aware estimates when Shippo is not set
 * up, has no destination, fails, or returns nothing usable. Rating is free; only buyLabel costs money.
 */
export async function quoteRates(input: { addressFrom: ShippoAddress; addressTo: ShippoAddress | null; weightLb: number }):
  Promise<{ rates: QuotedRate[]; source: 'shippo' | 'estimate' }> {
  if (!shippoConfigured()) {
    console.warn('[shipping] SHIPPO_API_TOKEN not set — serving weight-aware estimates')
  } else if (input.addressTo?.zip) {
    try {
      const shipment = await createShipment({ addressFrom: input.addressFrom, addressTo: input.addressTo, weightLb: input.weightLb })
      if (shipment.ok) {
        const rates = shipment.rates.filter(isQuotableRate).map(toQuoted)
        if (rates.length > 0) return { rates, source: 'shippo' }
        console.warn('[shipping] Shippo returned no USPS/UPS rates, using estimates')
      } else {
        console.error('[shipping] Shippo /shipments error:', shipment.status, shipment.detail.slice(0, 300))
      }
    } catch (err) {
      console.error('[shipping] Shippo rate request failed, using estimates:', err)
    }
  }
  return { rates: estimateCarrierRates(input.weightLb), source: 'estimate' }
}

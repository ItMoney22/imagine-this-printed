// Real shipping for a seller's store (David 2026-10-26, Crystal's store: "use ITP's same GoShippo flow ... her own
// items ship from HER: give her the Shippo label to print"). A store order ships as up to two packages: her items
// from her ship-from address, ITP's items from Rockmart. Each is rated through the one Shippo client
// (services/shippo.ts, the main site's quote), the buyer picks one service for both, and one signed token carries
// both charges to the checkout (services/shipping-quote.ts). Her label is bought later, on ITP's Shippo account, when
// she presses Print label in her store manager (routes/vendor-store.ts); ITP's package keeps the normal order flow.
import {
  buyLabel,
  createShipment,
  isQuotableRate,
  labelCentsOf,
  quoteRates,
  type QuotedRate,
  type ShippoAddress
} from './shippo.js'
import { computeCartWeightLb, signStoreShippingQuote, type StorePackageQuote } from './shipping-quote.js'

/** A US address as the store forms send it (her ship-from, the buyer's ship-to). */
export type ShipAddress = { name: string; street1: string; street2: string; city: string; state: string; zip: string; phone: string }

/** A typed address, tidied, or what is missing in plain words. Her ship-from needs a phone: carriers print it. */
export function readUsAddress(raw: any, opts: { phoneRequired?: boolean } = {}): { address: ShipAddress } | { error: string } {
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')
  const a: ShipAddress = {
    name: text(raw?.name, 80),
    street1: text(raw?.street1, 80),
    street2: text(raw?.street2, 80),
    city: text(raw?.city, 50),
    state: text(raw?.state, 30).toUpperCase(),
    zip: text(raw?.zip, 10),
    phone: text(raw?.phone, 20)
  }
  if (!a.name) return { error: 'Add the name for the label' }
  if (!a.street1) return { error: 'Add the street address' }
  if (!a.city) return { error: 'Add the city' }
  if (!/^[A-Z]{2}$/.test(a.state)) return { error: 'Add the state as two letters, like GA' }
  if (!/^\d{5}(-\d{4})?$/.test(a.zip)) return { error: 'Add a 5-digit ZIP code' }
  if (opts.phoneRequired && a.phone.replace(/\D/g, '').length < 10) return { error: 'Add a phone number the carrier can call' }
  return { address: a }
}

export const toShippoAddress = (a: ShipAddress, email = ''): ShippoAddress =>
  ({ name: a.name, street1: a.street1, street2: a.street2, city: a.city, state: a.state, zip: a.zip, country: 'US', phone: a.phone, email })

/** The order row's shipping_address, in the shape the rest of ITP reads (routes/orders.ts toShippoAddress, emails). */
export function orderShippingAddress(a: ShipAddress, email: string | null) {
  const [firstName, ...rest] = a.name.split(/\s+/)
  return {
    firstName: firstName || '',
    lastName: rest.join(' '),
    email: email || '',
    phone: a.phone,
    address: a.street1,
    address2: a.street2,
    city: a.city,
    state: a.state,
    zipCode: a.zip,
    country: 'US'
  }
}

/** Each package's parcel weight: her items in one box, ITP's in another (0.5 lb a unit, the main site's rule). */
export function packageWeights(lines: Array<{ kind: 'own' | 'itp'; quantity: number }>): { own: number | null; itp: number | null } {
  const side = (kind: 'own' | 'itp') => {
    const mine = lines.filter(l => l.kind === kind)
    return mine.length ? computeCartWeightLb(mine.map(l => ({ quantity: l.quantity }))) : null
  }
  return { own: side('own'), itp: side('itp') }
}

export type ShippingOption = {
  /** The Shippo service token, e.g. usps_ground_advantage. */
  id: string
  name: string
  days: number
  amountCents: number
  packages: number
  /** Signed quote the checkout takes back unchanged. */
  token: string
}

const displayName = (r: QuotedRate) => (r.name.toLowerCase().startsWith(r.provider.toLowerCase()) ? r.name : `${r.provider} ${r.name}`)
const cheapest = (rates: QuotedRate[]) => [...rates].sort((a, b) => a.chargeCents - b.chargeCents)[0]

type Side = { rates: QuotedRate[]; source: 'shippo' | 'estimate'; weightLb: number }

/**
 * The buyer's choices: one per service both packages can ship by (USPS Ground Advantage for both, Priority for
 * both...), priced as the two packages together. When the packages share no service, one "Standard" choice ships
 * each by its cheapest rate.
 */
export function combineOptions(input: { slug: string; zip: string; own: Side | null; itp: Side | null }): ShippingOption[] {
  const sides = [input.own, input.itp].filter(Boolean) as Side[]
  if (!sides.length) return []
  const pkg = (side: Side | null, rate: QuotedRate | undefined): StorePackageQuote | null =>
    side && rate ? { chargeCents: rate.chargeCents, carrier: rate.provider, service: rate.service, name: displayName(rate), weightLb: side.weightLb, source: side.source } : null
  const option = (id: string, name: string, own: QuotedRate | undefined, itp: QuotedRate | undefined): ShippingOption => ({
    id,
    name,
    days: Math.max(own?.estimatedDays ?? 0, itp?.estimatedDays ?? 0),
    amountCents: (own?.chargeCents ?? 0) + (itp?.chargeCents ?? 0),
    packages: sides.length,
    token: signStoreShippingQuote({ slug: input.slug, destinationZip: input.zip, own: pkg(input.own, own), itp: pkg(input.itp, itp) })
  })

  const services = [...new Set(sides[0].rates.map(r => r.service))].filter(svc => svc && sides.every(s => s.rates.some(r => r.service === svc)))
  const options = services.map(svc => {
    const own = input.own ? cheapest(input.own.rates.filter(r => r.service === svc)) : undefined
    const itp = input.itp ? cheapest(input.itp.rates.filter(r => r.service === svc)) : undefined
    return option(svc, displayName((own || itp)!), own, itp)
  })
  if (!options.length) {
    options.push(option('standard', 'Standard shipping', input.own ? cheapest(input.own.rates) : undefined, input.itp ? cheapest(input.itp.rates) : undefined))
  }
  return options.sort((a, b) => a.amountCents - b.amountCents).slice(0, 5)
}

/**
 * Rates both packages at once: hers from her ship-from address, ITP's from the warehouse. A seller with no ship-from
 * address yet gets the main site's weight-aware estimate for her package (never a flat rate); her Print label then
 * asks her for the address before it buys anything.
 */
export async function quoteStoreShipping(input: {
  slug: string
  shipFrom: ShipAddress | null
  warehouse: ShippoAddress
  shipTo: ShipAddress
  weights: { own: number | null; itp: number | null }
}): Promise<{ options: ShippingOption[]; source: 'shippo' | 'estimate' }> {
  const to = toShippoAddress(input.shipTo)
  const [own, itp] = await Promise.all([
    input.weights.own == null ? null : quoteRates({
      addressFrom: input.shipFrom ? toShippoAddress(input.shipFrom) : input.warehouse,
      addressTo: input.shipFrom ? to : null,
      weightLb: input.weights.own
    }).then(q => ({ ...q, weightLb: input.weights.own! })),
    input.weights.itp == null ? null : quoteRates({ addressFrom: input.warehouse, addressTo: to, weightLb: input.weights.itp })
      .then(q => ({ ...q, weightLb: input.weights.itp! }))
  ])
  const options = combineOptions({ slug: input.slug, zip: input.shipTo.zip, own, itp })
  const source = [own, itp].every(s => !s || s.source === 'shippo') ? 'shippo' : 'estimate'
  return { options, source }
}

/** The carrier's rate inside a package charge (the label cost); the rest is ITP's 5% cut. */
export const labelCents = (pkg: StorePackageQuote | null) => (pkg ? labelCentsOf(pkg.chargeCents) : 0)

export type SellerLabel = {
  transaction_id: string
  label_url: string
  tracking_number: string | null
  tracking_url: string | null
  carrier: string | null
  service: string | null
  cost_cents: number
  weight_lb: number
  purchased_at: string
  purchased_by: string | null
}

/**
 * Buys her package's label on ITP's Shippo account: from her ship-from address to the buyer, for her items' weight,
 * on the service the buyer paid for (the cheapest USPS/UPS rate if that service isn't offered now).
 */
export async function buySellerLabel(input: {
  shipFrom: ShipAddress
  shipTo: ShippoAddress
  weightLb: number
  service: string | null
  reference: string
  purchasedBy: string | null
}): Promise<{ ok: true; label: SellerLabel } | { ok: false; error: string }> {
  const shipment = await createShipment({ addressFrom: toShippoAddress(input.shipFrom), addressTo: input.shipTo, weightLb: input.weightLb })
  if (!shipment.ok) return { ok: false, error: `Shippo could not set up the shipment (${shipment.status}). Check your ship-from address in Settings.` }
  const usable = shipment.rates.filter(isQuotableRate)
  const pool = usable.length ? usable : shipment.rates
  if (!pool.length) return { ok: false, error: 'No carrier can take this package right now. Check both addresses and try again.' }
  const byPrice = (a: any, b: any) => parseFloat(a.amount) - parseFloat(b.amount)
  const chosen = [...pool].filter(r => input.service && String(r?.servicelevel?.token || '').toLowerCase() === input.service).sort(byPrice)[0]
    || [...pool].sort(byPrice)[0]
  const bought = await buyLabel(chosen.object_id, input.reference)
  if (!bought.ok) return { ok: false, error: bought.error }
  const t = bought.transaction
  return {
    ok: true,
    label: {
      transaction_id: t.object_id,
      label_url: t.label_url,
      tracking_number: t.tracking_number || null,
      tracking_url: t.tracking_url_provider || null,
      carrier: chosen.provider || null,
      service: chosen.servicelevel?.name || chosen.servicelevel?.token || null,
      cost_cents: Math.round((parseFloat(chosen.amount) || 0) * 100),
      weight_lb: Math.round(input.weightLb * 100) / 100,
      purchased_at: new Date().toISOString(),
      purchased_by: input.purchasedBy
    }
  }
}

/** A label link is only ever fetched from Shippo's own file hosts. */
export const isShippoLabelUrl = (url: unknown): url is string => {
  try {
    const u = new URL(String(url))
    return u.protocol === 'https:' && /(^|\.)(goshippo\.com|amazonaws\.com)$/.test(u.hostname) && /shippo/i.test(u.hostname + u.pathname)
  } catch {
    return false
  }
}

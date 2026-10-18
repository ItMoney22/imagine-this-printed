/**
 * The QR stand sold through a client site we built (Darrell's first).
 *
 * David 2026-10-17: a site owner lists the stand on his own site; when one of
 * his clients buys it he gets 10% of the sale, recorded on HIS platform by the
 * revenue share it already has (Darrell V2 revenue-share.ts splitReferredClientLine
 * / partner.ts recordOneOffPurchaseEarning). ITP computes no share and shows
 * none: it only says "this stand line sold, for this much, through you".
 *
 * Two hops, both signed with the vendor's STOREFRONT_CREATOR_KEYS key, the
 * secret ITP and that site already share for the storefront API:
 *
 *   1. REF — the site's shop links to ITP's order page with ?ref=<payload>.<sig>,
 *      payload = base64url JSON { s: vendor, c: client user id on that site | "",
 *      t: unix seconds }, sig = base64url HMAC-SHA256(key, payload). The order
 *      page carries it on the cart line; checkout verifies it here and stores
 *      only what verified.
 *   2. SALE — when the order is paid, ITP POSTs a sale event to the site,
 *      body signed as x-itp-signature: sha256=<hex HMAC-SHA256(key, rawBody)>.
 *      The event id is per order line, so a redelivery is a no-op there.
 *
 * Fail-soft: nothing here may break a checkout or a paid-order webhook.
 */
import crypto from 'crypto'
import { storefrontKeyFor } from '../middleware/requireStorefrontSecret.js'

/** A ref older than this is refused: shop links are made per visit. */
export const REF_MAX_AGE_S = 30 * 24 * 3600

export interface ResellerRef {
  vendor: string
  /** The buyer's user id on the vendor's own site, when they were signed in there. */
  clientRef: string | null
  issuedAt: number
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** What a vendor site does to make a ref. Exported for tests and as the reference
 *  implementation the Darrell side mirrors. */
export function signResellerRef(vendor: string, clientRef: string | null, key: string, now = Date.now()): string {
  const payload = b64url(Buffer.from(JSON.stringify({ s: vendor, c: clientRef ?? '', t: Math.floor(now / 1000) })))
  const sig = b64url(crypto.createHmac('sha256', key).update(payload).digest())
  return `${payload}.${sig}`
}

/** null unless the ref is well-formed, signed by that vendor's key and fresh. */
export function verifyResellerRef(ref: string | null | undefined, now = Date.now()): ResellerRef | null {
  if (!ref || typeof ref !== 'string' || ref.length > 1024) return null
  const [payload, sig] = ref.split('.')
  if (!payload || !sig) return null
  let body: { s?: unknown; c?: unknown; t?: unknown }
  try {
    body = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
  } catch {
    return null
  }
  const vendor = typeof body.s === 'string' ? body.s : ''
  const key = vendor ? storefrontKeyFor(vendor) : null
  if (!key) return null
  const expected = b64url(crypto.createHmac('sha256', key).update(payload).digest())
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  const t = Number(body.t)
  const ageS = now / 1000 - t
  if (!Number.isFinite(t) || ageS > REF_MAX_AGE_S || ageS < -300) return null
  const clientRef = typeof body.c === 'string' && body.c ? body.c.slice(0, 64) : null
  return { vendor, clientRef, issuedAt: t }
}

/** Where each vendor's site takes sale events. STOREFRONT_SALE_HOOKS (JSON
 *  {vendor: url}) overrides; Darrell's is known. */
export function saleHookUrl(vendor: string): string | null {
  try {
    const map = JSON.parse(process.env.STOREFRONT_SALE_HOOKS || '{}') as Record<string, string>
    if (typeof map[vendor] === 'string' && map[vendor].startsWith('https://')) return map[vendor]
  } catch {
    /* fall through to the known list */
  }
  return vendor === 'darrell' ? 'https://darrellmccutchen.com/api/itp/product-sale' : null
}

export interface ResellerSaleLine {
  /** Index of the line on the order — with the order id, the event's identity. */
  lineIndex: number
  vendor: string
  clientRef: string | null
  quantity: number
  /** What the buyer paid for this line, before tax and shipping. */
  grossCents: number
}

export interface ResellerSaleEvent {
  id: string
  type: 'product_sale.paid'
  occurredAt: string
  product: { kind: 'qr-stand'; name: string }
  order: { id: string; number: string | null }
  line: { index: number; quantity: number; grossCents: number }
  clientRef: string | null
}

export function buildSaleEvent(
  order: { id: string; order_number: string | null },
  line: ResellerSaleLine,
  productName: string,
  now = new Date()
): ResellerSaleEvent {
  return {
    id: `itp-qr-stand-${order.id}-${line.lineIndex}`,
    type: 'product_sale.paid',
    occurredAt: now.toISOString(),
    product: { kind: 'qr-stand', name: productName },
    order: { id: order.id, number: order.order_number },
    line: { index: line.lineIndex, quantity: line.quantity, grossCents: line.grossCents },
    clientRef: line.clientRef,
  }
}

export function signSaleBody(rawBody: string, key: string): string {
  return `sha256=${crypto.createHmac('sha256', key).update(rawBody, 'utf8').digest('hex')}`
}

type Logger = { info?: Function; warn?: Function; error?: Function } | undefined

/**
 * Tell each vendor site about its stand lines on a paid order. Returns what it
 * attempted so the caller can stamp it on the line. Never throws.
 */
export async function notifyResellerSales(
  order: { id: string; order_number: string | null },
  lines: ResellerSaleLine[],
  productName: string,
  log?: Logger
): Promise<Array<{ lineIndex: number; eventId: string; sent: boolean; error?: string }>> {
  const out: Array<{ lineIndex: number; eventId: string; sent: boolean; error?: string }> = []
  for (const line of lines) {
    const event = buildSaleEvent(order, line, productName)
    try {
      const key = storefrontKeyFor(line.vendor)
      const url = saleHookUrl(line.vendor)
      if (!key || !url) {
        out.push({ lineIndex: line.lineIndex, eventId: event.id, sent: false, error: 'vendor not configured' })
        continue
      }
      const body = JSON.stringify(event)
      const res = await postSigned(url, body, signSaleBody(body, key))
      out.push({ lineIndex: line.lineIndex, eventId: event.id, sent: res.ok, error: res.ok ? undefined : res.error })
      if (!res.ok) log?.warn?.({ orderId: order.id, vendor: line.vendor, error: res.error }, '[qr-stand] reseller sale not delivered')
    } catch (err: any) {
      out.push({ lineIndex: line.lineIndex, eventId: event.id, sent: false, error: err?.message ?? 'failed' })
      log?.error?.({ err, orderId: order.id }, '[qr-stand] reseller sale emission threw (swallowed)')
    }
  }
  return out
}

/** One retry on a network error or 5xx, never on a 4xx (same rule as the merch hook). */
async function postSigned(url: string, body: string, signature: string): Promise<{ ok: boolean; error?: string }> {
  let last = ''
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-itp-signature': signature },
        body,
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) return { ok: true }
      last = `HTTP ${res.status}`
      if (res.status < 500) return { ok: false, error: last }
    } catch (err: any) {
      last = err?.message ?? 'network error'
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return { ok: false, error: last }
}

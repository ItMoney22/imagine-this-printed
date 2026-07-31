/**
 * Merch Studio sales-ledger webhook — pushes signed order.paid / order.refunded /
 * order.canceled events to Darrell V2 so its admin Shop page has a durable
 * local sales history (closes the loop documented in Darrell V2's
 * docs/merch-orders-webhook.md, which is the authoritative receiving contract).
 *
 * Money model: this is a READ-MODEL push only. ITP remains the sole source of
 * truth for payments; Darrell V2 never moves money, it just records a
 * snapshot per order line for reconciliation/display.
 *
 * Inert until configured: no-ops (logs once) if MERCH_WEBHOOK_SECRET or
 * MERCH_WEBHOOK_CREATOR_USER_ID is unset — see .env.example.
 *
 * Creator gating (privacy/correctness): only order lines whose
 * products.created_by_user_id matches MERCH_WEBHOOK_CREATOR_USER_ID are ever
 * sent. That env var must hold the SAME ITP user id as this vendor's entry in
 * STOREFRONT_CREATOR_KEYS (backend/middleware/requireStorefrontSecret.ts) —
 * i.e. Darrell's creator account. Every other creator's sales are excluded,
 * even when they share an order with a Darrell item (mixed carts only send
 * Darrell's lines).
 *
 * Fail-soft: sendMerchOrderEvent() never throws — a delivery failure must
 * never break a customer's checkout or an admin's order-status update.
 */

import crypto from 'crypto'
import { supabase } from '../lib/supabase.js'

export const MERCH_WEBHOOK_URL = 'https://darrellmccutchen.com/api/merch/webhook'

export type MerchOrderEventType = 'order.paid' | 'order.refunded' | 'order.canceled'

export interface MerchOrderEventItem {
  externalRef: string | null
  productId: string
  orderItemId: string | null
  quantity: number
  unitAmountCents: number
  subtotalCents: number
  creatorMarginCents: number | null
}

export interface MerchOrderEventPayload {
  id: string
  type: MerchOrderEventType
  occurredAt: string
  order: {
    id: string
    number?: string
    buyerEmail?: string
    currency?: string
  }
  items: MerchOrderEventItem[]
}

// Minimal shapes this module reads from Supabase — kept narrow to what's
// actually selected, and exported so tests can build fixtures against them.
export interface MerchOrderInput {
  id: string
  order_number: string | null
  customer_email: string | null
  currency: string | null
}

export interface MerchOrderItemInput {
  id: string
  product_id: string | null
  quantity: number
  unit_price: number
}

export interface MerchProductInput {
  id: string
  created_by_user_id: string | null
  metadata: Record<string, any> | null
}

type Logger = { info?: Function; warn?: Function; error?: Function } | undefined

/**
 * Deterministic per (order, event type) — a redelivery (ours or a network
 * retry) reuses the exact same id, so Darrell V2's `dedupe_key` (event id +
 * line id) absorbs it as a no-op instead of double-recording a sale.
 */
export function buildMerchEventId(orderId: string, type: MerchOrderEventType): string {
  return `itp-${type.replace('.', '-')}-${orderId}`
}

/**
 * HMAC-SHA256 over the exact raw body string — mirrors Darrell V2's reference
 * signer verbatim (docs/merch-orders-webhook.md):
 *   "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")
 */
export function signMerchPayload(rawBody: string, secret: string): string {
  const hex = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  return `sha256=${hex}`
}

/**
 * Filters + maps order lines to the ones belonging to the configured
 * creator (Darrell). Pure — no Supabase calls — so it's directly testable.
 */
export function selectDarrellItems(
  items: MerchOrderItemInput[],
  productsById: Map<string, MerchProductInput>,
  royaltiesByProduct: Map<string, number>,
  creatorUserId: string
): MerchOrderEventItem[] {
  const out: MerchOrderEventItem[] = []
  for (const item of items) {
    if (!item.product_id) continue
    const product = productsById.get(item.product_id)
    // Privacy/correctness gate: only this creator's products are ever sent.
    if (!product || product.created_by_user_id !== creatorUserId) continue

    const qty = Math.max(1, Number(item.quantity) || 1)
    const unitAmountCents = Math.round((Number(item.unit_price) || 0) * 100)
    out.push({
      externalRef: product.metadata?.external_ref ?? null,
      productId: product.id,
      orderItemId: item.id ?? null,
      quantity: qty,
      unitAmountCents,
      subtotalCents: unitAmountCents * qty,
      creatorMarginCents: royaltiesByProduct.get(product.id) ?? null
    })
  }
  return out
}

/** Builds the wire payload for a set of already-gated Darrell line items. */
export function buildMerchOrderPayload(
  order: MerchOrderInput,
  items: MerchOrderEventItem[],
  type: MerchOrderEventType
): MerchOrderEventPayload {
  const payload: MerchOrderEventPayload = {
    id: buildMerchEventId(order.id, type),
    type,
    occurredAt: new Date().toISOString(),
    order: { id: order.id },
    items
  }
  if (order.order_number) payload.order.number = order.order_number
  if (order.customer_email) payload.order.buyerEmail = order.customer_email
  payload.order.currency = (order.currency || 'usd').toLowerCase()
  return payload
}

const MAX_DELIVERY_ATTEMPTS = 2
const REQUEST_TIMEOUT_MS = 5000
const RETRY_BACKOFF_MS = 300

/**
 * POSTs the already-serialized body with its signature. Bounded retry (2
 * attempts total) on network errors and 5xx only — a 4xx (bad signature/json/
 * payload per the contract) is never retried. Never throws: every branch logs
 * and returns.
 */
export async function deliverMerchEvent(url: string, body: string, signature: string, log?: Logger): Promise<void> {
  for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-merch-signature': signature },
        body,
        signal: controller.signal
      })
      clearTimeout(timeout)

      if (res.ok) {
        log?.info?.({ status: res.status, attempt }, '[merch-webhook] delivered')
        return
      }

      if (res.status >= 400 && res.status < 500) {
        // invalid_signature / invalid_json / invalid_payload — contract says
        // do not retry.
        const text = await res.text().catch(() => '')
        log?.error?.({ status: res.status, body: text, attempt }, '[merch-webhook] rejected — not retrying (4xx)')
        return
      }

      // 5xx (includes 503 "not configured" on their side) — retryable.
      log?.warn?.({ status: res.status, attempt }, '[merch-webhook] receiver error')
      if (attempt === MAX_DELIVERY_ATTEMPTS) {
        log?.error?.({ status: res.status, attempts: attempt }, '[merch-webhook] gave up after retries')
        return
      }
    } catch (err: any) {
      clearTimeout(timeout)
      log?.warn?.({ err: err?.message, attempt }, '[merch-webhook] network/timeout error')
      if (attempt === MAX_DELIVERY_ATTEMPTS) {
        log?.error?.({ err: err?.message, attempts: attempt }, '[merch-webhook] gave up after retries (network)')
        return
      }
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS))
  }
}

let warnedMissingSecret = false
let warnedMissingCreatorId = false

export interface SendMerchOrderEventInput {
  orderId: string
  type: MerchOrderEventType
  log?: Logger
}

/**
 * Loads the order + its Darrell-owned line items and emits the signed event.
 * Fail-soft: every failure path logs and returns — this must never throw,
 * so it never breaks the checkout webhook or the admin status-update route
 * that call it.
 */
export async function sendMerchOrderEvent({ orderId, type, log }: SendMerchOrderEventInput): Promise<void> {
  try {
    const secret = process.env.MERCH_WEBHOOK_SECRET
    if (!secret) {
      if (!warnedMissingSecret) {
        warnedMissingSecret = true
        log?.info?.('[merch-webhook] MERCH_WEBHOOK_SECRET not set — merch order events disabled (no-op)')
      }
      return
    }

    const creatorUserId = process.env.MERCH_WEBHOOK_CREATOR_USER_ID
    if (!creatorUserId) {
      if (!warnedMissingCreatorId) {
        warnedMissingCreatorId = true
        log?.info?.('[merch-webhook] MERCH_WEBHOOK_CREATOR_USER_ID not set — cannot scope to a creator, merch order events disabled (no-op)')
      }
      return
    }

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, order_number, customer_email, currency')
      .eq('id', orderId)
      .single()
    if (orderErr || !order) {
      log?.error?.({ err: orderErr, orderId }, '[merch-webhook] order not found — skipping emission')
      return
    }

    const { data: itemRows, error: itemsErr } = await supabase
      .from('order_items')
      .select('id, product_id, quantity, unit_price')
      .eq('order_id', orderId)
    if (itemsErr) {
      log?.error?.({ err: itemsErr, orderId }, '[merch-webhook] failed to load order items — skipping emission')
      return
    }
    const items = (itemRows || []) as MerchOrderItemInput[]
    const productIds = [...new Set(items.map((i) => i.product_id).filter((id): id is string => !!id))]
    if (productIds.length === 0) return

    const { data: productRows, error: productsErr } = await supabase
      .from('products')
      .select('id, created_by_user_id, metadata')
      .in('id', productIds)
    if (productsErr) {
      log?.error?.({ err: productsErr, orderId }, '[merch-webhook] failed to load products — skipping emission')
      return
    }
    const productsById = new Map<string, MerchProductInput>((productRows || []).map((p: any) => [p.id, p]))

    const { data: royaltyRows } = await supabase
      .from('user_product_royalties')
      .select('product_id, amount_cents')
      .eq('order_id', orderId)
    const royaltiesByProduct = new Map<string, number>((royaltyRows || []).map((r: any) => [r.product_id, r.amount_cents]))

    const darrellItems = selectDarrellItems(items, productsById, royaltiesByProduct, creatorUserId)
    if (darrellItems.length === 0) {
      log?.info?.({ orderId }, '[merch-webhook] no line items belong to the configured creator — nothing to send')
      return
    }

    const payload = buildMerchOrderPayload(order as MerchOrderInput, darrellItems, type)
    const body = JSON.stringify(payload)
    const signature = signMerchPayload(body, secret)

    await deliverMerchEvent(MERCH_WEBHOOK_URL, body, signature, log)
  } catch (err: any) {
    // Absolute last-resort guard — see module doc: must never throw.
    log?.error?.({ err, orderId, type }, '[merch-webhook] unexpected failure (swallowed)')
  }
}

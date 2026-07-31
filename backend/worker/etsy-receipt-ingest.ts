// Etsy receipt ingest — pulls paid Etsy sales into ITP as real orders so they
// enter the print queue, get counted in revenue, and decrement blank
// inventory (closing the overselling gap: a sale on Etsy used to never touch
// ITP at all). Started from etsy-jobs-worker.ts's startEtsyWorker() so
// worker/index.ts needs no changes.
//
// Idempotency: relies on the DB-level unique index on orders.etsy_receipt_id
// (supabase/migrations/20260728_etsy_receipts_and_inventory_sync.sql), not on
// a check-then-insert — a second poll re-fetching the same receipt hits a
// Postgres 23505 unique_violation on the INSERT and is treated as a no-op.
// This is safe under concurrent pollers/ticks by construction (the DB is the
// single arbiter), unlike a SELECT-then-INSERT which would race.
//
// Watermark: etsy_connection.receipts_watermark tracks the Etsy receipt
// `updated_timestamp` (unix seconds) of the newest receipt fully processed.
// Sorting/filtering on `updated` (not `created`) means a receipt that flips
// was_paid=true after creation re-surfaces on a later poll instead of being
// permanently missed.
//
// Error handling (OPEN QUESTION, decided here): receipts in a page are
// processed oldest-updated-first; the watermark only advances past a receipt
// AFTER it ingests successfully. The first failure in a page stops the
// watermark advance for the rest of that page (they get retried next tick).
// This trades "maybe reprocess a few extra receipts" (harmless — the unique
// constraint makes that a no-op) for "never silently lose a sale."
import { supabase } from '../lib/supabase.js'
import { getShopReceipts, etsyMoneyToDollars, isEtsyEnabled, type EtsyReceipt, type EtsyReceiptTransaction } from '../services/etsy.js'
import { decrementBlanksForOrder } from '../services/blank-inventory.js'

const RECEIPT_POLL_INTERVAL = 60_000 // 60s — order ingestion isn't latency-critical; low volume, keeps well under Etsy rate limits
const WATERMARK_ROW_ID = 1

let receiptPolling = false // in-flight guard, same pattern as etsy-jobs-worker.ts's `running`

export function startEtsyReceiptPoller(): void {
  if (process.env.ETSY_WORKER_ENABLED === 'false') return
  console.log(`[etsy-receipts] 🧾 starting receipt ingest poller (poll ${RECEIPT_POLL_INTERVAL}ms)`)
  setInterval(() => { void pollReceipts() }, RECEIPT_POLL_INTERVAL)
  void pollReceipts() // run once on boot
}

export async function pollReceipts(): Promise<void> {
  if (receiptPolling) return
  if (!isEtsyEnabled()) return // dark until ETSY_ENABLED=true + creds present
  receiptPolling = true
  try {
    const { data: conn } = await supabase
      .from('etsy_connection')
      .select('receipts_watermark')
      .eq('id', WATERMARK_ROW_ID)
      .maybeSingle()
    const watermark = conn?.receipts_watermark ?? 0

    const receipts = await getShopReceipts({ minLastModified: watermark, limit: 25 })
    if (!receipts.length) return

    const sorted = [...receipts].sort((a, b) => a.updated_timestamp - b.updated_timestamp)
    let newWatermark = watermark

    for (const receipt of sorted) {
      try {
        const result = await ingestReceipt(receipt)
        if (result.created) console.log(`[etsy-receipts] ✅ ingested receipt ${receipt.receipt_id} -> order ${result.orderId}`)
        newWatermark = receipt.updated_timestamp
      } catch (e: any) {
        console.error(`[etsy-receipts] ingest failed for receipt ${receipt.receipt_id}, stopping page early (will retry next poll):`, e?.message)
        break
      }
    }

    if (newWatermark > watermark) {
      await supabase.from('etsy_connection').update({ receipts_watermark: newWatermark }).eq('id', WATERMARK_ROW_ID)
    }
  } catch (e: any) {
    console.error('[etsy-receipts] poll failed:', e?.message)
  } finally {
    receiptPolling = false
  }
}

export interface IngestResult {
  created: boolean
  orderId: string | null
  reason?: 'not_paid_yet' | 'no_transactions' | 'duplicate'
}

const SIZE_NAME_RE = /^size\b/i
const COLOR_NAME_RE = /colou?r/i

function extractVariant(txn: EtsyReceiptTransaction): { size: string | null; color: string | null } {
  const vars = txn.variations || []
  const sizeVar = vars.find((v) => SIZE_NAME_RE.test(v.formatted_name || ''))
  const colorVar = vars.find((v) => COLOR_NAME_RE.test(v.formatted_name || ''))
  return { size: sizeVar?.formatted_value ?? null, color: colorVar?.formatted_value ?? null }
}

/**
 * Upsert one Etsy receipt into ITP as an order. `db` is injected (mirrors
 * ai-jobs-worker.ts's claimQueuedJob(db, ...) pattern) so this is unit
 * testable against a fake in-memory client — see etsy-receipt-ingest.test.ts —
 * without standing up Supabase or calling the real Etsy API.
 */
export async function ingestReceipt(
  receipt: EtsyReceipt,
  db: { from: (table: string) => any } = supabase
): Promise<IngestResult> {
  if (!receipt.was_paid) return { created: false, orderId: null, reason: 'not_paid_yet' }
  if (!receipt.transactions?.length) return { created: false, orderId: null, reason: 'no_transactions' }

  // Map Etsy listing_id -> ITP product_id via the same ledger the publish
  // worker writes (etsy_listings). Unmapped transactions (e.g. a listing
  // created before this ledger existed) still create the order — with
  // product_id null — so revenue/print-queue visibility isn't lost, just the
  // blank-inventory decrement for that line (decrementBlanksForOrder already
  // skips lines with no product_id).
  const listingIds = [...new Set(receipt.transactions.map((t) => t.listing_id))]
  const { data: listingRows, error: listingErr } = await db
    .from('etsy_listings')
    .select('listing_id, product_id')
    .in('listing_id', listingIds)
  if (listingErr) throw new Error(`etsy_listings lookup failed: ${listingErr.message}`)
  const productByListing = new Map<number, string>((listingRows || []).map((r: any) => [r.listing_id, r.product_id]))

  const name = (receipt.name || '').trim()
  const [firstName, ...rest] = name.split(' ')
  const lastName = rest.join(' ')

  const orderRow = {
    order_number: `ETSY-${receipt.receipt_id}`,
    user_id: null,
    customer_email: null, // Etsy Open API v3 does not expose buyer email
    customer_name: name || null,
    subtotal: etsyMoneyToDollars(receipt.subtotal),
    tax_amount: etsyMoneyToDollars(receipt.total_tax_cost),
    shipping_amount: etsyMoneyToDollars(receipt.total_shipping_cost),
    discount_amount: etsyMoneyToDollars(receipt.discount_amt),
    total: etsyMoneyToDollars(receipt.total_price),
    currency: receipt.total_price?.currency_code || 'USD',
    status: 'processing',
    payment_status: 'paid', // Etsy already collected payment — nothing for ITP to charge
    fulfillment_status: 'unfulfilled',
    payment_method: 'etsy',
    source: 'etsy',
    etsy_receipt_id: receipt.receipt_id,
    shipping_address: {
      firstName: firstName || null,
      lastName: lastName || null,
      address: [receipt.first_line, receipt.second_line].filter(Boolean).join(', ') || null,
      city: receipt.city ?? null,
      state: receipt.state ?? null,
      zipCode: receipt.zip ?? null,
      country: receipt.country_iso || 'US',
      email: null
    },
    discount_codes: [],
    metadata: {
      etsy_receipt_id: receipt.receipt_id,
      message_from_buyer: receipt.message_from_buyer ?? null,
      items: receipt.transactions.map((t) => ({
        id: productByListing.get(t.listing_id) ?? null,
        name: t.title,
        quantity: t.quantity,
        price: etsyMoneyToDollars(t.price),
        ...extractVariant(t)
      }))
    }
  }

  const { data: inserted, error: insertError } = await db.from('orders').insert(orderRow).select('id').single()
  if (insertError) {
    if (insertError.code === '23505') return { created: false, orderId: null, reason: 'duplicate' }
    throw new Error(`order insert failed for receipt ${receipt.receipt_id}: ${insertError.message}`)
  }
  const orderId = inserted.id as string

  const itemRows = receipt.transactions.map((t) => {
    const variant = extractVariant(t)
    return {
      order_id: orderId,
      product_id: productByListing.get(t.listing_id) ?? null,
      product_name: t.title,
      quantity: t.quantity,
      unit_price: etsyMoneyToDollars(t.price),
      subtotal: etsyMoneyToDollars(t.price) * t.quantity,
      metadata: {
        etsy_transaction_id: t.transaction_id,
        etsy_listing_id: t.listing_id,
        size: variant.size,
        color: variant.color
      }
    }
  })
  const { error: itemsError } = await db.from('order_items').insert(itemRows)
  if (itemsError) {
    console.error(`[etsy-receipts] order_items insert failed for order ${orderId} (receipt ${receipt.receipt_id}):`, itemsError.message)
  }

  // Idempotent (blank_inventory_movements unique index on (blank_id, order_id)
  // WHERE reason='sale') and self-contained — never throws, so it can't turn
  // an ingested order back into a failed poll tick.
  await decrementBlanksForOrder(orderId)

  return { created: true, orderId }
}

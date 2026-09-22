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
import { parseTeamTemplate, type TeamTemplate } from '../shared/team-template.js'
import { extractPersonalizationText, parsePersonalizationText } from '../shared/personalization-etsy.js'
import { renderOrGetCached } from '../services/team-plate/plate-store.js'
import { reviewFlags } from '../services/team-plate/review-flags.js'

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

/**
 * Personalization resolved for ONE Etsy transaction.
 *
 * Etsy hands over one free-text string; the press needs typed field values and
 * a drawn plate. Everything here is recorded even when the parse or the render
 * fails, because the one thing that must never happen is a personalized shirt
 * reaching the press with no name on it and nothing on the order saying why.
 */
interface LinePersonalization {
  /** Exactly what the buyer typed, kept verbatim for a human to read. */
  text: string | null
  values: Record<string, string> | null
  /** Durable GCS path of the press file, drawn from the template + values. */
  printFilePath: string | null
  /** Field keys the buyer's text did not yield. */
  missing: string[]
  flags: Array<{ field: string; reason: string }>
  error: string | null
}

export interface IngestDeps {
  /**
   * Draws the press file. Injected so the tests can prove the wiring without
   * standing up sharp, GCS and a real font — the render itself is covered by
   * services/team-plate/render.test.ts.
   */
  renderPlate?: (template: TeamTemplate, values: Record<string, string>) => Promise<{ path: string }>
}

const defaultRenderPlate: NonNullable<IngestDeps['renderPlate']> = (template, values) =>
  // Press width, not preview width: the same call the website's checkout makes
  // (backend/routes/stripe.ts personalizationForItems), so an Etsy sale and a
  // website sale of the same shirt produce the identical file.
  renderOrGetCached(template, values, template.canvas.w)

/**
 * Turn one transaction's personalization box into printable values + a plate.
 *
 * Returns null when this line has nothing to do with personalization — no
 * template on the product AND no text on the receipt — so an ordinary sale
 * carries no personalization keys at all.
 */
async function resolvePersonalization(
  txn: EtsyReceiptTransaction,
  template: TeamTemplate | null,
  renderPlate: NonNullable<IngestDeps['renderPlate']>
): Promise<LinePersonalization | null> {
  const text = extractPersonalizationText(txn)
  if (!template) {
    // A buyer typed into a box on a listing ITP cannot render from — usually a
    // listing personalized by hand in Shop Manager, or one whose product lost
    // its template. Keep the words; they are the whole order.
    return text ? { text, values: null, printFilePath: null, missing: [], flags: [], error: 'no_template' } : null
  }

  const parsed = parsePersonalizationText(template, text)
  const flags = reviewFlags(template, parsed.values)

  if (parsed.missing.length > 0) {
    // Refusing to draw half a plate is the point: a shirt pressed with a blank
    // number is scrap, and a human reading `text` can fix this in seconds.
    return {
      text,
      values: parsed.values,
      printFilePath: null,
      missing: parsed.missing,
      flags,
      error: text ? 'unreadable_personalization' : 'missing_personalization',
    }
  }

  try {
    const plate = await renderPlate(template, parsed.values)
    return { text, values: parsed.values, printFilePath: plate.path, missing: [], flags, error: null }
  } catch (e: any) {
    console.error(`[etsy-receipts] team-plate render failed for transaction ${txn.transaction_id}:`, e?.message)
    return { text, values: parsed.values, printFilePath: null, missing: [], flags, error: e?.message ?? 'render failed' }
  }
}

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
  db: { from: (table: string) => any } = supabase,
  deps: IngestDeps = {}
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

  // Team templates for the mapped products. Read for EVERY mapped product, not
  // only the transactions that carry personalization text, so a personalizable
  // shirt whose buyer somehow sent an empty box still lands on the order with
  // "missing_personalization" instead of looking like an ordinary sale.
  // A failure here must not cost the SALE: the raw text is still recorded and
  // the line is flagged, which is a problem a human can see and fix.
  const templates = new Map<string, TeamTemplate>()
  const productIds = [...new Set(productByListing.values())].filter(Boolean)
  if (productIds.length > 0) {
    try {
      const { data: productRows, error: productErr } = await db
        .from('products')
        .select('id, metadata')
        .in('id', productIds)
      if (productErr) throw new Error(productErr.message)
      for (const row of productRows || []) {
        const template = parseTeamTemplate((row as any).metadata)
        if (template) templates.set(String((row as any).id), template)
      }
    } catch (e: any) {
      console.error(`[etsy-receipts] could not load team templates for receipt ${receipt.receipt_id}:`, e?.message)
    }
  }

  const renderPlate = deps.renderPlate ?? defaultRenderPlate
  const personalizationByTransaction = new Map<number, LinePersonalization>()
  for (const txn of receipt.transactions) {
    const productId = productByListing.get(txn.listing_id) ?? null
    const template = productId ? templates.get(productId) ?? null : null
    const resolved = await resolvePersonalization(txn, template, renderPlate)
    if (resolved) personalizationByTransaction.set(txn.transaction_id, resolved)
  }

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
        ...extractVariant(t),
        // The snapshot Order Management falls back to when order_items is
        // unavailable — it must carry the name on the shirt too.
        personalization: personalizationByTransaction.get(t.transaction_id)?.values ?? null
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
    const personalization = personalizationByTransaction.get(t.transaction_id) ?? null
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
        color: variant.color,
        // Same keys the website's checkout writes (backend/routes/stripe.ts
        // replaceOrderItems), so Order Management, the print bridge and the
        // fulfillment emails read an Etsy sale and a website sale identically
        // — no second code path, no second place to forget.
        personalization: personalization?.values ?? null,
        print_file_path: personalization?.printFilePath ?? null,
        print_file_error: personalization?.error ?? null,
        personalization_flags: personalization?.flags?.length ? personalization.flags : null,
        // Etsy-only: the buyer's own words. The parser is forgiving but it is
        // still a parser, and this is the evidence a human needs when it
        // reads a name wrong.
        personalization_text: personalization?.text ?? null,
        personalization_missing: personalization?.missing?.length ? personalization.missing : null
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

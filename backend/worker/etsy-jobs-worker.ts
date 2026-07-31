// Etsy publish worker — mirrors the ai-jobs-worker pattern (setInterval poll, per-item try/catch,
// atomic claim, stale-claim recovery). Drives off etsy_listings.state = 'queued' (index idx_etsy_listings_state).
//
// Flow per queued product: atomic claim → copyright/AI gate → (blocked ? notify + stop)
//   → publishProductToEtsy (DRAFT only) → notify Christina. Publishing to 'active' stays human.
//
// Atomic claim + stale-claim recovery (Watchtower task 13dcdf0a): the old
// claim was an unconditional `.update({state:'processing'})` with no WHERE
// guard on the current state — two overlapping ticks (or two worker
// replicas) could both grab the same 'queued' row and both publish it,
// producing a duplicate Etsy listing (wasted $0.20 fee, confused sync
// ledger). claimEtsyListing() below is the same conditional-UPDATE-and-verify
// shape as ai-jobs-worker.ts's claimQueuedJob() — `.eq('state','queued')` in
// the WHERE clause means only ONE caller's UPDATE actually matches the row.
// requeueStaleEtsyJobs() is modeled on social-outbox.ts's
// requeueStaleClaims(): a crash/deploy between the claim and the terminal
// state (draft/active/blocked/error) used to strand a row in 'processing' or
// 'pending' forever, invisible to the 'queued'-only poll query.
import { supabase } from '../lib/supabase.js'
import { publishProductToEtsy, isEtsyEnabled } from '../services/etsy.js'
import { runCopyrightGate } from '../services/etsy-copyright-gate.js'
import { notifyChristina } from '../services/etsy-notify.js'
import { claimOnce, type ClaimOutcome } from '../lib/webhook-helpers.js'
import { type EtsyTier, etsyTierConfig, isEtsyTier } from '../shared/etsy-tiers.js'
import { startEtsyReceiptPoller } from './etsy-receipt-ingest.js'

const POLL_INTERVAL = 15_000 // 15s — Etsy posting is low-volume
const STALE_CLAIM_MINUTES = 15
let running = false // in-flight guard so overlapping ticks don't double-process

export function startEtsyWorker(): void {
  if (process.env.ETSY_WORKER_ENABLED === 'false') {
    console.log('[etsy-worker] disabled (ETSY_WORKER_ENABLED=false)')
    return
  }
  console.log(`[etsy-worker] 🧵 starting Etsy publish worker (poll ${POLL_INTERVAL}ms)`)
  setInterval(() => { void processEtsyQueue() }, POLL_INTERVAL)
  void processEtsyQueue() // run once on boot
  startEtsyReceiptPoller()
}

/**
 * Reset 'processing'/'pending' etsy_listings rows whose updated_at is older
 * than STALE_CLAIM_MINUTES back to 'queued'. A row can be stuck in either
 * state: 'processing' is the claim itself; 'pending' is set by
 * publishProductToEtsy's first upsertSync() call, so a crash mid-publish
 * (after the claim, before a terminal state) strands it there too.
 * `db` is injected for unit testing — see etsy-jobs-worker.claim.test.ts.
 */
export async function requeueStaleEtsyJobs(db: { from: (table: string) => any } = supabase): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MINUTES * 60 * 1000).toISOString()
  const { data, error } = await db
    .from('etsy_listings')
    .update({ state: 'queued', updated_at: new Date().toISOString() })
    .in('state', ['processing', 'pending'])
    .lt('updated_at', staleBefore)
    .select('id')
  if (error) {
    console.error('[etsy-worker] requeueStaleEtsyJobs failed:', error.message)
    return 0
  }
  const n = data?.length ?? 0
  if (n > 0) console.log(`[etsy-worker] 🔁 requeued ${n} stale Etsy job(s) (stuck >${STALE_CLAIM_MINUTES}min)`)
  return n
}

/**
 * Atomically claims a queued etsy_listings row by flipping it to 'processing'
 * — but ONLY if it is still 'queued'. See ai-jobs-worker.ts's
 * claimQueuedJob() for the full rationale (same shape, different table).
 */
export async function claimEtsyListing(
  db: { from: (table: string) => any },
  rowId: string
): Promise<ClaimOutcome<{ id: string }>> {
  return claimOnce(
    db
      .from('etsy_listings')
      .update({ state: 'processing', updated_at: new Date().toISOString() })
      .eq('id', rowId)
      .eq('state', 'queued')
      .select('id')
  )
}

export async function processEtsyQueue(): Promise<void> {
  if (running) return
  if (!isEtsyEnabled()) return // dark until ETSY_ENABLED=true + creds present
  running = true
  try {
    await requeueStaleEtsyJobs()

    const { data: queued, error } = await supabase
      .from('etsy_listings')
      .select('id, product_id, state, tier')
      .eq('state', 'queued')
      .order('created_at', { ascending: true })
      .limit(5)
    if (error) { console.error('[etsy-worker] poll failed:', error.message); return }
    if (!queued?.length) return

    for (const row of queued as Array<{ id: string; product_id: string; tier?: EtsyTier }>) {
      try {
        const claim = await claimEtsyListing(supabase, row.id)
        if (claim.error) { console.error(`[etsy-worker] claim query failed for ${row.id}:`, claim.error); continue }
        if (!claim.claimed) {
          console.warn(`[etsy-worker] lost claim race for ${row.id} — already claimed by another tick/replica, skipping to avoid duplicate listing`)
          continue
        }
        await processOne(row.id, row.product_id, isEtsyTier(row.tier) ? row.tier : 'primary')
      } catch (e: any) {
        console.error(`[etsy-worker] product ${row.product_id} [${row.tier ?? 'primary'}] failed:`, e?.message)
        await supabase
          .from('etsy_listings')
          .update({ state: 'error', last_error: String(e?.message).slice(0, 500), updated_at: new Date().toISOString() })
          .eq('id', row.id)
      }
    }
  } finally {
    running = false
  }
}

async function processOne(rowId: string, productId: string, tier: EtsyTier = 'primary'): Promise<void> {
  // Row is already claimed (state='processing') by claimEtsyListing() in
  // processEtsyQueue's loop above.
  const { data: product } = await supabase
    .from('products')
    .select('name, description, meta_title, meta_description, search_keywords, metadata, price')
    .eq('id', productId)
    .maybeSingle()
  const p: any = product
  if (!p) throw new Error('product not found')

  const tags = String(p.search_keywords || '').split(',').map((t: string) => t.trim()).filter(Boolean)
  const aiGenerated = p?.metadata?.ai_generated === false ? false : true // default to disclosing (policy-safe)
  const gate = runCopyrightGate({ name: p.meta_title || p.name, description: p.description || p.meta_description, tags, aiGenerated })

  if (!gate.pass) {
    await supabase
      .from('etsy_listings')
      .update({ state: 'blocked', last_error: gate.reasons.join(' | ').slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', rowId)
    await notifyChristina({ productName: p.name, productId, outcome: 'blocked', gateReasons: gate.reasons })
    console.log(`[etsy-worker] BLOCKED ${productId}: ${gate.reasons.join('; ')}`)
    return
  }

  // Passed the gate → create the DRAFT (service manages pending→draft/error + the sync ledger + images).
  const result = await publishProductToEtsy(productId, { tier, descriptionSuffix: gate.disclosure, publish: false })

  // Christina reviews three different listings per design now, so the tier has
  // to be on the notification or "Graffiti Roaring Lion Face" arrives 3x with
  // no way to tell the tee from the transfer from the file.
  const label = etsyTierConfig(tier).label
  const productName = tier === 'primary' ? p.name : `${p.name} — ${label}`

  if (result.ok) {
    await notifyChristina({ productName, productId, outcome: 'draft', etsyUrl: result.etsyUrl, listingId: result.listingId, price: p.price, tags })
    console.log(`[etsy-worker] DRAFT ${productId} [${tier}] → listing ${result.listingId}`)
  } else {
    await notifyChristina({ productName, productId, outcome: 'error', errorMessage: result.error })
    console.log(`[etsy-worker] ERROR ${productId} [${tier}]: ${result.error}`)
  }
}

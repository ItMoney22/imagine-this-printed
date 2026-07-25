// Etsy publish worker — mirrors the ai-jobs-worker pattern (setInterval poll, per-item try/catch,
// single-process claim). Drives off etsy_listings.state = 'queued' (index idx_etsy_listings_state).
//
// Flow per queued product: claim → copyright/AI gate → (blocked ? notify + stop)
//   → publishProductToEtsy (DRAFT only) → notify Christina. Publishing to 'active' stays human.
import { supabase } from '../lib/supabase.js'
import { publishProductToEtsy, isEtsyEnabled } from '../services/etsy.js'
import { runCopyrightGate } from '../services/etsy-copyright-gate.js'
import { notifyChristina } from '../services/etsy-notify.js'

const POLL_INTERVAL = 15_000 // 15s — Etsy posting is low-volume
let running = false // in-flight guard so overlapping ticks don't double-process

export function startEtsyWorker(): void {
  if (process.env.ETSY_WORKER_ENABLED === 'false') {
    console.log('[etsy-worker] disabled (ETSY_WORKER_ENABLED=false)')
    return
  }
  console.log(`[etsy-worker] 🧵 starting Etsy publish worker (poll ${POLL_INTERVAL}ms)`)
  setInterval(() => { void processEtsyQueue() }, POLL_INTERVAL)
  void processEtsyQueue() // run once on boot
}

export async function processEtsyQueue(): Promise<void> {
  if (running) return
  if (!isEtsyEnabled()) return // dark until ETSY_ENABLED=true + creds present
  running = true
  try {
    const { data: queued, error } = await supabase
      .from('etsy_listings')
      .select('id, product_id, state')
      .eq('state', 'queued')
      .order('created_at', { ascending: true })
      .limit(5)
    if (error) { console.error('[etsy-worker] poll failed:', error.message); return }
    if (!queued?.length) return

    for (const row of queued as Array<{ id: string; product_id: string }>) {
      try {
        await processOne(row.id, row.product_id)
      } catch (e: any) {
        console.error(`[etsy-worker] product ${row.product_id} failed:`, e?.message)
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

async function processOne(rowId: string, productId: string): Promise<void> {
  // Claim (single-worker assumption; prevents the next tick from re-grabbing this row).
  await supabase.from('etsy_listings').update({ state: 'processing', updated_at: new Date().toISOString() }).eq('id', rowId)

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
  const result = await publishProductToEtsy(productId, { descriptionSuffix: gate.disclosure, publish: false })

  if (result.ok) {
    await notifyChristina({ productName: p.name, productId, outcome: 'draft', etsyUrl: result.etsyUrl, listingId: result.listingId, price: p.price, tags })
    console.log(`[etsy-worker] DRAFT ${productId} → listing ${result.listingId}`)
  } else {
    await notifyChristina({ productName: p.name, productId, outcome: 'error', errorMessage: result.error })
    console.log(`[etsy-worker] ERROR ${productId}: ${result.error}`)
  }
}

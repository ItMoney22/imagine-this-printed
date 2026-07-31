/**
 * Nightly job: materializes public.product_copurchase from real order
 * history (order_items), replacing the recommender's old mock/random
 * ranking with actual "customers who bought this also bought" data.
 *
 * Watchtower task 7194f6fe-7f92-40a5-8dee-c41a986aa60a.
 *
 * Usage: npx tsx backend/scripts/refresh-product-copurchase.ts
 *
 * Scheduling: NOT wired to a scheduler by this pass — see the handoff for
 * why (this repo has no existing Vercel cron / GH Action convention this
 * script could safely piggyback on without a live deploy to verify against).
 * Wire it into whichever nightly mechanism the deploy owner prefers
 * (Vercel Cron hitting a thin API route that shells out to this script, a
 * GitHub Actions scheduled workflow, or a host-level cron) and pass
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY the same way this repo's other
 * scripts already do (see backend/scripts/refresh-product-images.ts).
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseKey) {
  throw new Error('[copurchase] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
}
const supabase = createClient(supabaseUrl, supabaseKey)

// A cancelled order never happened from the buyer's perspective — counting
// its items would teach the recommender pairings from carts that were undone.
const EXCLUDED_ORDER_STATUS = 'cancelled'
const PAGE_SIZE = 1000
const INSERT_BATCH_SIZE = 500
// Placeholder row_id constraint workaround: `.delete()` requires a WHERE
// clause, so this deletes "everything whose product_id isn't this
// impossible UUID" — i.e. everything.
const NEVER_MATCHES_UUID = '00000000-0000-0000-0000-000000000000'

interface OrderItemRow {
  order_id: string
  product_id: string | null
}

/** Fetches every (order_id, product_id) pair for non-cancelled orders, paginated. */
async function fetchOrderProductPairs(): Promise<Map<string, Set<string>>> {
  const byOrder = new Map<string, Set<string>>()
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('order_items')
      .select('order_id, product_id, orders!inner(status)')
      .not('product_id', 'is', null)
      .neq('orders.status', EXCLUDED_ORDER_STATUS)
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw new Error(`Failed to fetch order_items page at ${from}: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data as unknown as OrderItemRow[]) {
      if (!row.product_id) continue
      const set = byOrder.get(row.order_id) || new Set<string>()
      set.add(row.product_id)
      byOrder.set(row.order_id, set)
    }

    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return byOrder
}

/**
 * Pure function (unit-testable in isolation): for every order's distinct
 * product set, increments a directional count for every ordered pair
 * (A, B) with A !== B. An order with N distinct products contributes
 * N*(N-1) directional pairs.
 */
export function buildPairCounts(byOrder: Map<string, Set<string>>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const productIds of byOrder.values()) {
    const ids = Array.from(productIds)
    if (ids.length < 2) continue
    for (let i = 0; i < ids.length; i++) {
      for (let j = 0; j < ids.length; j++) {
        if (i === j) continue
        const key = `${ids[i]}|${ids[j]}`
        counts.set(key, (counts.get(key) || 0) + 1)
      }
    }
  }
  return counts
}

async function main() {
  console.log('[copurchase] Fetching order/product pairs from order_items...')
  const byOrder = await fetchOrderProductPairs()
  console.log(`[copurchase] ${byOrder.size} qualifying orders`)

  const counts = buildPairCounts(byOrder)
  console.log(`[copurchase] ${counts.size} directional product pairs`)

  if (counts.size === 0) {
    console.log('[copurchase] Nothing to write — leaving existing table as-is.')
    return
  }

  const rows = Array.from(counts.entries()).map(([key, purchase_count]) => {
    const [product_id, co_product_id] = key.split('|')
    return { product_id, co_product_id, purchase_count, updated_at: new Date().toISOString() }
  })

  // Full nightly recompute, not an incremental patch — a discontinued
  // product's stale pairs shouldn't linger and keep getting recommended.
  const { error: deleteError } = await supabase
    .from('product_copurchase')
    .delete()
    .neq('product_id', NEVER_MATCHES_UUID)
  if (deleteError) throw new Error(`Failed to clear product_copurchase: ${deleteError.message}`)

  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE)
    const { error: insertError } = await supabase.from('product_copurchase').insert(batch)
    if (insertError) throw new Error(`Failed to insert batch at offset ${i}: ${insertError.message}`)
  }

  console.log(`[copurchase] Wrote ${rows.length} rows.`)
}

// Only run when executed directly (`npx tsx refresh-product-copurchase.ts`),
// not when buildPairCounts is imported for a unit test.
const isMain = process.argv[1] && process.argv[1].endsWith('refresh-product-copurchase.ts')
if (isMain) {
  main().catch(err => {
    console.error('[copurchase] Failed:', err)
    process.exit(1)
  })
}

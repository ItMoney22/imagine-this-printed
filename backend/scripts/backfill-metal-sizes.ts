// ---------------------------------------------------------------------------
// Backfill canonical size/price metadata onto legacy metal-art product rows,
// and deactivate any active row that turns out to be unsellable (no artwork).
//
// Watchtower task 0c72fd16-9714-4dc2-8bd9-6263e7f80916 (Levi James,
// 2026-09-22). Context: 34 products carry category metal-art; only the two
// rows already fixed during the 2026-09-02 "fourth wave" (see TASK_NOTES.md)
// carry the full canonical shape. Every OTHER reader of a metal row's price
// (unitBasePrice/lineBasePrice client-side, computeLineItemCents server-side)
// already ignores `products.price` and prices off METAL_ART_PRICES via
// isMetalProductRow/metalSizesFor, so this is not fixing a live mispricing
// bug — it is making the stored metadata match what the code already assumes,
// per backend/shared/metal-art.ts (the single source of truth), so:
//   (a) any FUTURE reader that trusts metadata.metal_sizes directly (instead
//       of going through metalSizesFor()'s "default to both sizes" fallback)
//       gets a correct, explicit answer instead of an absent field, and
//   (b) the admin editor / Etsy sync / size picker all show the real,
//       intentional per-size price table instead of a stale flat number.
//
// Canonical shape written to every ACTIVE metal-art row (mirrors exactly what
// POST /:id/step/sizes writes — see backend/routes/admin/ai-products-step-flow.ts):
//   products.price            = METAL_ART_PRICES[smallest offered size] (8.95)
//   products.sizes            = ['4x6', '8x10']
//   metadata.metal_sizes      = ['4x6', '8x10']
//   metadata.metal_size       = '8x10' (largest — drives mockup scale anchor)
//   metadata.metal_prices     = { '4x6': 8.95, '8x10': 16.95 }
// All other metadata keys are preserved (spread), never dropped.
//
// A row already carrying the exact canonical shape is left untouched (no
// no-op writes, no updated_at churn).
//
// DEACTIVATION: any row where is_active/status currently reads as "active"
// but has NO artwork at all (no images[], no metadata.assets.{display,clean,
// mockups[0]}) is unsellable — it can't render on the storefront — and gets
// is_active:false, status:'draft'. As of the 2026-09-22 audit this bucket is
// EMPTY (all 20 active rows have real artwork); the check runs every time in
// case a future row regresses.
//
// Idempotent + safe to re-run. Writes a timestamped JSON snapshot of every
// row's PRE-CHANGE state to backend/scripts/.backfill-metal-sizes-backup-<ts>.json
// before touching anything, so any write here is trivially reversible.
//
// Usage (from backend/):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-metal-sizes.ts --dry-run
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-metal-sizes.ts
// ---------------------------------------------------------------------------
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { METAL_ART_PRICES, normalizeMetalSizeKey, type MetalArtSizeKey } from '../shared/metal-art.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in env')
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

const DRY_RUN = process.argv.includes('--dry-run')
const CANONICAL: MetalArtSizeKey[] = ['4x6', '8x10']
const CANONICAL_PRICES: Record<MetalArtSizeKey, number> = { '4x6': METAL_ART_PRICES['4x6'], '8x10': METAL_ART_PRICES['8x10'], '8x11': METAL_ART_PRICES['8x11'] }
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

function hasArt(row: any): boolean {
  const images = Array.isArray(row.images) ? row.images.filter(Boolean) : []
  const assets = row.metadata?.assets
  const assetUrl = assets && typeof assets === 'object' ? (assets.display || assets.clean || (Array.isArray(assets.mockups) && assets.mockups[0])) : null
  return images.length > 0 || !!assetUrl
}

function isActiveRow(row: any): boolean {
  return row.is_active !== false && row.status !== 'archived' && row.status !== 'deleted'
}

function matchesCanonical(row: any): boolean {
  const metaSizes = Array.isArray(row.metadata?.metal_sizes)
    ? (row.metadata.metal_sizes.map(normalizeMetalSizeKey).filter(Boolean) as MetalArtSizeKey[])
    : []
  const colSizes = Array.isArray(row.sizes)
    ? (row.sizes.map(normalizeMetalSizeKey).filter(Boolean) as MetalArtSizeKey[])
    : []
  const sameSet = (a: MetalArtSizeKey[]) => a.length === CANONICAL.length && CANONICAL.every(k => a.includes(k))
  const priceOk = Number(row.price) === CANONICAL_PRICES['4x6']
  const metalPricesOk =
    row.metadata?.metal_prices &&
    Number(row.metadata.metal_prices['4x6']) === CANONICAL_PRICES['4x6'] &&
    Number(row.metadata.metal_prices['8x10']) === CANONICAL_PRICES['8x10']
  const metalSizeOk = row.metadata?.metal_size === '8x10'
  return sameSet(metaSizes) && sameSet(colSizes) && priceOk && !!metalPricesOk && metalSizeOk
}

async function run() {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, slug, category, status, is_active, price, sizes, images, metadata, created_at')
    .or('category.eq.metal-art,category.eq.metal-arts,category.eq.metal')
    .order('created_at', { ascending: true })
  if (error) throw new Error(`query failed: ${error.message}`)
  const rows = data || []
  console.log(`backfill-metal-sizes: ${rows.length} metal-art rows found${DRY_RUN ? ' (DRY RUN)' : ''}\n`)

  if (!DRY_RUN) {
    const backupPath = path.join(SCRIPT_DIR, `.backfill-metal-sizes-backup-${Date.now()}.json`)
    fs.writeFileSync(backupPath, JSON.stringify(rows, null, 2))
    console.log(`Pre-change snapshot written: ${backupPath}\n`)
  }

  const plan: Array<Record<string, unknown>> = []
  let metadataUpdates = 0
  let deactivations = 0
  let untouched = 0

  for (const row of rows) {
    const active = isActiveRow(row)

    if (active && !hasArt(row)) {
      // Unsellable: active but nothing to render. Deactivate.
      plan.push({ id: row.id, name: (row.name || '').slice(0, 40), action: 'DEACTIVATE (no artwork)' })
      deactivations++
      if (!DRY_RUN) {
        const { error: updErr } = await supabase
          .from('products')
          .update({ is_active: false, status: 'draft' })
          .eq('id', row.id)
        if (updErr) throw new Error(`deactivate failed for ${row.id}: ${updErr.message}`)
      }
      continue
    }

    if (!active) {
      // Already inactive/draft — leave metadata alone, nothing to backfill.
      plan.push({ id: row.id, name: (row.name || '').slice(0, 40), action: 'skip (already inactive)' })
      untouched++
      continue
    }

    if (matchesCanonical(row)) {
      plan.push({ id: row.id, name: (row.name || '').slice(0, 40), action: 'skip (already canonical)' })
      untouched++
      continue
    }

    const update = {
      price: CANONICAL_PRICES['4x6'],
      sizes: [...CANONICAL],
      metadata: {
        ...(row.metadata || {}),
        metal_sizes: [...CANONICAL],
        metal_size: '8x10' as MetalArtSizeKey,
        metal_prices: { '4x6': CANONICAL_PRICES['4x6'], '8x10': CANONICAL_PRICES['8x10'] }
      }
    }
    plan.push({
      id: row.id,
      name: (row.name || '').slice(0, 40),
      action: `BACKFILL price ${row.price} -> ${update.price}`
    })
    metadataUpdates++
    if (!DRY_RUN) {
      const { error: updErr } = await supabase.from('products').update(update).eq('id', row.id)
      if (updErr) throw new Error(`backfill failed for ${row.id}: ${updErr.message}`)
    }
  }

  console.table(plan)
  console.log('\n--- Summary ---')
  console.log(`Metadata backfilled: ${metadataUpdates}`)
  console.log(`Deactivated (no art): ${deactivations}`)
  console.log(`Untouched (already ok / already inactive): ${untouched}`)
  if (DRY_RUN) console.log('\nDRY RUN — no writes made. Re-run without --dry-run to apply.')
}

run().catch(err => {
  console.error('backfill-metal-sizes failed:', err?.message || err)
  process.exit(1)
})

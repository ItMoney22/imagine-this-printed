// ---------------------------------------------------------------------------
// Audit every metal-art product row against the canonical size/price table in
// backend/shared/metal-art.ts (METAL_ART_PRICES / metalSizesFor).
//
// Watchtower task 0c72fd16-9714-4dc2-8bd9-6263e7f80916 (Levi James,
// 2026-09-22): measured on prod that only 2 of 34 metal-art rows carried
// metadata.metal_sizes, so most active rows relied on metalSizesFor()'s
// implicit "both sizes" fallback rather than an explicit, auditable value.
// This script is read-only — it reports what backfill-metal-sizes.ts (the
// write half) would do, without touching the database.
//
// Usage (from backend/, reads env from process.env — see backfill script's
// header for how to supply SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY):
//   npx tsx scripts/audit-metal-art-sizes.ts
// ---------------------------------------------------------------------------
import { createClient } from '@supabase/supabase-js'
import { normalizeMetalSizeKey, type MetalArtSizeKey } from '../shared/metal-art.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in env')
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

const CANONICAL: MetalArtSizeKey[] = ['4x6', '8x10']

function hasArt(row: any): boolean {
  const images = Array.isArray(row.images) ? row.images.filter(Boolean) : []
  const assets = row.metadata?.assets
  const assetUrl = assets && typeof assets === 'object' ? (assets.display || assets.clean || (Array.isArray(assets.mockups) && assets.mockups[0])) : null
  return images.length > 0 || !!assetUrl
}

async function run() {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, slug, category, status, is_active, price, sizes, images, metadata, created_at')
    .or('category.eq.metal-art,category.eq.metal-arts,category.eq.metal')
    .order('created_at', { ascending: true })
  if (error) throw new Error(`query failed: ${error.message}`)

  const rows = data || []
  console.log(`Found ${rows.length} products under metal-art category aliases.\n`)

  const summary: Array<Record<string, unknown>> = []
  let activeMissingMeta = 0
  let activeOk = 0
  let inactiveCount = 0
  let activeNoArt = 0

  for (const row of rows) {
    const metaSizes: unknown[] = Array.isArray(row.metadata?.metal_sizes) ? row.metadata.metal_sizes : []
    const normalizedMeta = metaSizes.map(normalizeMetalSizeKey).filter(Boolean) as MetalArtSizeKey[]
    const metaMatchesCanonical =
      normalizedMeta.length === CANONICAL.length && CANONICAL.every(k => normalizedMeta.includes(k))
    const columnSizes: unknown[] = Array.isArray(row.sizes) ? row.sizes : []
    const normalizedColumn = columnSizes.map(normalizeMetalSizeKey).filter(Boolean) as MetalArtSizeKey[]
    const artPresent = hasArt(row)

    const active = row.is_active !== false && row.status !== 'archived' && row.status !== 'deleted'
    if (!active) inactiveCount++
    if (active && !artPresent) activeNoArt++
    if (active && metaMatchesCanonical) activeOk++
    if (active && !metaMatchesCanonical) activeMissingMeta++

    summary.push({
      id: row.id,
      name: (row.name || '').slice(0, 40),
      status: row.status,
      is_active: row.is_active,
      price: row.price,
      sizes_col: normalizedColumn.join('|') || '(none)',
      metadata_metal_sizes: normalizedMeta.join('|') || '(none)',
      matches_canonical: metaMatchesCanonical,
      has_art: artPresent
    })
  }

  console.table(summary)
  console.log('\n--- Totals ---')
  console.log(`Total rows:                 ${rows.length}`)
  console.log(`Inactive/archived already:  ${inactiveCount}`)
  console.log(`Active, metadata OK:        ${activeOk}`)
  console.log(`Active, metadata MISSING:   ${activeMissingMeta}`)
  console.log(`Active but NO artwork/img:  ${activeNoArt} (candidate for deactivation)`)
}

run().catch(err => {
  console.error('audit failed:', err?.message || err)
  process.exit(1)
})

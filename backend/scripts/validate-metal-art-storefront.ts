// ---------------------------------------------------------------------------
// Storefront validation for the metal-art backfill (Watchtower task
// 0c72fd16-9714-4dc2-8bd9-6263e7f80916). Read-only.
//
// Runs the REAL storefront classification/pricing code (src/lib/product-kind.ts
// — the same module ProductPage/ProductCard/Cart import) against every live
// metal-art row, so this proves what the storefront will actually render, not
// a reimplementation of the rule that could drift from it.
//
// Checks per ACTIVE row:
//   - productKindOf(row) === 'metal'      (classified correctly at all)
//   - hasPriceRange(row) === true         (size picker renders, not a flat price)
//   - metalSizeOptions(row) === ['4x6','8x10']  (both canonical sizes offered)
//   - unitBasePrice(row, '4x6') === 8.95  (never falls back to products.price)
//   - unitBasePrice(row, '8x10') === 16.95
//
// Usage (from backend/):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/validate-metal-art-storefront.ts
// ---------------------------------------------------------------------------
import { createClient } from '@supabase/supabase-js'
import { productKindOf, hasPriceRange, metalSizeOptions, unitBasePrice } from '../../src/lib/product-kind.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in env')
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

async function run() {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, category, status, is_active, price, sizes, metadata')
    .or('category.eq.metal-art,category.eq.metal-arts,category.eq.metal')
  if (error) throw new Error(`query failed: ${error.message}`)
  const rows = data || []
  const active = rows.filter(r => r.is_active !== false && r.status !== 'archived' && r.status !== 'deleted')

  console.log(`Validating ${active.length} active metal-art rows against src/lib/product-kind.ts...\n`)

  const failures: Array<Record<string, unknown>> = []
  for (const row of active) {
    const kind = productKindOf(row as any)
    const range = hasPriceRange(row as any)
    const options = metalSizeOptions(row as any)
    const price4x6 = unitBasePrice(row as any, '4x6')
    const price8x10 = unitBasePrice(row as any, '8x10')

    const ok =
      kind === 'metal' &&
      range === true &&
      options.length === 2 &&
      options.includes('4x6') &&
      options.includes('8x10') &&
      price4x6 === 8.95 &&
      price8x10 === 16.95

    if (!ok) {
      failures.push({ id: row.id, name: row.name, kind, hasPriceRange: range, options: options.join('|'), price4x6, price8x10 })
    }
  }

  if (failures.length === 0) {
    console.log(`PASS — all ${active.length} active metal-art rows classify as 'metal', show the size picker, and price 4x6=$8.95 / 8x10=$16.95 via unitBasePrice (never flat products.price).`)
  } else {
    console.log(`FAIL — ${failures.length} row(s) would not render correctly:`)
    console.table(failures)
    process.exit(1)
  }
}

run().catch(err => {
  console.error('validate-metal-art-storefront failed:', err?.message || err)
  process.exit(1)
})

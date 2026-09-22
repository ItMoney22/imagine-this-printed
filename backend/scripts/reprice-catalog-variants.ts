// ---------------------------------------------------------------------------
// Stamp variant retail prices onto the printed-apparel catalogue.
//
// Watchtower 767f74d4. Reads public.blank_variant_costs (written by
// scripts/sync-jiffy-costs.ts), applies the house rule
//
//     Retail = (blank_variant_cost * 1.20) + decoration_cost
//
// and writes the resulting table to products.metadata.garment.variant_pricing,
// which is what src/lib/product-kind.ts (product page / cart / checkout) and
// backend/services/order-pricing.ts (the authoritative re-price) both read.
//
// WHAT MOVES AND WHAT DOES NOT. The decoration half is DERIVED from the
// listing's existing price against its base blank, so the base variant
// (standard tier, base size band) keeps exactly the price it has today.
// Nothing about a headline price changes. What changes is the upcharge for the
// variants that genuinely cost more -- a 5XL Top Line tee was collecting
// $2.50 + $7.00 against a blank that costs $12.62 more than the base.
//
// UNDERWATER LISTINGS ARE SKIPPED BY DEFAULT. A listing priced at or below its
// own blank cost (the $15 hoodie against a $15.09 Gildan 18500) cannot derive
// an honest decoration cost, and repricing it would MOVE A LISTED PRICE. That
// is David's call, not a script's -- they are reported and left alone unless
// --include-underwater is passed.
//
// USAGE (from backend/, reads backend/.env):
//   npx tsx --env-file=.env scripts/reprice-catalog-variants.ts --dry-run
//   npx tsx --env-file=.env scripts/reprice-catalog-variants.ts
//   npx tsx --env-file=.env scripts/reprice-catalog-variants.ts --include-underwater
//   npx tsx --env-file=.env scripts/reprice-catalog-variants.ts --markup 25
//   npx tsx --env-file=.env scripts/reprice-catalog-variants.ts --status all
//   npx tsx --env-file=.env scripts/reprice-catalog-variants.ts --product <uuid>
//
// Idempotent: re-running recomputes from the current costs and rewrites the
// stamp in place. Run it after every scripts/sync-jiffy-costs.ts.
// ---------------------------------------------------------------------------
import dotenv from 'dotenv'
dotenv.config({ override: true })

import { supabase } from '../lib/supabase.js'
import { loadVariantCosts, priceProduct } from '../services/variant-cost-resolver.js'
import { HOUSE_MARKUP_PCT, variantUnitPriceDollars } from '../shared/variant-pricing.js'
import { isBlankGarmentMeta } from '../shared/blank-pricing.js'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

const DRY_RUN = flag('dry-run')
const INCLUDE_UNDERWATER = flag('include-underwater')
const MARKUP = Number(opt('markup') ?? HOUSE_MARKUP_PCT)
const STATUS = opt('status') || 'active'
const ONLY_PRODUCT = opt('product') || null

if (!Number.isFinite(MARKUP) || MARKUP < 0) throw new Error(`--markup must be a number, got ${opt('markup')}`)

const APPAREL_CATEGORIES = ['shirts', 't-shirts', 'hoodies', 'apparel']

interface ProductRow {
  id: string
  name: string
  category: string | null
  price: number
  status: string | null
  metadata: Record<string, any> | null
}

async function loadProducts(): Promise<ProductRow[]> {
  let q = supabase.from('products').select('id, name, category, price, status, metadata')
  if (ONLY_PRODUCT) q = q.eq('id', ONLY_PRODUCT)
  else {
    q = q.in('category', APPAREL_CATEGORIES)
    if (STATUS !== 'all') q = q.eq('status', STATUS)
  }
  const { data, error } = await q
  if (error) throw new Error(`Failed to load products: ${error.message}`)
  return (data || []) as ProductRow[]
}

async function run() {
  console.log(
    `reprice-catalog-variants: markup=${MARKUP}% status=${STATUS}${ONLY_PRODUCT ? ` product=${ONLY_PRODUCT}` : ''}` +
      `${INCLUDE_UNDERWATER ? ' +underwater' : ''}${DRY_RUN ? ' (DRY RUN)' : ''}`
  )

  const { index, oldestSync, rows } = await loadVariantCosts()
  if (rows === 0) {
    console.error('blank_variant_costs is empty — run scripts/sync-jiffy-costs.ts first')
    process.exit(1)
  }
  console.log(`  loaded ${rows} supplier costs across ${index.size} styles (oldest sync ${oldestSync ?? 'unknown'})`)

  const products = await loadProducts()
  console.log(`  ${products.length} candidate product(s)`)

  const applied: Array<Record<string, unknown>> = []
  const underwater: Array<Record<string, unknown>> = []
  const skipped: Array<Record<string, unknown>> = []

  for (const p of products) {
    if (isBlankGarmentMeta(p.metadata)) {
      // Blanks already price off their own size x colour table (blank-pricing.ts).
      skipped.push({ product: p.name.slice(0, 40), why: 'blank garment — priced by seed-blanks.ts' })
      continue
    }

    const result = priceProduct(index, {
      garmentId: p.metadata?.product_type ?? p.metadata?.garment?.id ?? null,
      category: p.category,
      listingPrice: Number(p.price),
      syncedAt: oldestSync,
      markupPct: MARKUP
    })

    if ('error' in result) {
      skipped.push({ product: p.name.slice(0, 40), why: result.error })
      continue
    }

    const { pricing, baseCost, decorationCost } = result
    const before = Number(p.price)
    const baseAfter = variantUnitPriceDollars(pricing, 'M', null, 'standard') ?? variantUnitPriceDollars(pricing, 'L', null, 'standard')
    const row = {
      product: p.name.slice(0, 38),
      garment: result.garmentId,
      listed: `$${before.toFixed(2)}`,
      'blank M': `$${baseCost.toFixed(2)}`,
      decoration: `$${decorationCost.toFixed(2)}`,
      'base now': baseAfter != null ? `$${baseAfter.toFixed(2)}` : '—',
      '2XL': fmt(variantUnitPriceDollars(pricing, '2XL', null, 'standard')),
      '3XL': fmt(variantUnitPriceDollars(pricing, '3XL', null, 'standard')),
      'top 3XL': fmt(variantUnitPriceDollars(pricing, '3XL', null, 'heavyweight')),
      youth: fmt(variantUnitPriceDollars(pricing, 'YM', null, 'standard'))
    }

    if (result.underwater && !INCLUDE_UNDERWATER) {
      underwater.push({ ...row, loss: `$${(before - baseCost * (1 + MARKUP / 100)).toFixed(2)}` })
      continue
    }
    applied.push(row)

    if (DRY_RUN) continue

    const metadata = { ...(p.metadata || {}) }
    metadata.garment = { ...(metadata.garment || {}), variant_pricing: pricing }
    const { error } = await supabase.from('products').update({ metadata }).eq('id', p.id)
    if (error) throw new Error(`update failed for ${p.id}: ${error.message}`)
  }

  if (applied.length) {
    console.log(`\n${DRY_RUN ? 'WOULD STAMP' : 'STAMPED'} — ${applied.length} product(s):`)
    console.table(applied)
  }
  if (underwater.length) {
    console.log(`\nUNDERWATER — ${underwater.length} listing(s) priced at or below their own blank. NOT touched.`)
    console.log('These need a listed price change, which is David\'s call. Re-run with --include-underwater once ruled on.')
    console.table(underwater)
  }
  if (skipped.length) {
    console.log(`\nSKIPPED — ${skipped.length}:`)
    const why = new Map<string, number>()
    for (const s of skipped) why.set(String(s.why), (why.get(String(s.why)) ?? 0) + 1)
    console.table([...why.entries()].map(([reason, count]) => ({ reason: reason.slice(0, 90), count })))
  }

  console.log(
    `\n${DRY_RUN ? 'DRY RUN — nothing written.' : `Done. ${applied.length} product(s) now price per variant.`}` +
      ` Admin > Margins shows cost vs retail vs margin.`
  )
}

function fmt(v: number | null): string {
  return v == null ? '—' : `$${v.toFixed(2)}`
}

run().catch(err => {
  console.error('reprice-catalog-variants failed:', err?.message || err)
  process.exit(1)
})

// Reconcile the Design Performance report against the raw tables (task 47174caa).
//
//   cd backend && npx tsx --env-file=.env scripts/design-performance-reconcile.ts [days=30]
//
// For every product on the report, re-counts its design_events rows by type and
// its paid order lines straight off the tables (no aggregation function) and
// compares them with the report's numbers for that product, summed across
// every variant it appears under. Read-only. Exits 1 on any mismatch.
import { loadDesignPerformance, rawCountsForProduct } from '../services/design-performance.js'

const days = Number(process.argv[2]) || 30

async function main() {
  const until = new Date()
  const report = await loadDesignPerformance(days, until)

  const byProduct = new Map<string, { name: string; impression: number; click: number; detail_view: number; add_to_cart: number; order: number }>()
  for (const v of report.variants) {
    for (const p of v.products) {
      const t = byProduct.get(p.id) || { name: p.name, impression: 0, click: 0, detail_view: 0, add_to_cart: 0, order: 0 }
      t.impression += p.counts.impressions
      t.click += p.counts.clicks
      t.detail_view += p.counts.detailViews
      t.add_to_cart += p.counts.addToCarts
      t.order += p.counts.orders
      byProduct.set(p.id, t)
    }
  }

  let checked = 0
  const mismatches: string[] = []
  for (const [productId, reported] of byProduct) {
    const raw = await rawCountsForProduct(productId, days, until)
    checked++
    for (const key of ['impression', 'click', 'detail_view', 'add_to_cart', 'order'] as const) {
      if (raw.counts[key] !== reported[key]) {
        mismatches.push(`${reported.name} (${productId}) ${key}: report ${reported[key]} vs raw ${raw.counts[key]}`)
      }
    }
    const busy = Object.values(raw.counts).some(n => n > 0)
    if (busy) {
      console.log(`${reported.name.slice(0, 40).padEnd(40)} views ${raw.counts.impression} clicks ${raw.counts.click} pages ${raw.counts.detail_view} carts ${raw.counts.add_to_cart} orders ${raw.counts.order}`)
    }
  }

  console.log(`\n${days}-day window ${report.window.since} -> ${report.window.until}`)
  console.log(`checked ${checked} products across ${report.variants.length} prompt variants; shop CTR ${report.store.rates.ctr ?? 'n/a'}`)
  if (mismatches.length) {
    console.log(`MISMATCH x${mismatches.length}\n${mismatches.join('\n')}`)
    process.exit(1)
  }
  console.log('RECONCILED: every product on the report matches its raw event and order counts')
  process.exit(0)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})

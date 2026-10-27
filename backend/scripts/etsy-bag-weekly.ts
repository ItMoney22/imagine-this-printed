// Weekly count for the Etsy bag card (Watchtower task 8cde2a1d). Read-only.
//
//   cd backend && npx tsx --env-file=.env scripts/etsy-bag-weekly.ts [weeks]
//
// Same numbers as the admin page /admin/etsy-bag-card (both read
// services/etsy-bag-report.ts).

import { createClient } from '@supabase/supabase-js'
import { loadEtsyBagWeeks } from '../services/etsy-bag-report.js'
import { ETSY_BAG } from '../shared/etsy-bag.js'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (run with --env-file=.env).')
  process.exit(1)
}

const weeks = await loadEtsyBagWeeks(createClient(url, key), { weeks: Number(process.argv[2]) || 8 })

console.log(`${ETSY_BAG.code} — Etsy bag card, week by week (Mondays, UTC)`)
console.log('week of     redeemed   sales   discount   QR orders   unpaid checkouts')
for (const w of weeks) {
  console.log(
    `${w.weekStart}  ${String(w.redemptions).padStart(8)}  ${('$' + w.sales.toFixed(2)).padStart(8)}  ${('$' + w.discountGiven.toFixed(2)).padStart(9)}  ${String(w.qrOrders).padStart(10)}  ${String(w.unpaidCheckouts).padStart(17)}`
  )
}

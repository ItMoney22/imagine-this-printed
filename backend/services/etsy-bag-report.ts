// Weekly count for the Etsy bag card (Watchtower task 8cde2a1d): how many
// paid orders used ETSYBAG, and how many came in through the card's QR link
// (orders.attribution, captured at checkout since 3ed8aa2). Served to the
// admin print page by GET /api/admin/coupons/etsy-bag/weekly and printed by
// backend/scripts/etsy-bag-weekly.ts.

import { ETSY_BAG, summarizeEtsyBagWeeks, weekStartUtc, type EtsyBagOrderRow, type EtsyBagWeek } from '../shared/etsy-bag.js'

type OrdersDb = { from: (table: string) => any }

export const ETSY_BAG_REPORT_MAX_WEEKS = 52

export async function loadEtsyBagWeeks(db: OrdersDb, opts: { weeks?: number; now?: Date } = {}): Promise<EtsyBagWeek[]> {
  const weeks = Math.min(Math.max(Math.floor(opts.weeks ?? 8), 1), ETSY_BAG_REPORT_MAX_WEEKS)
  const now = opts.now ?? new Date()
  const from = new Date(`${weekStartUtc(now)}T00:00:00Z`)
  from.setUTCDate(from.getUTCDate() - 7 * (weeks - 1))

  const { utm_source, utm_medium, utm_campaign } = ETSY_BAG.utm
  const { data, error } = await db
    .from('orders')
    .select('id, created_at, payment_status, discount_codes, discount_amount, total, attribution')
    .gte('created_at', from.toISOString())
    .or(
      `discount_codes.cs.{${ETSY_BAG.code}},` +
        `and(attribution->>utm_source.eq.${utm_source},attribution->>utm_medium.eq.${utm_medium},attribution->>utm_campaign.eq.${utm_campaign})`
    )
  if (error) throw new Error(`Failed to load Etsy bag orders: ${error.message}`)
  return summarizeEtsyBagWeeks((data || []) as EtsyBagOrderRow[], { weeks, now })
}

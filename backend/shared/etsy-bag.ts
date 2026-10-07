// The Etsy bag insert card — one place for its facts (Watchtower task 8cde2a1d).
//
// David 2026-10-07: "when we sell something on Etsy, we're going to add a
// coupon code for the site, a little coupon in the bag." The card
// (src/components/etsy-bag/EtsyBagCard.tsx), its print page
// (src/pages/admin/EtsyBagCardPage.tsx) and the weekly count
// (backend/services/etsy-bag-report.ts) all read from here, so the code on
// the card, the QR link and what the report counts can never disagree.
//
// The discount itself lives in the discount_codes row with this code
// (15% off, per_user_limit 1, metadata.first_order_only = true). Changing
// the amount means changing that row AND percentOff below.
//
// The QR image is generated from `url`, not drawn by hand:
//   npx qrcode -t svg -e M -o public/etsy-bag/etsy-bag-qr.svg "<url>"
// Regenerate it if `url` ever changes.

export const ETSY_BAG = {
  code: 'ETSYBAG',
  percentOff: 15,
  utm: { utm_source: 'etsy', utm_medium: 'insert', utm_campaign: 'bag' },
  url: 'https://imaginethisprinted.com/?utm_source=etsy&utm_medium=insert&utm_campaign=bag',
  displayUrl: 'imaginethisprinted.com',
  qrImage: '/etsy-bag/etsy-bag-qr.svg',
  /**
   * Etsy's Off-Platform Transactions Policy (last updated 2026-10-05, read
   * live 2026-10-07) says sellers may not offer "off-platform discounts ...
   * that encourage members to purchase off Etsy" or use "a QR code to direct
   * members off Etsy". This card does both, so it stays on hold until David
   * rules on the approval card (see the task 8cde2a1d handoff). The print
   * page shows the hold; flip to false once he says go.
   */
  onHoldForEtsyPolicy: true
} as const

export interface EtsyBagOrderRow {
  id: string
  created_at: string
  payment_status: string | null
  discount_codes: string[] | null
  discount_amount: number | string | null
  total: number | string | null
  attribution: Record<string, unknown> | null
}

export interface EtsyBagWeek {
  /** Monday of the week, YYYY-MM-DD (UTC). */
  weekStart: string
  /** Paid orders that used the code — the redemption count. */
  redemptions: number
  /** What those orders took in, after the discount. */
  sales: number
  /** What the code gave away. */
  discountGiven: number
  /** Paid orders that arrived through the card's QR link (code used or not). */
  qrOrders: number
  /** Checkouts that carried the code or the QR link but never paid. */
  unpaidCheckouts: number
}

const EVER_PAID = new Set(['paid', 'refunded', 'partially_refunded', 'disputed'])

export function usedEtsyBagCode(row: Pick<EtsyBagOrderRow, 'discount_codes'>): boolean {
  return (row.discount_codes || []).some(c => String(c).toUpperCase() === ETSY_BAG.code)
}

export function cameFromEtsyBagQr(row: Pick<EtsyBagOrderRow, 'attribution'>): boolean {
  const a = row.attribution || {}
  return (
    a.utm_source === ETSY_BAG.utm.utm_source &&
    a.utm_medium === ETSY_BAG.utm.utm_medium &&
    a.utm_campaign === ETSY_BAG.utm.utm_campaign
  )
}

/** Monday 00:00 UTC of the week `date` falls in, as YYYY-MM-DD. */
export function weekStartUtc(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const sinceMonday = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - sinceMonday)
  return d.toISOString().slice(0, 10)
}

const cents = (v: number | string | null) => Math.round((Number(v) || 0) * 100)

/**
 * One row per week, newest first, for the last `weeks` weeks (including the
 * current one) — weeks with nothing in them still appear as zeros, so "no
 * redemptions" reads as a real answer rather than a missing row.
 */
export function summarizeEtsyBagWeeks(rows: EtsyBagOrderRow[], opts: { weeks: number; now?: Date }): EtsyBagWeek[] {
  const now = opts.now ?? new Date()
  const byWeek = new Map<string, EtsyBagWeek & { _sales: number; _discount: number }>()
  const thisMonday = new Date(`${weekStartUtc(now)}T00:00:00Z`)
  for (let i = 0; i < opts.weeks; i++) {
    const d = new Date(thisMonday)
    d.setUTCDate(d.getUTCDate() - 7 * i)
    const key = d.toISOString().slice(0, 10)
    byWeek.set(key, { weekStart: key, redemptions: 0, sales: 0, discountGiven: 0, qrOrders: 0, unpaidCheckouts: 0, _sales: 0, _discount: 0 })
  }

  for (const row of rows) {
    const week = byWeek.get(weekStartUtc(new Date(row.created_at)))
    if (!week) continue
    const usedCode = usedEtsyBagCode(row)
    const viaQr = cameFromEtsyBagQr(row)
    if (!usedCode && !viaQr) continue
    if (!EVER_PAID.has(String(row.payment_status || '').toLowerCase())) {
      week.unpaidCheckouts++
      continue
    }
    if (viaQr) week.qrOrders++
    if (usedCode) {
      week.redemptions++
      week._sales += cents(row.total)
      week._discount += cents(row.discount_amount)
    }
  }

  return [...byWeek.values()].map(({ _sales, _discount, ...week }) => ({
    ...week,
    sales: _sales / 100,
    discountGiven: _discount / 100
  }))
}

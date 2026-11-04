// The Etsy bag insert card — one place for its facts (Watchtower tasks
// 8cde2a1d, d9a98efc).
//
// David 2026-10-07: "when we sell something on Etsy, we're going to add a
// coupon code for the site, a little coupon in the bag." Etsy's Off-Platform
// Transactions Policy (last updated 2026-10-05, re-read live 2026-10-07,
// etsy.com/legal/policy/off-platform-transactions-policy/1254654515806) bans
// exactly that in an Etsy order: "off-platform discounts ... that encourage
// members to purchase off Etsy", "using a QR code to direct members off Etsy"
// and "instructing a member to purchase an item through an off-platform
// destination, such as a personal website". Breaking it puts Christina's
// Etsy shop at risk. So (decision d9a98efc, option A) the card in the bag
// carries an Etsy SHOP promo code for the buyer's next Etsy order — Etsy says
// sellers may share those "anywhere" — and nothing that points off Etsy: no
// site discount, no QR, no website, no off-Etsy email.
//
// Christina makes the promo code in Etsy Shop Manager and types it on the
// print page (src/pages/admin/EtsyBagCardPage.tsx); it is stored in
// admin_settings under ETSY_BAG_CARD.settingsKey. Until a code is saved, the
// page will not print.
//
// ETSY_BAG below is the WEBSITE code, which stays live for pickup orders,
// markets and social — never for Etsy orders. Its discount lives in the
// discount_codes row with this code (15% off, per_user_limit 1,
// metadata.first_order_only = true); the weekly count
// (backend/services/etsy-bag-report.ts) reads it from here.

export const ETSY_BAG = {
  code: 'ETSYBAG',
  percentOff: 15,
  utm: { utm_source: 'etsy', utm_medium: 'insert', utm_campaign: 'bag' },
  url: 'https://imaginethisprinted.com/?utm_source=etsy&utm_medium=insert&utm_campaign=bag'
} as const

export const ETSY_BAG_CARD = {
  settingsKey: 'etsy_bag_card',
  /** The Etsy shop the card sends buyers back to. */
  etsyShopName: 'ImagineThisPrinted1',
  /** Suggested name and amount for the Etsy promo code; Christina decides. */
  suggestedCode: 'THANKYOU15',
  suggestedPercentOff: 15,
  /** Etsy allows a whole-number percentage from 5 to 75 (help.etsy.com 115014260108, read 2026-10-07). */
  minPercentOff: 5,
  maxPercentOff: 75
} as const

/** What Christina saved on the print page: her Etsy shop promo code. */
export interface EtsyShopCoupon {
  code: string
  percentOff: number
  savedAt: string
  savedBy: string | null
}

export type EtsyShopCouponCheck =
  | { ok: true; code: string; percentOff: number }
  | { ok: false; error: string }

// Etsy promo codes are 5-20 letters or numbers, no spaces or punctuation
// (Etsy's code field; older Etsy guides state it — not re-verified live).
const ETSY_CODE = /^[A-Z0-9]{5,20}$/

/**
 * Checks what was typed for the Etsy promo code. The code is upper-cased
 * (Etsy codes are not case-sensitive) and otherwise kept exactly as typed.
 */
export function checkEtsyShopCoupon(input: { code?: unknown; percentOff?: unknown }): EtsyShopCouponCheck {
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : ''
  if (!code) return { ok: false, error: 'Type the promo code you made in Etsy.' }
  if (!ETSY_CODE.test(code)) return { ok: false, error: 'Etsy codes are 5 to 20 letters or numbers, with no spaces.' }
  if (code === ETSY_BAG.code) {
    return { ok: false, error: `${ETSY_BAG.code} is the website code. Make a separate promo code in Etsy for the card.` }
  }
  const percentOff = typeof input.percentOff === 'string' ? Number(input.percentOff.trim()) : input.percentOff
  if (
    typeof percentOff !== 'number' ||
    !Number.isInteger(percentOff) ||
    percentOff < ETSY_BAG_CARD.minPercentOff ||
    percentOff > ETSY_BAG_CARD.maxPercentOff
  ) {
    return { ok: false, error: `Use the same whole-number percent you set in Etsy (${ETSY_BAG_CARD.minPercentOff} to ${ETSY_BAG_CARD.maxPercentOff}).` }
  }
  return { ok: true, code, percentOff }
}

/** A stored setting is only trusted if it still passes the same check. */
export function readEtsyShopCoupon(value: unknown): EtsyShopCoupon | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const checked = checkEtsyShopCoupon({ code: v.code, percentOff: v.percentOff })
  if (!checked.ok) return null
  return {
    code: checked.code,
    percentOff: checked.percentOff,
    savedAt: typeof v.savedAt === 'string' ? v.savedAt : '',
    savedBy: typeof v.savedBy === 'string' ? v.savedBy : null
  }
}

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

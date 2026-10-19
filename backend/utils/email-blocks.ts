// ============================================================================
// Email fragments shared by the hand-written templates (utils/email.ts) and the
// AI writer's layout (services/emailAI.ts).
//
// This module exists so the coupon card has exactly ONE implementation. The
// discount code it prints is a real row in `discount_codes`; if the AI writer
// were left to phrase it, or a second copy of this markup drifted, a customer
// would be handed a code that doesn't validate at checkout.
// ============================================================================

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://imaginethisprinted.com'

export interface EmailCoupon {
  code: string
  percent: number
  expiresAt?: string | null
}

const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** The thank-you coupon card. Empty string when there's no coupon to show. */
export function couponBlockHtml(coupon?: EmailCoupon | null): string {
  if (!coupon?.code) return ''

  const expires = coupon.expiresAt
    ? new Date(coupon.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null

  return `
    <div style="background: linear-gradient(135deg, #fdf4ff 0%, #eef2ff 100%); border: 2px dashed #a855f7; border-radius: 16px; padding: 26px; margin: 25px 0; text-align: center;">
      <p style="color: #7c3aed; font-size: 13px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; margin: 0 0 8px;">A little thank you</p>
      <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">
        ${esc(String(coupon.percent))}% off your next order — because you gave us a shot.
      </p>
      <p style="margin: 0 0 10px;">
        <span style="display: inline-block; background: #ffffff; border: 1px solid #ddd6fe; border-radius: 10px; padding: 12px 22px; color: #4c1d95; font-size: 22px; font-weight: bold; font-family: 'Courier New', Courier, monospace; letter-spacing: 2px;">${esc(coupon.code)}</span>
      </p>
      <p style="color: #6b7280; font-size: 12px; margin: 0 0 16px;">
        Paste it at checkout.${expires ? ` Good through ${esc(expires)}.` : ''} One use, just for you.
      </p>
      <a href="${FRONTEND_URL}/catalog" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 13px 28px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 15px;">
        Spend It On Something Good
      </a>
    </div>
  `
}

// ---------------------------------------------------------------------------
// Order totals — one implementation for the hand-written confirmation and the
// AI writer's layout. Real order ITP-MTYGMM4V-UQ5X listed 2 x $20 with
// "Total $30.42" and no lines in between: the order row carried subtotal,
// discount, shipping and tax, but nothing handed them to the email.
// ---------------------------------------------------------------------------

export interface OrderTotals {
  subtotal?: number | null
  discount?: number | null
  shipping?: number | null
  tax?: number | null
}

export interface TotalsRow {
  label: string
  /** Signed dollars: negative renders as a minus. */
  amount: number
  strong?: boolean
}

const cents = (n: unknown): number => Math.round((Number(n) || 0) * 100)

const money = (dollars: number): string =>
  `${dollars < 0 ? '-' : ''}$${Math.abs(dollars).toFixed(2)}`

/**
 * Rows that always add up to `total`. Subtotal falls back to the item lines;
 * discount/shipping/tax are shown when known (shipping always, "Free" at 0).
 * If the pieces still don't reach the charged total (a legacy row, add-ons the
 * lines don't carry), one "Adjustments" row makes up the gap rather than
 * printing numbers that contradict each other.
 */
export function buildTotalsRows(
  items: Array<{ quantity: number; price: number }>,
  total: number,
  totals: OrderTotals = {}
): TotalsRow[] {
  const itemsCents = items.reduce((n, i) => n + cents(i.price) * (Number(i.quantity) || 1), 0)
  const subtotalCents = totals.subtotal != null ? cents(totals.subtotal) : itemsCents
  const discountCents = Math.abs(cents(totals.discount))
  const shippingCents = cents(totals.shipping)
  const taxCents = cents(totals.tax)
  const totalCents = cents(total)

  const rows: TotalsRow[] = [{ label: 'Subtotal', amount: subtotalCents / 100 }]
  if (discountCents > 0) rows.push({ label: 'Discount', amount: -discountCents / 100 })
  rows.push({ label: 'Shipping', amount: shippingCents / 100 })
  rows.push({ label: 'Tax', amount: taxCents / 100 })

  const gap = totalCents - (subtotalCents - discountCents + shippingCents + taxCents)
  if (gap !== 0) rows.splice(rows.length, 0, { label: 'Adjustments', amount: gap / 100 })

  rows.push({ label: 'Total', amount: totalCents / 100, strong: true })
  return rows
}

/** <tfoot> rows for the order table (3 columns: item, qty, price). */
export function totalsFootHtml(rows: TotalsRow[]): string {
  return rows
    .map(r => {
      const label = r.label
      const value = r.label === 'Shipping' && r.amount === 0 ? 'Free' : money(r.amount)
      return r.strong
        ? `<tr><td colspan="2" style="padding: 12px; font-weight: bold; color: #374151; border-top: 2px solid #e5e7eb;">${esc(label)}</td><td style="padding: 12px; text-align: right; font-weight: bold; color: #059669; font-size: 18px; border-top: 2px solid #e5e7eb;">${value}</td></tr>`
        : `<tr><td colspan="2" style="padding: 6px 12px; color: #6b7280; font-size: 14px;">${esc(label)}</td><td style="padding: 6px 12px; text-align: right; color: #6b7280; font-size: 14px;">${value}</td></tr>`
    })
    .join('')
}

/** Words that mean the parcel has moved. A confirmation must never say them. */
const SHIPPED_WORDS = /\b(on (its|their|the) way|shipped|shipping soon|in transit|out for delivery|delivered|arriv(ed|ing)|heading your way|has left)\b/i

/** True when a confirmation subject claims something that hasn't happened. */
export function subjectClaimsShipped(subject: string): boolean {
  return SHIPPED_WORDS.test(subject || '')
}

/** Greeting name for an inbound ticket: what the customer typed, else null. */
export function typedName(raw?: string | null): string | null {
  const name = (raw || '').trim().replace(/\s+/g, ' ')
  if (!name || name.length > 60 || name.includes('@') || /^(not provided|anonymous|n\/a)$/i.test(name)) return null
  return name
}

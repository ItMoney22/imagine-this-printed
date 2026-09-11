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

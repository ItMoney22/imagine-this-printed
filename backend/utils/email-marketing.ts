// COMMERCIAL email. Deliberately not in utils/email.ts.
//
// Everything in utils/email.ts is transactional — a receipt, a shipping notice,
// a support reply. Somebody asked for it by buying something, it needs no
// unsubscribe, and it must be delivered.
//
// This file is the other kind: mail nobody asked for, sent to make a sale. As
// of 2026-09-07 there is exactly one — the abandoned-checkout nudge — and the
// rules that apply to it are different enough that mixing the two in one file
// is how a future template quietly ships without an unsubscribe link:
//
//   * CAN-SPAM requires a working opt-out in the message, and that we honour it.
//   * Gmail and Yahoo require RFC 8058 one-click unsubscribe headers on bulk
//     mail. Omitting them costs domain reputation — and that domain also
//     carries the order confirmations, which genuinely have to land.
//   * A recipient with no unsubscribe button uses the spam button instead.
//
// The suppression check is free: sendEmailWithTracking (utils/email.ts) already
// refuses to send to any address in `email_suppressions`, and the unsubscribe
// route writes there — so one opt-out silences this permanently with no extra
// plumbing here.
import { sendEmailWithTracking, type SendEmailResult } from './email.js'
import { buildUnsubscribeUrl, unsubscribeHeaders } from './unsubscribe-token.js'

/** Escape untrusted product/customer values before interpolating into HTML. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** First name only, with an email address in the name column defended against. */
function greetingName(raw?: string | null): string {
  const first = String(raw || '').trim().split(/\s+/)[0]
  if (!first) return 'there'
  if (first.includes('@')) return 'there'
  return first
}

export interface AbandonedCartItem {
  name?: string | null
  quantity?: number | null
  price?: number | null
  image?: string | null
  size?: string | null
  color?: string | null
}

export interface AbandonedCartEmailInput {
  to: string
  customerName?: string | null
  items: AbandonedCartItem[]
  total: number
  /** Tokenized one-click cart restore URL — works without a login, on any device. */
  recoverUrl: string
  /** 'first' is the 4h nudge, 'second' the 24h last call. Then we stop. */
  stage: 'first' | 'second'
}

/**
 * "You left something in your cart."
 *
 * Two of these ever go out per abandoned checkout — see
 * backend/lib/abandoned-cart.ts for why the sequence stops at two.
 */
export async function sendAbandonedCartEmail(opts: AbandonedCartEmailInput): Promise<SendEmailResult> {
  const name = greetingName(opts.customerName)
  const unsubscribeUrl = buildUnsubscribeUrl(opts.to)
  const isLastCall = opts.stage === 'second'

  const subject = isLastCall
    ? `Still thinking it over, ${name}? Your cart is still here`
    : `${name}, you left something behind`

  // Cap the render at 6 lines so a 20-item cart doesn't produce a mail that
  // gets clipped by Gmail (which truncates around 102KB and hides the CTA).
  const shown = opts.items.slice(0, 6)
  const moreCount = Math.max(0, opts.items.length - shown.length)

  const itemRows = shown.map(item => {
    const qty = Number(item.quantity) || 1
    const variant = [item.size, item.color].filter(Boolean).join(' / ')
    const lineTotal = item.price != null ? `$${(Number(item.price) * qty).toFixed(2)}` : ''
    return `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;width:64px;">
            ${item.image
        ? `<img src="${esc(item.image)}" alt="" width="56" height="56" style="width:56px;height:56px;object-fit:cover;border-radius:10px;display:block;background:#f3f4f6;" />`
        : '<div style="width:56px;height:56px;border-radius:10px;background:#f3f4f6;"></div>'}
          </td>
          <td style="padding:12px 0 12px 14px;border-bottom:1px solid #e5e7eb;">
            <p style="margin:0;color:#111827;font-size:15px;font-weight:600;">${esc(item.name || 'Your custom item')}</p>
            ${variant ? `<p style="margin:3px 0 0;color:#6b7280;font-size:13px;">${esc(variant)}</p>` : ''}
            <p style="margin:3px 0 0;color:#6b7280;font-size:13px;">Qty ${qty}</p>
          </td>
          <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;text-align:right;color:#111827;font-size:15px;font-weight:600;white-space:nowrap;">${lineTotal}</td>
        </tr>`
  }).join('')

  const intro = isLastCall
    ? 'we saved your cart one more time in case you still want it. This is the last nudge - we will not email you about it again.'
    : 'we noticed you got as far as checkout and did not finish. Your cart is still saved, so you can pick up right where you left off.'

  return sendEmailWithTracking({
    to: opts.to,
    subject,
    headers: unsubscribeHeaders(opts.to),
    htmlContent: `
      <div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <div style="text-align:center;margin-bottom:26px;">
          <h1 style="color:#7c3aed;margin:0;font-size:26px;">${isLastCall ? 'Last call on your cart' : 'You left something in your cart'}</h1>
        </div>

        <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 22px;">
          Hey ${esc(name)} - ${intro}
        </p>

        <div style="background:#f9fafb;border-radius:16px;padding:22px;margin-bottom:22px;">
          <table style="width:100%;border-collapse:collapse;">${itemRows}</table>
          ${moreCount > 0 ? `<p style="margin:14px 0 0;color:#6b7280;font-size:13px;">+ ${moreCount} more item${moreCount === 1 ? '' : 's'}</p>` : ''}
          <p style="margin:16px 0 0;text-align:right;color:#111827;font-size:17px;font-weight:700;">Total $${opts.total.toFixed(2)}</p>
        </div>

        <div style="text-align:center;margin:30px 0;">
          <a href="${esc(opts.recoverUrl)}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed 0%,#ec4899 100%);color:#fff;padding:15px 34px;text-decoration:none;border-radius:12px;font-weight:bold;font-size:16px;">
            Finish My Order
          </a>
          <p style="color:#9ca3af;font-size:12px;margin:10px 0 0;">One click puts everything back in your cart. No account needed.</p>
        </div>

        <p style="color:#6b7280;font-size:14px;line-height:1.6;margin:0 0 8px;">
          Hit a snag at checkout, or have a question about sizing or artwork? Just reply to this email - a real person reads it.
        </p>

        <div style="border-top:1px solid #e5e7eb;padding-top:18px;margin-top:28px;text-align:center;">
          <p style="color:#9ca3af;font-size:13px;margin:0 0 8px;">- The Imagine This Printed Team</p>
          <p style="color:#9ca3af;font-size:11px;line-height:1.5;margin:0;">
            You are getting this because you started a checkout at Imagine This Printed.<br>
            <a href="${esc(unsubscribeUrl)}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe from cart reminders</a>
          </p>
        </div>
      </div>
    `,
    textContent:
      `Hey ${name} - you left something in your cart at Imagine This Printed.\n\n` +
      shown.map(i => `- ${i.name || 'Your custom item'} x${Number(i.quantity) || 1}`).join('\n') +
      (moreCount > 0 ? `\n- + ${moreCount} more item(s)` : '') +
      `\n\nTotal: $${opts.total.toFixed(2)}\n\n` +
      `Finish your order: ${opts.recoverUrl}\n\n` +
      `Questions? Just reply to this email.\n\n` +
      `Unsubscribe from cart reminders: ${unsubscribeUrl}\n`
  })
}

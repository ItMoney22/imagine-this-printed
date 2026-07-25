// Christina approval-loop notification — Rico messages the store operator on every draft (and on
// blocks/errors) with her explicit next steps. Human-in-command: Rico drafts, Christina publishes.
import { sendEmail } from '../utils/email.js'

const APPROVER_EMAIL = process.env.ETSY_APPROVER_EMAIL || 'Christina@ImagineThisPrinted.com'
const SHOP_MANAGER_LISTINGS = 'https://www.etsy.com/your/shops/me/tools/listings'

export interface EtsyNotifyInput {
  productName: string
  productId: string
  outcome: 'draft' | 'blocked' | 'error'
  etsyUrl?: string
  listingId?: number
  price?: number
  tags?: string[]
  gateReasons?: string[]
  errorMessage?: string
}

function shell(title: string, bodyHtml: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
    <h2 style="margin:0 0 12px">${title}</h2>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
    <p style="font-size:12px;color:#888">Sent by Rico (ImagineThisPrinted Etsy operator). Reply with edits or questions.</p>
  </div>`
}

export async function notifyChristina(input: EtsyNotifyInput): Promise<boolean> {
  let subject: string
  let html: string
  let text: string

  if (input.outcome === 'draft') {
    subject = `Etsy draft ready to review: ${input.productName}`
    const details = [
      input.price != null ? `Price: $${Number(input.price).toFixed(2)}` : null,
      input.tags?.length ? `Tags: ${input.tags.slice(0, 13).join(', ')}` : null,
    ].filter(Boolean)
    html = shell('New Etsy draft is ready 🎨', `
      <p><strong>${input.productName}</strong> passed the copyright/IP + AI-disclosure check and is now a
      <strong>free, invisible draft</strong> in your Etsy shop.</p>
      ${details.length ? `<p style="color:#444">${details.join('<br/>')}</p>` : ''}
      ${input.etsyUrl ? `<p><a href="${input.etsyUrl}" style="background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open the draft</a></p>` : ''}
      <p><strong>Your next step:</strong> review it in <a href="${SHOP_MANAGER_LISTINGS}">Shop Manager → Listings</a>,
      then click <strong>Publish</strong> to go live (or reply here with edits and Rico will revise).</p>`)
    text = `Etsy draft ready: ${input.productName}. ${input.etsyUrl || ''}\n${details.join('\n')}\n` +
      `Next step: review in Shop Manager (${SHOP_MANAGER_LISTINGS}) and Publish, or reply with edits.`
  } else if (input.outcome === 'blocked') {
    subject = `Etsy post held for review: ${input.productName}`
    html = shell('An Etsy post needs your eyes 🛑', `
      <p><strong>${input.productName}</strong> was <strong>held before drafting</strong> by the copyright/IP gate:</p>
      <ul>${(input.gateReasons || []).map((r) => `<li>${r}</li>`).join('')}</ul>
      <p><strong>Your next step:</strong> confirm the design is clear of third-party trademarks/characters.
      If it's fine, reply to approve and Rico will draft it; if not, it stays unpublished.</p>`)
    text = `Etsy post held: ${input.productName}.\nReasons:\n- ${(input.gateReasons || []).join('\n- ')}\n` +
      `Next step: confirm IP is clear and reply to approve, or leave it unpublished.`
  } else {
    subject = `Etsy draft failed: ${input.productName}`
    html = shell('An Etsy draft hit an error ⚠️', `
      <p>Rico couldn't create the draft for <strong>${input.productName}</strong>.</p>
      <p style="color:#a00">${input.errorMessage || 'Unknown error'}</p>
      <p><strong>Your next step:</strong> nothing required — Rico will retry, or reply and we'll look into it.</p>`)
    text = `Etsy draft failed: ${input.productName}. Error: ${input.errorMessage || 'unknown'}.`
  }

  return sendEmail({ to: APPROVER_EMAIL, subject, htmlContent: html, textContent: text })
}

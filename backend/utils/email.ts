// ============================================================================
// Transactional email — transport is Resend (sendViaResend), the ONLY
// provider. There is no fallback: if RESEND_API_KEY is absent at runtime,
// sendEmailWithTracking fails loudly (logged) rather than silently rerouting
// mail through a different, unmonitored provider (Brevo, formerly a "graceful
// fallback" here, was armed live via BREVO_API_KEY — removed).
//
// All exported function *signatures* are unchanged so callers need no edits.
// ============================================================================

import { sendViaResend } from '../services/email-resend.js'
import { getSuppression } from '../services/email-suppression.js'
import { resolveCarrier } from './carrier-tracking.js'
import { buildOrderStatusUrl } from './order-status-token.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// EMAIL_FROM is the "from" address for all transactional mail.
const EMAIL_FROM = process.env.EMAIL_FROM || 'Imagine This Printed <wecare@imaginethisprinted.com>'

// Default Reply-To for transactional mail — the general support inbox.
const REPLY_TO = 'wecare@imaginethisprinted.com'

const RESEND_API_KEY = process.env.RESEND_API_KEY

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://imaginethisprinted.com'

// Flag to enable/disable AI personalisation (can be toggled via env)
const AI_EMAIL_ENABLED = process.env.AI_EMAIL_ENABLED !== 'false'

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface EmailOptions {
  to: string
  subject: string
  htmlContent: string
  textContent?: string
}

export interface SendEmailResult {
  success: boolean
  messageId?: string
  /** True when the send was blocked by the suppression list (no mail was sent). */
  suppressed?: boolean
  /** 'hard_bounce' | 'complaint' | 'manual' when suppressed. */
  suppressionReason?: string
}

// ---------------------------------------------------------------------------
// Core transport helpers
// ---------------------------------------------------------------------------

/**
 * The only transport: Resend.
 */
async function sendViaResendTransport(options: EmailOptions): Promise<SendEmailResult> {
  const result = await sendViaResend({
    from: EMAIL_FROM,
    to: [options.to],
    reply_to: REPLY_TO,
    subject: options.subject,
    html: options.htmlContent,
    text: options.textContent || options.htmlContent.replace(/<[^>]*>/g, ''),
  })
  console.log('[Email] ✅ Sent via Resend to:', options.to, 'id:', result.id)
  return { success: true, messageId: result.id }
}

// ---------------------------------------------------------------------------
// Public send functions (same signatures as before)
// ---------------------------------------------------------------------------

/**
 * Send transactional email.
 * Returns a boolean for backward compatibility.
 */
export const sendEmail = async (options: EmailOptions): Promise<boolean> => {
  const result = await sendEmailWithTracking(options)
  return result.success
}

/**
 * Send transactional email with full tracking response.
 * Returns messageId when available (used by email-templates route for log correlation).
 */
export const sendEmailWithTracking = async (options: EmailOptions): Promise<SendEmailResult> => {
  // Suppression list first — an address that hard-bounced or filed a spam
  // complaint must never be mailed again. getSuppression fails OPEN, so a
  // database blip can't mute all mail.
  const suppression = await getSuppression(options.to)
  if (suppression) {
    console.warn(
      `[Email] 🚫 Suppressed — not sending to ${options.to} (${suppression.reason}).`,
      'Subject:', options.subject
    )
    return { success: false, suppressed: true, suppressionReason: suppression.reason }
  }

  if (!RESEND_API_KEY) {
    // Fail LOUD, not silent: this used to fall back to Brevo, which meant a
    // missing/rotated Resend key silently rerouted customer mail through a
    // provider nobody monitors. Now it just doesn't send, and says so loudly.
    console.error('[Email] 🚨 NO EMAIL TRANSPORT CONFIGURED — RESEND_API_KEY is missing. Email NOT sent.')
    console.error('[Email] Would have sent to:', options.to, '| Subject:', options.subject)
    return { success: false }
  }

  try {
    return await sendViaResendTransport(options)
  } catch (err) {
    console.error('[Email] Resend transport failed:', err)
    return { success: false }
  }
}

// ============================================================================
// All high-level sender functions below — transport wired through sendEmail /
// sendEmailWithTracking above.  HTML templates are unchanged.
// ============================================================================

/**
 * Low-stock digest for blank-shirt inventory (one email per worker sweep, not
 * one per SKU). Sent to ADMIN_ALERT_EMAIL (default wecare@).
 */
export const sendLowStockAlertEmail = async (
  items: Array<{
    brand: string
    style_code: string
    color: string
    size: string
    qty_on_hand: number
    reorder_threshold: number
    reorder_qty: number | null
    supplier: string | null
  }>
): Promise<boolean> => {
  if (!items.length) return true
  const to = process.env.ADMIN_ALERT_EMAIL || 'wecare@imaginethisprinted.com'
  const rows = items.map(i => `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${i.brand} ${i.style_code}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${i.color} / ${i.size}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #dc2626; font-weight: bold;">${i.qty_on_hand}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${i.reorder_threshold}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${i.reorder_qty ?? '—'}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${i.supplier ?? '—'}</td>
        </tr>`).join('')

  return sendEmail({
    to,
    subject: `🚨 Low blank stock: ${items.length} SKU${items.length === 1 ? '' : 's'} at/below reorder point`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #dc2626; margin-top: 0;">Blank inventory needs a re-up</h2>
        <p style="color: #6b7280;">These blanks are at or below their reorder threshold:</p>
        <table style="width: 100%; border-collapse: collapse; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px;">
          <thead>
            <tr style="background: #f9fafb; text-align: left;">
              <th style="padding: 8px 12px;">Style</th>
              <th style="padding: 8px 12px;">Color / Size</th>
              <th style="padding: 8px 12px; text-align: center;">On hand</th>
              <th style="padding: 8px 12px; text-align: center;">Threshold</th>
              <th style="padding: 8px 12px; text-align: center;">Reorder qty</th>
              <th style="padding: 8px 12px;">Supplier</th>
            </tr>
          </thead>
          <tbody>${rows}
          </tbody>
        </table>
        <p style="color: #6b7280; margin-top: 16px;">
          Manage stock in the <a href="${FRONTEND_URL}/admin?tab=inventory" style="color: #7c3aed;">admin Inventory tab</a>.
        </p>
      </div>
    `
  })
}

/**
 * Send approval notification email to product creator
 */
export const sendProductApprovalEmail = async (
  email: string,
  productName: string,
  productId: string,
  creatorName?: string
): Promise<boolean> => {
  // Try AI-powered email first
  if (AI_EMAIL_ENABLED && generateAIEmail) {
    try {
      const aiEmail = await generateAIEmail({
        templateKey: 'design_approved',
        customerEmail: email,
        customerName: creatorName,
        productName,
        productId
      })

      return sendEmail({
        to: email,
        subject: aiEmail.subject,
        htmlContent: aiEmail.htmlContent,
        textContent: aiEmail.textContent
      })
    } catch (error) {
      console.error('[Email] AI design approved email failed, using fallback:', error)
    }
  }

  // Fallback to static template (the production copy — 15% royalty, /product/:id route)
  return sendEmail({
    to: email,
    subject: '🎉 Your Design Has Been Approved! - Imagine This Printed',
    htmlContent: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <img src="${FRONTEND_URL}/mr-imagine/mr-imagine-waist-up.png" alt="Mr. Imagine" style="height: 60px;">
        </div>

        <h1 style="color: #9333EA; text-align: center;">Congratulations! 🎨</h1>

        <p>Hey ${creatorName || 'Creator'},</p>

        <p>Great news! Your design <strong>"${productName}"</strong> has been approved and is now live on our marketplace!</p>

        <div style="background: linear-gradient(135deg, #9333EA 0%, #EC4899 100%); border-radius: 12px; padding: 20px; margin: 20px 0; color: white;">
          <h3 style="margin: 0 0 10px 0;">💰 Start Earning!</h3>
          <p style="margin: 0;">You'll earn <strong>15% royalty</strong> on every sale of your design!</p>
        </div>

        <h3>Next Steps:</h3>
        <ol>
          <li><strong>Set up your wallet</strong> - Add your payout details to receive earnings</li>
          <li><strong>Share your design</strong> - Get the word out to maximize sales</li>
          <li><strong>Create more</strong> - The more designs, the more you can earn!</li>
        </ol>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/wallet"
             style="display: inline-block; background: linear-gradient(135deg, #9333EA 0%, #EC4899 100%); color: white; text-decoration: none; padding: 15px 30px; border-radius: 25px; font-weight: bold;">
            Set Up Your Wallet
          </a>
        </div>

        <div style="text-align: center; margin: 20px 0;">
          <a href="${FRONTEND_URL}/product/${productId}"
             style="color: #9333EA; text-decoration: none; font-weight: bold;">
            View Your Live Product →
          </a>
        </div>

        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

        <p style="color: #666; font-size: 14px; text-align: center;">
          Keep creating amazing designs!<br>
          - The ITP Team
        </p>
      </div>
    `
  })
}

/**
 * Send rejection notification email to product creator
 */
export const sendProductRejectionEmail = async (
  email: string,
  productName: string,
  reason: string
): Promise<boolean> => {
  return sendEmail({
    to: email,
    subject: `Update on Your Design "${productName}"`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #374151; margin: 0;">Design Update</h1>
        </div>

        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <h2 style="color: #991b1b; margin-top: 0;">We couldn't approve your design</h2>
          <p style="color: #6b7280; font-size: 16px; line-height: 1.6;">
            Thank you for submitting <strong>"${productName}"</strong>. Unfortunately, we weren't able to approve it at this time.
          </p>

          <div style="background: #fff; border-radius: 8px; padding: 15px; margin-top: 15px;">
            <p style="color: #374151; font-weight: 600; margin: 0 0 5px 0;">Reason:</p>
            <p style="color: #6b7280; margin: 0;">${reason}</p>
          </div>
        </div>

        <div style="background: #f9fafb; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <h3 style="color: #374151; margin-top: 0;">What can you do?</h3>
          <ul style="color: #6b7280; font-size: 15px; line-height: 1.8;">
            <li>Review the feedback above</li>
            <li>Make adjustments to your design</li>
            <li>Submit a new design when ready</li>
          </ul>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/create" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Create a New Design
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Questions? Reply to this email and we'll be happy to help!
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send notification email to support team when a new ticket is created
 */
export const sendNewSupportTicketEmail = async (
  ticketId: string,
  subject: string,
  description: string,
  priority: string,
  category: string,
  userEmail?: string
): Promise<boolean> => {
  const supportEmail = process.env.SUPPORT_EMAIL || 'wecare@imaginethisprinted.com'

  const priorityColors: Record<string, string> = {
    urgent: '#ef4444',
    high: '#f97316',
    medium: '#eab308',
    low: '#22c55e'
  }

  return sendEmail({
    to: supportEmail,
    subject: `🎫 New Support Ticket [${priority.toUpperCase()}]: ${subject}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #7c3aed; margin: 0;">New Support Ticket 🎫</h1>
        </div>

        <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
            <span style="font-size: 14px; color: #6b7280;">Ticket ID: <strong>${ticketId.slice(0, 8)}</strong></span>
            <span style="background: ${priorityColors[priority] || '#6b7280'}; color: white; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: bold; text-transform: uppercase;">${priority}</span>
          </div>
          <h2 style="color: #374151; margin: 0 0 10px 0;">${subject}</h2>
          <p style="color: #6b7280; font-size: 14px; margin: 0;">Category: ${category.replace('_', ' ')}</p>
          ${userEmail ? `<p style="color: #6b7280; font-size: 14px; margin: 5px 0 0 0;">From: ${userEmail}</p>` : ''}
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <h3 style="color: #374151; margin-top: 0;">Description</h3>
          <p style="color: #6b7280; font-size: 15px; line-height: 1.6; white-space: pre-wrap;">${description}</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/admin/dashboard?tab=support" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            View in Admin Dashboard
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            This ticket was created via Mr. Imagine chat assistant.<br>
            Please respond promptly to maintain customer satisfaction.
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Tell the team a real order just landed and is ready to fulfil (2026-08-07).
 *
 * This did not exist before. The paid-order path emailed only the CUSTOMER, so
 * the only team-facing order signals in the whole system were the stalled-order
 * alert (which waits ORDER_STALL_DAYS = 3 days) and the 8am daily digest. ITP's
 * first real order came in and no one on staff was notified.
 *
 * Recipients: PRINT_WORKER_EMAILS (the crew who actually print — same list
 * routes/print-bridge.ts uses) if set, else ADMIN_ALERT_EMAIL / SUPPORT_EMAIL /
 * wecare@, matching the convention of every other alert in this file.
 */
export const sendNewOrderTeamEmail = async (opts: {
  orderId: string
  orderNumber: string
  total: number
  customerName?: string | null
  customerEmail?: string | null
  shippingAddress?: Record<string, any> | null
  /** orders.metadata.shipping — the customer's fulfilment choice. */
  shippingChoice?: Record<string, any> | null
  items: Array<{ name: string; quantity: number; size?: string | null; color?: string | null }>
  recoveredByReconciler?: boolean
}): Promise<boolean> => {
  const recipients = (
    process.env.PRINT_WORKER_EMAILS ||
    process.env.ADMIN_ALERT_EMAIL ||
    process.env.SUPPORT_EMAIL ||
    'wecare@imaginethisprinted.com'
  )
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  const a = opts.shippingAddress || {}
  const shipLines = [
    [a.firstName, a.lastName].filter(Boolean).join(' '),
    a.address,
    [a.city, a.state, a.zipCode].filter(Boolean).join(', '),
    a.country
  ].filter(Boolean)

  const itemRows = opts.items.map(i => `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${i.name}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${i.quantity}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${[i.size, i.color].filter(Boolean).join(' / ') || '—'}</td>
        </tr>`).join('')

  // Fulfilment method. This is the first thing the crew needs — a pickup they
  // treat as a shipment is a customer standing in the lobby waiting for a box
  // that's already on a truck. Pickups get the appointment inline and a loud
  // colour; carrier orders get the method name.
  const choice = opts.shippingChoice || null
  const shipType = String(choice?.type || '').toLowerCase()
  const isPickup = shipType === 'pickup'
  const isDelivery = shipType === 'delivery'
  const appt = choice?.pickup_appointment || null
  const apptLine = [appt?.date, appt?.time].filter(Boolean).join(' at ')

  const fulfilmentBlock = choice
    ? `<div style="background: ${isPickup ? '#ecfdf5' : isDelivery ? '#eff6ff' : '#f9fafb'}; border: 1px solid ${isPickup ? '#a7f3d0' : isDelivery ? '#bfdbfe' : '#e5e7eb'}; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
         <p style="color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 6px 0;">Fulfilment</p>
         <p style="color: #111827; font-size: 17px; font-weight: bold; margin: 0;">
           ${isPickup ? '🏪 ' : isDelivery ? '🚗 ' : '📦 '}${choice.method || 'Standard Shipping'}
         </p>
         <p style="color: #4b5563; font-size: 14px; margin: 6px 0 0 0;">
           ${Number(choice.amount) > 0 ? `Customer paid $${Number(choice.amount).toFixed(2)}` : 'No shipping charge'}
           ${choice.rush ? ` · <strong style="color: #b45309;">RUSH — next business day</strong>` : ''}
           ${choice.free_shipping_applied ? ' · free-shipping applied' : ''}
         </p>
         ${isPickup ? `<p style="color: #065f46; font-size: 14px; margin: 8px 0 0 0;">
           <strong>Pickup${apptLine ? `: ${apptLine}` : ' — no appointment time chosen'}</strong>
           ${appt?.notes ? `<br><span style="color: #4b5563;">Note: ${appt.notes}</span>` : ''}
         </p>` : ''}
       </div>`
    // Orders created before 2026-08-07 have no shipping snapshot; say so rather
    // than implying a method nobody recorded.
    : `<div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px; margin-bottom: 20px;">
         <p style="color: #6b7280; font-size: 14px; margin: 0;">Fulfilment method not recorded on this order — check with the customer.</p>
       </div>`

  // A reconciler-recovered order means Stripe's webhook never landed. That is an
  // infrastructure alarm, not a sales notification, so it gets its own banner.
  const warning = opts.recoveredByReconciler
    ? `<div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 16px; margin-bottom: 20px;">
         <p style="color: #991b1b; margin: 0; font-weight: bold;">⚠️ Recovered by the payment reconciler</p>
         <p style="color: #991b1b; margin: 6px 0 0 0; font-size: 14px;">
           Stripe's webhook did NOT deliver this payment — the hourly sweep caught it. The money is
           captured and the order is now correct, but webhook delivery needs checking in the Stripe
           Dashboard before the next order.
         </p>
       </div>`
    : ''

  // One email per send, but the crew list can hold several addresses; Resend
  // takes a single `to` per call here, so fan out and succeed if any landed.
  const results = await Promise.all(recipients.map(to => sendEmail({
    to,
    subject: `${opts.recoveredByReconciler ? '⚠️ ' : '💰 '}New order ${opts.orderNumber} — $${opts.total.toFixed(2)}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #7c3aed; margin: 0 0 20px 0;">New order — ready to fulfil 💰</h1>
        ${warning}
        <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 16px; padding: 24px; margin-bottom: 20px;">
          <p style="color: #6b7280; font-size: 13px; margin: 0 0 4px 0;">Order</p>
          <h2 style="color: #374151; margin: 0 0 12px 0; font-family: monospace;">${opts.orderNumber}</h2>
          <p style="color: #111827; font-size: 22px; font-weight: bold; margin: 0;">$${opts.total.toFixed(2)}</p>
          <p style="color: #6b7280; font-size: 14px; margin: 10px 0 0 0;">
            ${opts.customerName || 'Customer'}${opts.customerEmail ? ` &lt;${opts.customerEmail}&gt;` : ''}
          </p>
        </div>

        <h3 style="color: #374151; margin-bottom: 8px;">Items</h3>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px;">
          <thead><tr style="background: #f9fafb; text-align: left;">
            <th style="padding: 8px 12px;">Product</th>
            <th style="padding: 8px 12px; text-align: center;">Qty</th>
            <th style="padding: 8px 12px;">Size / Colour</th>
          </tr></thead>
          <tbody>${itemRows || '<tr><td colspan="3" style="padding: 8px 12px; color: #9ca3af;">No line items recorded</td></tr>'}
          </tbody>
        </table>

        ${fulfilmentBlock}

        ${shipLines.length ? `
        <h3 style="color: #374151; margin: 24px 0 8px 0;">${isPickup ? 'Customer address (on file)' : 'Ship to'}</h3>
        <p style="color: #4b5563; line-height: 1.6; margin: 0;">${shipLines.join('<br>')}</p>` : ''}

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/admin/orders" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold;">
            Open Order Management
          </a>
        </div>
      </div>
    `
  })))

  return results.some(Boolean)
}

/**
 * Send notification email to admins when a new wholesale application is
 * submitted (Watchtower task 0af32316). Mirrors sendNewSupportTicketEmail's
 * shape/recipient convention (ADMIN_ALERT_EMAIL, falling back to SUPPORT_EMAIL,
 * falling back to wecare@).
 */
export const sendNewWholesaleApplicationEmail = async (
  applicationId: string,
  companyName: string,
  businessType: string,
  contactEmail: string
): Promise<boolean> => {
  const to = process.env.ADMIN_ALERT_EMAIL || process.env.SUPPORT_EMAIL || 'wecare@imaginethisprinted.com'

  return sendEmail({
    to,
    subject: `🏢 New Wholesale Application: ${companyName}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #7c3aed; margin: 0;">New Wholesale Application 🏢</h1>
        </div>

        <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px;">
          <p style="color: #6b7280; font-size: 14px; margin: 0 0 5px 0;">Application ID: <strong>${applicationId.slice(0, 8)}</strong></p>
          <h2 style="color: #374151; margin: 0 0 10px 0;">${companyName}</h2>
          <p style="color: #6b7280; font-size: 14px; margin: 0;">Business type: ${businessType}</p>
          <p style="color: #6b7280; font-size: 14px; margin: 5px 0 0 0;">Contact: ${contactEmail}</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/admin/dashboard?tab=wholesale" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Review Application
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Please review and respond within 2-3 business days, per the applicant-facing copy.
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send confirmation email to user when their ticket is created
 */
export const sendTicketConfirmationEmail = async (
  email: string,
  ticketId: string,
  subject: string
): Promise<boolean> => {
  // Try AI-powered email first
  if (AI_EMAIL_ENABLED && generateAIEmail) {
    try {
      const aiEmail = await generateAIEmail({
        templateKey: 'ticket_confirmation',
        customerEmail: email,
        ticketId,
        ticketSubject: subject
      })

      return sendEmail({
        to: email,
        subject: aiEmail.subject,
        htmlContent: aiEmail.htmlContent,
        textContent: aiEmail.textContent
      })
    } catch (error) {
      console.error('[Email] AI ticket confirmation email failed, using fallback:', error)
    }
  }

  // Fallback to static template
  return sendEmail({
    to: email,
    subject: `✅ Your Support Request Has Been Received - ${subject}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #7c3aed; margin: 0;">We Got Your Request! ✅</h1>
        </div>

        <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px;">
          <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0;">Reference Number</p>
          <p style="color: #7c3aed; font-size: 24px; font-weight: bold; margin: 0;">${ticketId.slice(0, 8).toUpperCase()}</p>
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <h3 style="color: #374151; margin-top: 0;">What happens next?</h3>
          <ul style="color: #6b7280; font-size: 15px; line-height: 1.8;">
            <li>Our support team will review your request</li>
            <li>You'll receive a response within 24 hours</li>
            <li>We'll email you with updates</li>
          </ul>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Continue Shopping
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Thank you for reaching out to us!<br>
            - The Imagine This Printed Team
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send notification to customer when an agent replies to their ticket
 */
export const sendTicketReplyEmail = async (
  email: string,
  ticketId: string,
  subject: string,
  agentMessage: string,
  agentName?: string
): Promise<boolean> => {
  return sendEmail({
    to: email,
    subject: `📬 New Reply on Your Support Request - ${subject}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #7c3aed; margin: 0;">New Reply From Support 📬</h1>
        </div>

        <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 16px; padding: 20px; margin-bottom: 20px;">
          <p style="color: #6b7280; font-size: 14px; margin: 0 0 5px 0;">Reference Number</p>
          <p style="color: #7c3aed; font-size: 18px; font-weight: bold; margin: 0;">${ticketId.slice(0, 8).toUpperCase()}</p>
          <p style="color: #374151; font-size: 16px; margin: 10px 0 0 0;">${subject}</p>
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <div style="display: flex; align-items: center; margin-bottom: 15px;">
            <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 12px;">
              <span style="color: white; font-weight: bold;">${(agentName || 'Support')[0].toUpperCase()}</span>
            </div>
            <div>
              <p style="margin: 0; color: #374151; font-weight: 600;">${agentName || 'Support Team'}</p>
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">Support Agent</p>
            </div>
          </div>
          <p style="color: #6b7280; font-size: 15px; line-height: 1.6; white-space: pre-wrap; margin: 0;">${agentMessage}</p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Reply to Support
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            You can reply directly to this email or use the chat widget on our website.<br>
            - The Imagine This Printed Team
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send escalation notification to support team when a customer needs immediate help
 */
export const sendTicketEscalationEmail = async (
  ticketId: string,
  subject: string,
  customerEmail: string,
  waitTime?: string
): Promise<boolean> => {
  const supportEmail = process.env.SUPPORT_EMAIL || 'wecare@imaginethisprinted.com'

  return sendEmail({
    to: supportEmail,
    subject: `🚨 [URGENT] Customer Waiting for Live Chat - ${subject}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #ef4444; margin: 0;">🚨 Urgent: Agent Needed!</h1>
        </div>

        <div style="background: #fef2f2; border: 2px solid #fecaca; border-radius: 16px; padding: 30px; margin-bottom: 20px;">
          <p style="color: #991b1b; font-size: 18px; font-weight: bold; margin: 0 0 15px 0;">
            A customer is waiting for live chat support
          </p>
          <div style="background: #fff; border-radius: 8px; padding: 15px;">
            <p style="color: #6b7280; margin: 0 0 8px 0;"><strong>Ticket:</strong> ${ticketId.slice(0, 8).toUpperCase()}</p>
            <p style="color: #6b7280; margin: 0 0 8px 0;"><strong>Subject:</strong> ${subject}</p>
            <p style="color: #6b7280; margin: 0 0 8px 0;"><strong>Customer:</strong> ${customerEmail}</p>
            ${waitTime ? `<p style="color: #ef4444; margin: 0; font-weight: bold;"><strong>Wait Time:</strong> ${waitTime}</p>` : ''}
          </div>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/admin/dashboard?tab=support" style="display: inline-block; background: #ef4444; color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Go Online &amp; Help Customer
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Please respond as soon as possible to maintain customer satisfaction.
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send notification to support team when a ticket is resolved
 */
export const sendTicketResolvedEmail = async (
  email: string,
  ticketId: string,
  subject: string
): Promise<boolean> => {
  return sendEmail({
    to: email,
    subject: `✅ Your Support Request Has Been Resolved - ${subject}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #059669; margin: 0;">Issue Resolved! ✅</h1>
        </div>

        <div style="background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px; text-align: center;">
          <p style="color: #065f46; font-size: 14px; margin: 0 0 10px 0;">Reference Number</p>
          <p style="color: #047857; font-size: 24px; font-weight: bold; margin: 0;">${ticketId.slice(0, 8).toUpperCase()}</p>
          <p style="color: #065f46; font-size: 16px; margin: 10px 0 0 0;">${subject}</p>
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <h3 style="color: #374151; margin-top: 0;">Your ticket has been closed</h3>
          <p style="color: #6b7280; font-size: 15px; line-height: 1.6;">
            We're glad we could help! If you have any more questions or if the issue persists,
            feel free to reach out to us again through the chat widget on our website.
          </p>
        </div>

        <div style="background: #f9fafb; border-radius: 16px; padding: 20px; margin-bottom: 20px; text-align: center;">
          <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0;">How was your experience?</p>
          <div style="display: flex; justify-content: center; gap: 10px;">
            <span style="font-size: 24px; cursor: pointer;">😊</span>
            <span style="font-size: 24px; cursor: pointer;">😐</span>
            <span style="font-size: 24px; cursor: pointer;">😔</span>
          </div>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Continue Shopping
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Thank you for choosing Imagine This Printed!<br>
            We're always here to help.
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send payout notification email to creator
 */
export const sendPayoutEmail = async (
  email: string,
  amount: number,
  method: string
): Promise<boolean> => {
  const formattedAmount = (amount / 100).toFixed(2)

  return sendEmail({
    to: email,
    subject: `💸 Your $${formattedAmount} Payout is on the Way!`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #059669; margin: 0;">Payment Sent! 💸</h1>
        </div>

        <div style="background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px; text-align: center;">
          <p style="color: #065f46; font-size: 14px; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 1px;">Payout Amount</p>
          <p style="color: #047857; font-size: 48px; font-weight: bold; margin: 0;">$${formattedAmount}</p>
          <p style="color: #065f46; font-size: 14px; margin: 10px 0 0 0;">via ${method}</p>
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <h3 style="color: #374151; margin-top: 0;">What to expect</h3>
          <ul style="color: #6b7280; font-size: 15px; line-height: 1.8;">
            <li>Funds typically arrive within 1-3 business days</li>
            <li>Check your ${method} account for the deposit</li>
            <li>Keep creating to earn more royalties!</li>
          </ul>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/my-products" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            View My Products
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Thank you for being a creator at Imagine This Printed!<br>
            Your creativity is what makes our marketplace special.
          </p>
        </div>
      </div>
    `
  })
}

// ===============================
// ORDER STATUS EMAILS (AI-Powered with Mr. Imagine personality)
// ===============================

interface OrderItem {
  name: string
  quantity: number
  price: number
}

/**
 * Extra order context every status email now accepts.
 * `orderId` is the primary-key UUID — never shown to the customer, only used to
 * mint the tokenized guest order-status link.
 */
export interface OrderEmailOptions {
  orderId?: string
  customerName?: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * What we actually print as "Order Number".
 * Callers should pass orders.order_number (e.g. ITP-20260726-0042). If a legacy
 * caller still hands us a raw UUID we degrade to the old 8-char slice rather
 * than dumping a 36-character key into the subject line.
 */
function displayOrderNumber(orderNumber?: string | null, orderId?: string | null): string {
  const candidate = (orderNumber || '').trim()
  if (candidate && !UUID_RE.test(candidate)) return candidate
  const fallback = candidate || (orderId || '').trim()
  return fallback ? fallback.slice(0, 8).toUpperCase() : 'YOUR ORDER'
}

/**
 * Greeting name. orders.customer_name is "First Last"; a first name reads far
 * warmer in a greeting than the full legal name off the shipping label.
 */
function greetingName(customerName?: string | null): string {
  const first = (customerName || '').trim().split(/\s+/)[0]
  if (!first || first.length > 40) return 'Creative Friend'
  // Guard against an email address landing in the name column.
  if (first.includes('@')) return 'Creative Friend'
  return first
}

/** Escape untrusted order/customer values before interpolating into HTML. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Tracking block with a real, carrier-specific deep link.
 * Renders nothing when there's no tracking number yet.
 */
function trackingBlockHtml(trackingNumber?: string | null, carrier?: string | null): string {
  if (!trackingNumber) return ''
  const info = resolveCarrier(trackingNumber, carrier)
  return `
        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <h3 style="color: #374151; margin-top: 0;">Tracking Information</h3>
          <div style="background: #f9fafb; border-radius: 8px; padding: 15px;">
            <p style="color: #6b7280; margin: 0 0 5px 0;">Carrier: <strong>${esc(info.name)}</strong></p>
            <p style="color: #6b7280; margin: 0;">Tracking Number:
              <a href="${esc(info.trackingUrl)}" style="color: #4f46e5; font-weight: bold; text-decoration: underline;">${esc(trackingNumber)}</a>
            </p>
          </div>
          <div style="text-align: center; margin-top: 18px;">
            <a href="${esc(info.trackingUrl)}" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 14px;">
              Track with ${esc(info.name)}
            </a>
          </div>
        </div>`
}

// Try to import AI email service (may fail if not available)
let generateAIEmail: any = null
try {
  // Dynamic import to avoid breaking if AI service has issues
  import('../services/emailAI.js').then(module => {
    generateAIEmail = module.generateAIEmail
    console.log('[Email] AI email service loaded successfully')
  }).catch(() => {
    console.log('[Email] AI email service not available, using fallback templates')
  })
} catch {
  console.log('[Email] AI email service not available')
}

/**
 * Send order confirmation email to customer
 * Uses AI personalisation when available, with Mr. Imagine personality
 */
export const sendOrderConfirmationEmail = async (
  email: string,
  orderNumber: string,
  items: OrderItem[],
  total: number,
  customerName?: string,
  options: OrderEmailOptions = {}
): Promise<boolean> => {
  const orderRef = displayOrderNumber(orderNumber, options.orderId)
  const name = greetingName(customerName || options.customerName)
  const statusUrl = buildOrderStatusUrl(options.orderId)

  // Try AI-powered email first
  if (AI_EMAIL_ENABLED && generateAIEmail) {
    try {
      const aiEmail = await generateAIEmail({
        templateKey: 'order_confirmation',
        customerEmail: email,
        customerName: name,
        orderNumber: orderRef,
        orderId: options.orderId,
        items,
        total
      })

      return sendEmail({
        to: email,
        subject: aiEmail.subject,
        htmlContent: aiEmail.htmlContent,
        textContent: aiEmail.textContent
      })
    } catch (error) {
      console.error('[Email] AI generation failed, using fallback:', error)
      // Fall through to static template
    }
  }

  // Fallback to static template with Mr. Imagine branding
  const itemsHtml = items.map(item => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${item.name}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${item.quantity}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">$${(item.price * item.quantity).toFixed(2)}</td>
    </tr>
  `).join('')

  return sendEmail({
    to: email,
    subject: `🎉 Order Confirmed - ${orderRef}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <!-- Mr. Imagine Header -->
        <div style="background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); border-radius: 16px 16px 0 0; padding: 25px; text-align: center;">
          <img src="${FRONTEND_URL}/mr-imagine/mr-imagine-waist-up-happy.png" alt="Mr. Imagine" style="width: 100px; height: auto; margin: 0 auto 12px; display: block;" />
          <h1 style="color: white; margin: 0; font-size: 22px;">Order Confirmed! 🎉</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 5px 0 0; font-size: 13px;">From your friend, Mr. Imagine</p>
        </div>

        <div style="background: white; padding: 25px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
          <p style="color: #7c3aed; font-size: 16px; font-weight: 600; margin: 0 0 15px;">
            Hey ${esc(name)}! 👋
          </p>

          <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
            Your order just made my day! We're already getting excited to bring your vision to life.
            Here's what you've got cooking:
          </p>

          <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 12px; padding: 15px; margin-bottom: 20px; text-align: center;">
            <p style="color: #6b7280; font-size: 12px; margin: 0 0 5px; text-transform: uppercase; letter-spacing: 1px;">Order Number</p>
            <p style="color: #7c3aed; font-size: 22px; font-weight: bold; margin: 0;">${esc(orderRef)}</p>
          </div>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <thead>
              <tr style="background: #f9fafb;">
                <th style="padding: 12px; text-align: left; font-weight: 600; color: #374151;">Item</th>
                <th style="padding: 12px; text-align: center; font-weight: 600; color: #374151;">Qty</th>
                <th style="padding: 12px; text-align: right; font-weight: 600; color: #374151;">Price</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2" style="padding: 12px; font-weight: bold; color: #374151;">Total</td>
                <td style="padding: 12px; text-align: right; font-weight: bold; color: #059669; font-size: 18px;">$${total.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>

          <div style="background: #f9fafb; border-radius: 12px; padding: 15px; margin-bottom: 20px;">
            <h4 style="color: #374151; margin: 0 0 10px 0;">What's happening next?</h4>
            <ul style="color: #6b7280; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
              <li>We're prepping your order for printing (the fun part!)</li>
              <li>You'll get an email the moment it ships</li>
              <li>Track it anytime - I'll keep you posted!</li>
            </ul>
          </div>

          <div style="text-align: center; margin: 25px 0;">
            <a href="${esc(statusUrl)}" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 15px; box-shadow: 0 4px 15px rgba(124, 58, 237, 0.3);">
              Track My Order
            </a>
            <p style="color: #9ca3af; font-size: 12px; margin: 10px 0 0;">No account needed — this link is just for you.</p>
          </div>

          <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 20px;">
            <p style="color: #6b7280; font-size: 14px; margin: 0;">
              Questions? Just reply to this email - I'm always here to help!
            </p>
            <p style="color: #7c3aed; font-weight: 600; margin: 12px 0 0; font-size: 15px;">
              — Mr. Imagine 🎨
            </p>
          </div>
        </div>

        <div style="text-align: center; padding: 15px; color: #9ca3af; font-size: 11px;">
          <a href="${FRONTEND_URL}" style="color: #7c3aed; text-decoration: none;">Imagine This Printed</a>
        </div>
      </div>
    `
  })
}

/**
 * Send shipping notification email to customer
 */
export const sendOrderShippedEmail = async (
  email: string,
  orderNumber: string,
  trackingNumber?: string,
  carrier?: string,
  options: OrderEmailOptions = {}
): Promise<boolean> => {
  const orderRef = displayOrderNumber(orderNumber, options.orderId)
  const name = greetingName(options.customerName)
  const statusUrl = buildOrderStatusUrl(options.orderId)

  // Try AI-powered email first, retaining the guest-status-link fallback below.
  if (AI_EMAIL_ENABLED && generateAIEmail) {
    try {
      const aiEmail = await generateAIEmail({
        templateKey: 'order_shipped',
        customerEmail: email,
        customerName: name,
        orderNumber: orderRef,
        trackingNumber,
        carrier
      })

      return sendEmail({
        to: email,
        subject: aiEmail.subject,
        htmlContent: aiEmail.htmlContent,
        textContent: aiEmail.textContent
      })
    } catch (error) {
      console.error('[Email] AI order shipped email failed, using fallback:', error)
    }
  }

  return sendEmail({
    to: email,
    subject: `📦 Your Order Has Shipped! - ${orderRef}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #7c3aed; margin: 0;">Your Order is On Its Way! 📦</h1>
        </div>

        <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
          Hey ${esc(name)} — great news, your order just left our shop!
        </p>

        <div style="background: linear-gradient(135deg, #dbeafe 0%, #e0e7ff 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px; text-align: center;">
          <p style="color: #3730a3; font-size: 14px; margin: 0 0 10px 0;">Order Number</p>
          <p style="color: #4f46e5; font-size: 24px; font-weight: bold; margin: 0;">${esc(orderRef)}</p>
        </div>

        ${trackingBlockHtml(trackingNumber, carrier)}

        <div style="background: #f9fafb; border-radius: 16px; padding: 20px; margin-bottom: 20px;">
          <h4 style="color: #374151; margin: 0 0 10px 0;">Estimated Delivery</h4>
          <p style="color: #6b7280; font-size: 14px; margin: 0;">
            Your package should arrive within 3-7 business days. We'll send you an update when it's delivered!
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${esc(statusUrl)}" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            View Order Status
          </a>
          <p style="color: #9ca3af; font-size: 12px; margin: 10px 0 0;">No account needed — this link is just for you.</p>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Can't wait to hear what you think!<br>
            - The Imagine This Printed Team
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send delivery confirmation email to customer
 */
export const sendOrderDeliveredEmail = async (
  email: string,
  orderNumber: string,
  options: OrderEmailOptions = {}
): Promise<boolean> => {
  const orderRef = displayOrderNumber(orderNumber, options.orderId)
  const name = greetingName(options.customerName)
  const statusUrl = buildOrderStatusUrl(options.orderId)

  // Try AI-powered email first, retaining the guest-status-link fallback below.
  if (AI_EMAIL_ENABLED && generateAIEmail) {
    try {
      const aiEmail = await generateAIEmail({
        templateKey: 'order_delivered',
        customerEmail: email,
        customerName: name,
        orderNumber: orderRef
      })

      return sendEmail({
        to: email,
        subject: aiEmail.subject,
        htmlContent: aiEmail.htmlContent,
        textContent: aiEmail.textContent
      })
    } catch (error) {
      console.error('[Email] AI order delivered email failed, using fallback:', error)
    }
  }

  return sendEmail({
    to: email,
    subject: `✅ Your Order Has Been Delivered! - ${orderRef}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #059669; margin: 0;">Delivered! ✅</h1>
        </div>

        <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
          Hey ${esc(name)} — it made it!
        </p>

        <div style="background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px; text-align: center;">
          <p style="color: #065f46; font-size: 14px; margin: 0 0 10px 0;">Order Number</p>
          <p style="color: #047857; font-size: 24px; font-weight: bold; margin: 0;">${esc(orderRef)}</p>
          <p style="color: #065f46; font-size: 16px; margin: 15px 0 0 0;">Your order has been delivered!</p>
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px; text-align: center;">
          <h3 style="color: #374151; margin-top: 0;">Love your new prints?</h3>
          <p style="color: #6b7280; font-size: 15px; line-height: 1.6;">
            We'd love to see how you're using them! Share a photo on social media and tag us @imaginethisprinted
          </p>
          <div style="margin-top: 15px;">
            <span style="font-size: 24px; cursor: pointer; margin: 0 5px;">😊</span>
            <span style="font-size: 24px; cursor: pointer; margin: 0 5px;">😍</span>
            <span style="font-size: 24px; cursor: pointer; margin: 0 5px;">🎉</span>
          </div>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/catalog" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Shop More Designs
          </a>
          <p style="margin: 14px 0 0;">
            <a href="${esc(statusUrl)}" style="color: #7c3aed; font-size: 13px; text-decoration: underline;">View order ${esc(orderRef)}</a>
          </p>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Questions about your order? Just reply to this email!<br>
            - The Imagine This Printed Team
          </p>
        </div>
      </div>
    `
  })
}

// ===============================
// ITC PURCHASE CONFIRMATION
// ===============================

/**
 * Send ITC purchase confirmation email to customer
 */
export const sendItcPurchaseEmail = async (
  email: string,
  itcAmount: number,
  usdAmount: number,
  newBalance: number,
  username?: string
): Promise<boolean> => {
  // Try AI-powered email first
  if (AI_EMAIL_ENABLED && generateAIEmail) {
    try {
      const aiEmail = await generateAIEmail({
        templateKey: 'itc_purchase',
        customerEmail: email,
        customerName: username,
        itcAmount,
        usdAmount,
        newBalance
      })

      return sendEmail({
        to: email,
        subject: aiEmail.subject,
        htmlContent: aiEmail.htmlContent,
        textContent: aiEmail.textContent
      })
    } catch (error) {
      console.error('[Email] AI ITC purchase email failed, using fallback:', error)
    }
  }

  // Fallback to static template
  return sendEmail({
    to: email,
    subject: `💰 ITC Purchase Confirmed - ${itcAmount} ITC Added!`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #7c3aed; margin: 0;">Powered Up! 💰</h1>
        </div>

        <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px; text-align: center;">
          <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0;">ITC Purchased</p>
          <p style="color: #7c3aed; font-size: 28px; font-weight: bold; margin: 0;">${itcAmount} ITC</p>
          <p style="color: #9ca3af; font-size: 13px; margin: 10px 0 0 0;">for $${usdAmount.toFixed(2)}</p>
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px; text-align: center;">
          <h3 style="color: #374151; margin-top: 0;">Your New Balance</h3>
          <p style="color: #059669; font-size: 24px; font-weight: bold; margin: 0;">${newBalance} ITC</p>
          <p style="color: #6b7280; font-size: 14px; margin-top: 10px;">
            Time to create something amazing! Use your ITC on custom designs, premium features, and more.
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/wallet" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Use My ITC
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Questions about your purchase? Just reply to this email!<br>
            - The Imagine This Printed Team
          </p>
        </div>
      </div>
    `
  })
}

// ===============================
// WELCOME EMAIL
// ===============================

/**
 * Send welcome email to new users - Uses AI-powered Mr. Imagine personalisation
 */
export const sendWelcomeEmail = async (
  email: string,
  username: string
): Promise<boolean> => {
  // Try AI-powered email first
  if (AI_EMAIL_ENABLED && generateAIEmail) {
    try {
      const aiEmail = await generateAIEmail({
        templateKey: 'welcome',
        customerEmail: email,
        customerName: username,
        username: username
      })

      return sendEmail({
        to: email,
        subject: aiEmail.subject,
        htmlContent: aiEmail.htmlContent,
        textContent: aiEmail.textContent
      })
    } catch (error) {
      console.error('[Email] AI welcome email failed, using fallback:', error)
    }
  }

  // Fallback to static template with Mr. Imagine branding
  return sendEmail({
    to: email,
    subject: `🎨 Welcome to Imagine This Printed, ${username}!`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <!-- Header with Mr. Imagine -->
        <div style="background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); border-radius: 16px 16px 0 0; padding: 30px; text-align: center;">
          <img src="${FRONTEND_URL}/mr-imagine/mr-imagine-waist-up-happy.png" alt="Mr. Imagine" style="width: 120px; height: auto; margin: 0 auto 15px; display: block;" />
          <h1 style="color: white; margin: 0; font-size: 24px; font-weight: bold;">Mr. Imagine</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 5px 0 0; font-size: 14px;">Your Creative Companion</p>
        </div>

        <div style="background: white; padding: 30px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
          <p style="color: #7c3aed; font-size: 18px; font-weight: 600; margin: 0 0 20px;">
            Welcome to the family, ${username}! 🎉
          </p>

          <p style="color: #374151; font-size: 15px; line-height: 1.7;">
            I'm Mr. Imagine, your creative companion here at Imagine This Printed!
            We're so excited to have you join our community of creative souls.
          </p>

          <div style="background: #f9fafb; border-radius: 12px; padding: 20px; margin: 20px 0;">
            <h3 style="color: #374151; margin: 0 0 15px 0;">Here's what you can do:</h3>
            <ul style="color: #6b7280; font-size: 15px; line-height: 2; margin: 0; padding-left: 20px;">
              <li>🛒 <strong>Shop</strong> - Browse thousands of unique designs</li>
              <li>🎨 <strong>Create</strong> - Design your own custom products</li>
              <li>💰 <strong>Earn</strong> - Submit designs and earn 10% royalties</li>
              <li>🎁 <strong>Points</strong> - Earn points on every purchase</li>
            </ul>
          </div>

          <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 12px; padding: 20px; margin: 20px 0; text-align: center;">
            <p style="color: #7c3aed; font-size: 18px; font-weight: bold; margin: 0 0 10px 0;">🎁 Welcome Gifts!</p>
            <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0;">
              <strong style="color: #ec4899;">50 ITC</strong> has been added to your wallet!
            </p>
            <p style="color: #6b7280; font-size: 14px; margin: 0;">
              Plus, use code <strong style="color: #7c3aed;">WELCOME10</strong> for 10% off your first order!
            </p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${FRONTEND_URL}/catalog" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
              Start Exploring
            </a>
          </div>

          <!-- Closing with Mr. Imagine signature -->
          <div style="border-top: 1px solid #e5e7eb; padding-top: 25px; margin-top: 25px;">
            <p style="color: #6b7280; font-size: 15px; line-height: 1.6; margin: 0;">
              Can't wait to see what you create! If you have any questions, just reply to this email or chat with me on our website.
            </p>
            <div style="margin-top: 20px;">
              <img src="${FRONTEND_URL}/mr-imagine/mr-imagine-head-happy.png" alt="Mr. Imagine" style="width: 50px; height: 50px; border-radius: 50%; vertical-align: middle; margin-right: 12px;" />
              <span style="color: #7c3aed; font-weight: 600; font-size: 16px;">Mr. Imagine</span>
              <span style="color: #9ca3af; font-size: 12px; margin-left: 5px;">Your Creative Companion</span>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
          <a href="${FRONTEND_URL}" style="color: #7c3aed; text-decoration: none;">Imagine This Printed</a>
        </div>
      </div>
    `
  })
}

// ===============================
// CUSTOM JOB REQUEST EMAILS
// ===============================

/**
 * Send confirmation when a custom job is submitted
 */
export const sendCustomJobSubmittedEmail = async (
  email: string,
  jobId: string,
  title: string
): Promise<boolean> => {
  return sendEmail({
    to: email,
    subject: `📋 Custom Job Request Received - ${title}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #7c3aed; margin: 0;">Request Received! 📋</h1>
        </div>

        <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px; text-align: center;">
          <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0;">Request ID</p>
          <p style="color: #7c3aed; font-size: 24px; font-weight: bold; margin: 0;">${jobId.slice(0, 8).toUpperCase()}</p>
          <p style="color: #374151; font-size: 16px; margin: 15px 0 0 0;">${title}</p>
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <h3 style="color: #374151; margin-top: 0;">What happens next?</h3>
          <ol style="color: #6b7280; font-size: 15px; line-height: 1.8;">
            <li>Our team will review your request within 24-48 hours</li>
            <li>We'll send you a quote with pricing and timeline</li>
            <li>Once approved, we'll start working on your custom project</li>
            <li>You'll receive updates as we progress</li>
          </ol>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Continue Shopping
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Have questions? Reply to this email anytime!<br>
            - The Imagine This Printed Team
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send notification when a custom job is approved
 */
export const sendCustomJobApprovedEmail = async (
  email: string,
  jobId: string,
  title: string,
  estimatedCost: number
): Promise<boolean> => {
  return sendEmail({
    to: email,
    subject: `✅ Custom Job Approved - ${title}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #059669; margin: 0;">Your Request is Approved! ✅</h1>
        </div>

        <div style="background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px; text-align: center;">
          <p style="color: #065f46; font-size: 14px; margin: 0 0 10px 0;">Request ID</p>
          <p style="color: #047857; font-size: 24px; font-weight: bold; margin: 0;">${jobId.slice(0, 8).toUpperCase()}</p>
          <p style="color: #065f46; font-size: 16px; margin: 15px 0 0 0;">${title}</p>
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px;">
          <h3 style="color: #374151; margin-top: 0;">Project Details</h3>
          <div style="background: #f9fafb; border-radius: 8px; padding: 15px; text-align: center;">
            <p style="color: #6b7280; margin: 0 0 5px 0;">Estimated Cost</p>
            <p style="color: #059669; font-size: 32px; font-weight: bold; margin: 0;">$${estimatedCost.toFixed(2)}</p>
          </div>
          <p style="color: #6b7280; font-size: 14px; text-align: center; margin: 15px 0 0 0;">
            Our team has started working on your custom project!
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/contact" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Contact Us With Questions
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            We'll keep you updated on the progress!<br>
            - The Imagine This Printed Team
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send notification when a custom job is completed
 */
export const sendCustomJobCompletedEmail = async (
  email: string,
  jobId: string,
  title: string
): Promise<boolean> => {
  return sendEmail({
    to: email,
    subject: `🎉 Your Custom Project is Ready! - ${title}`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #7c3aed; margin: 0;">Your Project is Complete! 🎉</h1>
        </div>

        <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 16px; padding: 30px; margin-bottom: 20px; text-align: center;">
          <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0;">Request ID</p>
          <p style="color: #7c3aed; font-size: 24px; font-weight: bold; margin: 0;">${jobId.slice(0, 8).toUpperCase()}</p>
          <p style="color: #374151; font-size: 16px; margin: 15px 0 0 0;">${title}</p>
        </div>

        <div style="background: #fff; border: 2px solid #e5e7eb; border-radius: 16px; padding: 25px; margin-bottom: 20px; text-align: center;">
          <h3 style="color: #374151; margin-top: 0;">Great news!</h3>
          <p style="color: #6b7280; font-size: 15px; line-height: 1.6;">
            Your custom project has been completed and is ready for shipping or pickup!
            We can't wait for you to see the final result.
          </p>
        </div>

        <div style="background: #f9fafb; border-radius: 16px; padding: 20px; margin-bottom: 20px; text-align: center;">
          <p style="color: #6b7280; font-size: 14px; margin: 0;">
            Our team will reach out shortly with delivery details.
          </p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${FRONTEND_URL}/contact" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px;">
            Contact Us
          </a>
        </div>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
          <p style="color: #9ca3af; font-size: 13px; text-align: center;">
            Thank you for trusting us with your custom project!<br>
            - The Imagine This Printed Team
          </p>
        </div>
      </div>
    `
  })
}

// ===============================
// DESIGN SUBMISSION EMAILS
// ===============================

/**
 * Send confirmation email when a design is submitted for approval
 */
export const sendDesignSubmittedEmail = async (
  email: string,
  designId: string,
  designConcept: string,
  previewUrl?: string
): Promise<boolean> => {
  const conceptPreview = designConcept.substring(0, 100)

  return sendEmail({
    to: email,
    subject: `🎨 Design Submitted for Review!`,
    htmlContent: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <!-- Header with Mr. Imagine -->
        <div style="background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); border-radius: 16px 16px 0 0; padding: 25px; text-align: center;">
          <img src="${FRONTEND_URL}/mr-imagine/mr-imagine-waist-up-happy.png" alt="Mr. Imagine" style="width: 100px; height: auto; margin: 0 auto 12px; display: block;" />
          <h1 style="color: white; margin: 0; font-size: 22px;">Design Submitted! 🎨</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 5px 0 0; font-size: 13px;">Your creative masterpiece is under review</p>
        </div>

        <div style="background: white; padding: 25px; border-radius: 0 0 16px 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
          <p style="color: #7c3aed; font-size: 16px; font-weight: 600; margin: 0 0 15px;">
            Hey creative genius! 👋
          </p>

          <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 20px;">
            Woohoo! Your design has been submitted and is now being reviewed by our team.
            We can't wait to see it go live!
          </p>

          ${previewUrl ? `
          <div style="margin: 20px 0; text-align: center;">
            <img src="${previewUrl}" alt="Your Design" style="max-width: 200px; max-height: 200px; border-radius: 12px; border: 2px solid #e5e7eb;" />
          </div>
          ` : ''}

          <div style="background: linear-gradient(135deg, #f3e8ff 0%, #fce7f3 100%); border-radius: 12px; padding: 15px; margin-bottom: 20px;">
            <p style="color: #6b7280; font-size: 12px; margin: 0 0 5px; text-transform: uppercase; letter-spacing: 1px;">Design ID</p>
            <p style="color: #7c3aed; font-size: 16px; font-weight: bold; margin: 0;">${designId.slice(0, 8).toUpperCase()}</p>
            <p style="color: #374151; font-size: 14px; margin: 10px 0 0; font-style: italic;">"${conceptPreview}${designConcept.length > 100 ? '...' : ''}"</p>
          </div>

          <div style="background: #f9fafb; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
            <h3 style="color: #374151; margin: 0 0 15px 0;">What happens next?</h3>
            <ul style="color: #6b7280; font-size: 15px; line-height: 2; margin: 0; padding-left: 20px;">
              <li>🔍 Our team reviews your design (usually within 24 hours)</li>
              <li>✅ Once approved, we'll generate professional mockups</li>
              <li>🛒 Your design goes live and you can start earning!</li>
              <li>💰 Earn 10% royalty on every sale</li>
            </ul>
          </div>

          <div style="text-align: center; margin: 25px 0;">
            <a href="${FRONTEND_URL}/my-designs" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 15px; box-shadow: 0 4px 15px rgba(124, 58, 237, 0.3);">
              View My Designs
            </a>
          </div>

          <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 20px;">
            <p style="color: #6b7280; font-size: 14px; margin: 0;">
              I'll send you another email as soon as your design is approved. Keep creating!
            </p>
            <p style="color: #7c3aed; font-weight: 600; margin: 12px 0 0; font-size: 15px;">
              — Mr. Imagine 🎨
            </p>
          </div>
        </div>

        <div style="text-align: center; padding: 15px; color: #9ca3af; font-size: 11px;">
          <a href="${FRONTEND_URL}" style="color: #7c3aed; text-decoration: none;">Imagine This Printed</a>
        </div>
      </div>
    `
  })
}

// ===============================
// INVOICE EMAILS
// ===============================

/**
 * Send a branded invoice email to client
 */
export const sendInvoiceEmail = async ({
  clientEmail,
  clientName,
  invoiceNumber,
  amountDue,
  dueDate,
  lineItems,
  memo,
  paymentUrl,
  businessName = 'Imagine This Printed'
}: {
  clientEmail: string
  clientName?: string
  invoiceNumber: string
  amountDue: number
  dueDate: string
  lineItems: Array<{ description: string; quantity: number; amount_cents: number }>
  memo?: string
  paymentUrl: string
  businessName?: string
}): Promise<boolean> => {
  const formattedAmount = (amountDue / 100).toFixed(2)
  const displayName = clientName || clientEmail.split('@')[0]

  const lineItemsHtml = lineItems.map(item => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #374151;">${item.description}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #374151;">${item.quantity}</td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #374151;">$${(item.amount_cents / 100).toFixed(2)}</td>
    </tr>
  `).join('')

  return sendEmail({
    to: clientEmail,
    subject: `Invoice from ${businessName} - $${formattedAmount} Due`,
    htmlContent: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">

        <!-- Header with Mr. Imagine -->
        <div style="background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); padding: 30px; text-align: center; border-radius: 12px 12px 0 0;">
          <img src="${FRONTEND_URL}/mr-imagine/mr-imagine-waist-up.png" alt="Mr. Imagine" style="height: 80px; margin-bottom: 15px;" />
          <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 600;">Invoice from ${businessName}</h1>
        </div>

        <div style="padding: 30px; background: #f9fafb;">
          <p style="color: #374151; font-size: 16px; margin: 0 0 20px;">
            Hi ${displayName}! 👋
          </p>

          <p style="color: #374151; font-size: 15px; line-height: 1.6; margin: 0 0 25px;">
            Here's your invoice. You can pay securely online using the button below.
          </p>

          <!-- Invoice Details Box -->
          <div style="background: white; border-radius: 12px; padding: 25px; margin-bottom: 25px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
            <table style="width: 100%; margin-bottom: 20px;">
              <tr>
                <td style="vertical-align: top;">
                  <p style="color: #6b7280; font-size: 13px; margin: 0;">Invoice Number</p>
                  <p style="color: #111827; font-size: 15px; font-weight: 600; margin: 5px 0 0;">${invoiceNumber}</p>
                </td>
                <td style="vertical-align: top; text-align: right;">
                  <p style="color: #6b7280; font-size: 13px; margin: 0;">Due Date</p>
                  <p style="color: #111827; font-size: 15px; font-weight: 600; margin: 5px 0 0;">${dueDate}</p>
                </td>
              </tr>
            </table>

            <!-- Line Items Table -->
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <thead>
                <tr style="background: #f3f4f6;">
                  <th style="padding: 12px; text-align: left; font-size: 13px; color: #6b7280; font-weight: 600;">Description</th>
                  <th style="padding: 12px; text-align: center; font-size: 13px; color: #6b7280; font-weight: 600;">Qty</th>
                  <th style="padding: 12px; text-align: right; font-size: 13px; color: #6b7280; font-weight: 600;">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${lineItemsHtml}
              </tbody>
            </table>

            <!-- Total -->
            <table style="width: 100%; border-top: 2px solid #e5e7eb; padding-top: 15px; margin-top: 10px;">
              <tr>
                <td style="font-size: 18px; font-weight: 600; color: #111827; padding-top: 15px;">Amount Due</td>
                <td style="font-size: 24px; font-weight: 700; color: #7c3aed; text-align: right; padding-top: 15px;">$${formattedAmount}</td>
              </tr>
            </table>

            ${memo ? `
              <div style="background: #fef3c7; border-radius: 8px; padding: 15px; margin-top: 20px;">
                <p style="color: #92400e; font-size: 14px; margin: 0;"><strong>Note:</strong> ${memo}</p>
              </div>
            ` : ''}
          </div>

          <!-- Pay Now Button -->
          <div style="text-align: center; margin: 30px 0;">
            <a href="${paymentUrl}" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: white; padding: 16px 40px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(124, 58, 237, 0.4);">
              💳 Pay Now - $${formattedAmount}
            </a>
          </div>

          <p style="color: #6b7280; font-size: 13px; text-align: center; margin: 20px 0 0;">
            Payment is processed securely via Stripe. Click the button above to pay online.
          </p>
        </div>

        <!-- Footer -->
        <div style="background: #1f2937; padding: 25px; text-align: center; border-radius: 0 0 12px 12px;">
          <p style="color: #9ca3af; font-size: 13px; margin: 0 0 10px;">
            Questions about this invoice? Reply to this email or contact us at
          </p>
          <a href="mailto:wecare@imaginethisprinted.com" style="color: #a78bfa; text-decoration: none; font-size: 14px;">
            wecare@imaginethisprinted.com
          </a>
          <p style="color: #6b7280; font-size: 11px; margin: 15px 0 0;">
            © ${new Date().getFullYear()} Imagine This Printed. All rights reserved.
          </p>
        </div>
      </div>
    `
  })
}

/**
 * Send gift card email to recipient with Mr. Imagine branding
 */
export async function sendGiftCardEmail({
  recipientEmail,
  recipientName,
  senderName,
  giftCardCode,
  itcAmount,
  personalMessage
}: {
  recipientEmail: string
  recipientName?: string
  senderName: string
  giftCardCode: string
  itcAmount: number
  personalMessage?: string
}): Promise<void> {
  const usdValue = (itcAmount * 0.10).toFixed(2)
  const greeting = recipientName ? `Hi ${recipientName}!` : 'Hello!'

  await sendEmail({
    to: recipientEmail,
    subject: `${senderName} sent you a gift! 🎁`,
    htmlContent: `
      <div style="background: linear-gradient(135deg, #f9f5ff 0%, #fdf2f8 100%); padding: 40px 20px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
        <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.15);">
          <!-- Header with Mr. Imagine -->
          <div style="background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); padding: 40px; text-align: center;">
            <img
              src="https://imaginethisprinted.com/mr-imagine/mr-imagine-waist-up.png"
              alt="Mr. Imagine"
              style="height: 100px; margin-bottom: 15px;"
            />
            <h1 style="color: #ffffff; font-size: 28px; margin: 0; font-weight: 700;">
              You've Got a Gift!
            </h1>
            <p style="color: rgba(255,255,255,0.9); font-size: 16px; margin: 10px 0 0;">
              From ${senderName}
            </p>
          </div>

          <!-- Body -->
          <div style="padding: 40px;">
            <p style="color: #374151; font-size: 18px; line-height: 1.6; margin: 0 0 25px;">
              ${greeting}
            </p>
            <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 25px;">
              ${senderName} has sent you a special gift from Imagine This Printed!
              Use this gift card to unlock exclusive AI-powered designs and create something amazing.
            </p>

            ${personalMessage ? `
              <div style="background: linear-gradient(135deg, #f5f3ff 0%, #fce7f3 100%); border-left: 4px solid #7c3aed; padding: 20px; border-radius: 0 12px 12px 0; margin: 25px 0;">
                <p style="color: #6b7280; font-size: 14px; margin: 0 0 5px; text-transform: uppercase; letter-spacing: 0.5px;">
                  Personal Message
                </p>
                <p style="color: #374151; font-size: 16px; font-style: italic; margin: 0;">
                  "${personalMessage}"
                </p>
              </div>
            ` : ''}

            <!-- Gift Card Display -->
            <div style="background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); border-radius: 16px; padding: 30px; text-align: center; margin: 30px 0;">
              <p style="color: rgba(255,255,255,0.9); font-size: 14px; margin: 0 0 10px; text-transform: uppercase; letter-spacing: 1px;">
                Your Gift Card Code
              </p>
              <div style="background: rgba(255,255,255,0.2); border-radius: 8px; padding: 15px; margin: 0 0 20px;">
                <code style="color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: 3px;">
                  ${giftCardCode}
                </code>
              </div>
              <div style="display: flex; justify-content: center; gap: 30px; flex-wrap: wrap;">
                <div>
                  <p style="color: rgba(255,255,255,0.8); font-size: 12px; margin: 0 0 5px;">ITC TOKENS</p>
                  <p style="color: #ffffff; font-size: 28px; font-weight: 700; margin: 0;">
                    ${itcAmount.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p style="color: rgba(255,255,255,0.8); font-size: 12px; margin: 0 0 5px;">VALUE</p>
                  <p style="color: #ffffff; font-size: 28px; font-weight: 700; margin: 0;">
                    $${usdValue}
                  </p>
                </div>
              </div>
            </div>

            <!-- How to Redeem -->
            <div style="background: #f9fafb; border-radius: 12px; padding: 25px; margin: 25px 0;">
              <h3 style="color: #374151; font-size: 16px; margin: 0 0 15px; font-weight: 600;">
                How to Redeem Your Gift:
              </h3>
              <ol style="color: #6b7280; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
                <li>Visit <a href="https://imaginethisprinted.com" style="color: #7c3aed; text-decoration: none; font-weight: 600;">imaginethisprinted.com</a></li>
                <li>Create an account or sign in</li>
                <li>Go to your Wallet page</li>
                <li>Enter your gift card code to claim your ITC tokens</li>
                <li>Start creating amazing designs!</li>
              </ol>
            </div>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 30px 0;">
              <a
                href="https://imaginethisprinted.com/wallet"
                style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #ec4899 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 12px; font-weight: 600; font-size: 16px; box-shadow: 0 10px 25px -5px rgba(124, 58, 237, 0.4);"
              >
                Redeem Your Gift Now
              </a>
            </div>
          </div>

          <!-- Footer -->
          <div style="background: #f9fafb; padding: 25px; text-align: center; border-top: 1px solid #e5e7eb;">
            <img
              src="https://imaginethisprinted.com/mr-imagine/mr-imagine-head.png"
              alt="Mr. Imagine"
              style="height: 40px; margin-bottom: 10px;"
            />
            <p style="color: #6b7280; font-size: 12px; margin: 0;">
              © ${new Date().getFullYear()} Imagine This Printed. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    `
  })
}

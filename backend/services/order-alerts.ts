// Team-facing alerts for the CLOSE of an order's life.
//
// The open of that life already had one: services/order-payment.ts fires
// notifyTeamOfPaidOrder the moment Stripe money lands, which is the "make this
// and ship it" signal. There was no matching signal at the other end, so
// nothing told the shop an order had actually gone out the door — the only way
// to know was to go and look at the dashboard.
//
// David, 2026-09-07: "we need to be alerted when an order is coming in and when
// they're completed so we can ship".
//
// Deliberately separate from order-payment.ts: that module runs inside the
// Stripe webhook against live money and its failure modes are about not
// double-charging. This one runs off an admin clicking a button, and every
// failure here is cosmetic — which is why nothing in it is allowed to throw.
import { supabase } from '../lib/supabase.js'
import { sendEmail } from '../utils/email.js'

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://imaginethisprinted.com'

export interface OrderClosedAlert {
  orderId: string
  orderNumber: string
  /** 'shipped' | 'delivered' | 'completed' — the state it just moved INTO. */
  status: string
  total: number
  customerEmail?: string | null
  trackingNumber?: string | null
  trackingCompany?: string | null
}

const STATUS_HEADLINE: Record<string, string> = {
  shipped: 'Shipped',
  delivered: 'Delivered',
  completed: 'Completed'
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Same recipient list as the "new order" alert, so one inbox sees both bookends. */
function crewRecipients(): string[] {
  return (
    process.env.PRINT_WORKER_EMAILS ||
    process.env.ADMIN_ALERT_EMAIL ||
    process.env.SUPPORT_EMAIL ||
    'wecare@imaginethisprinted.com'
  ).split(',').map(s => s.trim()).filter(Boolean)
}

async function sendOrderClosedTeamEmail(alert: OrderClosedAlert): Promise<boolean> {
  const headline = STATUS_HEADLINE[alert.status] || `Order ${alert.status}`
  const tracking = [alert.trackingCompany, alert.trackingNumber].filter(Boolean).join(' ')

  const html = `
      <div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h1 style="color:#16a34a;margin:0 0 6px;font-size:22px;">${esc(headline)} - ${esc(alert.orderNumber)}</h1>
        <p style="color:#6b7280;font-size:14px;margin:0 0 22px;">$${alert.total.toFixed(2)}</p>

        <div style="background:#f9fafb;border-radius:12px;padding:18px;margin-bottom:18px;">
          <p style="margin:0 0 6px;color:#374151;font-size:14px;">Status: <strong>${esc(alert.status)}</strong></p>
          <p style="margin:0 0 6px;color:#374151;font-size:14px;">Customer: ${esc(alert.customerEmail || 'no email on file')}</p>
          <p style="margin:0;color:#374151;font-size:14px;">${tracking ? `Tracking: ${esc(tracking)}` : 'No tracking on this order.'}</p>
        </div>

        ${alert.customerEmail
      ? '<p style="color:#16a34a;font-size:14px;margin:0 0 18px;">The customer has been emailed automatically.</p>'
      : '<p style="color:#dc2626;font-size:14px;margin:0 0 18px;"><strong>No customer email on file - nobody was notified.</strong> Reach out by hand if you have another contact.</p>'}

        <div style="text-align:center;margin:26px 0;">
          <a href="${FRONTEND_URL}/orders" style="display:inline-block;background:#7c3aed;color:#fff;padding:13px 26px;text-decoration:none;border-radius:10px;font-weight:bold;font-size:15px;">
            Open Order Management
          </a>
        </div>
      </div>`

  const results = await Promise.all(
    crewRecipients().map(to => sendEmail({
      to,
      subject: `${headline}: ${alert.orderNumber} ($${alert.total.toFixed(2)})`,
      htmlContent: html
    }))
  )
  return results.some(Boolean)
}

/**
 * Bell row + crew email when an order reaches shipped/delivered/completed.
 *
 * Never throws. The order status change is already committed and is the thing
 * that matters; an alert that fails must not turn a successful update into an
 * error the admin retries, because a retried PATCH is how duplicate customer
 * emails get sent.
 */
export async function notifyTeamOfOrderClosed(alert: OrderClosedAlert): Promise<void> {
  const headline = STATUS_HEADLINE[alert.status] || `Order ${alert.status}`
  const tracking = [alert.trackingCompany, alert.trackingNumber].filter(Boolean).join(' ')

  try {
    const { error } = await supabase.from('admin_notifications').insert({
      type: 'order_completed',
      title: `${headline} - ${alert.orderNumber} ($${alert.total.toFixed(2)})`,
      message:
        `Order ${alert.orderNumber} is now ${alert.status}.` +
        (tracking ? ` Tracking: ${tracking}.` : '') +
        (alert.customerEmail
          ? ` Customer ${alert.customerEmail} has been emailed.`
          : ' No customer email on file - nobody was notified.')
    })
    // An unapplied 20260907120000 migration shows up here as a type_check
    // violation. Log it and carry on to the email, which is what the crew reads.
    if (error) console.error('[order-alerts] admin_notifications insert failed:', error.message)
  } catch (err: any) {
    console.error('[order-alerts] admin_notifications insert threw:', err?.message || err)
  }

  try {
    await sendOrderClosedTeamEmail(alert)
  } catch (err: any) {
    console.error('[order-alerts] team email failed:', err?.message || err)
  }
}

// Paid-order steps for vendor storefront orders (source 'store:<slug>', routes/vendor-store.ts).
// Both are called from applyPaidCheckoutOrder and are fail-soft: the payment already succeeded.
//
// 1. backfillVendorStoreBuyer: Stripe Checkout collects the buyer's email (and phone, when the cart had none). The
//    address comes from the cart, where shipping was priced for it, so it is kept; an older order without one takes
//    Stripe's. Copied in before the confirmation email reads it.
// 2. notifyVendorOfPaidOrder: email the seller the lines SHE ships (maker 'vendor'); ITP's own
//    lines stay in ITP's normal order queue.
import Stripe from 'stripe'
import type { Logger } from 'pino'
import { supabase } from '../lib/supabase.js'
import { sendEmail } from '../utils/email.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-02-24.acacia' })

const isVendorStoreOrder = (order: any) => typeof order?.source === 'string' && order.source.startsWith('store:')

export async function backfillVendorStoreBuyer(order: any, log?: Logger): Promise<any> {
  if (!isVendorStoreOrder(order)) return order
  const sessionId = order.metadata?.stripe_session_id
  if (!sessionId || (order.customer_email && order.shipping_address?.address)) return order
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    const details = session.customer_details
    const ship = (session as any).shipping_details || (session as any).collected_information?.shipping_details
    const name = String(ship?.name || details?.name || '').trim()
    const [firstName, ...rest] = name.split(/\s+/)
    const a = ship?.address || details?.address || {}
    const kept = order.shipping_address?.address ? order.shipping_address : null
    const patch = {
      customer_email: order.customer_email || details?.email || null,
      customer_name: order.customer_name || name || null,
      shipping_address: kept ? { ...kept, email: kept.email || details?.email || '', phone: kept.phone || details?.phone || '' } : {
        firstName: firstName || '',
        lastName: rest.join(' '),
        email: details?.email || '',
        phone: details?.phone || '',
        address: [a.line1, a.line2].filter(Boolean).join(', '),
        city: a.city || '',
        state: a.state || '',
        zipCode: a.postal_code || '',
        country: a.country || 'US'
      }
    }
    await supabase.from('orders').update(patch).eq('id', order.id)
    return { ...order, ...patch }
  } catch (err) {
    log?.error({ err, orderId: order.id }, '[vendor-store] buyer backfill failed')
    return order
  }
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`
const SITE_URL = process.env.FRONTEND_URL || 'https://imaginethisprinted.com'

export async function notifyVendorOfPaidOrder(order: any, log?: Logger): Promise<void> {
  if (!isVendorStoreOrder(order)) return
  try {
    const slug = order.source.slice('store:'.length)
    const { data: store } = await supabase.from('vendor_storefronts').select('name, owner_email').eq('slug', slug).maybeSingle()
    if (!store?.owner_email) return
    const items: any[] = order.metadata?.items || []
    const hers = items.filter(i => i.maker === 'vendor')
    const ours = items.filter(i => i.maker === 'itp')
    const share = order.metadata?.vendor_store?.split?.vendorShareCents
    const a = order.shipping_address || {}
    const line = (i: any) => `<li>${esc(i.quantity)} x ${esc(i.name)}${i.size ? ` (${esc(i.size)})` : ''}${i.color ? `, ${esc(i.color)}` : ''}</li>`

    await sendEmail({
      to: store.owner_email,
      subject: `New order on ${store.name}: ${order.order_number}`,
      htmlContent: `
        <h2>You made a sale!</h2>
        <p>Order <strong>${esc(order.order_number)}</strong>${typeof share === 'number' ? `. Your share is <strong>${usd(share)}</strong>, paid to your account by Stripe` : ''}.</p>
        ${hers.length ? `<h3>Please make and ship these</h3><ul>${hers.map(line).join('')}</ul>
        <p>Your shipping label is paid for: open <a href="${SITE_URL}/vendor/store/${encodeURIComponent(slug)}#orders">your store</a> and press <strong>Print label</strong> on this order.</p>
        <p><strong>Ship to:</strong><br>${esc([a.firstName, a.lastName].filter(Boolean).join(' '))}<br>${esc(a.address)}${a.address2 ? `, ${esc(a.address2)}` : ''}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.zipCode)}${a.phone ? `<br>${esc(a.phone)}` : ''}</p>` : ''}
        ${ours.length ? `<h3>Imagine This Printed makes and ships these</h3><ul>${ours.map(line).join('')}</ul>` : ''}
      `
    })
  } catch (err) {
    log?.error({ err, orderId: order?.id }, '[vendor-store] seller email failed')
  }
}

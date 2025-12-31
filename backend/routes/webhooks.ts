import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import Stripe from 'stripe'
import { supabase } from '../lib/supabase.js'
import { sendWelcomeEmail } from '../utils/email.js'
import {
  handleConnectAccountUpdate,
  handlePayoutPaid,
  handlePayoutFailed
} from '../services/stripe-connect.js'

const router = Router()
const prisma = new PrismaClient()

// ===============================
// BREVO EMAIL TRACKING WEBHOOKS
// ===============================

interface BrevoWebhookEvent {
  event: 'delivered' | 'opened' | 'click' | 'hard_bounce' | 'soft_bounce' | 'spam' | 'unsubscribe' | 'blocked' | 'invalid'
  email: string
  'message-id': string
  date: string
  link?: string
  tag?: string
  ts_event?: number
}

/**
 * POST /api/webhooks/brevo
 * Receives real-time email tracking events from Brevo
 */
router.post('/brevo', async (req: Request, res: Response) => {
  try {
    const event = req.body as BrevoWebhookEvent

    console.log('[Brevo Webhook] Received event:', event.event, 'for messageId:', event['message-id'])

    if (!event['message-id']) {
      console.warn('[Brevo Webhook] No message-id in event')
      return res.status(200).json({ received: true })
    }

    const messageId = event['message-id']
    const eventTime = new Date(event.ts_event ? event.ts_event * 1000 : event.date)

    // Find the email log entry by message_id
    const { data: emailLog, error: findError } = await supabase
      .from('email_logs')
      .select('id, open_count, click_count, clicked_links')
      .eq('message_id', messageId)
      .single()

    if (findError || !emailLog) {
      console.warn('[Brevo Webhook] Email log not found for messageId:', messageId)
      // Still return 200 to prevent retries
      return res.status(200).json({ received: true })
    }

    // Build update based on event type
    const update: Record<string, any> = {}

    switch (event.event) {
      case 'delivered':
        update.status = 'delivered'
        break

      case 'opened':
        update.open_count = (emailLog.open_count || 0) + 1
        if (!emailLog.open_count || emailLog.open_count === 0) {
          update.opened_at = eventTime.toISOString()
        }
        break

      case 'click':
        update.click_count = (emailLog.click_count || 0) + 1
        if (!emailLog.click_count || emailLog.click_count === 0) {
          update.clicked_at = eventTime.toISOString()
        }
        // Track clicked links
        const currentLinks = emailLog.clicked_links || []
        if (event.link) {
          currentLinks.push({
            url: event.link,
            clicked_at: eventTime.toISOString()
          })
          update.clicked_links = currentLinks
        }
        break

      case 'hard_bounce':
      case 'soft_bounce':
        update.status = 'bounced'
        update.bounced_at = eventTime.toISOString()
        update.error_message = `${event.event}: Email could not be delivered`
        break

      case 'spam':
        update.status = 'spam'
        update.spam_reported_at = eventTime.toISOString()
        break

      case 'unsubscribe':
        update.unsubscribed_at = eventTime.toISOString()
        break

      case 'blocked':
      case 'invalid':
        update.status = 'failed'
        update.error_message = `${event.event}: Email blocked or invalid`
        break

      default:
        console.log('[Brevo Webhook] Unhandled event type:', event.event)
    }

    // Update the email log if we have updates
    if (Object.keys(update).length > 0) {
      const { error: updateError } = await supabase
        .from('email_logs')
        .update(update)
        .eq('id', emailLog.id)

      if (updateError) {
        console.error('[Brevo Webhook] Failed to update email log:', updateError)
      } else {
        console.log('[Brevo Webhook] Updated email log:', emailLog.id, 'with:', Object.keys(update))
      }
    }

    return res.status(200).json({ received: true })
  } catch (error: any) {
    console.error('[Brevo Webhook] Processing error:', error)
    // Still return 200 to prevent Brevo from retrying
    return res.status(200).json({ received: true, error: error.message })
  }
})

// ===============================
// SUPABASE AUTH WEBHOOKS
// ===============================

interface SupabaseAuthWebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  schema: string
  record: {
    id: string
    email?: string
    raw_user_meta_data?: {
      username?: string
      display_name?: string
      first_name?: string
      full_name?: string
      avatar_url?: string
    }
    created_at?: string
  }
  old_record?: any
}

/**
 * POST /api/webhooks/supabase-auth
 * Receives webhook events from Supabase Database Webhooks
 * Triggered on INSERT to auth.users table (new user signup)
 *
 * To set up in Supabase Dashboard:
 * 1. Go to Database → Webhooks
 * 2. Create new webhook
 * 3. Table: auth.users, Events: INSERT
 * 4. URL: https://api.imaginethisprinted.com/api/webhooks/supabase-auth
 * 5. Add header: x-webhook-secret with your SUPABASE_WEBHOOK_SECRET
 */
router.post('/supabase-auth', async (req: Request, res: Response) => {
  try {
    // Verify webhook secret (optional but recommended)
    const webhookSecret = process.env.SUPABASE_WEBHOOK_SECRET
    if (webhookSecret) {
      const receivedSecret = req.headers['x-webhook-secret']
      if (receivedSecret !== webhookSecret) {
        console.warn('[Supabase Webhook] Invalid webhook secret')
        return res.status(401).json({ error: 'Invalid webhook secret' })
      }
    }

    const payload = req.body as SupabaseAuthWebhookPayload

    console.log('[Supabase Webhook] Received:', payload.type, 'on', payload.table)

    // Only handle new user signups (INSERT on auth.users)
    if (payload.type === 'INSERT' && payload.table === 'users') {
      const user = payload.record
      const email = user.email
      const metadata = user.raw_user_meta_data || {}
      const username = metadata.username || metadata.display_name || metadata.first_name || email?.split('@')[0] || 'Friend'

      if (email) {
        console.log('[Supabase Webhook] New user signup:', email, 'username:', username)

        // Send welcome email
        try {
          await sendWelcomeEmail(email, username)
          console.log('[Supabase Webhook] ✅ Welcome email sent to:', email)
        } catch (emailError) {
          console.error('[Supabase Webhook] ❌ Failed to send welcome email:', emailError)
          // Don't fail the webhook if email fails
        }
      } else {
        console.warn('[Supabase Webhook] New user has no email:', user.id)
      }
    }

    return res.status(200).json({ received: true })
  } catch (error: any) {
    console.error('[Supabase Webhook] Processing error:', error)
    // Return 200 to prevent retries for now
    return res.status(200).json({ received: true, error: error.message })
  }
})

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-02-24.acacia'
})

// Stripe webhook handler
router.post('/stripe', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.error('Missing STRIPE_WEBHOOK_SECRET')
    return res.status(500).json({ error: 'Webhook secret not configured' })
  }

  let event: Stripe.Event

  try {
    const body = JSON.stringify(req.body)
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message)
    return res.status(400).json({ error: 'Invalid signature' })
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(event.data.object as Stripe.PaymentIntent)
        break

      case 'payment_intent.payment_failed':
        await handlePaymentFailure(event.data.object as Stripe.PaymentIntent)
        break

      // ===============================
      // STRIPE CONNECT EVENTS
      // ===============================
      case 'account.updated': {
        const account = event.data.object as Stripe.Account
        console.log('[Stripe Connect Webhook] Account updated:', account.id)
        await handleConnectAccountUpdate(account)
        break
      }

      case 'payout.paid': {
        const payout = event.data.object as Stripe.Payout
        // Check if this is from a connected account
        if (event.account) {
          console.log('[Stripe Connect Webhook] Payout paid:', payout.id, 'account:', event.account)
          await handlePayoutPaid(payout, event.account)
        }
        break
      }

      case 'payout.failed': {
        const payout = event.data.object as Stripe.Payout
        // Check if this is from a connected account
        if (event.account) {
          console.log('[Stripe Connect Webhook] Payout failed:', payout.id, 'account:', event.account)
          await handlePayoutFailed(payout, event.account)
        }
        break
      }

      // ===============================
      // FOUNDER INVOICE EVENTS
      // ===============================
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice
        console.log('[Stripe Webhook] Invoice paid:', invoice.id)
        await handleInvoicePaid(invoice)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        console.log('[Stripe Webhook] Invoice payment failed:', invoice.id)
        await handleInvoicePaymentFailed(invoice)
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return res.status(200).json({ received: true })
  } catch (error) {
    console.error('Webhook processing error:', error)
    return res.status(500).json({ error: 'Webhook processing failed' })
  }
})

async function handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
  try {
    const { metadata } = paymentIntent
    console.log('[Stripe Webhook] Payment succeeded:', paymentIntent.id, 'metadata:', metadata)

    // First, try to find and update an existing order by payment_intent_id or order_id
    const orderId = metadata?.orderId
    const paymentIntentIdForLookup = paymentIntent.id

    // Look for existing order in Supabase
    let existingOrder = null
    if (orderId) {
      const { data } = await supabase
        .from('orders')
        .select('id')
        .eq('id', orderId)
        .single()
      existingOrder = data
    }

    if (!existingOrder) {
      // Try to find by stripe_payment_intent_id
      const { data } = await supabase
        .from('orders')
        .select('id')
        .eq('stripe_payment_intent_id', paymentIntentIdForLookup)
        .single()
      existingOrder = data
    }

    if (existingOrder) {
      // Update existing order to paid
      const { error: updateError } = await supabase
        .from('orders')
        .update({
          payment_status: 'paid',
          status: 'processing',
          stripe_payment_intent_id: paymentIntentIdForLookup,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingOrder.id)

      if (updateError) {
        console.error('[Stripe Webhook] Failed to update order:', updateError)
      } else {
        console.log('[Stripe Webhook] ✅ Order updated to paid:', existingOrder.id)
      }
    } else {
      // No existing order found - create a new one in Supabase
      const items = JSON.parse(metadata?.items || '[]')
      const shipping = JSON.parse(metadata?.shipping || '{}')

      const { data: newOrder, error: createError } = await supabase
        .from('orders')
        .insert({
          order_number: `ITP-${Date.now().toString(36).toUpperCase()}`,
          stripe_payment_intent_id: paymentIntent.id,
          user_id: metadata?.userId || null,
          customer_email: metadata?.customerEmail || shipping?.email || null,
          subtotal: paymentIntent.amount / 100,
          total: paymentIntent.amount / 100,
          currency: paymentIntent.currency.toUpperCase(),
          status: 'processing',
          payment_status: 'paid',
          shipping_address: shipping,
          metadata: { items, source: 'webhook_fallback' }
        })
        .select()
        .single()

      if (createError) {
        console.error('[Stripe Webhook] Failed to create order:', createError)
      } else {
        console.log('[Stripe Webhook] ✅ New order created:', newOrder?.id)
      }
    }

    // Handle ITC purchases (wallet top-ups)
    if (metadata?.userId && metadata?.itcAmount) {
      const itcAmount = parseFloat(metadata.itcAmount)
      const usdAmount = paymentIntent.amount / 100

      // Get current wallet
      const { data: wallet } = await supabase
        .from('user_wallets')
        .select('itc_balance')
        .eq('user_id', metadata.userId)
        .single()

      const currentBalance = wallet?.itc_balance || 0
      const newBalance = currentBalance + itcAmount

      // Update wallet in Supabase
      const { error: walletError } = await supabase
        .from('user_wallets')
        .upsert({
          user_id: metadata.userId,
          itc_balance: newBalance,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' })

      if (walletError) {
        console.error('[Stripe Webhook] Failed to update wallet:', walletError)
      } else {
        console.log('[Stripe Webhook] ✅ Wallet updated, new ITC balance:', newBalance)
      }

      // Record ITC transaction
      await supabase
        .from('itc_transactions')
        .insert({
          user_id: metadata.userId,
          type: 'purchase',
          amount: itcAmount,
          balance_after: newBalance,
          usd_value: usdAmount,
          reason: 'ITC token purchase',
          reference_id: paymentIntent.id
        })
    }

    console.log(`[Stripe Webhook] Payment processing complete: ${paymentIntent.id}`)
  } catch (error) {
    console.error('[Stripe Webhook] Payment success handling error:', error)
  }
}

async function handlePaymentFailure(paymentIntent: Stripe.PaymentIntent) {
  try {
    console.log(`Payment failed: ${paymentIntent.id}`, paymentIntent.last_payment_error)
  } catch (error) {
    console.error('Payment failure handling error:', error)
  }
}

// ===============================
// FOUNDER INVOICE HANDLERS
// ===============================

async function handleInvoicePaid(stripeInvoice: Stripe.Invoice) {
  try {
    const founderId = stripeInvoice.metadata?.founder_id

    if (!founderId) {
      console.log('[Invoice Webhook] Not a founder invoice, skipping')
      return
    }

    // Find the invoice in our database
    const { data: invoice, error: findError } = await supabase
      .from('founder_invoices')
      .select('*')
      .eq('stripe_invoice_id', stripeInvoice.id)
      .single()

    if (findError || !invoice) {
      console.error('[Invoice Webhook] Invoice not found:', stripeInvoice.id)
      return
    }

    // Update invoice status
    const { error: updateError } = await supabase
      .from('founder_invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString()
      })
      .eq('id', invoice.id)

    if (updateError) {
      console.error('[Invoice Webhook] Failed to update invoice:', updateError)
      return
    }

    // Credit founder earnings to their wallet
    const founderEarningsCents = invoice.founder_earnings_cents
    const founderEarningsUSD = founderEarningsCents / 100

    // Get current wallet balance
    const { data: wallet, error: walletError } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', founderId)
      .single()

    if (walletError || !wallet) {
      console.error('[Invoice Webhook] Founder wallet not found:', founderId)
      return
    }

    // Convert USD earnings to ITC (1 ITC = $0.01)
    const itcEarnings = founderEarningsCents // $1 = 100 ITC

    const newBalance = parseFloat(wallet.itc_balance || '0') + itcEarnings

    // Update wallet
    const { error: walletUpdateError } = await supabase
      .from('user_wallets')
      .update({
        itc_balance: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', founderId)

    if (walletUpdateError) {
      console.error('[Invoice Webhook] Failed to update wallet:', walletUpdateError)
      return
    }

    // Record the ITC transaction
    await supabase
      .from('itc_transactions')
      .insert({
        user_id: founderId,
        type: 'reward',
        amount: itcEarnings,
        balance_after: newBalance,
        usd_value: founderEarningsUSD,
        reason: `Invoice earnings (35% of $${(invoice.subtotal_cents / 100).toFixed(2)})`,
        reference_id: invoice.id
      })

    console.log(`[Invoice Webhook] ✅ Invoice paid: ${invoice.id}, Founder ${founderId} earned ${itcEarnings} ITC ($${founderEarningsUSD.toFixed(2)})`)
  } catch (error) {
    console.error('[Invoice Webhook] Invoice paid handling error:', error)
  }
}

async function handleInvoicePaymentFailed(stripeInvoice: Stripe.Invoice) {
  try {
    const founderId = stripeInvoice.metadata?.founder_id

    if (!founderId) {
      console.log('[Invoice Webhook] Not a founder invoice, skipping')
      return
    }

    // Update invoice status to overdue (Stripe will retry)
    const { error } = await supabase
      .from('founder_invoices')
      .update({ status: 'overdue' })
      .eq('stripe_invoice_id', stripeInvoice.id)

    if (error) {
      console.error('[Invoice Webhook] Failed to update invoice status:', error)
    }

    console.log(`[Invoice Webhook] Invoice payment failed: ${stripeInvoice.id}`)
  } catch (error) {
    console.error('[Invoice Webhook] Invoice payment failed handling error:', error)
  }
}

export default router
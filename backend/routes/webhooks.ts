import { Router, Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import Stripe from 'stripe'
import { supabase } from '../lib/supabase.js'
import { sendWelcomeEmail } from '../utils/email.js'

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
    const items = JSON.parse(metadata?.items || '[]')
    const shipping = JSON.parse(metadata?.shipping || '{}')

    const orderData = {
      order_number: `ORD-${Date.now()}`,
      payment_intent_id: paymentIntent.id,
      user_id: metadata?.userId || null,
      customer_email: metadata?.customerEmail || null,
      subtotal: paymentIntent.amount / 100, // Convert cents to dollars
      total: paymentIntent.amount / 100,
      currency: paymentIntent.currency.toUpperCase(),
      status: 'confirmed',
      payment_status: 'paid',
      payment_method: 'stripe',
      shipping_address: shipping,
      source: 'web'
    }

    const order = await prisma.order.create({
      data: {
        orderNumber: orderData.order_number,
        paymentIntentId: orderData.payment_intent_id,
        userId: orderData.user_id,
        customerEmail: orderData.customer_email,
        subtotal: orderData.subtotal,
        total: orderData.total,
        currency: orderData.currency,
        status: orderData.status,
        paymentStatus: orderData.payment_status,
        paymentMethod: orderData.payment_method,
        shippingAddress: orderData.shipping_address,
        source: orderData.source
      }
    })

    if (metadata?.userId && metadata?.itcAmount) {
      const itcAmount = parseFloat(metadata.itcAmount)
      const usdAmount = paymentIntent.amount / 100 // Convert cents to dollars
      
      // Get current wallet balance
      const walletData = await prisma.userWallet.findUnique({
        where: { userId: metadata.userId },
        select: { itcBalance: true }
      })
      
      const currentBalance = Number(walletData?.itcBalance || 0)
      const newBalance = currentBalance + itcAmount
      
      // Update wallet balance
      await prisma.userWallet.upsert({
        where: { userId: metadata.userId },
        update: { itcBalance: newBalance },
        create: {
          userId: metadata.userId,
          itcBalance: newBalance,
          pointsBalance: 0
        }
      })

      // Record transaction
      await prisma.itcTransaction.create({
        data: {
          userId: metadata.userId,
          type: 'purchase',
          amount: itcAmount,
          balanceAfter: newBalance,
          usdValue: usdAmount,
          reason: 'ITC token purchase',
          paymentIntentId: paymentIntent.id
        }
      })
    }

    console.log(`Payment succeeded: ${paymentIntent.id}`)
  } catch (error) {
    console.error('Payment success handling error:', error)
  }
}

async function handlePaymentFailure(paymentIntent: Stripe.PaymentIntent) {
  try {
    console.log(`Payment failed: ${paymentIntent.id}`, paymentIntent.last_payment_error)
  } catch (error) {
    console.error('Payment failure handling error:', error)
  }
}

export default router
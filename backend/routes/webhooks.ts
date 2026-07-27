import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { supabase } from '../lib/supabase.js'
import { sendWelcomeEmail } from '../utils/email.js'

const router = Router()

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

/**
 * Constant-time string comparison for the webhook shared secret. Mirrors
 * middleware/requireStorefrontSecret.ts's safeEqual: crypto.timingSafeEqual
 * throws if the two buffers differ in length, so length is checked first
 * (leaking only length, never content, via timing) before the constant-time
 * comparison runs.
 */
function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * Verifies the Supabase webhook shared secret. Fails closed: if
 * SUPABASE_WEBHOOK_SECRET isn't configured server-side at all, every request
 * is rejected (503) rather than falling through to "no check" — previously
 * an unset/mistyped secret in the deploy environment turned this endpoint
 * into an open relay that would call sendWelcomeEmail() for any
 * attacker-supplied payload. Exported for unit testing.
 */
export function verifySupabaseWebhookSecret(
  configuredSecret: string | undefined,
  receivedHeader: string | string[] | undefined
): { ok: true } | { ok: false; status: 401 | 503; error: string } {
  if (!configuredSecret) {
    return { ok: false, status: 503, error: 'Webhook not configured' }
  }
  if (typeof receivedHeader !== 'string' || !safeEqual(receivedHeader, configuredSecret)) {
    return { ok: false, status: 401, error: 'Invalid webhook secret' }
  }
  return { ok: true }
}

router.post('/supabase-auth', async (req: Request, res: Response) => {
  try {
    const verification = verifySupabaseWebhookSecret(
      process.env.SUPABASE_WEBHOOK_SECRET,
      req.headers['x-webhook-secret']
    )
    if (!verification.ok) {
      if (verification.status === 503) {
        console.error('[Supabase Webhook] SUPABASE_WEBHOOK_SECRET is not configured — rejecting request')
      } else {
        console.warn('[Supabase Webhook] Invalid webhook secret')
      }
      return res.status(verification.status).json({ error: verification.error })
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

// Stripe webhooks (payment_intent.*, Connect, founder invoices) are
// consolidated into the single, signature-safe, idempotent endpoint at
// routes/stripe.ts POST /webhook. This route used to duplicate that work
// but verified signatures against JSON.stringify(req.body) (never matches
// Stripe's raw bytes — index.ts only gives raw body to /api/stripe/webhook)
// and had no idempotency guard, so redelivered events double-registered
// orders and double-credited ITC. Removed rather than patched: both live
// PaymentIntent-creation flows (checkout-payment-intent, create-payment-intent
// in routes/stripe.ts) already produce metadata that routes/stripe.ts's own
// handlePaymentSuccess dispatches correctly, so nothing here was reachable
// that isn't already handled, better, on the surviving endpoint.

export default router

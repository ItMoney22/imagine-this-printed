import { Router, Request, Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { sendTicketConfirmationEmail, sendNewSupportTicketEmail } from '../utils/email.js'
import { triageTicket, describeTicketTriage } from '../lib/jev-triage.js'
import { checkTicketSpam } from '../lib/spam-guard.js'
import { verifyTurnstile, readTurnstileToken } from '../lib/turnstile.js'
import { pingChristinaAboutTicket, ticketRef } from '../services/support-ping.js'
import { startLiveChat, cleanEmail, agentAvailability } from '../services/live-chat.js'

dotenv.config()

const router = Router()

// Initialize Supabase client with service role for admin operations
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('[Support Routes] Missing Supabase credentials')
}

const supabase = createClient(supabaseUrl!, supabaseKey!)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Per-IP rate limit on public ticket creation. The endpoint is intentionally
// unauthenticated so anyone can use the contact form, but that also makes it a
// spam/abuse target. 5 tickets per hour per IP is well above legit use (a user
// reporting an order issue tops out at maybe 2 tickets) and below what a bot
// can do damage with before tripping. In-memory is fine: support traffic is
// low and a restart-clearing window is acceptable for a soft cap.
const ticketCreateRateLimit = new Map<string, { count: number; resetAt: number }>()
const TICKET_RATE_LIMIT_PER_HOUR = 5
const TICKET_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

function checkTicketCreateLimit(ip: string): boolean {
  const now = Date.now()
  const state = ticketCreateRateLimit.get(ip)
  if (!state || state.resetAt < now) {
    ticketCreateRateLimit.set(ip, { count: 1, resetAt: now + TICKET_RATE_LIMIT_WINDOW_MS })
    return true
  }
  if (state.count >= TICKET_RATE_LIMIT_PER_HOUR) return false
  state.count++
  return true
}

/**
 * Create an admin notification for new ticket
 */
const createNotification = async (
  type: 'new_ticket' | 'ticket_reply' | 'ticket_escalation' | 'agent_needed',
  title: string,
  message: string,
  ticketId?: string,
  userId?: string
) => {
  try {
    await supabase.from('admin_notifications').insert({
      type,
      title,
      message,
      ticket_id: ticketId,
      user_id: userId
    })
  } catch (error) {
    console.error('[Notification] Failed to create:', error)
  }
}

/** What a bot sees: the same 201 a person gets, so it learns nothing. */
const SPAM_REPLY = {
  success: true,
  message: 'Your support ticket has been created. We will respond within 24 hours.'
}

/** Keep spam on file (closed) so a false positive can be found, but alert and email no one. */
const fileSpamTicket = async (
  t: { email: string; subject: string; description: string; name?: string; order_id?: string },
  reason: string
) => {
  const { error } = await supabase.from('support_tickets').insert({
    email: t.email || null,
    subject: t.subject,
    description: `Name: ${t.name || 'Not provided'}\n\n${t.description}${t.order_id ? `\n\nOrder ID: ${t.order_id}` : ''}`,
    category: 'spam',
    priority: 'low',
    status: 'closed'
  })
  if (error) console.error('[Support] Failed to file spam ticket:', error.message)
  console.log('[Support] Spam filed quietly:', reason)
}

/**
 * PUBLIC: Create a new support ticket
 * No authentication required - anyone can submit a ticket via contact form
 */
router.post('/tickets', async (req: Request, res: Response): Promise<void> => {
  try {
    const ip = (req.ip || req.socket.remoteAddress || 'unknown').toString()
    if (!checkTicketCreateLimit(ip)) {
      res.status(429).json({
        error: 'Too many tickets submitted. Please wait an hour before submitting another, or email wecare@imaginethisprinted.com directly.'
      })
      return
    }

    const {
      name,
      email,
      subject,
      description,
      category = 'general',
      order_id,
      user_id
    } = req.body

    // Validate required fields
    if (!email || !subject || !description) {
      res.status(400).json({ error: 'Email, subject, and description are required' })
      return
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      res.status(400).json({ error: 'Invalid email address' })
      return
    }

    // Bot check first: spam is filed closed with no alert and no email (spam-guard.ts).
    const spamCheck = checkTicketSpam({ name, subject, description, order_id, website: req.body.website })
    if (spamCheck.spam) {
      await fileSpamTicket({ email, subject, description, name, order_id }, spamCheck.reasons.join(','))
      res.status(201).json(SPAM_REPLY)
      return
    }

    // Human check (Turnstile), once TURNSTILE_SECRET_KEY is set on the API. A
    // refusal is a visible 400, not a quiet file: if the widget failed for a real
    // person, they must know to retry or email us rather than lose the message.
    const captcha = await verifyTurnstile(readTurnstileToken(req.body), ip)
    if (captcha.skipped && captcha.reason !== 'not_configured') {
      console.warn('[Support] Turnstile check skipped:', captcha.reason)
    }
    if (!captcha.ok) {
      console.log('[Support] Turnstile refused:', captcha.reason)
      res.status(400).json({
        error: 'Please complete the security check and send again, or email wecare@imaginethisprinted.com directly.'
      })
      return
    }

    console.log('[Support] Creating ticket from:', email)

    // Jev triage: category + priority from what the customer actually wrote.
    // Fails open (lane down -> the deterministic floor decides and the ticket
    // is marked for human triage), never rejects a ticket, and the floor keeps
    // the old billing -> high rule and lifts damaged/bulk tickets to high.
    const triage = await triageTicket({
      subject: String(subject),
      description: String(description),
      customerCategory: category,
      orderId: order_id,
    })

    // Jev sure it's spam: same quiet path. Unsure spam still reaches a human.
    if (triage.category === 'spam' && !triage.needsReview) {
      await fileSpamTicket({ email, subject, description, name, order_id }, 'jev')
      res.status(201).json(SPAM_REPLY)
      return
    }

    // Create the support ticket
    const { data: ticket, error: ticketError } = await supabase
      .from('support_tickets')
      .insert({
        user_id: user_id || null,
        email: email || null,
        subject,
        description: `Name: ${name || 'Not provided'}\n\n${description}${order_id ? `\n\nOrder ID: ${order_id}` : ''}`,
        // Free-text column: the triaged category when there is one, else what the customer picked.
        category: triage.category ?? category,
        priority: triage.dbPriority,
        status: 'open'
      })
      .select()
      .single()

    if (ticketError) {
      console.error('[Support] Error creating ticket:', ticketError)
      throw ticketError
    }

    console.log('[Support] Ticket created:', ticket.id)

    // Create admin notification
    await createNotification(
      'new_ticket',
      `New Support Ticket: ${subject}`,
      `From: ${name || 'Contact Form'} (${email})\nCategory: ${triage.category ?? category} · Priority: ${triage.priority}` +
        (triage.needsReview ? '\nNeeds human triage — Jev was not confident.' : ''),
      ticket.id,
      user_id
    )

    // Store customer email in ticket_messages for future reference
    await supabase.from('ticket_messages').insert({
      ticket_id: ticket.id,
      sender_type: 'user',
      sender_id: user_id || null,
      message: `Contact Email: ${email}\nName: ${name || 'Not provided'}\n\n${description}`,
      is_internal: false
    })

    // How the ticket was triaged, visible only to staff — the audit trail for
    // the human-review queue (no schema change: support_tickets has no triage column).
    const { error: triageNoteError } = await supabase.from('ticket_messages').insert({
      ticket_id: ticket.id,
      sender_type: 'system',
      sender_id: null,
      message: describeTicketTriage(triage),
      is_internal: true
    })
    if (triageNoteError) console.error('[Support] Failed to store triage note:', triageNoteError.message)

    // Send confirmation email to customer
    try {
      await sendTicketConfirmationEmail(email, ticket.id, subject, name)
      console.log('[Support] Confirmation email sent to:', email)
    } catch (emailError) {
      console.error('[Support] Failed to send confirmation email:', emailError)
      // Don't fail the request if email fails
    }

    // Send notification email to support team
    try {
      await sendNewSupportTicketEmail(
        ticket.id,
        subject,
        description,
        triage.dbPriority,
        triage.category ?? category,
        email
      )
      console.log('[Support] Notification email sent to support team')
    } catch (emailError) {
      console.error('[Support] Failed to send support team notification:', emailError)
      // Don't fail the request if email fails
    }

    // Becky tells Christina on her phone; her answer comes back through /api/print-bridge/ticket-reply.
    await pingChristinaAboutTicket({
      kind: 'ticket',
      ticketId: ticket.id,
      subject: String(subject),
      message: String(description),
      customerName: name,
      customerEmail: email,
      priority: triage.dbPriority,
      category: triage.category ?? category,
    })

    res.status(201).json({
      success: true,
      ticketId: ticket.id,
      message: 'Your support ticket has been created. We will respond within 24 hours.'
    })

  } catch (error: any) {
    console.error('[Support] Error:', error)
    res.status(500).json({
      error: 'Failed to create support ticket',
      details: error.message
    })
  }
})

/**
 * PUBLIC: Check ticket status (with email verification)
 */
router.get('/tickets/:id/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const { email } = req.query

    if (!email) {
      res.status(400).json({ error: 'Email required to check ticket status' })
      return
    }

    // Get ticket with first message to verify email
    const { data: ticket, error } = await supabase
      .from('support_tickets')
      .select(`
        id, status, subject, created_at, updated_at,
        ticket_messages(message)
      `)
      .eq('id', id)
      .single()

    if (error || !ticket) {
      res.status(404).json({ error: 'Ticket not found' })
      return
    }

    // Verify email is in the first message
    const firstMessage = ticket.ticket_messages?.[0]?.message || ''
    if (!firstMessage.toLowerCase().includes((email as string).toLowerCase())) {
      res.status(403).json({ error: 'Email does not match ticket' })
      return
    }

    res.json({
      id: ticket.id,
      status: ticket.status,
      subject: ticket.subject,
      created_at: ticket.created_at,
      updated_at: ticket.updated_at
    })

  } catch (error: any) {
    console.error('[Support] Error checking status:', error)
    res.status(500).json({ error: 'Failed to check ticket status' })
  }
})

// ---------------------------------------------------------------------------
// The shop chat's hand-off to Christina (task 5878a61f). The ticket id is the
// capability here, the same as the widget's poll and send calls on
// /api/admin/support/tickets/:id/messages: a UUID nobody can guess.
// ---------------------------------------------------------------------------

/**
 * PUBLIC: "Talk to a person" from the chat widget. Same path as Mr. Imagine's
 * request_live_chat tool (services/live-chat.ts).
 * Body: { message, name?, email?, ticketId? }
 */
router.post('/live-chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const ip = (req.ip || req.socket.remoteAddress || 'unknown').toString()
    // userId comes from the page, the same as the contact form's user_id; it only labels the ticket.
    const { message, name, email, ticketId, userId, website } = req.body ?? {}
    const text = typeof message === 'string' ? message.trim().slice(0, 1000) : ''

    if (email && !cleanEmail(email)) {
      res.status(400).json({ error: 'That email address does not look right.' })
      return
    }
    // A chat that already has a ticket is not a new submission; only new tickets count toward the hourly cap.
    if (!ticketId && !checkTicketCreateLimit(ip)) {
      res.status(429).json({ error: 'Too many requests. Please email wecare@imaginethisprinted.com directly.' })
      return
    }
    const spam = checkTicketSpam({ name, subject: text || 'Live chat', description: text, website })
    if (spam.spam) {
      console.log('[Support] Live chat refused as spam:', spam.reasons.join(','))
      res.json({ ok: true, live: false, ticketId: null, email: null })
      return
    }

    const result = await startLiveChat(supabase, {
      userId: typeof userId === 'string' && UUID_RE.test(userId) ? userId : null,
      email: email || null,
      name: typeof name === 'string' ? name : null,
      reason: text || 'Customer pressed Talk to a person',
      message: text,
      ticketId: typeof ticketId === 'string' ? ticketId : null,
    }, { checkAgentAvailability: () => agentAvailability(supabase), createNotification, pingChristinaAboutTicket })

    if (!result.ok && !result.ticketId) {
      console.error('[Support] Live chat not started:', result.error)
      res.status(500).json({ error: 'Could not reach the shop right now. Please email wecare@imaginethisprinted.com.' })
      return
    }
    if (text && result.ticketId) {
      await supabase.from('ticket_messages').insert({
        ticket_id: result.ticketId, sender_type: 'user', sender_id: null, message: text, is_internal: false,
      })
    }
    res.json({ ok: true, live: result.live, ticketId: result.ticketId, ref: result.ticketId ? ticketRef(result.ticketId) : null, email: result.email })
  } catch (error: any) {
    console.error('[Support] Live chat failed:', error?.message || error)
    res.status(500).json({ error: 'Could not reach the shop right now. Please email wecare@imaginethisprinted.com.' })
  }
})

/**
 * PUBLIC: a guest waiting for Christina leaves their email so her reply reaches
 * them after they close the page. Only fills an empty email; never changes one.
 */
router.post('/tickets/:id/contact-email', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const email = cleanEmail(req.body?.email)
    if (!email) {
      res.status(400).json({ error: 'That email address does not look right.' })
      return
    }
    const { data: ticket } = await supabase.from('support_tickets').select('id, email').eq('id', id).maybeSingle()
    if (!ticket) {
      res.status(404).json({ error: 'Chat not found' })
      return
    }
    const current = cleanEmail(ticket.email)
    if (current && current !== email) {
      res.status(409).json({ error: 'This chat already has an email on it.' })
      return
    }
    if (!current) {
      const { error } = await supabase.from('support_tickets').update({ email, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    }
    res.json({ ok: true, email })
  } catch (error: any) {
    console.error('[Support] Saving chat email failed:', error?.message || error)
    res.status(500).json({ error: 'Could not save your email. Please try again.' })
  }
})

/**
 * PUBLIC: the customer ends the chat. The ticket stays open, so Christina can
 * still answer by email.
 */
router.post('/tickets/:id/end-chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    const now = new Date().toISOString()
    const { error } = await supabase.from('chat_sessions').update({ status: 'ended', ended_at: now }).eq('ticket_id', id)
    if (error) throw error
    await supabase.from('ticket_messages').insert({
      ticket_id: id, sender_type: 'system', message: 'The customer ended the chat.', is_internal: true,
    })
    res.json({ ok: true })
  } catch (error: any) {
    console.error('[Support] Ending chat failed:', error?.message || error)
    res.status(500).json({ error: 'Could not end the chat.' })
  }
})

export default router

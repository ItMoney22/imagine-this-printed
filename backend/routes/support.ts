import { Router, Request, Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { sendTicketConfirmationEmail, sendNewSupportTicketEmail } from '../utils/email.js'

dotenv.config()

const router = Router()

// Initialize Supabase client with service role for admin operations
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('[Support Routes] Missing Supabase credentials')
}

const supabase = createClient(supabaseUrl!, supabaseKey!)

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

/**
 * PUBLIC: Create a new support ticket
 * No authentication required - anyone can submit a ticket via contact form
 */
router.post('/tickets', async (req: Request, res: Response): Promise<void> => {
  try {
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

    console.log('[Support] Creating ticket from:', email)

    // Create the support ticket
    const { data: ticket, error: ticketError } = await supabase
      .from('support_tickets')
      .insert({
        user_id: user_id || null,
        subject,
        description: `Name: ${name || 'Not provided'}\n\n${description}${order_id ? `\n\nOrder ID: ${order_id}` : ''}`,
        category,
        priority: category === 'billing' ? 'high' : 'medium',
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
      `From: ${name || 'Contact Form'} (${email})\nCategory: ${category}`,
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

    // Send confirmation email to customer
    try {
      await sendTicketConfirmationEmail(email, ticket.id, subject)
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
        category === 'billing' ? 'high' : 'medium',
        category,
        email
      )
      console.log('[Support] Notification email sent to support team')
    } catch (emailError) {
      console.error('[Support] Failed to send support team notification:', emailError)
      // Don't fail the request if email fails
    }

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

export default router

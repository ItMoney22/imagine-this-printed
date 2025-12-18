import { Router, Request, Response, NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import {
    sendTicketReplyEmail,
    sendTicketEscalationEmail,
    sendTicketResolvedEmail
} from '../../utils/email'

dotenv.config()

const router = Router()

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials for Admin Support routes')
}

const supabase = createClient(supabaseUrl!, supabaseKey!)

// ===============================
// AUTHENTICATION MIDDLEWARE
// ===============================

/**
 * Middleware to verify user is admin or support_agent
 */
const requireSupportAccess = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization token required' })
    }

    const token = authHeader.split(' ')[1]

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token)

        if (error || !user) {
            return res.status(401).json({ error: 'Invalid or expired token' })
        }

        // Get user profile with role
        const { data: profile, error: profileError } = await supabase
            .from('user_profiles')
            .select('id, role, first_name, last_name, email')
            .eq('id', user.id)
            .single()

        if (profileError || !profile) {
            return res.status(401).json({ error: 'User profile not found' })
        }

        // Check role
        if (!['admin', 'support_agent'].includes(profile.role)) {
            return res.status(403).json({ error: 'Access denied. Admin or Support Agent role required.' })
        }

        // Attach user info to request
        (req as any).user = profile
        next()
    } catch (error: any) {
        console.error('[Support Auth] Error:', error)
        return res.status(500).json({ error: 'Authentication failed' })
    }
}

// ===============================
// HELPER FUNCTIONS
// ===============================

/**
 * Create an admin notification
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
 * Check if any agent is online (from database)
 */
export const checkAgentAvailability = async (): Promise<{ available: boolean; count: number }> => {
    try {
        const { data, error } = await supabase
            .from('agent_status')
            .select('id')
            .eq('is_online', true)

        if (error) throw error

        return { available: (data?.length || 0) > 0, count: data?.length || 0 }
    } catch (error) {
        console.error('[Agent Availability] Error:', error)
        return { available: false, count: 0 }
    }
}

// ===============================
// TICKET ENDPOINTS
// ===============================

/**
 * GET /api/admin/support/tickets
 * List all support tickets
 */
router.get('/tickets', requireSupportAccess, async (req: Request, res: Response) => {
    try {
        const { status, priority, limit = 50, offset = 0 } = req.query

        let query = supabase
            .from('support_tickets')
            .select('*, user:user_profiles!user_id(email, first_name, last_name, avatar_url)', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(Number(offset), Number(offset) + Number(limit) - 1)

        if (status) {
            query = query.eq('status', status)
        }

        if (priority) {
            query = query.eq('priority', priority)
        }

        const { data, count, error } = await query

        if (error) throw error

        res.json({ tickets: data, total: count })
    } catch (error: any) {
        console.error('Error fetching tickets:', error)
        res.status(500).json({ error: error.message })
    }
})

/**
 * GET /api/admin/support/tickets/:id
 * Get details of a specific ticket including messages
 */
router.get('/tickets/:id', requireSupportAccess, async (req: Request, res: Response) => {
    try {
        const { id } = req.params

        const { data: ticket, error: ticketError } = await supabase
            .from('support_tickets')
            .select('*, user:user_profiles!user_id(email, first_name, last_name)')
            .eq('id', id)
            .single()

        if (ticketError) throw ticketError

        const { data: messages, error: messagesError } = await supabase
            .from('ticket_messages')
            .select('*, sender:user_profiles!sender_id(first_name, last_name, role)')
            .eq('ticket_id', id)
            .order('created_at', { ascending: true })

        if (messagesError) throw messagesError

        // Get chat session status
        const { data: session } = await supabase
            .from('chat_sessions')
            .select('*')
            .eq('ticket_id', id)
            .single()

        res.json({ ticket, messages, chatSession: session })
    } catch (error: any) {
        console.error('Error fetching ticket details:', error)
        res.status(500).json({ error: error.message })
    }
})

/**
 * POST /api/admin/support/tickets/:id/reply
 * Admin/Agent reply to a ticket
 */
router.post('/tickets/:id/reply', requireSupportAccess, async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const { content, status, isInternal } = req.body
        const user = (req as any).user

        if (!content) {
            return res.status(400).json({ error: 'Message content is required' })
        }

        // 1. Create message
        const { data: message, error: messageError } = await supabase
            .from('ticket_messages')
            .insert({
                ticket_id: id,
                sender_id: user.id,
                sender_type: 'agent',
                message: content,
                is_internal: isInternal || false
            })
            .select()
            .single()

        if (messageError) throw messageError

        // 2. Get ticket info for email
        const { data: ticket } = await supabase
            .from('support_tickets')
            .select('*, user:user_profiles!user_id(email, first_name)')
            .eq('id', id)
            .single()

        // 3. Update ticket status if provided
        if (status) {
            await supabase
                .from('support_tickets')
                .update({ status, updated_at: new Date().toISOString() })
                .eq('id', id)

            // Send resolution email if ticket is closed
            if (status === 'resolved' || status === 'closed') {
                if (ticket?.email) {
                    await sendTicketResolvedEmail(ticket.email, id, ticket.subject)
                }
            }
        }

        // 4. Send email notification to customer (only for non-internal messages)
        if (!isInternal && ticket?.email) {
            const agentName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Support Team'
            await sendTicketReplyEmail(ticket.email, id, ticket.subject, content, agentName)
        }

        res.json({ message })
        return
    } catch (error: any) {
        console.error('Error replying to ticket:', error)
        res.status(500).json({ error: error.message })
        return
    }
})

// ===============================
// AGENT STATUS ENDPOINTS (DB-BACKED)
// ===============================

/**
 * POST /api/admin/support/status
 * Update Agent Online Status (persisted to database)
 */
router.post('/status', requireSupportAccess, async (req: Request, res: Response) => {
    try {
        const { isOnline } = req.body
        const user = (req as any).user

        // Upsert agent status
        const { error } = await supabase
            .from('agent_status')
            .upsert({
                user_id: user.id,
                is_online: isOnline,
                last_seen_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'user_id'
            })

        if (error) throw error

        console.log(`[Agent Status] ${user.email} is now ${isOnline ? 'ONLINE' : 'OFFLINE'}`)
        res.json({ success: true, status: isOnline ? 'online' : 'offline' })
        return
    } catch (error: any) {
        console.error('Error updating agent status:', error)
        res.status(500).json({ error: error.message })
        return
    }
})

/**
 * GET /api/admin/support/availability
 * Check if any agent is online (public endpoint)
 */
router.get('/availability', async (req: Request, res: Response) => {
    const availability = await checkAgentAvailability()
    res.json(availability)
})

/**
 * GET /api/admin/support/agents/online
 * List all online agents (requires auth)
 */
router.get('/agents/online', requireSupportAccess, async (req: Request, res: Response) => {
    try {
        const { data, error } = await supabase
            .from('agent_status')
            .select('*, user:user_profiles!user_id(email, first_name, last_name, avatar_url)')
            .eq('is_online', true)
            .order('last_seen_at', { ascending: false })

        if (error) throw error

        res.json({ agents: data || [] })
    } catch (error: any) {
        console.error('Error fetching online agents:', error)
        res.status(500).json({ error: error.message })
    }
})

// ===============================
// NOTIFICATION ENDPOINTS
// ===============================

/**
 * GET /api/admin/support/notifications
 * Get unread notifications for support team
 */
router.get('/notifications', requireSupportAccess, async (req: Request, res: Response) => {
    try {
        const { limit = 20, includeRead = false } = req.query

        let query = supabase
            .from('admin_notifications')
            .select('*, ticket:support_tickets!ticket_id(subject, status, priority)')
            .order('created_at', { ascending: false })
            .limit(Number(limit))

        if (!includeRead) {
            query = query.eq('is_read', false)
        }

        const { data, error } = await query

        if (error) throw error

        // Get unread count
        const { count } = await supabase
            .from('admin_notifications')
            .select('id', { count: 'exact', head: true })
            .eq('is_read', false)

        res.json({ notifications: data || [], unreadCount: count || 0 })
    } catch (error: any) {
        console.error('Error fetching notifications:', error)
        res.status(500).json({ error: error.message })
    }
})

/**
 * POST /api/admin/support/notifications/:id/read
 * Mark a notification as read
 */
router.post('/notifications/:id/read', requireSupportAccess, async (req: Request, res: Response) => {
    try {
        const { id } = req.params

        const { error } = await supabase
            .from('admin_notifications')
            .update({ is_read: true })
            .eq('id', id)

        if (error) throw error

        res.json({ success: true })
    } catch (error: any) {
        console.error('Error marking notification as read:', error)
        res.status(500).json({ error: error.message })
    }
})

/**
 * POST /api/admin/support/notifications/read-all
 * Mark all notifications as read
 */
router.post('/notifications/read-all', requireSupportAccess, async (req: Request, res: Response) => {
    try {
        const { error } = await supabase
            .from('admin_notifications')
            .update({ is_read: true })
            .eq('is_read', false)

        if (error) throw error

        res.json({ success: true })
    } catch (error: any) {
        console.error('Error marking all notifications as read:', error)
        res.status(500).json({ error: error.message })
    }
})

// ===============================
// LIVE CHAT ENDPOINTS (DB-BACKED)
// ===============================

/**
 * POST /api/admin/support/tickets/:id/claim
 * Agent claims a ticket for live chat
 */
router.post('/tickets/:id/claim', requireSupportAccess, async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const user = (req as any).user

        // Check if already claimed by another agent
        const { data: existingSession } = await supabase
            .from('chat_sessions')
            .select('*, agent:user_profiles!agent_id(email, first_name)')
            .eq('ticket_id', id)
            .eq('status', 'active')
            .single()

        if (existingSession && existingSession.agent_id !== user.id) {
            return res.status(409).json({
                error: 'Ticket already claimed by another agent',
                agent: existingSession.agent?.first_name || 'Another agent'
            })
        }

        // Get ticket info
        const { data: ticket } = await supabase
            .from('support_tickets')
            .select('user_id')
            .eq('id', id)
            .single()

        // Create or update chat session
        const { error: sessionError } = await supabase
            .from('chat_sessions')
            .upsert({
                ticket_id: id,
                user_id: ticket?.user_id,
                agent_id: user.id,
                status: 'active',
                started_at: new Date().toISOString()
            }, {
                onConflict: 'ticket_id'
            })

        if (sessionError) throw sessionError

        // Update ticket status to in_progress
        await supabase
            .from('support_tickets')
            .update({
                status: 'in_progress',
                assigned_to: user.id,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)

        // Update agent's active ticket
        await supabase
            .from('agent_status')
            .update({ active_ticket_id: id })
            .eq('user_id', user.id)

        console.log(`[Live Chat] Agent ${user.email} claimed ticket ${id.slice(0, 8)}`)
        res.json({ success: true, claimed: true })
        return
    } catch (error: any) {
        console.error('Error claiming ticket:', error)
        res.status(500).json({ error: error.message })
        return
    }
})

/**
 * POST /api/admin/support/tickets/:id/release
 * Agent releases a live chat claim
 */
router.post('/tickets/:id/release', requireSupportAccess, async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const user = (req as any).user

        // End the chat session
        await supabase
            .from('chat_sessions')
            .update({
                status: 'ended',
                ended_at: new Date().toISOString()
            })
            .eq('ticket_id', id)
            .eq('agent_id', user.id)

        // Clear agent's active ticket
        await supabase
            .from('agent_status')
            .update({ active_ticket_id: null })
            .eq('user_id', user.id)

        console.log(`[Live Chat] Agent ${user.email} released ticket ${id.slice(0, 8)}`)
        res.json({ success: true, released: true })
    } catch (error: any) {
        console.error('Error releasing ticket:', error)
        res.status(500).json({ error: error.message })
    }
})

/**
 * GET /api/admin/support/tickets/:id/live-status
 * Check if a ticket has an active live chat session
 */
router.get('/tickets/:id/live-status', async (req: Request, res: Response) => {
    try {
        const { id } = req.params

        const { data: session } = await supabase
            .from('chat_sessions')
            .select('*, agent:user_profiles!agent_id(first_name, last_name)')
            .eq('ticket_id', id)
            .eq('status', 'active')
            .single()

        res.json({
            isLive: !!session,
            agentId: session?.agent_id || null,
            agentName: session?.agent ? `${session.agent.first_name || ''} ${session.agent.last_name || ''}`.trim() : null,
            startedAt: session?.started_at || null
        })
    } catch (error: any) {
        console.error('Error checking live status:', error)
        res.json({ isLive: false, agentId: null, startedAt: null })
    }
})

/**
 * GET /api/admin/support/chat-sessions
 * Get all active/waiting chat sessions
 */
router.get('/chat-sessions', requireSupportAccess, async (req: Request, res: Response) => {
    try {
        const { data, error } = await supabase
            .from('chat_sessions')
            .select(`
                *,
                ticket:support_tickets!ticket_id(id, subject, priority, email, created_at),
                user:user_profiles!user_id(email, first_name, last_name),
                agent:user_profiles!agent_id(email, first_name, last_name)
            `)
            .in('status', ['waiting', 'active'])
            .order('created_at', { ascending: true })

        if (error) throw error

        res.json({ sessions: data || [] })
    } catch (error: any) {
        console.error('Error fetching chat sessions:', error)
        res.status(500).json({ error: error.message })
    }
})

// ===============================
// USER-FACING LIVE CHAT ENDPOINTS
// (No admin auth required)
// ===============================

/**
 * GET /api/admin/support/tickets/:id/messages/poll
 * Get messages for a ticket (for live chat polling)
 */
router.get('/tickets/:id/messages/poll', async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const { since } = req.query // ISO timestamp for incremental polling

        let query = supabase
            .from('ticket_messages')
            .select('id, message, created_at, is_internal, sender_type, sender:user_profiles!sender_id(first_name, role)')
            .eq('ticket_id', id)
            .eq('is_internal', false) // Don't expose internal notes
            .order('created_at', { ascending: true })

        if (since) {
            query = query.gt('created_at', since as string)
        }

        const { data: messages, error } = await query

        if (error) throw error

        // Check if this is a live session
        const { data: session } = await supabase
            .from('chat_sessions')
            .select('status, agent:user_profiles!agent_id(first_name)')
            .eq('ticket_id', id)
            .single()

        res.json({
            messages: messages || [],
            isLive: session?.status === 'active',
            agentName: session?.agent?.first_name || null
        })
    } catch (error: any) {
        console.error('Error polling messages:', error)
        res.status(500).json({ error: error.message })
    }
})

/**
 * POST /api/admin/support/tickets/:id/messages
 * User sends a message in live chat
 */
router.post('/tickets/:id/messages', async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const { content, userId } = req.body

        if (!content) {
            return res.status(400).json({ error: 'Message content is required' })
        }

        const { data: message, error } = await supabase
            .from('ticket_messages')
            .insert({
                ticket_id: id,
                sender_id: userId || null,
                sender_type: userId ? 'user' : 'user',
                message: content,
                is_internal: false
            })
            .select()
            .single()

        if (error) throw error

        res.json({ message })
        return
    } catch (error: any) {
        console.error('Error sending message:', error)
        res.status(500).json({ error: error.message })
        return
    }
})

/**
 * POST /api/admin/support/tickets/:id/escalate
 * Escalate a ticket (customer requesting live agent)
 */
router.post('/tickets/:id/escalate', async (req: Request, res: Response) => {
    try {
        const { id } = req.params

        // Get ticket info
        const { data: ticket } = await supabase
            .from('support_tickets')
            .select('*')
            .eq('id', id)
            .single()

        if (!ticket) {
            return res.status(404).json({ error: 'Ticket not found' })
        }

        // Update ticket priority
        await supabase
            .from('support_tickets')
            .update({
                priority: 'high',
                status: 'waiting',
                updated_at: new Date().toISOString()
            })
            .eq('id', id)

        // Create or update chat session as waiting
        await supabase
            .from('chat_sessions')
            .upsert({
                ticket_id: id,
                user_id: ticket.user_id,
                status: 'waiting',
                started_at: new Date().toISOString()
            }, {
                onConflict: 'ticket_id'
            })

        // Create notification for agents
        await createNotification(
            'agent_needed',
            'Customer Waiting for Live Support',
            `Customer is waiting for help with: ${ticket.subject}`,
            id,
            ticket.user_id
        )

        // Send escalation email to support team
        await sendTicketEscalationEmail(id, ticket.subject, ticket.email)

        console.log(`[Escalation] Ticket ${id.slice(0, 8)} escalated - customer waiting for live chat`)
        res.json({ success: true, escalated: true })
        return
    } catch (error: any) {
        console.error('Error escalating ticket:', error)
        res.status(500).json({ error: error.message })
        return
    }
})

// Export notification helper for use by chat.ts
export { createNotification }

export default router

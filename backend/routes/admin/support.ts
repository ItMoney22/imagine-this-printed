import { Router, Request, Response, NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import {
    sendTicketReplyEmail,
    sendTicketEscalationEmail,
    sendTicketResolvedEmail
} from '../../utils/email.js'

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
const requireSupportAccess = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Authorization token required' })
        return
    }

    const token = authHeader.split(' ')[1]

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token)

        if (error || !user) {
            res.status(401).json({ error: 'Invalid or expired token' })
            return
        }

        // Get user profile with role
        const { data: profile, error: profileError } = await supabase
            .from('user_profiles')
            .select('id, role, first_name, last_name, email')
            .eq('id', user.id)
            .single()

        if (profileError || !profile) {
            res.status(401).json({ error: 'User profile not found' })
            return
        }

        // Check role
        if (!['admin', 'support_agent'].includes(profile.role)) {
            res.status(403).json({ error: 'Access denied. Admin or Support Agent role required.' })
            return
        }

        // Attach user info to request
        (req as any).user = profile
        next()
    } catch (error: any) {
        console.error('[Support Auth] Error:', error)
        res.status(500).json({ error: 'Authentication failed' })
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
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(Number(offset), Number(offset) + Number(limit) - 1)

        if (status) {
            query = query.eq('status', status)
        }

        if (priority) {
            query = query.eq('priority', priority)
        }

        const { data: tickets, count, error } = await query

        if (error) throw error

        // Fetch user profiles separately
        const userIds = [...new Set(tickets?.filter(t => t.user_id).map(t => t.user_id) || [])]
        let userProfiles: Record<string, any> = {}
        if (userIds.length > 0) {
            const { data: profiles } = await supabase
                .from('user_profiles')
                .select('id, email, first_name, last_name, avatar_url')
                .in('id', userIds)
            profiles?.forEach(p => userProfiles[p.id] = p)
        }

        // Attach user info to tickets
        const ticketsWithUser = tickets?.map(t => ({
            ...t,
            user: t.user_id ? userProfiles[t.user_id] : null
        }))

        res.json({ tickets: ticketsWithUser, total: count })
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
            .select('*')
            .eq('id', id)
            .single()

        if (ticketError) throw ticketError

        // Fetch user profile for ticket
        let ticketWithUser = { ...ticket, user: null as any }
        if (ticket.user_id) {
            const { data: userProfile } = await supabase
                .from('user_profiles')
                .select('id, email, first_name, last_name')
                .eq('id', ticket.user_id)
                .single()
            ticketWithUser.user = userProfile
        }

        const { data: messages, error: messagesError } = await supabase
            .from('ticket_messages')
            .select('*')
            .eq('ticket_id', id)
            .order('created_at', { ascending: true })

        // Fetch sender profiles for messages that have sender_id
        const senderIds = [...new Set(messages?.filter(m => m.sender_id).map(m => m.sender_id) || [])]
        let senderProfiles: Record<string, any> = {}
        if (senderIds.length > 0) {
            const { data: profiles } = await supabase
                .from('user_profiles')
                .select('id, first_name, last_name, role')
                .in('id', senderIds)
            profiles?.forEach(p => senderProfiles[p.id] = p)
        }

        // Attach sender info to messages
        const messagesWithSender = messages?.map(m => ({
            ...m,
            sender: m.sender_id ? senderProfiles[m.sender_id] : null
        }))

        if (messagesError) throw messagesError

        // Get chat session status
        const { data: session } = await supabase
            .from('chat_sessions')
            .select('*')
            .eq('ticket_id', id)
            .single()

        res.json({ ticket: ticketWithUser, messages: messagesWithSender, chatSession: session })
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
        const { data: ticketData } = await supabase
            .from('support_tickets')
            .select('*')
            .eq('id', id)
            .single()

        // Fetch user email separately
        let ticket: any = ticketData
        if (ticketData?.user_id) {
            const { data: userProfile } = await supabase
                .from('user_profiles')
                .select('email, first_name')
                .eq('id', ticketData.user_id)
                .single()
            ticket = { ...ticketData, email: userProfile?.email, user: userProfile }
        }

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
        const { data: agentStatuses, error } = await supabase
            .from('agent_status')
            .select('*')
            .eq('is_online', true)
            .order('last_seen_at', { ascending: false })

        if (error) throw error

        // Fetch user profiles separately
        const userIds = [...new Set(agentStatuses?.filter(a => a.user_id).map(a => a.user_id) || [])]
        let userProfiles: Record<string, any> = {}
        if (userIds.length > 0) {
            const { data: profiles } = await supabase
                .from('user_profiles')
                .select('id, email, first_name, last_name, avatar_url')
                .in('id', userIds)
            profiles?.forEach(p => userProfiles[p.id] = p)
        }

        // Attach user info
        const agentsWithUser = agentStatuses?.map(a => ({
            ...a,
            user: a.user_id ? userProfiles[a.user_id] : null
        }))

        res.json({ agents: agentsWithUser || [] })
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
            .select('*')
            .eq('ticket_id', id)
            .eq('status', 'active')
            .single()

        // Fetch agent name if session exists
        let agentName = 'Another agent'
        if (existingSession?.agent_id && existingSession.agent_id !== user.id) {
            const { data: agentProfile } = await supabase
                .from('user_profiles')
                .select('first_name')
                .eq('id', existingSession.agent_id)
                .single()
            agentName = agentProfile?.first_name || 'Another agent'
            return res.status(409).json({
                error: 'Ticket already claimed by another agent',
                agent: agentName
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
            .select('*')
            .eq('ticket_id', id)
            .eq('status', 'active')
            .single()

        // Fetch agent name if session exists
        let agentName = null
        if (session?.agent_id) {
            const { data: agentProfile } = await supabase
                .from('user_profiles')
                .select('first_name, last_name')
                .eq('id', session.agent_id)
                .single()
            agentName = agentProfile ? `${agentProfile.first_name || ''} ${agentProfile.last_name || ''}`.trim() : null
        }

        res.json({
            isLive: !!session,
            agentId: session?.agent_id || null,
            agentName,
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
        const { data: sessions, error } = await supabase
            .from('chat_sessions')
            .select(`
                *,
                ticket:support_tickets!ticket_id(id, subject, priority, email, created_at)
            `)
            .in('status', ['waiting', 'active'])
            .order('created_at', { ascending: true })

        if (error) throw error

        // Fetch user and agent profiles separately
        const userIds = [...new Set(sessions?.filter(s => s.user_id).map(s => s.user_id) || [])]
        const agentIds = [...new Set(sessions?.filter(s => s.agent_id).map(s => s.agent_id) || [])]
        const allIds = [...new Set([...userIds, ...agentIds])]

        let profiles: Record<string, any> = {}
        if (allIds.length > 0) {
            const { data: profileData } = await supabase
                .from('user_profiles')
                .select('id, email, first_name, last_name')
                .in('id', allIds)
            profileData?.forEach(p => profiles[p.id] = p)
        }

        // Attach user and agent info
        const sessionsWithProfiles = sessions?.map(s => ({
            ...s,
            user: s.user_id ? profiles[s.user_id] : null,
            agent: s.agent_id ? profiles[s.agent_id] : null
        }))

        res.json({ sessions: sessionsWithProfiles || [] })
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
            .select('id, message, created_at, is_internal, sender_type, sender_id')
            .eq('ticket_id', id)
            .eq('is_internal', false) // Don't expose internal notes
            .order('created_at', { ascending: true })

        if (since) {
            query = query.gt('created_at', since as string)
        }

        const { data: messages, error } = await query

        if (error) throw error

        // Fetch sender profiles for messages that have sender_id
        const senderIds = [...new Set(messages?.filter(m => m.sender_id).map(m => m.sender_id) || [])]
        let senderProfiles: Record<string, any> = {}
        if (senderIds.length > 0) {
            const { data: profiles } = await supabase
                .from('user_profiles')
                .select('id, first_name, role')
                .in('id', senderIds)
            profiles?.forEach(p => senderProfiles[p.id] = p)
        }

        // Attach sender info to messages
        const messagesWithSender = messages?.map(m => ({
            ...m,
            sender: m.sender_id ? senderProfiles[m.sender_id] : null
        }))

        // Check if this is a live session
        const { data: session } = await supabase
            .from('chat_sessions')
            .select('status, agent_id')
            .eq('ticket_id', id)
            .single()

        // Get agent name if session exists
        let agentName = null
        if (session?.agent_id) {
            const { data: agentProfile } = await supabase
                .from('user_profiles')
                .select('first_name')
                .eq('id', session.agent_id)
                .single()
            agentName = agentProfile?.first_name || null
        }

        res.json({
            messages: messagesWithSender || [],
            isLive: session?.status === 'active',
            agentName
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

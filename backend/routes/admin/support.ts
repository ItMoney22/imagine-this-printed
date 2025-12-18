import { Router, Request, Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const router = Router()

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials for Admin Support routes')
}

const supabase = createClient(supabaseUrl!, supabaseKey!)

// In-memory store for admin online status (simple solution for single-instance)
// For multi-instance, use Redis or Database
// Export for use by chat.ts to check availability without HTTP call
export const onlineAgents: Map<string, boolean> = new Map()

/**
 * GET /api/admin/support/tickets
 * List all support tickets
 */
router.get('/tickets', async (req: Request, res: Response) => {
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
router.get('/tickets/:id', async (req: Request, res: Response) => {
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

        res.json({ ticket, messages })
    } catch (error: any) {
        console.error('Error fetching ticket details:', error)
        res.status(500).json({ error: error.message })
    }
})

/**
 * POST /api/admin/support/tickets/:id/reply
 * Admin reply to a ticket
 */
router.post('/tickets/:id/reply', async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const { content, adminId, status } = req.body

        if (!content) {
            return res.status(400).json({ error: 'Message content is required' })
        }

        // 1. Create message
        const { data: message, error: messageError } = await supabase
            .from('ticket_messages')
            .insert({
                ticket_id: id,
                sender_id: adminId, // Assuming adminId is passed or extracted from auth middleware
                content,
                is_internal: false
            })
            .select()
            .single()

        if (messageError) throw messageError

        // 2. Update ticket status if provided
        if (status) {
            await supabase
                .from('support_tickets')
                .update({ status, updated_at: new Date() })
                .eq('id', id)
        }

        // 3. TODO: Trigger Email Notification to User via Email Service

        res.json({ message })
        return
    } catch (error: any) {
        console.error('Error replying to ticket:', error)
        res.status(500).json({ error: error.message })
        return
    }
})

/**
 * POST /api/admin/support/status
 * Update Admin Online Status
 */
router.post('/status', async (req: Request, res: Response) => {
    const { adminId, isOnline } = req.body

    if (!adminId) {
        return res.status(400).json({ error: 'Admin ID required' })
    }

    if (isOnline) {
        onlineAgents.set(adminId, true)
    } else {
        onlineAgents.delete(adminId)
    }

    // Also update user profile for persistence if needed
    // await supabase.from('user_profiles').update({ is_online: isOnline }).eq('id', adminId)

    res.json({ success: true, status: onlineAgents.has(adminId) ? 'online' : 'offline' })
    return
})

/**
 * GET /api/admin/support/availability
 * Check if any admin is online
 */
router.get('/availability', (req: Request, res: Response) => {
    const onlineAdmins = onlineAgents.size
    res.json({ available: onlineAdmins > 0, count: onlineAdmins })
})

// ===============================
// LIVE CHAT ENDPOINTS
// ===============================

// In-memory store for active live chat sessions
// Maps ticketId -> { adminId, startedAt }
export const liveChatSessions: Map<string, { adminId: string, startedAt: Date }> = new Map()

/**
 * POST /api/admin/support/tickets/:id/claim
 * Admin claims a ticket for live chat
 */
router.post('/tickets/:id/claim', async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const { adminId } = req.body

        if (!adminId) {
            return res.status(400).json({ error: 'Admin ID required' })
        }

        // Check if already claimed
        const existing = liveChatSessions.get(id)
        if (existing && existing.adminId !== adminId) {
            return res.status(409).json({ error: 'Ticket already claimed by another agent' })
        }

        // Claim the ticket
        liveChatSessions.set(id, { adminId, startedAt: new Date() })

        // Update ticket status to in_progress
        await supabase
            .from('support_tickets')
            .update({ status: 'in_progress', updated_at: new Date() })
            .eq('id', id)

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
 * Admin releases a live chat claim
 */
router.post('/tickets/:id/release', async (req: Request, res: Response) => {
    const { id } = req.params
    liveChatSessions.delete(id)
    res.json({ success: true, released: true })
})

/**
 * GET /api/admin/support/tickets/:id/live-status
 * Check if a ticket has an active live chat session
 */
router.get('/tickets/:id/live-status', (req: Request, res: Response) => {
    const { id } = req.params
    const session = liveChatSessions.get(id)
    res.json({
        isLive: !!session,
        adminId: session?.adminId || null,
        startedAt: session?.startedAt || null
    })
})

// ===============================
// USER-FACING LIVE CHAT ENDPOINTS
// (No admin auth required)
// ===============================

/**
 * GET /api/support/tickets/:id/messages
 * Get messages for a ticket (for live chat polling)
 */
router.get('/tickets/:id/messages/poll', async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const { since } = req.query // ISO timestamp for incremental polling

        let query = supabase
            .from('ticket_messages')
            .select('id, content, created_at, is_internal, sender:user_profiles!sender_id(first_name, role)')
            .eq('ticket_id', id)
            .eq('is_internal', false) // Don't expose internal notes
            .order('created_at', { ascending: true })

        if (since) {
            query = query.gt('created_at', since as string)
        }

        const { data: messages, error } = await query

        if (error) throw error

        // Check if this is a live session
        const session = liveChatSessions.get(id)

        res.json({
            messages: messages || [],
            isLive: !!session
        })
    } catch (error: any) {
        console.error('Error polling messages:', error)
        res.status(500).json({ error: error.message })
    }
})

/**
 * POST /api/support/tickets/:id/messages
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
                content,
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

export default router

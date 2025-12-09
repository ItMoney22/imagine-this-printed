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
let adminOnlineStatus: Record<string, boolean> = {}

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

    adminOnlineStatus[adminId] = !!isOnline

    // Also update user profile for persistence if needed
    // await supabase.from('user_profiles').update({ is_online: isOnline }).eq('id', adminId)

    res.json({ success: true, status: adminOnlineStatus[adminId] ? 'online' : 'offline' })
    return
})

/**
 * GET /api/admin/support/availability
 * Check if any admin is online
 */
router.get('/availability', (req: Request, res: Response) => {
    const onlineAdmins = Object.values(adminOnlineStatus).filter(status => status).length
    res.json({ available: onlineAdmins > 0, count: onlineAdmins })
})

export default router

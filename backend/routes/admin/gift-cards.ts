import { Router, Request, Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { nanoid } from 'nanoid'
import dotenv from 'dotenv'

dotenv.config()

const router = Router()

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials for Admin Gift Cards routes')
}

const supabase = createClient(supabaseUrl!, supabaseKey!)

// Generate a unique gift card code
function generateGiftCardCode(): string {
    // Format: ITP-XXXX-XXXX-XXXX (uppercase alphanumeric)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Removed confusing chars like 0, O, 1, I
    const segments = []
    for (let i = 0; i < 3; i++) {
        let segment = ''
        for (let j = 0; j < 4; j++) {
            segment += chars.charAt(Math.floor(Math.random() * chars.length))
        }
        segments.push(segment)
    }
    return `ITP-${segments.join('-')}`
}

// GET /api/admin/gift-cards - List all gift cards
router.get('/', async (req: Request, res: Response) => {
    try {
        const { status } = req.query // 'all', 'redeemed', 'unredeemed'

        let query = supabase
            .from('gift_cards')
            .select('*')
            .order('created_at', { ascending: false })

        if (status === 'redeemed') {
            query = query.eq('is_active', false)
        } else if (status === 'unredeemed') {
            query = query.eq('is_active', true)
        }

        const { data: giftCards, error } = await query

        if (error) throw error

        // Fetch redeemer profiles separately
        const redeemerIds = [...new Set(giftCards?.filter(gc => gc.redeemed_by).map(gc => gc.redeemed_by) || [])]
        let redeemerProfiles: Record<string, any> = {}
        if (redeemerIds.length > 0) {
            const { data: profiles } = await supabase
                .from('user_profiles')
                .select('id, email, first_name, last_name')
                .in('id', redeemerIds)
            profiles?.forEach(p => redeemerProfiles[p.id] = p)
        }

        // Attach redeemer info
        const giftCardsWithRedeemer = giftCards?.map(gc => ({
            ...gc,
            redeemer: gc.redeemed_by ? redeemerProfiles[gc.redeemed_by] : null
        }))

        res.json({ giftCards: giftCardsWithRedeemer })
    } catch (error: any) {
        console.error('Error fetching gift cards:', error)
        res.status(500).json({ error: error.message })
    }
})

// POST /api/admin/gift-cards - Create a single gift card
router.post('/', async (req: Request, res: Response) => {
    try {
        const {
            itc_amount,
            expires_at,
            notes,
            created_by,
            recipient_email,
            sender_name,
            message
        } = req.body

        if (!itc_amount || itc_amount <= 0) {
            return res.status(400).json({ error: 'ITC amount must be greater than 0' })
        }

        const code = generateGiftCardCode()

        const { data: giftCard, error } = await supabase
            .from('gift_cards')
            .insert({
                code,
                itc_amount,
                amount: itc_amount * 0.10, // USD equivalent (1 ITC = $0.10)
                balance: itc_amount * 0.10,
                expires_at,
                notes,
                created_by,
                recipient_email,
                sender_name,
                message,
                is_active: true
            })
            .select()
            .single()

        if (error) throw error

        res.json({ success: true, giftCard })
    } catch (error: any) {
        console.error('Error creating gift card:', error)
        res.status(500).json({ error: error.message })
    }
})

// POST /api/admin/gift-cards/bulk - Bulk generate gift cards
router.post('/bulk', async (req: Request, res: Response) => {
    try {
        const {
            count = 1,
            itc_amount,
            expires_at,
            notes,
            created_by
        } = req.body

        if (!itc_amount || itc_amount <= 0) {
            return res.status(400).json({ error: 'ITC amount must be greater than 0' })
        }

        if (count > 100) {
            return res.status(400).json({ error: 'Maximum 100 gift cards at a time' })
        }

        const giftCards = []
        for (let i = 0; i < count; i++) {
            giftCards.push({
                code: generateGiftCardCode(),
                itc_amount,
                amount: itc_amount * 0.10,
                balance: itc_amount * 0.10,
                expires_at,
                notes: notes || `Bulk generated - batch ${new Date().toISOString()}`,
                created_by,
                is_active: true
            })
        }

        const { data, error } = await supabase
            .from('gift_cards')
            .insert(giftCards)
            .select()

        if (error) throw error

        res.json({ success: true, giftCards: data, count: data?.length })
    } catch (error: any) {
        console.error('Error bulk creating gift cards:', error)
        res.status(500).json({ error: error.message })
    }
})

// DELETE /api/admin/gift-cards/:id - Delete an unredeemed gift card
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params

        // Check if already redeemed
        const { data: existing, error: fetchError } = await supabase
            .from('gift_cards')
            .select('is_active, redeemed_by')
            .eq('id', id)
            .single()

        if (fetchError) throw fetchError

        if (!existing.is_active || existing.redeemed_by) {
            return res.status(400).json({ error: 'Cannot delete a redeemed gift card' })
        }

        const { error } = await supabase
            .from('gift_cards')
            .delete()
            .eq('id', id)

        if (error) throw error

        res.json({ success: true })
    } catch (error: any) {
        console.error('Error deleting gift card:', error)
        res.status(500).json({ error: error.message })
    }
})

// GET /api/admin/gift-cards/stats - Get gift card statistics
router.get('/stats', async (req: Request, res: Response) => {
    try {
        const { data: all, error: allError } = await supabase
            .from('gift_cards')
            .select('itc_amount, is_active, redeemed_by')

        if (allError) throw allError

        const stats = {
            total: all.length,
            redeemed: all.filter(gc => gc.redeemed_by).length,
            unredeemed: all.filter(gc => !gc.redeemed_by && gc.is_active).length,
            totalItcIssued: all.reduce((sum, gc) => sum + (gc.itc_amount || 0), 0),
            totalItcRedeemed: all.filter(gc => gc.redeemed_by).reduce((sum, gc) => sum + (gc.itc_amount || 0), 0)
        }

        res.json({ stats })
    } catch (error: any) {
        console.error('Error fetching gift card stats:', error)
        res.status(500).json({ error: error.message })
    }
})

export default router

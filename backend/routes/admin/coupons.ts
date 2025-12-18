import { Router, Request, Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const router = Router()

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials for Admin Coupons routes')
}

const supabase = createClient(supabaseUrl!, supabaseKey!)

// GET /api/admin/coupons - List all coupons
router.get('/', async (req: Request, res: Response) => {
    try {
        const { data: coupons, error } = await supabase
            .from('discount_codes')
            .select('*')
            .order('created_at', { ascending: false })

        if (error) throw error

        res.json({ coupons })
    } catch (error: any) {
        console.error('Error fetching coupons:', error)
        res.status(500).json({ error: error.message })
    }
})

// POST /api/admin/coupons - Create a new coupon
router.post('/', async (req: Request, res: Response) => {
    try {
        const {
            code,
            type = 'percentage',
            value,
            max_uses,
            expires_at,
            is_active = true,
            description,
            min_order_amount = 0,
            max_discount_amount,
            per_user_limit = 1,
            applies_to = 'usd',
            created_by
        } = req.body

        if (!code || value === undefined) {
            return res.status(400).json({ error: 'Code and value are required' })
        }

        const { data: coupon, error } = await supabase
            .from('discount_codes')
            .insert({
                code: code.toUpperCase(),
                type,
                value,
                max_uses,
                current_uses: 0,
                expires_at,
                is_active,
                description,
                min_order_amount,
                max_discount_amount,
                per_user_limit,
                applies_to,
                created_by,
                metadata: {}
            })
            .select()
            .single()

        if (error) throw error

        res.json({ success: true, coupon })
    } catch (error: any) {
        console.error('Error creating coupon:', error)
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Coupon code already exists' })
        }
        res.status(500).json({ error: error.message })
    }
})

// PUT /api/admin/coupons/:id - Update a coupon
router.put('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const updates = req.body

        // Remove fields that shouldn't be updated directly
        delete updates.id
        delete updates.created_at
        delete updates.current_uses

        const { data: coupon, error } = await supabase
            .from('discount_codes')
            .update(updates)
            .eq('id', id)
            .select()
            .single()

        if (error) throw error

        res.json({ success: true, coupon })
    } catch (error: any) {
        console.error('Error updating coupon:', error)
        res.status(500).json({ error: error.message })
    }
})

// DELETE /api/admin/coupons/:id - Deactivate a coupon
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const { id } = req.params

        const { error } = await supabase
            .from('discount_codes')
            .update({ is_active: false })
            .eq('id', id)

        if (error) throw error

        res.json({ success: true })
    } catch (error: any) {
        console.error('Error deactivating coupon:', error)
        res.status(500).json({ error: error.message })
    }
})

// GET /api/admin/coupons/:id/usage - Get coupon usage history
router.get('/:id/usage', async (req: Request, res: Response) => {
    try {
        const { id } = req.params

        const { data: usage, error } = await supabase
            .from('coupon_usage')
            .select('*, user:user_profiles!user_id(email, first_name, last_name)')
            .eq('discount_code_id', id)
            .order('used_at', { ascending: false })

        if (error) throw error

        res.json({ usage })
    } catch (error: any) {
        console.error('Error fetching coupon usage:', error)
        res.status(500).json({ error: error.message })
    }
})

export default router

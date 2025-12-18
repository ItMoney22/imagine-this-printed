import { Router, Request, Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const router = Router()

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials for Coupons routes')
}

const supabase = createClient(supabaseUrl!, supabaseKey!)

// GET /api/coupons/validate - Validate a coupon code
router.get('/validate', async (req: Request, res: Response) => {
    try {
        const { code, userId, orderTotal } = req.query

        if (!code) {
            return res.status(400).json({ valid: false, error: 'Coupon code is required' })
        }

        const { data: coupon, error } = await supabase
            .from('discount_codes')
            .select('*')
            .eq('code', (code as string).toUpperCase())
            .eq('is_active', true)
            .single()

        if (error || !coupon) {
            return res.json({ valid: false, error: 'Invalid coupon code' })
        }

        // Check expiration
        if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
            return res.json({ valid: false, error: 'Coupon has expired' })
        }

        // Check usage limit
        if (coupon.max_uses && coupon.current_uses >= coupon.max_uses) {
            return res.json({ valid: false, error: 'Coupon usage limit reached' })
        }

        // Check minimum order amount
        if (orderTotal && coupon.min_order_amount && Number(orderTotal) < coupon.min_order_amount) {
            return res.json({
                valid: false,
                error: `Minimum order amount of $${coupon.min_order_amount.toFixed(2)} required`
            })
        }

        // Check per-user limit if userId provided
        if (userId && coupon.per_user_limit) {
            const { count, error: usageError } = await supabase
                .from('coupon_usage')
                .select('*', { count: 'exact', head: true })
                .eq('discount_code_id', coupon.id)
                .eq('user_id', userId)

            if (!usageError && count !== null && count >= coupon.per_user_limit) {
                return res.json({ valid: false, error: 'You have already used this coupon' })
            }
        }

        // Calculate discount
        let discountAmount = 0
        const total = Number(orderTotal) || 0

        if (coupon.type === 'percentage') {
            discountAmount = (total * coupon.value) / 100
            if (coupon.max_discount_amount && discountAmount > coupon.max_discount_amount) {
                discountAmount = coupon.max_discount_amount
            }
        } else if (coupon.type === 'fixed') {
            discountAmount = coupon.value
        } else if (coupon.type === 'free_shipping') {
            // Free shipping handled separately
            discountAmount = 0
        }

        res.json({
            valid: true,
            coupon: {
                id: coupon.id,
                code: coupon.code,
                type: coupon.type,
                value: coupon.value,
                description: coupon.description,
                min_order_amount: coupon.min_order_amount,
                max_discount_amount: coupon.max_discount_amount,
                applies_to: coupon.applies_to
            },
            discountAmount: Math.round(discountAmount * 100) / 100
        })
    } catch (error: any) {
        console.error('Error validating coupon:', error)
        res.status(500).json({ valid: false, error: 'Error validating coupon' })
    }
})

// POST /api/coupons/apply - Apply coupon to an order (record usage)
router.post('/apply', async (req: Request, res: Response) => {
    try {
        const { couponId, userId, orderId, discountApplied } = req.body

        if (!couponId) {
            return res.status(400).json({ error: 'Coupon ID is required' })
        }

        // Record usage
        const { error: usageError } = await supabase
            .from('coupon_usage')
            .insert({
                discount_code_id: couponId,
                user_id: userId || null,
                order_id: orderId || null,
                discount_applied: discountApplied || 0
            })

        if (usageError) throw usageError

        // Increment usage count on coupon
        const { error: updateError } = await supabase.rpc('increment_coupon_usage', {
            coupon_id: couponId
        })

        // If RPC doesn't exist, do it manually
        if (updateError) {
            await supabase
                .from('discount_codes')
                .update({ current_uses: supabase.rpc('current_uses', {}) })
                .eq('id', couponId)
        }

        res.json({ success: true })
    } catch (error: any) {
        console.error('Error applying coupon:', error)
        res.status(500).json({ error: error.message })
    }
})

export default router

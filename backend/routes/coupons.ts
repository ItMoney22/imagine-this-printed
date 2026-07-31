import { Router, Request, Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const router = Router()

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  // Anon fallback would silently re-enable RLS on privileged queries and mask a misconfigured deploy — dev only.
  || (process.env.NODE_ENV !== 'production' ? process.env.VITE_SUPABASE_ANON_KEY : undefined)

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials for Coupons routes')
}

const supabase = createClient(supabaseUrl!, supabaseKey!)

export interface CouponValidationResult {
    valid: boolean
    coupon?: {
        id: string
        code: string
        type: string
        value: number
        description?: string
        min_order_amount?: number | null
        max_discount_amount?: number | null
        applies_to?: string | null
    }
    discountAmount: number
    freeShipping: boolean
    error?: string
}

// Minimal structural type so tests can inject a fake in-memory table instead
// of the module-scoped real Supabase client — same convention as
// backend/worker/ai-jobs-worker.ts's claimQueuedJob(db, ...).
type CouponDb = { from: (table: string) => any; rpc: (fn: string, args: any) => any }

/**
 * Look up a coupon by code and compute the real discount for `orderTotal`,
 * re-checking expiry / max_uses / min_order_amount / per_user_limit against
 * the CURRENT database state. Extracted from GET /validate so it can also be
 * called directly (no HTTP round-trip) by routes that need a server-trusted
 * discount instead of a client-supplied number — e.g.
 * backend/routes/wallet.ts's process-full-itc-payment, which previously
 * trusted the client's `discount` field with zero validation at all.
 */
export async function validateCouponForOrder(
    params: { code: string; userId?: string | null; orderTotal: number },
    db: CouponDb = supabase
): Promise<CouponValidationResult> {
    const { code, userId, orderTotal } = params
    const total = Number(orderTotal) || 0

    const { data: coupon, error } = await db
        .from('discount_codes')
        .select('*')
        .eq('code', code.toUpperCase())
        .eq('is_active', true)
        .single()

    if (error || !coupon) {
        return { valid: false, discountAmount: 0, freeShipping: false, error: 'Invalid coupon code' }
    }

    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
        return { valid: false, discountAmount: 0, freeShipping: false, error: 'Coupon has expired' }
    }

    if (coupon.max_uses && coupon.current_uses >= coupon.max_uses) {
        return { valid: false, discountAmount: 0, freeShipping: false, error: 'Coupon usage limit reached' }
    }

    if (total && coupon.min_order_amount && total < coupon.min_order_amount) {
        return {
            valid: false,
            discountAmount: 0,
            freeShipping: false,
            error: `Minimum order amount of $${coupon.min_order_amount.toFixed(2)} required`
        }
    }

    if (userId && coupon.per_user_limit) {
        const { count, error: usageError } = await db
            .from('coupon_usage')
            .select('*', { count: 'exact', head: true })
            .eq('discount_code_id', coupon.id)
            .eq('user_id', userId)

        if (!usageError && count !== null && count >= coupon.per_user_limit) {
            return { valid: false, discountAmount: 0, freeShipping: false, error: 'You have already used this coupon' }
        }
    }

    // Calculate discount
    let discountAmount = 0
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
    discountAmount = Math.min(Math.round(discountAmount * 100) / 100, total)

    return {
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
        discountAmount,
        freeShipping: coupon.type === 'free_shipping'
    }
}

/**
 * Record a coupon redemption: inserts a coupon_usage row and increments
 * discount_codes.current_uses. This logic previously only lived inside
 * POST /apply, which had zero callers anywhere in the codebase — meaning
 * max_uses and per_user_limit above never actually triggered, because
 * current_uses never moved off 0 for a real purchase. Now also called
 * directly from backend/routes/stripe.ts's paid-webhook handler and from
 * backend/routes/wallet.ts's full-ITC payment path.
 */
export async function recordCouponUsage(
    params: { couponId: string; userId?: string | null; orderId?: string | null; discountApplied: number },
    db: CouponDb = supabase
): Promise<{ success: boolean; error?: string }> {
    const { couponId, userId, orderId, discountApplied } = params
    try {
        const { error: usageError } = await db
            .from('coupon_usage')
            .insert({
                discount_code_id: couponId,
                user_id: userId || null,
                order_id: orderId || null,
                discount_applied: discountApplied || 0
            })

        if (usageError) throw usageError

        // Increment usage count on coupon
        const { error: updateError } = await db.rpc('increment_coupon_usage', {
            coupon_id: couponId
        })

        // If RPC doesn't exist, do it manually with fetch-then-update
        if (updateError) {
            const { data: coupon } = await db
                .from('discount_codes')
                .select('current_uses')
                .eq('id', couponId)
                .single()

            if (coupon) {
                await db
                    .from('discount_codes')
                    .update({ current_uses: (coupon.current_uses || 0) + 1 })
                    .eq('id', couponId)
            }
        }

        return { success: true }
    } catch (error: any) {
        console.error('Error recording coupon usage:', error)
        return { success: false, error: error.message }
    }
}

/** Resolve a discount_codes.id from its code — used by the paid-webhook path,
 * which only has the code string stored on the order (orders.discount_codes). */
export async function findCouponIdByCode(code: string, db: CouponDb = supabase): Promise<string | null> {
    const { data } = await db
        .from('discount_codes')
        .select('id')
        .eq('code', code.toUpperCase())
        .single()
    return data?.id || null
}

// GET /api/coupons/validate - Validate a coupon code
router.get('/validate', async (req: Request, res: Response) => {
    try {
        const { code, userId, orderTotal } = req.query

        if (!code) {
            return res.status(400).json({ valid: false, error: 'Coupon code is required' })
        }

        const result = await validateCouponForOrder({
            code: code as string,
            userId: (userId as string) || null,
            orderTotal: Number(orderTotal) || 0
        })

        if (!result.valid) {
            return res.json({ valid: false, error: result.error })
        }

        res.json({
            valid: true,
            coupon: result.coupon,
            // Frontend expects 'discount' field
            discount: result.discountAmount,
            discountAmount: result.discountAmount,
            // Flag for free shipping coupons
            freeShipping: result.freeShipping
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

        const result = await recordCouponUsage({ couponId, userId, orderId, discountApplied })
        if (!result.success) throw new Error(result.error)

        res.json({ success: true })
    } catch (error: any) {
        console.error('Error applying coupon:', error)
        res.status(500).json({ error: error.message })
    }
})

export default router

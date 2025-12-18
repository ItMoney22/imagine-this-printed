import { Router, Request, Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const router = Router()

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials for Gift Cards routes')
}

const supabase = createClient(supabaseUrl!, supabaseKey!)

// GET /api/gift-cards/validate - Validate a gift card code
router.get('/validate', async (req: Request, res: Response) => {
    try {
        const { code } = req.query

        if (!code) {
            return res.status(400).json({ valid: false, error: 'Gift card code is required' })
        }

        const { data: giftCard, error } = await supabase
            .from('gift_cards')
            .select('id, code, itc_amount, is_active, redeemed_by, expires_at')
            .eq('code', (code as string).toUpperCase())
            .single()

        if (error || !giftCard) {
            return res.json({ valid: false, error: 'Invalid gift card code' })
        }

        if (!giftCard.is_active || giftCard.redeemed_by) {
            return res.json({ valid: false, error: 'This gift card has already been redeemed' })
        }

        if (giftCard.expires_at && new Date(giftCard.expires_at) < new Date()) {
            return res.json({ valid: false, error: 'This gift card has expired' })
        }

        res.json({
            valid: true,
            giftCard: {
                id: giftCard.id,
                code: giftCard.code,
                itc_amount: giftCard.itc_amount
            }
        })
    } catch (error: any) {
        console.error('Error validating gift card:', error)
        res.status(500).json({ valid: false, error: 'Error validating gift card' })
    }
})

// POST /api/gift-cards/redeem - Redeem a gift card and credit ITC to user wallet
router.post('/redeem', async (req: Request, res: Response) => {
    try {
        const { code, userId } = req.body

        if (!code || !userId) {
            return res.status(400).json({ error: 'Code and user ID are required' })
        }

        // Get the gift card
        const { data: giftCard, error: fetchError } = await supabase
            .from('gift_cards')
            .select('*')
            .eq('code', code.toUpperCase())
            .single()

        if (fetchError || !giftCard) {
            return res.status(404).json({ error: 'Gift card not found' })
        }

        if (!giftCard.is_active || giftCard.redeemed_by) {
            return res.status(400).json({ error: 'This gift card has already been redeemed' })
        }

        if (giftCard.expires_at && new Date(giftCard.expires_at) < new Date()) {
            return res.status(400).json({ error: 'This gift card has expired' })
        }

        const itcAmount = giftCard.itc_amount || 0

        // Start transaction - Mark gift card as redeemed
        const { error: updateError } = await supabase
            .from('gift_cards')
            .update({
                is_active: false,
                redeemed_by: userId,
                redeemed_at: new Date().toISOString(),
                balance: 0
            })
            .eq('id', giftCard.id)
            .eq('is_active', true) // Ensure it's still unredeemed

        if (updateError) throw updateError

        // Get user's current wallet
        const { data: wallet, error: walletError } = await supabase
            .from('user_wallets')
            .select('itc_balance')
            .eq('user_id', userId)
            .single()

        if (walletError && walletError.code !== 'PGRST116') {
            throw walletError
        }

        const currentBalance = wallet?.itc_balance || 0
        const newBalance = currentBalance + itcAmount

        // Update or create wallet
        if (wallet) {
            const { error: walletUpdateError } = await supabase
                .from('user_wallets')
                .update({
                    itc_balance: newBalance,
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', userId)

            if (walletUpdateError) throw walletUpdateError
        } else {
            const { error: walletInsertError } = await supabase
                .from('user_wallets')
                .insert({
                    user_id: userId,
                    itc_balance: itcAmount,
                    points: 0,
                    usd_balance: 0
                })

            if (walletInsertError) throw walletInsertError
        }

        // Also update user_profiles.itc_balance for consistency
        const { error: profileError } = await supabase
            .from('user_profiles')
            .update({ itc_balance: newBalance })
            .eq('id', userId)

        if (profileError) {
            console.warn('Failed to update user_profiles itc_balance:', profileError)
        }

        // Log the transaction
        const { error: txError } = await supabase
            .from('itc_transactions')
            .insert({
                user_id: userId,
                type: 'gift_card_redemption',
                amount: itcAmount,
                reference: giftCard.code,
                balance_after: newBalance,
                metadata: {
                    gift_card_id: giftCard.id,
                    gift_card_code: giftCard.code
                }
            })

        if (txError) {
            console.warn('Failed to log ITC transaction:', txError)
        }

        res.json({
            success: true,
            itc_credited: itcAmount,
            new_balance: newBalance,
            message: `Successfully redeemed ${itcAmount} ITC to your wallet!`
        })
    } catch (error: any) {
        console.error('Error redeeming gift card:', error)
        res.status(500).json({ error: error.message })
    }
})

export default router

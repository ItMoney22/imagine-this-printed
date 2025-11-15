import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/supabaseAuth.js'
import { supabase } from '../lib/supabase.js'
import { processOrderCompletion } from '../services/order-reward-service.js'
import {
  createReferralCode,
  validateReferralCode,
  processReferralSignup,
  getReferralStats
} from '../services/referral-service.js'

const router = Router()

// GET /api/wallet/get - Get user wallet data
router.get('/get', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Fetch wallet from user_wallets table
    const { data: wallet, error } = await supabase
      .from('user_wallets')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (error) {
      console.error('[wallet/get] Error fetching wallet:', error)
      return res.status(500).json({ error: 'Failed to fetch wallet data' })
    }

    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' })
    }

    return res.json({ ok: true, wallet })
  } catch (error: any) {
    console.error('[wallet/get] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/wallet/transactions/points - Get points transaction history
router.get('/transactions/points', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { limit = 50, offset = 0 } = req.query

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { data: transactions, error } = await supabase
      .from('points_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (error) {
      console.error('[wallet/transactions/points] Error:', error)
      return res.status(500).json({ error: 'Failed to fetch transactions' })
    }

    return res.json({ ok: true, transactions })
  } catch (error: any) {
    console.error('[wallet/transactions/points] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/wallet/transactions/itc - Get ITC transaction history
router.get('/transactions/itc', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { limit = 50, offset = 0 } = req.query

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { data: transactions, error } = await supabase
      .from('itc_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (error) {
      console.error('[wallet/transactions/itc] Error:', error)
      return res.status(500).json({ error: 'Failed to fetch transactions' })
    }

    return res.json({ ok: true, transactions })
  } catch (error: any) {
    console.error('[wallet/transactions/itc] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/wallet/rewards/orders - Get order rewards history
router.get('/rewards/orders', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { limit = 50, offset = 0 } = req.query

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Fetch order rewards with order details
    const { data: rewards, error } = await supabase
      .from('order_rewards')
      .select(`
        *,
        orders:order_id (
          id,
          total,
          status,
          created_at
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'awarded')
      .order('awarded_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (error) {
      console.error('[wallet/rewards/orders] Error:', error)
      return res.status(500).json({ error: 'Failed to fetch order rewards' })
    }

    return res.json({ ok: true, rewards })
  } catch (error: any) {
    console.error('[wallet/rewards/orders] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/wallet/redeem - Redeem points for ITC tokens
router.post('/redeem', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { amount, redeemType } = req.body

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' })
    }

    // Fetch current wallet
    const { data: wallet, error: fetchError } = await supabase
      .from('user_wallets')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (fetchError || !wallet) {
      return res.status(404).json({ error: 'Wallet not found' })
    }

    // Check if user has enough points
    if (wallet.points < amount) {
      return res.status(400).json({ error: 'Insufficient points' })
    }

    // Calculate ITC tokens (100 points = 1 ITC)
    const itcAmount = amount * 0.01

    // Create transactions
    const pointsBalanceBefore = wallet.points
    const itcBalanceBefore = wallet.itc_balance
    const newPointsBalance = wallet.points - amount
    const newITCBalance = wallet.itc_balance + itcAmount

    // Points transaction
    await supabase.from('points_transactions').insert({
      user_id: userId,
      points_change: -amount,
      balance_after: newPointsBalance,
      reason: `Redeemed ${amount} points for ${itcAmount.toFixed(2)} ITC`,
      reference: 'redemption',
      metadata: { redeem_type: redeemType }
    })

    // ITC transaction
    await supabase.from('itc_transactions').insert({
      user_id: userId,
      type: 'redemption',
      amount: itcAmount,
      balance_after: newITCBalance,
      reference: 'redemption',
      metadata: { usd_value: amount * 0.01 }
    })

    // Update wallet
    const { data: updated, error: updateError } = await supabase
      .from('user_wallets')
      .update({
        points: newPointsBalance,
        itc_balance: newITCBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .select()
      .single()

    if (updateError) {
      console.error('[wallet/redeem] Error updating wallet:', updateError)
      return res.status(500).json({ error: 'Failed to redeem points' })
    }

    return res.json({
      ok: true,
      message: `Successfully redeemed ${amount} points for ${itcAmount.toFixed(2)} ITC`,
      wallet: updated,
      redeemed: {
        points: amount,
        itc: itcAmount
      }
    })
  } catch (error: any) {
    console.error('[wallet/redeem] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/wallet/referral/create - Create referral code
router.post('/referral/create', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { description } = req.body

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Check if user already has an active code
    const { data: existing } = await supabase
      .from('referral_codes')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .single()

    if (existing) {
      return res.json({
        ok: true,
        code: existing,
        message: 'You already have an active referral code'
      })
    }

    // Create new code
    const result = await createReferralCode({
      userId,
      description
    })

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    return res.json({
      ok: true,
      code: result.code,
      message: 'Referral code created successfully'
    })
  } catch (error: any) {
    console.error('[wallet/referral/create] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/wallet/referral/stats - Get referral statistics
router.get('/referral/stats', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const result = await getReferralStats(userId)

    if (!result.success) {
      return res.status(500).json({ error: result.error })
    }

    return res.json({
      ok: true,
      stats: result.stats
    })
  } catch (error: any) {
    console.error('[wallet/referral/stats] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/wallet/referral/validate - Validate a referral code
router.post('/referral/validate', async (req: Request, res: Response): Promise<any> => {
  try {
    const { code } = req.body

    if (!code) {
      return res.status(400).json({ error: 'Referral code is required' })
    }

    const result = await validateReferralCode(code)

    return res.json({
      ok: result.valid,
      valid: result.valid,
      error: result.error
    })
  } catch (error: any) {
    console.error('[wallet/referral/validate] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/wallet/referral/apply - Apply referral code during signup
router.post('/referral/apply', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { code } = req.body

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    if (!code) {
      return res.status(400).json({ error: 'Referral code is required' })
    }

    // Get user email
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('email')
      .eq('user_id', userId)
      .single()

    if (!profile) {
      return res.status(404).json({ error: 'User profile not found' })
    }

    const result = await processReferralSignup(code, userId, profile.email)

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    return res.json({
      ok: true,
      message: 'Referral code applied successfully!',
      rewards: result.refereeRewards
    })
  } catch (error: any) {
    console.error('[wallet/referral/apply] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

export default router

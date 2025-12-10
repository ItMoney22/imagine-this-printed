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

// ==============================================
// ITC CASHOUT / PAYOUT REQUESTS
// ==============================================

// Minimum ITC for payout = 5000 ITC ($50)
const MINIMUM_PAYOUT_ITC = 5000
// Processing fee = 5%
const PAYOUT_FEE_PERCENT = 5
// ITC to USD conversion (1 ITC = $0.01)
const ITC_TO_USD = 0.01

/**
 * GET /api/wallet/payout-requests
 * Get user's payout request history
 */
router.get('/payout-requests', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { data: requests, error } = await supabase
      .from('payout_requests')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[wallet/payout-requests] Error:', error)
      return res.status(500).json({ error: 'Failed to fetch payout requests' })
    }

    return res.json({ ok: true, requests: requests || [] })
  } catch (error: any) {
    console.error('[wallet/payout-requests] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/wallet/payout-request
 * Request a payout (cash out ITC)
 */
router.post('/payout-request', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { amount_itc, payout_method, payout_details } = req.body

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Validate amount
    if (!amount_itc || amount_itc < MINIMUM_PAYOUT_ITC) {
      return res.status(400).json({
        error: `Minimum payout is ${MINIMUM_PAYOUT_ITC} ITC ($${(MINIMUM_PAYOUT_ITC * ITC_TO_USD).toFixed(2)})`,
        minimum: MINIMUM_PAYOUT_ITC
      })
    }

    // Validate payout method
    if (!payout_method || !['paypal', 'venmo', 'bank'].includes(payout_method)) {
      return res.status(400).json({ error: 'Invalid payout method. Choose: paypal, venmo, or bank' })
    }

    // Validate payout details
    if (!payout_details || !payout_details.email) {
      return res.status(400).json({ error: 'Payout details required (email for PayPal/Venmo)' })
    }

    // Check wallet balance
    const { data: wallet, error: walletError } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', userId)
      .single()

    if (walletError || !wallet) {
      return res.status(404).json({ error: 'Wallet not found' })
    }

    if (wallet.itc_balance < amount_itc) {
      return res.status(400).json({
        error: 'Insufficient ITC balance',
        required: amount_itc,
        current: wallet.itc_balance
      })
    }

    // Check for pending requests (prevent spam)
    const { data: pendingRequests } = await supabase
      .from('payout_requests')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'pending')

    if (pendingRequests && pendingRequests.length > 0) {
      return res.status(400).json({
        error: 'You already have a pending payout request. Please wait for it to be processed.'
      })
    }

    // Calculate USD amount (minus fee)
    const grossUsd = amount_itc * ITC_TO_USD
    const feeUsd = grossUsd * (PAYOUT_FEE_PERCENT / 100)
    const netUsd = grossUsd - feeUsd

    // Deduct ITC from wallet
    const newBalance = wallet.itc_balance - amount_itc
    const { error: deductError } = await supabase
      .from('user_wallets')
      .update({ itc_balance: newBalance })
      .eq('user_id', userId)

    if (deductError) {
      console.error('[wallet/payout-request] Deduct error:', deductError)
      return res.status(500).json({ error: 'Failed to deduct ITC' })
    }

    // Log the transaction
    await supabase.from('itc_transactions').insert({
      user_id: userId,
      type: 'payout',
      amount: -amount_itc,
      balance_after: newBalance,
      reference_type: 'payout_request',
      description: `Payout request: ${amount_itc} ITC -> $${netUsd.toFixed(2)} via ${payout_method}`,
      metadata: {
        payout_method,
        gross_usd: grossUsd,
        fee_usd: feeUsd,
        net_usd: netUsd
      }
    })

    // Create payout request
    const { data: request, error: requestError } = await supabase
      .from('payout_requests')
      .insert({
        user_id: userId,
        amount_itc,
        amount_usd: netUsd,
        payout_method,
        payout_details,
        status: 'pending'
      })
      .select()
      .single()

    if (requestError) {
      console.error('[wallet/payout-request] Request error:', requestError)
      // Refund if request creation fails
      await supabase
        .from('user_wallets')
        .update({ itc_balance: wallet.itc_balance })
        .eq('user_id', userId)
      return res.status(500).json({ error: 'Failed to create payout request' })
    }

    console.log('[wallet/payout-request] ✅ Payout request created:', {
      userId,
      amount_itc,
      net_usd: netUsd,
      method: payout_method
    })

    return res.json({
      ok: true,
      message: 'Payout request submitted successfully',
      request,
      summary: {
        itc_amount: amount_itc,
        gross_usd: grossUsd,
        fee_usd: feeUsd,
        fee_percent: PAYOUT_FEE_PERCENT,
        net_usd: netUsd,
        new_balance: newBalance
      }
    })
  } catch (error: any) {
    console.error('[wallet/payout-request] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * DELETE /api/wallet/payout-request/:id
 * Cancel a pending payout request
 */
router.delete('/payout-request/:id', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { id } = req.params

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Get the request and verify ownership + status
    const { data: request, error: fetchError } = await supabase
      .from('payout_requests')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    if (fetchError || !request) {
      return res.status(404).json({ error: 'Payout request not found' })
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        error: `Cannot cancel a ${request.status} payout request`
      })
    }

    // Refund the ITC
    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', userId)
      .single()

    if (wallet) {
      const newBalance = wallet.itc_balance + request.amount_itc
      await supabase
        .from('user_wallets')
        .update({ itc_balance: newBalance })
        .eq('user_id', userId)

      // Log the refund
      await supabase.from('itc_transactions').insert({
        user_id: userId,
        type: 'refund',
        amount: request.amount_itc,
        balance_after: newBalance,
        reference_type: 'payout_cancelled',
        description: `Payout request cancelled - ${request.amount_itc} ITC refunded`
      })
    }

    // Delete the request
    await supabase
      .from('payout_requests')
      .delete()
      .eq('id', id)

    console.log('[wallet/payout-request] ✅ Payout request cancelled and refunded:', id)

    return res.json({
      ok: true,
      message: 'Payout request cancelled and ITC refunded',
      refunded_itc: request.amount_itc
    })
  } catch (error: any) {
    console.error('[wallet/payout-request] Cancel error:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/wallet/itc-to-credit
 * Convert ITC to store credit (instant, no fee)
 */
router.post('/itc-to-credit', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { amount_itc } = req.body

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    if (!amount_itc || amount_itc <= 0) {
      return res.status(400).json({ error: 'Invalid amount' })
    }

    // Check wallet balance
    const { data: wallet, error: walletError } = await supabase
      .from('user_wallets')
      .select('itc_balance, usd_balance')
      .eq('user_id', userId)
      .single()

    if (walletError || !wallet) {
      return res.status(404).json({ error: 'Wallet not found' })
    }

    if (wallet.itc_balance < amount_itc) {
      return res.status(400).json({
        error: 'Insufficient ITC balance',
        required: amount_itc,
        current: wallet.itc_balance
      })
    }

    // Convert ITC to USD store credit (1 ITC = $0.01)
    const creditAmount = amount_itc * ITC_TO_USD
    const newItcBalance = wallet.itc_balance - amount_itc
    const newUsdBalance = (wallet.usd_balance || 0) + creditAmount

    // Update wallet
    const { error: updateError } = await supabase
      .from('user_wallets')
      .update({
        itc_balance: newItcBalance,
        usd_balance: newUsdBalance
      })
      .eq('user_id', userId)

    if (updateError) {
      console.error('[wallet/itc-to-credit] Update error:', updateError)
      return res.status(500).json({ error: 'Failed to convert ITC' })
    }

    // Log the transaction
    await supabase.from('itc_transactions').insert({
      user_id: userId,
      type: 'conversion',
      amount: -amount_itc,
      balance_after: newItcBalance,
      reference_type: 'store_credit',
      description: `Converted ${amount_itc} ITC to $${creditAmount.toFixed(2)} store credit`
    })

    console.log('[wallet/itc-to-credit] ✅ ITC converted to store credit:', {
      userId,
      itc: amount_itc,
      credit: creditAmount
    })

    return res.json({
      ok: true,
      message: `Converted ${amount_itc} ITC to $${creditAmount.toFixed(2)} store credit`,
      converted: {
        itc: amount_itc,
        usd: creditAmount
      },
      new_balances: {
        itc: newItcBalance,
        store_credit: newUsdBalance
      }
    })
  } catch (error: any) {
    console.error('[wallet/itc-to-credit] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

export default router

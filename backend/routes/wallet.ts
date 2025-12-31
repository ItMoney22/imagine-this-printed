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
import {
  createExpressAccount,
  createOnboardingLink,
  getConnectAccountStatus,
  calculateCashout,
  processInstantPayout,
  MINIMUM_CASHOUT_ITC,
  ITC_TO_USD as CONNECT_ITC_TO_USD
} from '../services/stripe-connect.js'

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

/**
 * POST /api/wallet/deduct-itc
 * Deduct ITC for premium features (mockups, upscaling, etc.)
 * Used by frontend for unlocking paid features
 */
router.post('/deduct-itc', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const { amount, reason } = req.body

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount - must be positive' })
    }

    if (!reason) {
      return res.status(400).json({ error: 'Reason is required for ITC deduction' })
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

    if (wallet.itc_balance < amount) {
      return res.status(402).json({
        error: 'Insufficient ITC balance',
        required: amount,
        current: wallet.itc_balance
      })
    }

    // Deduct ITC
    const newBalance = wallet.itc_balance - amount
    const { error: updateError } = await supabase
      .from('user_wallets')
      .update({ itc_balance: newBalance })
      .eq('user_id', userId)

    if (updateError) {
      console.error('[wallet/deduct-itc] Update error:', updateError)
      return res.status(500).json({ error: 'Failed to deduct ITC' })
    }

    // Log the transaction
    await supabase.from('itc_transactions').insert({
      user_id: userId,
      type: 'usage',
      amount: -amount,
      balance_after: newBalance,
      reference_type: 'feature_usage',
      description: reason
    })

    console.log('[wallet/deduct-itc] ✅ ITC deducted:', {
      userId,
      amount,
      reason,
      newBalance
    })

    return res.json({
      ok: true,
      message: `Deducted ${amount} ITC`,
      deducted: amount,
      new_balance: newBalance,
      reason
    })
  } catch (error: any) {
    console.error('[wallet/deduct-itc] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/wallet/process-full-itc-payment
 * Process a full order payment using ITC tokens
 * Deducts ITC from user's wallet and creates an order
 */
router.post('/process-full-itc-payment', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub
    const userEmail = req.user?.email
    const {
      items,
      itcAmount,
      usdEquivalent,
      shipping,
      shippingCost,
      tax,
      discount,
      couponCode,
      shippingMethod,
      shippingType,
      pickupAppointment
    } = req.body

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' })
    }

    if (!itcAmount || itcAmount <= 0) {
      return res.status(400).json({ error: 'Invalid ITC amount' })
    }

    console.log('[wallet/process-full-itc-payment] Processing ITC payment:', {
      userId,
      itcAmount,
      usdEquivalent,
      itemCount: items.length
    })

    // Get current wallet balance
    const { data: wallet, error: walletError } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', userId)
      .single()

    if (walletError || !wallet) {
      console.error('[wallet/process-full-itc-payment] Wallet error:', walletError)
      return res.status(400).json({ error: 'Wallet not found' })
    }

    const currentBalance = wallet.itc_balance || 0
    if (currentBalance < itcAmount) {
      return res.status(400).json({
        error: 'Insufficient ITC balance',
        required: itcAmount,
        available: currentBalance
      })
    }

    // Calculate new balance
    const newBalance = currentBalance - itcAmount

    // Generate order number
    const orderNumber = `ITP-ITC-${Date.now().toString(36).toUpperCase()}`

    // Calculate totals
    const subtotal = items.reduce((sum: number, item: any) => {
      return sum + (item.product?.price || 0) * (item.quantity || 1)
    }, 0)

    // Create the order in Supabase
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        user_id: userId,
        customer_email: shipping?.email || userEmail,
        subtotal: subtotal,
        shipping_cost: shippingCost || 0,
        tax: tax || 0,
        discount: discount || 0,
        total: parseFloat(usdEquivalent),
        currency: 'ITC',
        status: 'processing',
        payment_status: 'paid',
        payment_method: 'itc_full',
        shipping_address: {
          firstName: shipping?.firstName,
          lastName: shipping?.lastName,
          email: shipping?.email || userEmail,
          address: shipping?.address,
          city: shipping?.city,
          state: shipping?.state,
          zipCode: shipping?.zipCode,
          country: shipping?.country || 'US'
        },
        shipping_method: shippingMethod,
        shipping_type: shippingType,
        pickup_appointment: pickupAppointment,
        coupon_code: couponCode || null,
        metadata: {
          items: items.map((item: any) => ({
            id: item.id,
            productId: item.product?.id,
            name: item.product?.name,
            price: item.product?.price,
            quantity: item.quantity,
            size: item.selectedSize,
            color: item.selectedColor,
            image: item.product?.images?.[0]
          })),
          itc_payment: {
            itc_amount: itcAmount,
            usd_equivalent: usdEquivalent,
            rate: '0.01'
          },
          payment_method: 'itc_full'
        }
      })
      .select()
      .single()

    if (orderError) {
      console.error('[wallet/process-full-itc-payment] Order creation error:', orderError)
      return res.status(500).json({ error: 'Failed to create order' })
    }

    // Deduct ITC from wallet
    const { error: updateError } = await supabase
      .from('user_wallets')
      .update({ itc_balance: newBalance })
      .eq('user_id', userId)

    if (updateError) {
      console.error('[wallet/process-full-itc-payment] Wallet update error:', updateError)
      // Rollback order if wallet update fails
      await supabase.from('orders').delete().eq('id', order.id)
      return res.status(500).json({ error: 'Failed to process payment' })
    }

    // Log the ITC transaction
    await supabase.from('itc_transactions').insert({
      user_id: userId,
      type: 'purchase_payment',
      amount: -itcAmount,
      balance_after: newBalance,
      reference_type: 'order',
      reference_id: order.id,
      description: `Order payment: ${orderNumber}`
    })

    console.log('[wallet/process-full-itc-payment] ✅ Order created:', {
      orderId: order.id,
      orderNumber,
      itcAmount,
      newBalance
    })

    return res.json({
      success: true,
      orderId: order.id,
      orderNumber,
      itcDeducted: itcAmount,
      newBalance,
      message: 'Order placed successfully with ITC payment'
    })
  } catch (error: any) {
    console.error('[wallet/process-full-itc-payment] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// ==============================================
// STRIPE CONNECT INSTANT CASHOUT ENDPOINTS
// ==============================================

/**
 * GET /api/wallet/connect/status
 * Get user's Stripe Connect account status
 */
router.get('/connect/status', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const status = await getConnectAccountStatus(userId)

    return res.json({ ok: true, status })
  } catch (error: any) {
    console.error('[wallet/connect/status] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/wallet/connect/create-account
 * Create a new Stripe Connect Express account
 */
router.post('/connect/create-account', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Check if already has account
    const existingStatus = await getConnectAccountStatus(userId)
    if (existingStatus.hasAccount) {
      return res.status(400).json({
        error: 'You already have a Stripe Connect account',
        accountId: existingStatus.accountId
      })
    }

    // Get user email
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('email')
      .eq('id', userId)
      .single()

    if (!profile?.email) {
      return res.status(400).json({ error: 'User email not found' })
    }

    // Create account
    const account = await createExpressAccount(userId, profile.email)

    console.log('[wallet/connect] Created Express account:', account.id)

    return res.json({
      ok: true,
      accountId: account.id,
      message: 'Stripe Connect account created. Complete onboarding to enable payouts.'
    })
  } catch (error: any) {
    console.error('[wallet/connect/create-account] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/wallet/connect/onboarding-link
 * Get onboarding link for Stripe Express
 */
router.post('/connect/onboarding-link', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { returnUrl, refreshUrl } = req.body

    // Get account
    const { data: connectAccount } = await supabase
      .from('stripe_connect_accounts')
      .select('stripe_account_id')
      .eq('user_id', userId)
      .single()

    if (!connectAccount) {
      return res.status(404).json({ error: 'No Stripe Connect account found. Create one first.' })
    }

    const baseUrl = process.env.VITE_SITE_URL || 'https://imaginethisprinted.com'
    const onboardingUrl = await createOnboardingLink(
      connectAccount.stripe_account_id,
      returnUrl || `${baseUrl}/wallet?connect=success`,
      refreshUrl || `${baseUrl}/wallet?connect=refresh`
    )

    return res.json({ ok: true, url: onboardingUrl })
  } catch (error: any) {
    console.error('[wallet/connect/onboarding-link] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/wallet/connect/calculate
 * Calculate cashout amounts before confirming
 */
router.post('/connect/calculate', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { amountItc } = req.body

    if (!amountItc || amountItc < MINIMUM_CASHOUT_ITC) {
      return res.status(400).json({
        error: `Minimum cashout is ${MINIMUM_CASHOUT_ITC} ITC ($${MINIMUM_CASHOUT_ITC * CONNECT_ITC_TO_USD})`,
        minimum: MINIMUM_CASHOUT_ITC
      })
    }

    // Check if instant payouts available
    const status = await getConnectAccountStatus(userId)
    const calculation = calculateCashout(amountItc, status.instantPayoutsEnabled)

    return res.json({
      ok: true,
      calculation,
      instantAvailable: status.instantPayoutsEnabled
    })
  } catch (error: any) {
    console.error('[wallet/connect/calculate] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/wallet/connect/cashout
 * Process ITC cashout via Stripe Connect instant payout
 */
router.post('/connect/cashout', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { amountItc } = req.body

    if (!amountItc || amountItc < MINIMUM_CASHOUT_ITC) {
      return res.status(400).json({
        error: `Minimum cashout is ${MINIMUM_CASHOUT_ITC} ITC ($${MINIMUM_CASHOUT_ITC * CONNECT_ITC_TO_USD})`,
        minimum: MINIMUM_CASHOUT_ITC
      })
    }

    // Check for pending cashout requests
    const { data: pendingRequests } = await supabase
      .from('itc_cashout_requests')
      .select('id')
      .eq('user_id', userId)
      .in('status', ['pending', 'processing'])

    if (pendingRequests && pendingRequests.length > 0) {
      return res.status(400).json({
        error: 'You have a pending cashout request. Please wait for it to complete.'
      })
    }

    // Process the payout
    const result = await processInstantPayout(userId, amountItc)

    if (!result.success) {
      return res.status(400).json({ error: result.error })
    }

    console.log('[wallet/connect/cashout] ✅ Cashout processed:', result.payoutId)

    return res.json({
      ok: true,
      message: 'Cashout processed successfully! Funds will arrive on your debit card shortly.',
      payoutId: result.payoutId,
      transferId: result.transferId,
      cashoutRequestId: result.cashoutRequestId
    })
  } catch (error: any) {
    console.error('[wallet/connect/cashout] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/wallet/connect/cashout-history
 * Get user's cashout request history
 */
router.get('/connect/cashout-history', requireAuth, async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = req.user?.sub

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const { data: requests, error } = await supabase
      .from('itc_cashout_requests')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('[wallet/connect/cashout-history] Error:', error)
      return res.status(500).json({ error: 'Failed to fetch cashout history' })
    }

    return res.json({ ok: true, requests: requests || [] })
  } catch (error: any) {
    console.error('[wallet/connect/cashout-history] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// =============================================================================
// ADMIN: Connect Overview
// =============================================================================

router.get('/admin/connect/overview', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Check if user is admin
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', userId)
      .single()

    if (!profile || profile.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' })
    }

    // Fetch all connected accounts with user info
    const { data: accounts, error: accountsError } = await supabase
      .from('stripe_connect_accounts')
      .select(`
        id,
        user_id,
        stripe_account_id,
        onboarding_complete,
        payouts_enabled,
        instant_payouts_enabled,
        external_account_last4,
        external_account_brand,
        created_at
      `)
      .order('created_at', { ascending: false })

    if (accountsError) {
      console.error('[admin/connect/overview] Accounts error:', accountsError)
    }

    // Fetch user info for accounts
    const accountUserIds = (accounts || []).map(a => a.user_id)
    let accountUsers: Record<string, any> = {}
    if (accountUserIds.length > 0) {
      const { data: users } = await supabase
        .from('user_profiles')
        .select('id, email, first_name, last_name')
        .in('id', accountUserIds)

      if (users) {
        accountUsers = users.reduce((acc, u) => ({ ...acc, [u.id]: u }), {})
      }
    }

    // Attach user info to accounts
    const accountsWithUsers = (accounts || []).map(a => ({
      ...a,
      user: accountUsers[a.user_id] || null
    }))

    // Fetch all cashout requests
    const { data: cashouts, error: cashoutsError } = await supabase
      .from('itc_cashout_requests')
      .select(`
        id,
        user_id,
        amount_itc,
        gross_amount_usd,
        platform_fee_usd,
        net_amount_usd,
        status,
        created_at
      `)
      .order('created_at', { ascending: false })
      .limit(100)

    if (cashoutsError) {
      console.error('[admin/connect/overview] Cashouts error:', cashoutsError)
    }

    // Fetch user info for cashouts
    const cashoutUserIds = (cashouts || []).map(c => c.user_id)
    let cashoutUsers: Record<string, any> = {}
    if (cashoutUserIds.length > 0) {
      const { data: users } = await supabase
        .from('user_profiles')
        .select('id, email, first_name, last_name')
        .in('id', cashoutUserIds)

      if (users) {
        cashoutUsers = users.reduce((acc, u) => ({ ...acc, [u.id]: u }), {})
      }
    }

    // Attach user info to cashouts
    const cashoutsWithUsers = (cashouts || []).map(c => ({
      ...c,
      user: cashoutUsers[c.user_id] || null
    }))

    // Calculate stats
    const totalAccounts = accounts?.length || 0
    const activeAccounts = accounts?.filter(a => a.payouts_enabled).length || 0
    const pendingOnboarding = accounts?.filter(a => !a.payouts_enabled).length || 0

    const completedCashouts = cashouts?.filter(c => c.status === 'paid' || c.status === 'completed') || []
    const totalCashouts = completedCashouts.length
    const totalCashedOut = completedCashouts.reduce((sum, c) => sum + Number(c.net_amount_usd || 0), 0)
    const totalPlatformFees = completedCashouts.reduce((sum, c) => sum + Number(c.platform_fee_usd || 0), 0)
    const pendingCashouts = cashouts?.filter(c => c.status === 'pending' || c.status === 'processing').length || 0

    const stats = {
      totalAccounts,
      activeAccounts,
      pendingOnboarding,
      totalCashouts,
      totalCashedOut,
      totalPlatformFees,
      pendingCashouts
    }

    return res.json({
      ok: true,
      accounts: accountsWithUsers,
      cashouts: cashoutsWithUsers,
      stats
    })
  } catch (error: any) {
    console.error('[admin/connect/overview] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

export default router

import { Router, Request, Response } from 'express'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import { requireAdmin } from '../../middleware/requireAdmin.js'
import { supabase } from '../../lib/supabase.js'
import { logWalletAction, logWalletError } from '../../utils/wallet-logger.js'

const router = Router()

// Apply authentication and admin authorization to all routes
router.use(requireAuth)
router.use(requireAdmin)

// GET /api/admin/wallet/users - List all user wallets with balances
router.get('/users', async (req: Request, res: Response): Promise<any> => {
  try {
    const adminId = req.user?.sub
    const { search, limit = 50, offset = 0 } = req.query

    logWalletAction({
      userId: 'system',
      action: 'list',
      currency: 'points',
      adminId: adminId!,
      metadata: { search, limit, offset }
    })

    let query = supabase
      .from('user_profiles')
      .select(`
        id,
        username,
        email,
        role,
        user_wallets (
          points,
          itc_balance,
          updated_at
        )
      `)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    // Apply search filter if provided
    if (search) {
      query = query.or(`username.ilike.%${search}%,email.ilike.%${search}%`)
    }

    const { data: users, error, count } = await query

    if (error) {
      console.error('[admin/wallet/users] Error fetching users:', error)
      logWalletError(new Error(error.message), {
        userId: 'system',
        action: 'list',
        currency: 'points',
        adminId: adminId!
      })
      return res.status(500).json({ error: 'Failed to fetch user wallets' })
    }

    return res.json({
      ok: true,
      users: users || [],
      pagination: {
        total: count,
        limit: Number(limit),
        offset: Number(offset)
      }
    })
  } catch (error: any) {
    console.error('[admin/wallet/users] Error:', error)
    logWalletError(error, {
      userId: 'system',
      action: 'list',
      currency: 'points',
      adminId: req.user?.sub!
    })
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/admin/wallet/transactions - Get all wallet transactions (admin view)
router.get('/transactions', async (req: Request, res: Response): Promise<any> => {
  try {
    const adminId = req.user?.sub
    const { userId, limit = 100, offset = 0, type, currency } = req.query

    logWalletAction({
      userId: userId as string || 'all',
      action: 'view',
      currency: (currency as 'points' | 'itc') || 'points',
      adminId: adminId!,
      metadata: { limit, offset, type, currency }
    })

    // Note: This assumes you have a wallet_transactions table
    // If not, this endpoint would need to query audit_logs or similar
    let query = supabase
      .from('wallet_transactions')
      .select(`
        *,
        user_profiles (
          username,
          email
        )
      `)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (userId) {
      query = query.eq('user_id', userId)
    }

    if (type) {
      query = query.eq('type', type)
    }

    if (currency) {
      query = query.eq('currency', currency)
    }

    const { data: transactions, error, count } = await query

    if (error) {
      console.error('[admin/wallet/transactions] Error:', error)
      return res.status(500).json({ error: 'Failed to fetch transactions' })
    }

    return res.json({
      ok: true,
      transactions: transactions || [],
      pagination: {
        total: count,
        limit: Number(limit),
        offset: Number(offset)
      }
    })
  } catch (error: any) {
    console.error('[admin/wallet/transactions] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/wallet/credit - Credit ITC/points to user
router.post('/credit', async (req: Request, res: Response): Promise<any> => {
  try {
    const adminId = req.user?.sub
    const { userId, amount, currency, reason } = req.body

    // Validation
    if (!userId || !amount || !currency || !reason) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['userId', 'amount', 'currency', 'reason']
      })
    }

    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' })
    }

    if (!['points', 'itc'].includes(currency)) {
      return res.status(400).json({ error: 'Currency must be "points" or "itc"' })
    }

    if (reason.length < 10) {
      return res.status(400).json({ error: 'Reason must be at least 10 characters' })
    }

    // Fetch current wallet
    const { data: wallet, error: fetchError } = await supabase
      .from('user_wallets')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (fetchError || !wallet) {
      console.error('[admin/wallet/credit] Wallet not found:', fetchError)
      return res.status(404).json({ error: 'User wallet not found' })
    }

    const balanceBefore = currency === 'points' ? wallet.points : wallet.itc_balance
    const balanceAfter = balanceBefore + amount

    // Update wallet
    const updateField = currency === 'points' ? 'points' : 'itc_balance'
    const { data: updated, error: updateError } = await supabase
      .from('user_wallets')
      .update({
        [updateField]: balanceAfter,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .select()
      .single()

    if (updateError) {
      console.error('[admin/wallet/credit] Error updating wallet:', updateError)
      logWalletError(new Error(updateError.message), {
        userId,
        action: 'credit',
        currency,
        amount,
        adminId: adminId!
      })
      return res.status(500).json({ error: 'Failed to credit wallet' })
    }

    // Create transaction record (if wallet_transactions table exists)
    const { error: txError } = await supabase
      .from('wallet_transactions')
      .insert({
        user_id: userId,
        type: 'admin_credit',
        currency,
        amount,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        reason,
        admin_id: adminId,
        metadata: { adminAction: 'credit' }
      })

    if (txError) {
      console.warn('[admin/wallet/credit] Failed to log transaction:', txError)
    }

    // Log the action
    logWalletAction({
      userId,
      action: 'credit',
      currency,
      amount,
      reason,
      balanceBefore,
      balanceAfter,
      adminId: adminId!
    })

    return res.json({
      ok: true,
      wallet: updated,
      transaction: {
        type: 'credit',
        currency,
        amount,
        balanceBefore,
        balanceAfter,
        reason
      }
    })
  } catch (error: any) {
    console.error('[admin/wallet/credit] Error:', error)
    logWalletError(error, {
      userId: req.body.userId,
      action: 'credit',
      currency: req.body.currency,
      amount: req.body.amount,
      adminId: req.user?.sub!
    })
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/wallet/debit - Debit ITC/points from user
router.post('/debit', async (req: Request, res: Response): Promise<any> => {
  try {
    const adminId = req.user?.sub
    const { userId, amount, currency, reason, allowNegative = false } = req.body

    // Validation
    if (!userId || !amount || !currency || !reason) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['userId', 'amount', 'currency', 'reason']
      })
    }

    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' })
    }

    if (!['points', 'itc'].includes(currency)) {
      return res.status(400).json({ error: 'Currency must be "points" or "itc"' })
    }

    if (reason.length < 10) {
      return res.status(400).json({ error: 'Reason must be at least 10 characters' })
    }

    // Fetch current wallet
    const { data: wallet, error: fetchError } = await supabase
      .from('user_wallets')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (fetchError || !wallet) {
      console.error('[admin/wallet/debit] Wallet not found:', fetchError)
      return res.status(404).json({ error: 'User wallet not found' })
    }

    const balanceBefore = currency === 'points' ? wallet.points : wallet.itc_balance
    const balanceAfter = balanceBefore - amount

    // Check for negative balance (unless explicitly allowed)
    if (!allowNegative && balanceAfter < 0) {
      return res.status(400).json({
        error: 'Insufficient balance',
        current: balanceBefore,
        requested: amount,
        shortfall: Math.abs(balanceAfter)
      })
    }

    // Update wallet
    const updateField = currency === 'points' ? 'points' : 'itc_balance'
    const { data: updated, error: updateError } = await supabase
      .from('user_wallets')
      .update({
        [updateField]: balanceAfter,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .select()
      .single()

    if (updateError) {
      console.error('[admin/wallet/debit] Error updating wallet:', updateError)
      logWalletError(new Error(updateError.message), {
        userId,
        action: 'debit',
        currency,
        amount,
        adminId: adminId!
      })
      return res.status(500).json({ error: 'Failed to debit wallet' })
    }

    // Create transaction record
    const { error: txError } = await supabase
      .from('wallet_transactions')
      .insert({
        user_id: userId,
        type: 'admin_debit',
        currency,
        amount: -amount,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        reason,
        admin_id: adminId,
        metadata: { adminAction: 'debit', allowNegative }
      })

    if (txError) {
      console.warn('[admin/wallet/debit] Failed to log transaction:', txError)
    }

    // Log the action
    logWalletAction({
      userId,
      action: 'debit',
      currency,
      amount,
      reason,
      balanceBefore,
      balanceAfter,
      adminId: adminId!
    })

    return res.json({
      ok: true,
      wallet: updated,
      transaction: {
        type: 'debit',
        currency,
        amount,
        balanceBefore,
        balanceAfter,
        reason
      }
    })
  } catch (error: any) {
    console.error('[admin/wallet/debit] Error:', error)
    logWalletError(error, {
      userId: req.body.userId,
      action: 'debit',
      currency: req.body.currency,
      amount: req.body.amount,
      adminId: req.user?.sub!
    })
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/wallet/adjust - Adjust balance with reason
router.post('/adjust', async (req: Request, res: Response): Promise<any> => {
  try {
    const adminId = req.user?.sub
    const { userId, newBalance, currency, reason } = req.body

    // Validation
    if (!userId || newBalance === undefined || !currency || !reason) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['userId', 'newBalance', 'currency', 'reason']
      })
    }

    if (newBalance < 0) {
      return res.status(400).json({ error: 'New balance cannot be negative' })
    }

    if (!['points', 'itc'].includes(currency)) {
      return res.status(400).json({ error: 'Currency must be "points" or "itc"' })
    }

    if (reason.length < 10) {
      return res.status(400).json({ error: 'Reason must be at least 10 characters' })
    }

    // Fetch current wallet
    const { data: wallet, error: fetchError } = await supabase
      .from('user_wallets')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (fetchError || !wallet) {
      console.error('[admin/wallet/adjust] Wallet not found:', fetchError)
      return res.status(404).json({ error: 'User wallet not found' })
    }

    const balanceBefore = currency === 'points' ? wallet.points : wallet.itc_balance
    const difference = newBalance - balanceBefore

    // Update wallet
    const updateField = currency === 'points' ? 'points' : 'itc_balance'
    const { data: updated, error: updateError } = await supabase
      .from('user_wallets')
      .update({
        [updateField]: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .select()
      .single()

    if (updateError) {
      console.error('[admin/wallet/adjust] Error updating wallet:', updateError)
      logWalletError(new Error(updateError.message), {
        userId,
        action: 'adjust',
        currency,
        amount: difference,
        adminId: adminId!
      })
      return res.status(500).json({ error: 'Failed to adjust wallet' })
    }

    // Create transaction record
    const { error: txError } = await supabase
      .from('wallet_transactions')
      .insert({
        user_id: userId,
        type: 'admin_adjust',
        currency,
        amount: difference,
        balance_before: balanceBefore,
        balance_after: newBalance,
        reason,
        admin_id: adminId,
        metadata: { adminAction: 'adjust', previousBalance: balanceBefore }
      })

    if (txError) {
      console.warn('[admin/wallet/adjust] Failed to log transaction:', txError)
    }

    // Log the action
    logWalletAction({
      userId,
      action: 'adjust',
      currency,
      amount: difference,
      reason,
      balanceBefore,
      balanceAfter: newBalance,
      adminId: adminId!,
      metadata: { adjustmentType: difference > 0 ? 'increase' : 'decrease' }
    })

    return res.json({
      ok: true,
      wallet: updated,
      transaction: {
        type: 'adjust',
        currency,
        balanceBefore,
        balanceAfter: newBalance,
        difference,
        reason
      }
    })
  } catch (error: any) {
    console.error('[admin/wallet/adjust] Error:', error)
    logWalletError(error, {
      userId: req.body.userId,
      action: 'adjust',
      currency: req.body.currency,
      adminId: req.user?.sub!
    })
    return res.status(500).json({ error: error.message })
  }
})

export default router

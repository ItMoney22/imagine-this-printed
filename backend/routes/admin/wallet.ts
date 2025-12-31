import { Router, Request, Response } from 'express'
import { requireAuth } from '../../middleware/supabaseAuth.js'
import { requireAdmin } from '../../middleware/requireAdmin.js'
import { supabase } from '../../lib/supabase.js'
import { logWalletAction, logWalletError } from '../../utils/wallet-logger.js'

const router = Router()

// Apply authentication and admin authorization to all routes
router.use(requireAuth)
router.use(requireAdmin)

// GET /api/admin/wallet/users - List all user wallets with ITC balances
router.get('/users', async (req: Request, res: Response): Promise<any> => {
  try {
    const adminId = req.user?.sub
    const { search, limit = 50, offset = 0 } = req.query

    logWalletAction({
      userId: 'system',
      action: 'list',
      currency: 'itc',
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
      logWalletError({
        error: error.message,
        userId: 'system',
        action: 'list',
        currency: 'itc',
        metadata: { adminId: adminId! }
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
    logWalletError({
      error: error.message || String(error),
      userId: 'system',
      action: 'list',
      currency: 'itc',
      metadata: { adminId: req.user?.sub! }
    })
    return res.status(500).json({ error: error.message })
  }
})

// GET /api/admin/wallet/transactions - Get all ITC transactions (admin view)
router.get('/transactions', async (req: Request, res: Response): Promise<any> => {
  try {
    const adminId = req.user?.sub
    const { userId, limit = 100, offset = 0, type } = req.query

    logWalletAction({
      userId: userId as string || 'all',
      action: 'view',
      currency: 'itc',
      adminId: adminId!,
      metadata: { limit, offset, type }
    })

    // Query ITC transactions directly
    let query = supabase
      .from('itc_transactions')
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

// POST /api/admin/wallet/credit - Credit ITC to user
router.post('/credit', async (req: Request, res: Response): Promise<any> => {
  try {
    const adminId = req.user?.sub
    const { userId, amount, reason } = req.body

    // Validation
    if (!userId || !amount || !reason) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['userId', 'amount', 'reason']
      })
    }

    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' })
    }

    if (reason.length < 10) {
      return res.status(400).json({ error: 'Reason must be at least 10 characters' })
    }

    // Fetch current wallet - auto-create if it doesn't exist
    let { data: wallet, error: fetchError } = await supabase
      .from('user_wallets')
      .select('*')
      .eq('user_id', userId)
      .single()

    // If wallet doesn't exist, create it
    if (fetchError?.code === 'PGRST116' || !wallet) {
      console.log('[admin/wallet/credit] Wallet not found, creating one for user:', userId)

      // First verify user exists
      const { data: userProfile, error: userError } = await supabase
        .from('user_profiles')
        .select('id, email')
        .eq('id', userId)
        .single()

      if (userError || !userProfile) {
        console.error('[admin/wallet/credit] User not found:', userError)
        return res.status(404).json({ error: 'User not found' })
      }

      // Create wallet
      const { data: newWallet, error: createError } = await supabase
        .from('user_wallets')
        .insert({
          user_id: userId,
          points_balance: 0,
          itc_balance: 0,
          lifetime_points_earned: 0,
          lifetime_itc_earned: 0,
          wallet_status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single()

      if (createError) {
        console.error('[admin/wallet/credit] Failed to create wallet:', createError)
        return res.status(500).json({ error: 'Failed to create user wallet' })
      }

      wallet = newWallet
      console.log('[admin/wallet/credit] ✅ Wallet created for user:', userId)
    } else if (fetchError) {
      console.error('[admin/wallet/credit] Wallet fetch error:', fetchError)
      return res.status(500).json({ error: 'Failed to fetch wallet' })
    }

    const balanceBefore = wallet.itc_balance
    const balanceAfter = balanceBefore + amount

    // Update wallet (ITC only)
    const { data: updated, error: updateError } = await supabase
      .from('user_wallets')
      .update({
        itc_balance: balanceAfter,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .select()
      .single()

    if (updateError) {
      console.error('[admin/wallet/credit] Error updating wallet:', updateError)
      logWalletError({
        error: updateError.message,
        userId,
        action: 'credit',
        currency: 'itc',
        metadata: {
          amount,
          adminId: adminId!
        }
      })
      return res.status(500).json({ error: 'Failed to credit wallet' })
    }

    // Create ITC transaction record
    const { error: txError } = await supabase
      .from('itc_transactions')
      .insert({
        user_id: userId,
        type: 'admin_credit',
        amount,
        balance_after: balanceAfter,
        description: reason,
        metadata: { adminId, adminAction: 'credit', balanceBefore }
      })

    if (txError) {
      console.warn('[admin/wallet/credit] Failed to log transaction:', txError)
    }

    // Log the action
    logWalletAction({
      userId,
      action: 'credit',
      currency: 'itc',
      amount,
      adminId: adminId!,
      metadata: {
        reason,
        balanceBefore,
        balanceAfter
      }
    })

    return res.json({
      ok: true,
      wallet: updated,
      transaction: {
        type: 'credit',
        currency: 'itc',
        amount,
        balanceBefore,
        balanceAfter,
        reason
      }
    })
  } catch (error: any) {
    console.error('[admin/wallet/credit] Error:', error)
    logWalletError({
      error: error.message || String(error),
      userId: req.body.userId,
      action: 'credit',
      currency: 'itc',
      metadata: {
        amount: req.body.amount,
        adminId: req.user?.sub!
      }
    })
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/wallet/debit - Debit ITC from user
router.post('/debit', async (req: Request, res: Response): Promise<any> => {
  try {
    const adminId = req.user?.sub
    const { userId, amount, reason, allowNegative = false } = req.body

    // Validation
    if (!userId || !amount || !reason) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['userId', 'amount', 'reason']
      })
    }

    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0' })
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

    const balanceBefore = wallet.itc_balance
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

    // Update wallet (ITC only)
    const { data: updated, error: updateError } = await supabase
      .from('user_wallets')
      .update({
        itc_balance: balanceAfter,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .select()
      .single()

    if (updateError) {
      console.error('[admin/wallet/debit] Error updating wallet:', updateError)
      logWalletError({
        error: updateError.message,
        userId,
        action: 'debit',
        currency: 'itc',
        metadata: {
          amount,
          adminId: adminId!
        }
      })
      return res.status(500).json({ error: 'Failed to debit wallet' })
    }

    // Create ITC transaction record
    const { error: txError } = await supabase
      .from('itc_transactions')
      .insert({
        user_id: userId,
        type: 'admin_debit',
        amount: -amount,
        balance_after: balanceAfter,
        description: reason,
        metadata: { adminId, adminAction: 'debit', allowNegative, balanceBefore }
      })

    if (txError) {
      console.warn('[admin/wallet/debit] Failed to log transaction:', txError)
    }

    // Log the action
    logWalletAction({
      userId,
      action: 'debit',
      currency: 'itc',
      amount,
      adminId: adminId!,
      metadata: {
        reason,
        balanceBefore,
        balanceAfter
      }
    })

    return res.json({
      ok: true,
      wallet: updated,
      transaction: {
        type: 'debit',
        currency: 'itc',
        amount,
        balanceBefore,
        balanceAfter,
        reason
      }
    })
  } catch (error: any) {
    console.error('[admin/wallet/debit] Error:', error)
    logWalletError({
      error: error.message || String(error),
      userId: req.body.userId,
      action: 'debit',
      currency: 'itc',
      metadata: {
        amount: req.body.amount,
        adminId: req.user?.sub!
      }
    })
    return res.status(500).json({ error: error.message })
  }
})

// POST /api/admin/wallet/adjust - Adjust ITC balance with reason
router.post('/adjust', async (req: Request, res: Response): Promise<any> => {
  try {
    const adminId = req.user?.sub
    const { userId, newBalance, reason } = req.body

    // Validation
    if (!userId || newBalance === undefined || !reason) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['userId', 'newBalance', 'reason']
      })
    }

    if (newBalance < 0) {
      return res.status(400).json({ error: 'New balance cannot be negative' })
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

    const balanceBefore = wallet.itc_balance
    const difference = newBalance - balanceBefore

    // Update wallet (ITC only)
    const { data: updated, error: updateError } = await supabase
      .from('user_wallets')
      .update({
        itc_balance: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .select()
      .single()

    if (updateError) {
      console.error('[admin/wallet/adjust] Error updating wallet:', updateError)
      logWalletError({
        error: updateError.message,
        userId,
        action: 'adjust',
        currency: 'itc',
        metadata: {
          amount: difference,
          adminId: adminId!
        }
      })
      return res.status(500).json({ error: 'Failed to adjust wallet' })
    }

    // Create ITC transaction record
    const { error: txError } = await supabase
      .from('itc_transactions')
      .insert({
        user_id: userId,
        type: 'admin_adjust',
        amount: difference,
        balance_after: newBalance,
        description: reason,
        metadata: { adminId, adminAction: 'adjust', balanceBefore }
      })

    if (txError) {
      console.warn('[admin/wallet/adjust] Failed to log transaction:', txError)
    }

    // Log the action
    logWalletAction({
      userId,
      action: 'adjust',
      currency: 'itc',
      amount: difference,
      adminId: adminId!,
      metadata: {
        reason,
        balanceBefore,
        balanceAfter: newBalance,
        adjustmentType: difference > 0 ? 'increase' : 'decrease'
      }
    })

    return res.json({
      ok: true,
      wallet: updated,
      transaction: {
        type: 'adjust',
        currency: 'itc',
        balanceBefore,
        balanceAfter: newBalance,
        difference,
        reason
      }
    })
  } catch (error: any) {
    console.error('[admin/wallet/adjust] Error:', error)
    logWalletError({
      error: error.message || String(error),
      userId: req.body.userId,
      action: 'adjust',
      currency: 'itc',
      metadata: { adminId: req.user?.sub! }
    })
    return res.status(500).json({ error: error.message })
  }
})

export default router

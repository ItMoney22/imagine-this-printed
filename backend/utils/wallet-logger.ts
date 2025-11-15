import { supabase } from '../lib/supabase.js'

export type TransactionType = 'credit' | 'debit'

export interface LogWalletActionParams {
  userId: string
  action: string
  currency: 'points' | 'itc'
  amount?: number
  adminId?: string
  metadata?: Record<string, any>
}

export interface LogWalletErrorParams {
  userId: string
  error: string
  action: string
  currency: 'points' | 'itc'
  metadata?: Record<string, any>
}

export interface LogItcTransactionParams {
  userId: string
  amount: number
  type: TransactionType
  balanceBefore: number
  balanceAfter: number
  description: string
  metadata?: Record<string, any>
  relatedEntityType?: string
  relatedEntityId?: string
}

export interface LogPointsTransactionParams {
  userId: string
  amount: number
  type: TransactionType
  balanceBefore: number
  balanceAfter: number
  description: string
  metadata?: Record<string, any>
  relatedEntityType?: string
  relatedEntityId?: string
}

/**
 * Log an ITC transaction to the itc_transactions table
 * This ensures complete audit trail for all ITC wallet operations
 */
export async function logItcTransaction(params: LogItcTransactionParams) {
  try {
    const {
      userId,
      amount,
      type,
      balanceBefore,
      balanceAfter,
      description,
      metadata = {},
      relatedEntityType,
      relatedEntityId
    } = params

    console.log('[wallet-logger] =� Logging ITC transaction:', {
      userId,
      amount,
      type,
      description
    })

    const { data, error } = await supabase
      .from('itc_transactions')
      .insert({
        user_id: userId,
        amount,
        transaction_type: type,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        description,
        metadata,
        related_entity_type: relatedEntityType,
        related_entity_id: relatedEntityId,
        created_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      console.error('[wallet-logger] L Failed to log ITC transaction:', error)
      throw error
    }

    console.log('[wallet-logger]  ITC transaction logged:', data.id)
    return data
  } catch (error: any) {
    console.error('[wallet-logger] L Error logging ITC transaction:', error)
    // Don't throw - we don't want transaction logging failures to break the main operation
    // But log it for monitoring
    return null
  }
}

/**
 * Log a points transaction to the points_transactions table
 * This ensures complete audit trail for all points wallet operations
 */
export async function logPointsTransaction(params: LogPointsTransactionParams) {
  try {
    const {
      userId,
      amount,
      type,
      balanceBefore,
      balanceAfter,
      description,
      metadata = {},
      relatedEntityType,
      relatedEntityId
    } = params

    console.log('[wallet-logger] =� Logging points transaction:', {
      userId,
      amount,
      type,
      description
    })

    const { data, error } = await supabase
      .from('points_transactions')
      .insert({
        user_id: userId,
        amount,
        transaction_type: type,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        description,
        metadata,
        related_entity_type: relatedEntityType,
        related_entity_id: relatedEntityId,
        created_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      console.error('[wallet-logger] L Failed to log points transaction:', error)
      throw error
    }

    console.log('[wallet-logger]  Points transaction logged:', data.id)
    return data
  } catch (error: any) {
    console.error('[wallet-logger] L Error logging points transaction:', error)
    // Don't throw - we don't want transaction logging failures to break the main operation
    return null
  }
}

/**
 * Get ITC transaction history for a user
 * Supports pagination and filtering
 */
export async function getItcTransactionHistory(
  userId: string,
  options: {
    limit?: number
    offset?: number
    type?: TransactionType
    startDate?: string
    endDate?: string
  } = {}
) {
  const {
    limit = 50,
    offset = 0,
    type,
    startDate,
    endDate
  } = options

  try {
    let query = supabase
      .from('itc_transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (type) {
      query = query.eq('transaction_type', type)
    }

    if (startDate) {
      query = query.gte('created_at', startDate)
    }

    if (endDate) {
      query = query.lte('created_at', endDate)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('[wallet-logger] L Failed to fetch ITC transaction history:', error)
      throw error
    }

    return {
      transactions: data || [],
      total: count || 0
    }
  } catch (error: any) {
    console.error('[wallet-logger] L Error fetching ITC transaction history:', error)
    throw error
  }
}

/**
 * Get points transaction history for a user
 * Supports pagination and filtering
 */
export async function getPointsTransactionHistory(
  userId: string,
  options: {
    limit?: number
    offset?: number
    type?: TransactionType
    startDate?: string
    endDate?: string
  } = {}
) {
  const {
    limit = 50,
    offset = 0,
    type,
    startDate,
    endDate
  } = options

  try {
    let query = supabase
      .from('points_transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (type) {
      query = query.eq('transaction_type', type)
    }

    if (startDate) {
      query = query.gte('created_at', startDate)
    }

    if (endDate) {
      query = query.lte('created_at', endDate)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('[wallet-logger] L Failed to fetch points transaction history:', error)
      throw error
    }

    return {
      transactions: data || [],
      total: count || 0
    }
  } catch (error: any) {
    console.error('[wallet-logger] L Error fetching points transaction history:', error)
    throw error
  }
}


/**
 * Log wallet action (for admin operations)
 * Used by admin endpoints to track wallet management actions
 */
export async function logWalletAction(params: LogWalletActionParams) {
  try {
    const { userId, action, currency, amount, adminId, metadata = {} } = params
    console.log('[wallet-logger] 📝 Logging wallet action:', { userId, action, currency, adminId })

    // Log to audit_logs table if it exists
    const { error } = await supabase.from('audit_logs').insert({
      user_id: adminId || userId,
      action: `wallet_${action}`,
      entity_type: 'wallet',
      entity_id: userId,
      metadata: { ...metadata, currency, amount, targetUserId: userId },
      created_at: new Date().toISOString()
    })

    if (error) {
      console.error('[wallet-logger] ⚠️ Failed to log wallet action to audit_logs:', error)
    }

    return true
  } catch (error: any) {
    console.error('[wallet-logger] ❌ Error logging wallet action:', error)
    return false
  }
}

/**
 * Log wallet error (for admin operations)
 * Used by admin endpoints to track wallet management errors
 */
export async function logWalletError(params: LogWalletErrorParams) {
  try {
    const { userId, error, action, currency, metadata = {} } = params
    console.error('[wallet-logger] ❌ Logging wallet error:', { userId, error, action, currency })

    // Log to audit_logs table if it exists
    const { error: logError } = await supabase.from('audit_logs').insert({
      user_id: userId,
      action: `wallet_${action}_error`,
      entity_type: 'wallet',
      entity_id: userId,
      metadata: { ...metadata, error, currency },
      created_at: new Date().toISOString()
    })

    if (logError) {
      console.error('[wallet-logger] ⚠️ Failed to log wallet error to audit_logs:', logError)
    }

    return true
  } catch (err: any) {
    console.error('[wallet-logger] ❌ Error logging wallet error:', err)
    return false
  }
}

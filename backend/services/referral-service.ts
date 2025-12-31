/**
 * Referral Service
 *
 * Handles referral code generation, validation, and reward processing
 */

import { supabase } from '../lib/supabase.js'
import { calculateReferralRewards } from '../utils/reward-calculator.js'

export interface ReferralCodeData {
  userId: string
  code?: string
  description?: string
  maxUses?: number
  expiresAt?: Date
}

export interface ReferralValidation {
  valid: boolean
  code?: any
  error?: string
}

/**
 * Generate a unique referral code
 */
export function generateReferralCode(username?: string): string {
  const prefix = username ? username.slice(0, 4).toUpperCase() : 'REF'
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `${prefix}${random}`
}

/**
 * Create a new referral code for a user
 */
export async function createReferralCode(data: ReferralCodeData) {
  try {
    const code = data.code || generateReferralCode()

    // Check if code already exists
    const { data: existing } = await supabase
      .from('referral_codes')
      .select('id')
      .eq('code', code)
      .single()

    if (existing) {
      throw new Error('Referral code already exists')
    }

    // Create the code
    const { data: newCode, error } = await supabase
      .from('referral_codes')
      .insert({
        user_id: data.userId,
        code,
        description: data.description || 'Personal referral code',
        max_uses: data.maxUses || null,
        expires_at: data.expiresAt || null,
        is_active: true
      })
      .select()
      .single()

    if (error) throw error

    console.log(`[ReferralService] Created referral code ${code} for user ${data.userId}`)

    return {
      success: true,
      code: newCode
    }
  } catch (error: any) {
    console.error('[ReferralService] Error creating referral code:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

/**
 * Validate a referral code
 */
export async function validateReferralCode(code: string): Promise<ReferralValidation> {
  try {
    const { data, error } = await supabase
      .from('referral_codes')
      .select('*')
      .eq('code', code.toUpperCase())
      .single()

    if (error || !data) {
      return {
        valid: false,
        error: 'Referral code not found'
      }
    }

    // Check if active
    if (!data.is_active) {
      return {
        valid: false,
        error: 'Referral code is inactive'
      }
    }

    // Check if expired
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return {
        valid: false,
        error: 'Referral code has expired'
      }
    }

    // Check if max uses reached
    if (data.max_uses && data.total_uses >= data.max_uses) {
      return {
        valid: false,
        error: 'Referral code has reached maximum uses'
      }
    }

    return {
      valid: true,
      code: data
    }
  } catch (error: any) {
    console.error('[ReferralService] Error validating referral code:', error)
    return {
      valid: false,
      error: error.message
    }
  }
}

/**
 * Process referral signup reward
 */
export async function processReferralSignup(
  referralCode: string,
  newUserId: string,
  newUserEmail: string
) {
  try {
    console.log(`[ReferralService] Processing signup referral for ${newUserEmail} with code ${referralCode}`)

    // Validate the code
    const validation = await validateReferralCode(referralCode)
    if (!validation.valid || !validation.code) {
      throw new Error(validation.error || 'Invalid referral code')
    }

    // Prevent self-referral
    if (validation.code.user_id === newUserId) {
      throw new Error('Cannot use your own referral code')
    }

    // Check if user already used a referral code
    const { data: existingReferral } = await supabase
      .from('referral_transactions')
      .select('id')
      .eq('referee_id', newUserId)
      .single()

    if (existingReferral) {
      throw new Error('User has already used a referral code')
    }

    // Call the database function to process the reward
    const { data: result, error } = await supabase.rpc('process_referral_reward', {
      p_referral_code: referralCode.toUpperCase(),
      p_referee_id: newUserId,
      p_referee_email: newUserEmail,
      p_reward_type: 'signup'
    })

    if (error) throw error

    if (!result || !result.success) {
      throw new Error(result?.error || 'Failed to process referral reward')
    }

    console.log(`[ReferralService] Referral signup processed successfully:`, result)

    // Update user profile with referral info
    await supabase
      .from('user_profiles')
      .update({
        referred_by: validation.code.user_id
      })
      .eq('user_id', newUserId)

    return {
      success: true,
      transactionId: result.transaction_id,
      referrerRewards: result.referrer_rewards,
      refereeRewards: result.referee_rewards
    }
  } catch (error: any) {
    console.error('[ReferralService] Error processing referral signup:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

/**
 * Process first purchase referral bonus
 */
export async function processReferralFirstPurchase(
  userId: string,
  orderTotal: number
) {
  try {
    // Check if user was referred
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('referred_by')
      .eq('user_id', userId)
      .single()

    if (!profile || !profile.referred_by) {
      return { success: false, message: 'User was not referred' }
    }

    // Check if first purchase bonus already given
    const { data: existingBonus } = await supabase
      .from('referral_transactions')
      .select('id')
      .eq('referee_id', userId)
      .eq('type', 'purchase')
      .single()

    if (existingBonus) {
      return { success: false, message: 'First purchase bonus already awarded' }
    }

    // Get referral code
    const { data: referralCode } = await supabase
      .from('referral_codes')
      .select('id, code')
      .eq('user_id', profile.referred_by)
      .eq('is_active', true)
      .single()

    if (!referralCode) {
      return { success: false, message: 'Referral code not found' }
    }

    // Flat 50 ITC bonus for referrer when referred user makes first purchase
    const bonusITC = 50

    // Create referral transaction
    const { data: transaction, error: txError } = await supabase
      .from('referral_transactions')
      .insert({
        referral_code_id: referralCode.id,
        referrer_id: profile.referred_by,
        referee_id: userId,
        referee_email: '', // We don't need email for purchase bonus
        type: 'purchase',
        referrer_reward_points: 0,
        referrer_reward_itc: bonusITC,
        referee_reward_points: 0,
        referee_reward_itc: 0,
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .select()
      .single()

    if (txError) throw txError

    // Award ITC to referrer's wallet
    const { data: wallet } = await supabase
      .from('user_wallets')
      .select('itc_balance')
      .eq('user_id', profile.referred_by)
      .single()

    const newBalance = (wallet?.itc_balance || 0) + bonusITC

    await supabase.from('itc_transactions').insert({
      user_id: profile.referred_by,
      type: 'earned',
      amount: bonusITC,
      balance_after: newBalance,
      reason: 'Referral first purchase bonus',
      related_entity_type: 'referral',
      related_entity_id: transaction.id
    })

    await supabase
      .from('user_wallets')
      .update({
        itc_balance: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', profile.referred_by)

    console.log(`[ReferralService] First purchase bonus awarded: ${bonusITC} ITC to ${profile.referred_by}`)

    return {
      success: true,
      bonusITC,
      referrerId: profile.referred_by
    }
  } catch (error: any) {
    console.error('[ReferralService] Error processing first purchase bonus:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

/**
 * Get referral statistics for a user
 */
export async function getReferralStats(userId: string) {
  try {
    // Get user's referral codes
    const { data: codes } = await supabase
      .from('referral_codes')
      .select('*')
      .eq('user_id', userId)

    // Get referral transactions
    const { data: transactions } = await supabase
      .from('referral_transactions')
      .select('*')
      .eq('referrer_id', userId)
      .eq('status', 'completed')

    // Calculate totals
    const totalReferrals = transactions?.length || 0
    const totalPointsEarned = transactions?.reduce((sum, t) => sum + (t.referrer_reward_points || 0), 0) || 0
    const totalITCEarned = transactions?.reduce((sum, t) => sum + (t.referrer_reward_itc || 0), 0) || 0

    // Get active code
    const activeCode = codes?.find(c => c.is_active)

    return {
      success: true,
      stats: {
        totalReferrals,
        totalPointsEarned,
        totalITCEarned,
        activeCodes: codes?.filter(c => c.is_active).length || 0,
        activeCode: activeCode?.code || null,
        recentReferrals: transactions?.slice(0, 10) || []
      }
    }
  } catch (error: any) {
    console.error('[ReferralService] Error fetching referral stats:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

/**
 * Get leaderboard of top referrers
 */
export async function getReferralLeaderboard(limit: number = 10) {
  try {
    const { data, error } = await supabase
      .from('referral_codes')
      .select(`
        user_id,
        total_uses,
        total_earnings,
        user_profiles!inner(username, display_name)
      `)
      .eq('is_active', true)
      .order('total_uses', { ascending: false })
      .limit(limit)

    if (error) throw error

    return {
      success: true,
      leaderboard: data || []
    }
  } catch (error: any) {
    console.error('[ReferralService] Error fetching leaderboard:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

/**
 * Deactivate a referral code
 */
export async function deactivateReferralCode(codeId: string, userId: string) {
  try {
    const { error } = await supabase
      .from('referral_codes')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', codeId)
      .eq('user_id', userId)

    if (error) throw error

    return {
      success: true,
      message: 'Referral code deactivated'
    }
  } catch (error: any) {
    console.error('[ReferralService] Error deactivating code:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

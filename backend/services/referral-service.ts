/**
 * Referral Service
 *
 * Handles referral code generation, validation, and reward processing
 */

import { supabase } from '../lib/supabase.js'
import { calculateReferralRewards } from '../utils/reward-calculator.js'
import { EVER_PAID_STATUSES } from './order-refunds.js'

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
 * Create a new referral code for a user. A user holds at most one active code
 * (idx_referral_codes_one_active_per_user): when two requests race (the
 * dashboard's first load can fire twice), the loser returns the winner's code.
 */
export async function createReferralCode(data: ReferralCodeData) {
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = (attempt === 0 && data.code) || generateReferralCode()

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

      if (!error) {
        console.log(`[ReferralService] Created referral code ${code} for user ${data.userId}`)
        return { success: true, code: newCode }
      }

      if (error.code !== '23505') throw error

      // Unique violation: either this user already has an active code (a
      // concurrent create won) or the random code collided with someone's.
      const { data: active } = await supabase
        .from('referral_codes')
        .select('*')
        .eq('user_id', data.userId)
        .eq('is_active', true)
        .maybeSingle()
      if (active) return { success: true, code: active }
      if (data.code) throw new Error('Referral code already exists')
    }
    throw new Error('Could not pick a free referral code')
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
 * How new an account must be to join through a referral link. The link is
 * applied at the account's first sign-in (src/utils/referral-capture.ts), so a
 * real referred sign-up is minutes old; an older account is an existing
 * customer, not a referral.
 */
export const REFERRAL_NEW_ACCOUNT_DAYS = 7

export type ReferralSignupRefusal =
  | 'invalid_code'
  | 'own_code'
  | 'already_referred'
  | 'not_new_account'
  | 'bad_type'

export interface ReferralSignupResult {
  success: boolean
  /** The same link was already recorded for this account: a no-op. */
  already?: boolean
  transactionId?: string
  referrerId?: string
  referrerRewards?: { points: number; itc: number }
  refereeRewards?: { points: number; itc: number }
  /** Set on a refusal the client should treat as final (it clears the stored link). */
  reason?: ReferralSignupRefusal
  error?: string
}

/**
 * Pure: is this account new enough, and has it never paid for an order?
 * Returns the refusal, or null when the account may join through a referral.
 */
export function newAccountRefusal(
  accountCreatedAt: string | null | undefined,
  everPaidOrderCount: number,
  now: number = Date.now()
): 'not_new_account' | null {
  if (everPaidOrderCount > 0) return 'not_new_account'
  const created = accountCreatedAt ? Date.parse(accountCreatedAt) : NaN
  if (Number.isNaN(created)) return 'not_new_account'
  return now - created > REFERRAL_NEW_ACCOUNT_DAYS * 24 * 60 * 60 * 1000 ? 'not_new_account' : null
}

/**
 * Record that a new account joined through a referral link.
 *
 * Sign-up pays nothing (task bdfa6939, 2026-10-07: bot sign-ups could farm
 * it). process_referral_reward() writes the 'signup' referral_transactions row,
 * user_profiles.referred_by and referral_codes.total_uses in one transaction,
 * and refuses a second link for the same account. The referrer is paid later,
 * by processReferralFirstPurchase(), when this account's first order is paid.
 */
export async function processReferralSignup(
  referralCode: string,
  newUserId: string,
  newUserEmail: string
): Promise<ReferralSignupResult> {
  try {
    const code = String(referralCode || '').trim().toUpperCase()
    console.log(`[ReferralService] Recording signup referral for ${newUserId} with code ${code}`)

    // A new customer only: account age off auth.users (user_profiles.created_at
    // is a timestamp without time zone), paid orders off the payment truth.
    const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(newUserId)
    if (authErr || !authUser?.user) {
      throw new Error(authErr?.message || 'Account not found')
    }
    const { data: orders, error: ordersErr } = await supabase
      .from('orders')
      .select('id, payment_status')
      .eq('user_id', newUserId)
    if (ordersErr) throw ordersErr
    const everPaid = (orders || []).filter((o: { payment_status?: string | null }) =>
      EVER_PAID_STATUSES.has(String(o.payment_status))
    ).length
    const refusal = newAccountRefusal(authUser.user.created_at, everPaid)
    if (refusal) {
      return { success: false, reason: refusal, error: 'Referral links are for new accounts only' }
    }

    const { data: result, error } = await supabase.rpc('process_referral_reward', {
      p_referral_code: code,
      p_referee_id: newUserId,
      p_referee_email: newUserEmail || '',
      p_reward_type: 'signup'
    })

    if (error) throw error

    if (!result || !result.success) {
      return {
        success: false,
        reason: result?.reason,
        error: result?.error || 'Failed to record referral'
      }
    }

    console.log(`[ReferralService] Referral signup recorded:`, result)

    return {
      success: true,
      already: !!result.already,
      transactionId: result.transaction_id,
      referrerId: result.referrer_id,
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
 * Pay the referrer's first-order bonus (50 ITC, set in the
 * award_referral_first_order() database function) when a referred account's
 * first order is paid. Lifetime-once per referred account; the bonus row, the
 * wallet credit and the ledger row commit together. Safe to call on every paid
 * order: anything after the first is a no-op.
 */
export async function processReferralFirstPurchase(
  userId: string,
  orderTotal: number,
  orderId?: string | null
) {
  try {
    const { data: result, error } = await supabase.rpc('award_referral_first_order', {
      p_referee_id: userId,
      p_order_id: orderId || null
    })

    if (error) throw error

    if (!result || !result.success) {
      return { success: false, message: result?.message || 'No referral bonus' }
    }

    console.log(`[ReferralService] First purchase bonus awarded: ${result.bonus_itc} ITC to ${result.referrer_id} (order total ${orderTotal})`)

    return {
      success: true,
      bonusITC: Number(result.bonus_itc),
      referrerId: result.referrer_id as string,
      transactionId: result.transaction_id as string
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

    // Get referral transactions, newest first
    const { data: transactions } = await supabase
      .from('referral_transactions')
      .select('*')
      .eq('referrer_id', userId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })

    // One 'signup' row per friend who joined; a 'purchase' row when that
    // friend's first order paid. NUMERIC columns arrive as strings, so every
    // sum goes through Number() (a bare + concatenated "0" + "50").
    const rows = transactions || []
    const totalReferrals = rows.filter(t => t.type === 'signup').length
    const firstOrders = rows.filter(t => t.type === 'purchase').length
    const totalPointsEarned = rows.reduce((sum, t) => sum + Number(t.referrer_reward_points || 0), 0)
    const totalITCEarned = rows.reduce((sum, t) => sum + Number(t.referrer_reward_itc || 0), 0)

    // Get active code
    const activeCode = codes?.find(c => c.is_active)

    return {
      success: true,
      stats: {
        totalReferrals,
        firstOrders,
        totalPointsEarned,
        totalITCEarned,
        activeCodes: codes?.filter(c => c.is_active).length || 0,
        activeCode: activeCode?.code || null,
        referralCode: activeCode || null,
        recentReferrals: rows.slice(0, 50)
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
 * Get platform-wide referral statistics (admin dashboard). Backs
 * GET /api/wallet/admin/referral-stats, called from
 * src/utils/referral-system.ts getPlatformReferralStats(), which previously
 * had no backend endpoint and returned a hardcoded all-zeros stub.
 *
 * Data source decision (no existing spec to follow): totalReferrals counts
 * completed 'signup'-type referral_transactions (i.e. codes that were
 * actually used, not just created); totalEarnings sums referrer_reward_itc
 * across every completed transaction (signup + first-purchase bonuses);
 * conversionRate is completed 'purchase' transactions over completed
 * 'signup' transactions (what fraction of referred signups went on to make
 * their first purchase); topPerformers ranks referrers by total ITC earned.
 */
export async function getPlatformReferralStats(): Promise<{
  success: boolean
  stats?: {
    totalReferrals: number
    totalEarnings: number
    conversionRate: number
    topPerformers: Array<{ userId: string; name: string; referralCount: number; earnings: number }>
  }
  error?: string
}> {
  try {
    const { data: transactions, error } = await supabase
      .from('referral_transactions')
      .select('referrer_id, type, referrer_reward_itc, status')
      .eq('status', 'completed')

    if (error) throw error

    const rows = transactions || []
    const signups = rows.filter(t => t.type === 'signup')
    const purchases = rows.filter(t => t.type === 'purchase')

    const totalReferrals = signups.length
    const totalEarnings = rows.reduce((sum, t) => sum + Number(t.referrer_reward_itc || 0), 0)
    const conversionRate = totalReferrals > 0 ? purchases.length / totalReferrals : 0

    // Aggregate per referrer for the leaderboard
    const byReferrer = new Map<string, { referralCount: number; earnings: number }>()
    for (const t of rows) {
      const entry = byReferrer.get(t.referrer_id) || { referralCount: 0, earnings: 0 }
      entry.referralCount += 1
      entry.earnings += Number(t.referrer_reward_itc || 0)
      byReferrer.set(t.referrer_id, entry)
    }

    const referrerIds = Array.from(byReferrer.keys())
    let names: Record<string, string> = {}
    if (referrerIds.length > 0) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, email, first_name, last_name')
        .in('id', referrerIds)

      for (const p of profiles || []) {
        names[p.id] = [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || 'Unknown'
      }
    }

    const topPerformers = referrerIds
      .map(userId => ({
        userId,
        name: names[userId] || 'Unknown',
        referralCount: byReferrer.get(userId)!.referralCount,
        earnings: byReferrer.get(userId)!.earnings
      }))
      .sort((a, b) => b.earnings - a.earnings)
      .slice(0, 10)

    return {
      success: true,
      stats: { totalReferrals, totalEarnings, conversionRate, topPerformers }
    }
  } catch (error: any) {
    console.error('[ReferralService] Error fetching platform referral stats:', error)
    return { success: false, error: error.message }
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

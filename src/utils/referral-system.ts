import type { ReferralCode, ReferralTransaction } from '../types'
import { apiFetch } from '../lib/api'
import { REFERRAL_REWARDS } from '../lib/referral-program'

// The referral dashboard's client. Capturing a friend's ?ref= link and
// applying it at first sign-in live in ./referral-capture.ts.

export interface ReferralStats {
  totalReferrals: number
  totalEarnings: number
  conversionRate: number
  topPerformers: Array<{
    userId: string
    name: string
    referralCount: number
    earnings: number
  }>
}

export interface UserReferralStats {
  referralCode: ReferralCode | null
  transactions: ReferralTransaction[]
  /** Friends who joined through the link. */
  totalReferrals: number
  /** Of those, friends whose first order was paid. */
  firstOrders: number
  /** ITC the referrer has been paid. */
  totalItcEarned: number
}

const EMPTY_STATS: UserReferralStats = {
  referralCode: null,
  transactions: [],
  totalReferrals: 0,
  firstOrders: 0,
  totalItcEarned: 0
}

// Rows as the wallet API returns them (snake_case; NUMERIC columns as strings).
interface ReferralCodeRow {
  id: string
  user_id: string
  code: string
  is_active?: boolean | null
  created_at: string
  total_uses?: number | string | null
  total_earnings?: number | string | null
  description?: string | null
}

interface ReferralTransactionRow {
  id: string
  referral_code_id: string
  referrer_id: string
  referee_id: string
  referee_email?: string | null
  type: string
  referrer_reward_itc?: number | string | null
  referee_reward_itc?: number | string | null
  status: ReferralTransaction['status']
  created_at: string
  completed_at?: string | null
}

interface ReferralStatsPayload {
  referralCode?: ReferralCodeRow | null
  recentReferrals?: ReferralTransactionRow[]
  totalReferrals?: number
  firstOrders?: number
  totalITCEarned?: number | string
  activeCode?: string | null
}

/** Pure: a referral_codes row from the API as the app's ReferralCode. */
export function toReferralCode(row: ReferralCodeRow | null | undefined): ReferralCode | null {
  if (!row?.code) return null
  return {
    id: row.id,
    userId: row.user_id,
    code: row.code,
    isActive: row.is_active !== false,
    createdAt: row.created_at,
    totalUses: Number(row.total_uses || 0),
    totalEarnings: Number(row.total_earnings || 0),
    description: row.description || ''
  }
}

/** Pure: a referral_transactions row from the API as the app's ReferralTransaction. */
export function toReferralTransaction(row: ReferralTransactionRow): ReferralTransaction {
  return {
    id: row.id,
    referralCodeId: row.referral_code_id,
    referrerId: row.referrer_id,
    refereeId: row.referee_id,
    refereeEmail: row.referee_email || '',
    type: row.type === 'purchase' ? 'purchase' : 'signup',
    // NUMERIC columns arrive as strings.
    referrerReward: Number(row.referrer_reward_itc || 0),
    refereeReward: Number(row.referee_reward_itc || 0),
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at || undefined
  }
}

/** Pure: the API's /referral/stats payload as the dashboard reads it. */
export function toUserReferralStats(stats: ReferralStatsPayload | null | undefined): UserReferralStats {
  if (!stats) return EMPTY_STATS
  return {
    referralCode: toReferralCode(stats.referralCode),
    transactions: Array.isArray(stats.recentReferrals) ? stats.recentReferrals.map(toReferralTransaction) : [],
    totalReferrals: Number(stats.totalReferrals || 0),
    firstOrders: Number(stats.firstOrders || 0),
    totalItcEarned: Number(stats.totalITCEarned || 0)
  }
}

export class ReferralSystem {
  private baseUrl: string

  constructor() {
    this.baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://imaginethisprinted.com'
  }

  // Get this account's referral code, creating it (server side) on first use.
  async createReferralCode(userName: string): Promise<ReferralCode | null> {
    try {
      const result = await apiFetch('/api/wallet/referral/create', {
        method: 'POST',
        body: JSON.stringify({ description: `${userName}'s referral code` })
      })
      return toReferralCode(result?.code)
    } catch (error) {
      console.error('Error creating referral code:', error)
      return null
    }
  }

  // Generate referral URL with tracking parameters
  generateReferralUrl(referralCode: string, page: string = ''): string {
    const url = new URL(this.baseUrl)
    if (page) {
      url.pathname = page
    }
    url.searchParams.set('ref', referralCode)
    url.searchParams.set('utm_source', 'referral')
    url.searchParams.set('utm_medium', 'link')
    url.searchParams.set('utm_campaign', 'user_referral')

    return url.toString()
  }

  // Check if a referral code is valid
  async validateReferralCode(code: string): Promise<{ valid: boolean, error?: string }> {
    try {
      const result = await apiFetch('/api/wallet/referral/validate', {
        method: 'POST',
        body: JSON.stringify({ code })
      })
      return { valid: result?.valid || false, error: result?.error }
    } catch (error) {
      console.error('Error validating referral code:', error)
      return { valid: false, error: 'Error validating referral code' }
    }
  }

  // Referral statistics for the signed-in account
  async getUserReferralStats(): Promise<UserReferralStats> {
    try {
      const result = await apiFetch('/api/wallet/referral/stats')
      return result?.ok ? toUserReferralStats(result.stats) : EMPTY_STATS
    } catch (error) {
      console.error('Error fetching referral stats:', error)
      return EMPTY_STATS
    }
  }

  // Get platform-wide referral statistics (for admin dashboard)
  async getPlatformReferralStats(): Promise<ReferralStats> {
    try {
      const result = await apiFetch('/api/wallet/admin/referral-stats')
      if (result?.ok && result.stats) {
        return {
          totalReferrals: result.stats.totalReferrals || 0,
          totalEarnings: result.stats.totalEarnings || 0,
          conversionRate: result.stats.conversionRate || 0,
          topPerformers: result.stats.topPerformers || []
        }
      }
      return { totalReferrals: 0, totalEarnings: 0, conversionRate: 0, topPerformers: [] }
    } catch (error) {
      console.error('Error fetching platform referral stats:', error)
      return { totalReferrals: 0, totalEarnings: 0, conversionRate: 0, topPerformers: [] }
    }
  }

  // Share text. It promises the friend nothing: a friend earns no sign-up
  // bonus (only the referrer is paid, on the friend's first order).
  generateSharingContent(referralCode: string): {
    messages: Array<{
      platform: string,
      message: string,
      url: string
    }>
  } {
    const referralUrl = this.generateReferralUrl(referralCode)
    // The friend's own reason to click (task 4cebbf83): their first-order discount.
    const pitch = `I've been getting custom prints from Imagine This Printed and thought you'd love it too. Make a free account through my link and get ${REFERRAL_REWARDS.friend.percentOff}% off your first order: ${referralUrl}`

    return {
      messages: [
        {
          platform: 'email',
          message: pitch,
          url: `mailto:?subject=${encodeURIComponent('Check out Imagine This Printed')}&body=${encodeURIComponent(pitch)}`
        },
        {
          platform: 'twitter',
          message: pitch,
          url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(pitch)}`
        },
        {
          platform: 'facebook',
          message: pitch,
          url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(referralUrl)}`
        },
        {
          platform: 'whatsapp',
          message: pitch,
          url: `https://wa.me/?text=${encodeURIComponent(pitch)}`
        }
      ]
    }
  }
}

export const referralSystem = new ReferralSystem()

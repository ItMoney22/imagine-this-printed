import type { ReferralCode, ReferralTransaction } from '../types'
import { apiFetch } from '../lib/api'
import { hasAcceptedCookies } from '../components/CookieConsent'

export interface ReferralReward {
  referrerBonus: number // Points for the person who referred
  refereeBonus: number  // Points for the new user
  description: string
}

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

export class ReferralSystem {
  private baseUrl: string

  constructor() {
    this.baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'
  }

  // Generate a unique referral code for a user
  generateReferralCode(userId: string, userName: string): ReferralCode {
    const timestamp = Date.now()
    const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase()
    
    // Create a memorable code using user's name and random characters
    const namePrefix = userName.replace(/[^a-zA-Z]/g, '').substring(0, 4).toUpperCase()
    const code = `${namePrefix}${randomSuffix}`

    return {
      id: `ref_${timestamp}`,
      userId,
      code,
      isActive: true,
      createdAt: new Date().toISOString(),
      totalUses: 0,
      totalEarnings: 0,
      description: `${userName}'s referral code`
    }
  }

  // Create a new referral code in the database
  async createReferralCode(userId: string, userName: string): Promise<ReferralCode | null> {
    try {
      const result = await apiFetch('/api/wallet/referral/create', {
        method: 'POST',
        body: JSON.stringify({ description: `${userName}'s referral code` })
      })
      return result?.code || null
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
  async validateReferralCode(code: string): Promise<{ valid: boolean, referralCode?: ReferralCode, error?: string }> {
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

  // Process a successful referral when someone signs up
  async processReferral(
    referralCode: string,
    _newUserId: string,
    _newUserEmail: string
  ): Promise<ReferralTransaction | null> {
    try {
      const result = await apiFetch('/api/wallet/referral/apply', {
        method: 'POST',
        body: JSON.stringify({ code: referralCode })
      })
      if (result?.ok) {
        return result.rewards || null
      }
      return null
    } catch (error) {
      console.error('Error processing referral:', error)
      return null
    }
  }

  // Process additional referral rewards for purchases
  async processReferralPurchase(
    _referrerId: string,
    _refereeId: string,
    _orderValue: number
  ): Promise<ReferralTransaction | null> {
    // First purchase bonus is handled server-side via order completion webhook
    // No frontend call needed — backend processes this automatically
    return null
  }

  // Get referral statistics for a user
  async getUserReferralStats(_userId: string): Promise<{
    referralCode: ReferralCode | null,
    transactions: ReferralTransaction[],
    totalEarnings: number,
    totalReferrals: number
  }> {
    try {
      const result = await apiFetch('/api/wallet/referral/stats')
      if (result?.ok && result.stats) {
        return {
          referralCode: result.stats.referralCode || null,
          transactions: result.stats.transactions || [],
          totalEarnings: result.stats.totalEarnings || 0,
          totalReferrals: result.stats.totalReferrals || 0
        }
      }
      return { referralCode: null, transactions: [], totalEarnings: 0, totalReferrals: 0 }
    } catch (error) {
      console.error('Error fetching referral stats:', error)
      return { referralCode: null, transactions: [], totalEarnings: 0, totalReferrals: 0 }
    }
  }

  // Get platform-wide referral statistics (for admin dashboard)
  async getPlatformReferralStats(): Promise<ReferralStats> {
    // Platform-wide stats endpoint not yet implemented on backend
    // Returns empty stats as a safe default
    return {
      totalReferrals: 0,
      totalEarnings: 0,
      conversionRate: 0,
      topPerformers: []
    }
  }

  // Generate social sharing content
  generateSharingContent(referralCode: string, _userName: string): {
    messages: Array<{
      platform: string,
      message: string,
      url: string
    }>
  } {
    const referralUrl = this.generateReferralUrl(referralCode)
    
    return {
      messages: [
        {
          platform: 'email',
          message: `Hi! I've been using ImagineThisPrinted for custom designs and thought you'd love it too! Use my referral code ${referralCode} to get started with bonus points. Check it out: ${referralUrl}`,
          url: `mailto:?subject=Check out ImagineThisPrinted!&body=${encodeURIComponent(`Hi! I've been using ImagineThisPrinted for custom designs and thought you'd love it too! Use my referral code ${referralCode} to get started with bonus points. Check it out: ${referralUrl}`)}`
        },
        {
          platform: 'twitter',
          message: `Just discovered @ImagineThisPrinted for amazing custom designs! 🎨 Use code ${referralCode} for bonus points when you join!`,
          url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(`Just discovered @ImagineThisPrinted for amazing custom designs! 🎨 Use code ${referralCode} for bonus points when you join! ${referralUrl}`)}`
        },
        {
          platform: 'facebook',
          message: `Check out ImagineThisPrinted for custom printing! Amazing designs and quality. Use my code ${referralCode} to get started!`,
          url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(referralUrl)}&quote=${encodeURIComponent(`Check out ImagineThisPrinted for custom printing! Amazing designs and quality. Use my code ${referralCode} to get started!`)}`
        },
        {
          platform: 'whatsapp',
          message: `Hey! Check out this awesome custom printing platform I've been using: ${referralUrl} Use code ${referralCode} for bonus points! 🎨`,
          url: `https://wa.me/?text=${encodeURIComponent(`Hey! Check out this awesome custom printing platform I've been using: ${referralUrl} Use code ${referralCode} for bonus points! 🎨`)}`
        }
      ]
    }
  }

  // Extract referral code from URL parameters
  extractReferralFromUrl(): string | null {
    if (typeof window === 'undefined') return null
    const urlParams = new URLSearchParams(window.location.search)
    return urlParams.get('ref')
  }

  // Store referral code in localStorage AND 90-day cookie for later processing
  storeReferralCode(code: string): void {
    if (typeof window === 'undefined') return
    const timestamp = Date.now().toString()
    // Always store in localStorage (not a cookie, no consent needed)
    localStorage.setItem('pending_referral', code)
    localStorage.setItem('referral_timestamp', timestamp)
    // Only set tracking cookies if user has accepted cookie consent
    if (hasAcceptedCookies()) {
      this.setCookie('itp_referral', code, 90)
      this.setCookie('itp_referral_ts', timestamp, 90)
    }
  }

  // Retrieve stored referral code (and clear it)
  retrieveStoredReferral(): string | null {
    if (typeof window === 'undefined') return null
    const code = localStorage.getItem('pending_referral') || this.getCookie('itp_referral')
    const timestamp = localStorage.getItem('referral_timestamp') || this.getCookie('itp_referral_ts')

    if (code && timestamp) {
      // Check if referral is still valid (within 90 days)
      const referralAge = Date.now() - parseInt(timestamp)
      const ninetyDays = 90 * 24 * 60 * 60 * 1000

      if (referralAge < ninetyDays) {
        // Clear stored referral
        localStorage.removeItem('pending_referral')
        localStorage.removeItem('referral_timestamp')
        this.deleteCookie('itp_referral')
        this.deleteCookie('itp_referral_ts')
        return code
      }
    }

    return null
  }

  // Cookie helpers for 90-day referral tracking
  private setCookie(name: string, value: string, days: number = 90): void {
    if (typeof document === 'undefined') return
    const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString()
    document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`
  }

  private getCookie(name: string): string | null {
    if (typeof document === 'undefined') return null
    const value = `; ${document.cookie}`
    const parts = value.split(`; ${name}=`)
    if (parts.length === 2) return parts.pop()?.split(';').shift() || null
    return null
  }

  private deleteCookie(name: string): void {
    if (typeof document === 'undefined') return
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  }
}

export const referralSystem = new ReferralSystem()

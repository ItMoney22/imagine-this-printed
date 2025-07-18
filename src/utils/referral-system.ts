import type { ReferralCode, ReferralTransaction } from '../types'
// Removed direct Prisma import - using API endpoints for referral operations

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
      const response = await fetch('/api/referral/create-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ userId, userName })
      })

      if (!response.ok) {
        console.error('Failed to create referral code')
        return null
      }

      return await response.json()
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
      const response = await fetch(`/api/referral/validate?code=${code}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        return { valid: false, error: 'Failed to validate referral code' }
      }

      return await response.json()
    } catch (error) {
      console.error('Error validating referral code:', error)
      return { valid: false, error: 'Error validating referral code' }
    }
  }

  // Process a successful referral when someone signs up
  async processReferral(
    referralCode: string, 
    newUserId: string, 
    newUserEmail: string
  ): Promise<ReferralTransaction | null> {
    // TODO: This function needs to be moved to an API endpoint
    // For now, returning null to prevent build errors
    console.warn('processReferral function needs to be moved to API endpoint', { referralCode, newUserId, newUserEmail })
    return null
  }

  // Process additional referral rewards for purchases
  async processReferralPurchase(
    referrerId: string,
    refereeId: string,
    orderValue: number
  ): Promise<ReferralTransaction | null> {
    // TODO: This function needs to be moved to an API endpoint
    // For now, returning null to prevent build errors
    console.warn('processReferralPurchase function needs to be moved to API endpoint', { referrerId, refereeId, orderValue })
    return null
  }

  // Get referral statistics for a user
  async getUserReferralStats(userId: string): Promise<{
    referralCode: ReferralCode | null,
    transactions: ReferralTransaction[],
    totalEarnings: number,
    totalReferrals: number
  }> {
    // TODO: This function needs to be moved to an API endpoint
    // For now, returning empty stats to prevent build errors
    console.warn('getUserReferralStats function needs to be moved to API endpoint', { userId })
    return {
      referralCode: null,
      transactions: [],
      totalEarnings: 0,
      totalReferrals: 0
    }
  }

  // Get platform-wide referral statistics (for admin dashboard)
  async getPlatformReferralStats(): Promise<ReferralStats> {
    // TODO: This function needs to be moved to an API endpoint
    // For now, returning empty stats to prevent build errors
    console.warn('getPlatformReferralStats function needs to be moved to API endpoint')
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

  // Store referral code in localStorage for later processing
  storeReferralCode(code: string): void {
    if (typeof window === 'undefined') return
    localStorage.setItem('pending_referral', code)
    localStorage.setItem('referral_timestamp', Date.now().toString())
  }

  // Retrieve stored referral code (and clear it)
  retrieveStoredReferral(): string | null {
    if (typeof window === 'undefined') return null
    const code = localStorage.getItem('pending_referral')
    const timestamp = localStorage.getItem('referral_timestamp')
    
    if (code && timestamp) {
      // Check if referral is still valid (within 30 days)
      const referralAge = Date.now() - parseInt(timestamp)
      const thirtyDays = 30 * 24 * 60 * 60 * 1000
      
      if (referralAge < thirtyDays) {
        // Clear stored referral
        localStorage.removeItem('pending_referral')
        localStorage.removeItem('referral_timestamp')
        return code
      }
    }
    
    return null
  }
}

export const referralSystem = new ReferralSystem()
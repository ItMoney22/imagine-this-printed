import type { ReferralCode, ReferralTransaction } from '../types'

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
    this.baseUrl = window.location.origin
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
    // Mock validation - in real app, this would query the database
    await new Promise(resolve => setTimeout(resolve, 500))

    // Mock referral codes for demo
    const mockReferralCodes: ReferralCode[] = [
      {
        id: 'ref_1',
        userId: 'user1',
        code: 'JOHN2024',
        isActive: true,
        createdAt: '2025-01-01T00:00:00Z',
        totalUses: 5,
        totalEarnings: 250,
        description: 'John\'s referral code'
      },
      {
        id: 'ref_2',
        userId: 'user2',
        code: 'SARAH123',
        isActive: true,
        createdAt: '2025-01-02T00:00:00Z',
        totalUses: 3,
        totalEarnings: 150,
        description: 'Sarah\'s referral code'
      }
    ]

    const referralCode = mockReferralCodes.find(ref => ref.code === code.toUpperCase())
    
    if (!referralCode) {
      return { valid: false, error: 'Referral code not found' }
    }

    if (!referralCode.isActive) {
      return { valid: false, error: 'Referral code is no longer active' }
    }

    return { valid: true, referralCode }
  }

  // Process a successful referral when someone signs up
  async processReferral(
    referralCode: string, 
    newUserId: string, 
    newUserEmail: string
  ): Promise<ReferralTransaction | null> {
    const validation = await this.validateReferralCode(referralCode)
    
    if (!validation.valid || !validation.referralCode) {
      console.error('Invalid referral code:', validation.error)
      return null
    }

    // Define referral rewards based on action type
    const reward: ReferralReward = {
      referrerBonus: 100, // 100 points for referrer
      refereeBonus: 50,   // 50 points for new user
      description: 'New user signup bonus'
    }

    // Create referral transaction
    const transaction: ReferralTransaction = {
      id: `reftx_${Date.now()}`,
      referralCodeId: validation.referralCode.id,
      referrerId: validation.referralCode.userId,
      refereeId: newUserId,
      refereeEmail: newUserEmail,
      type: 'signup',
      referrerReward: reward.referrerBonus,
      refereeReward: reward.refereeBonus,
      status: 'completed',
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    }

    // In real app, this would:
    // 1. Save transaction to database
    // 2. Update user points balances
    // 3. Update referral code statistics
    // 4. Send notification emails
    
    console.log('Referral processed:', transaction)
    return transaction
  }

  // Process additional referral rewards for purchases
  async processReferralPurchase(
    referrerId: string,
    refereeId: string,
    orderValue: number
  ): Promise<ReferralTransaction | null> {
    // Calculate commission (5% of order value as points)
    const commission = Math.floor(orderValue * 0.05)
    
    const transaction: ReferralTransaction = {
      id: `reftx_${Date.now()}`,
      referralCodeId: 'ref_purchase',
      referrerId,
      refereeId,
      refereeEmail: '', // Would be filled from user data
      type: 'purchase',
      referrerReward: commission,
      refereeReward: 0, // No additional bonus for referee on purchase
      status: 'completed',
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      metadata: {
        orderValue,
        commissionRate: 0.05
      }
    }

    console.log('Purchase referral processed:', transaction)
    return transaction
  }

  // Get referral statistics for a user
  async getUserReferralStats(userId: string): Promise<{
    referralCode: ReferralCode | null,
    transactions: ReferralTransaction[],
    totalEarnings: number,
    totalReferrals: number
  }> {
    // Mock data for demo
    await new Promise(resolve => setTimeout(resolve, 300))

    const mockReferralCode: ReferralCode = {
      id: 'ref_user',
      userId,
      code: 'USER2024',
      isActive: true,
      createdAt: '2025-01-01T00:00:00Z',
      totalUses: 3,
      totalEarnings: 175,
      description: 'Your referral code'
    }

    const mockTransactions: ReferralTransaction[] = [
      {
        id: 'reftx_1',
        referralCodeId: 'ref_user',
        referrerId: userId,
        refereeId: 'referred_user_1',
        refereeEmail: 'friend1@example.com',
        type: 'signup',
        referrerReward: 100,
        refereeReward: 50,
        status: 'completed',
        createdAt: '2025-01-05T10:00:00Z',
        completedAt: '2025-01-05T10:00:00Z'
      },
      {
        id: 'reftx_2',
        referralCodeId: 'ref_user',
        referrerId: userId,
        refereeId: 'referred_user_2',
        refereeEmail: 'friend2@example.com',
        type: 'signup',
        referrerReward: 100,
        refereeReward: 50,
        status: 'completed',
        createdAt: '2025-01-08T14:30:00Z',
        completedAt: '2025-01-08T14:30:00Z'
      },
      {
        id: 'reftx_3',
        referralCodeId: 'ref_user',
        referrerId: userId,
        refereeId: 'referred_user_1',
        refereeEmail: 'friend1@example.com',
        type: 'purchase',
        referrerReward: 15, // 5% of $300 order
        refereeReward: 0,
        status: 'completed',
        createdAt: '2025-01-10T16:45:00Z',
        completedAt: '2025-01-10T16:45:00Z',
        metadata: {
          orderValue: 300,
          commissionRate: 0.05
        }
      }
    ]

    return {
      referralCode: mockReferralCode,
      transactions: mockTransactions,
      totalEarnings: mockTransactions.reduce((sum, tx) => sum + tx.referrerReward, 0),
      totalReferrals: mockTransactions.filter(tx => tx.type === 'signup').length
    }
  }

  // Get platform-wide referral statistics (for admin dashboard)
  async getPlatformReferralStats(): Promise<ReferralStats> {
    // Mock data for demo
    await new Promise(resolve => setTimeout(resolve, 500))

    return {
      totalReferrals: 156,
      totalEarnings: 7800, // Total points distributed
      conversionRate: 0.68, // 68% of referred users make a purchase
      topPerformers: [
        {
          userId: 'user1',
          name: 'John Doe',
          referralCount: 12,
          earnings: 650
        },
        {
          userId: 'user2',
          name: 'Sarah Wilson',
          referralCount: 8,
          earnings: 420
        },
        {
          userId: 'user3',
          name: 'Mike Johnson',
          referralCount: 6,
          earnings: 315
        }
      ]
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
    const urlParams = new URLSearchParams(window.location.search)
    return urlParams.get('ref')
  }

  // Store referral code in localStorage for later processing
  storeReferralCode(code: string): void {
    localStorage.setItem('pending_referral', code)
    localStorage.setItem('referral_timestamp', Date.now().toString())
  }

  // Retrieve stored referral code (and clear it)
  retrieveStoredReferral(): string | null {
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
import type { ReferralCode, ReferralTransaction } from '../types'
import { prisma } from './database'

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
      // Check if user already has an active referral code
      const existingCode = await prisma.referralCode.findFirst({
        where: { userId, isActive: true }
      })

      if (existingCode) {
        return {
          id: existingCode.id,
          userId: existingCode.userId,
          code: existingCode.code,
          isActive: existingCode.isActive,
          createdAt: existingCode.createdAt.toISOString(),
          totalUses: existingCode.totalUses,
          totalEarnings: Number(existingCode.totalEarnings),
          description: existingCode.description || ''
        }
      }

      // Generate a unique code
      let code: string
      let isUnique = false
      let attempts = 0
      const maxAttempts = 10

      do {
        const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase()
        const namePrefix = userName.replace(/[^a-zA-Z]/g, '').substring(0, 4).toUpperCase()
        code = `${namePrefix}${randomSuffix}`

        // Check if code is unique
        const existingCodeCheck = await prisma.referralCode.findUnique({
          where: { code }
        })

        isUnique = !existingCodeCheck
        attempts++
      } while (!isUnique && attempts < maxAttempts)

      if (!isUnique) {
        console.error('Failed to generate unique referral code after maximum attempts')
        return null
      }

      // Create the referral code in the database
      const dbReferralCode = await prisma.referralCode.create({
        data: {
          userId,
          code,
          isActive: true,
          totalUses: 0,
          totalEarnings: 0,
          description: `${userName}'s referral code`
        }
      })

      return {
        id: dbReferralCode.id,
        userId: dbReferralCode.userId,
        code: dbReferralCode.code,
        isActive: dbReferralCode.isActive,
        createdAt: dbReferralCode.createdAt.toISOString(),
        totalUses: dbReferralCode.totalUses,
        totalEarnings: Number(dbReferralCode.totalEarnings),
        description: dbReferralCode.description || ''
      }
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
      const dbReferralCode = await prisma.referralCode.findUnique({
        where: { code: code.toUpperCase() },
        include: { user: true }
      })
      
      if (!dbReferralCode) {
        return { valid: false, error: 'Referral code not found' }
      }

      if (!dbReferralCode.isActive) {
        return { valid: false, error: 'Referral code is no longer active' }
      }

      // Check if code has expired
      if (dbReferralCode.expiresAt && dbReferralCode.expiresAt < new Date()) {
        return { valid: false, error: 'Referral code has expired' }
      }

      // Check if code has reached max uses
      if (dbReferralCode.maxUses && dbReferralCode.totalUses >= dbReferralCode.maxUses) {
        return { valid: false, error: 'Referral code has reached maximum uses' }
      }

      const referralCode: ReferralCode = {
        id: dbReferralCode.id,
        userId: dbReferralCode.userId,
        code: dbReferralCode.code,
        isActive: dbReferralCode.isActive,
        createdAt: dbReferralCode.createdAt.toISOString(),
        totalUses: dbReferralCode.totalUses,
        totalEarnings: Number(dbReferralCode.totalEarnings),
        description: dbReferralCode.description || ''
      }

      return { valid: true, referralCode }
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
    const validation = await this.validateReferralCode(referralCode)
    
    if (!validation.valid || !validation.referralCode) {
      console.error('Invalid referral code:', validation.error)
      return null
    }

    try {
      // Get referral code details from database
      const dbReferralCode = await prisma.referralCode.findUnique({
        where: { id: validation.referralCode.id }
      })

      if (!dbReferralCode) {
        console.error('Referral code not found in database')
        return null
      }

      // Check if this user has already been referred by this code
      const existingTransaction = await prisma.referralTransaction.findFirst({
        where: {
          referralCodeId: validation.referralCode.id,
          refereeId: newUserId,
          type: 'signup'
        }
      })

      if (existingTransaction) {
        console.error('User has already been referred by this code')
        return null
      }

      // Use the reward amounts from the referral code
      const referrerReward = Number(dbReferralCode.referrerRewardAmount)
      const refereeReward = Number(dbReferralCode.refereeRewardAmount)

      // Create referral transaction using Prisma transaction
      const result = await prisma.$transaction(async (tx) => {
        // 1. Create the referral transaction
        const transaction = await tx.referralTransaction.create({
          data: {
            referralCodeId: validation.referralCode!.id,
            referrerId: validation.referralCode!.userId,
            refereeId: newUserId,
            refereeEmail: newUserEmail,
            type: 'signup',
            referrerReward: referrerReward,
            refereeReward: refereeReward,
            status: 'completed',
            completedAt: new Date()
          }
        })

        // 2. Update referral code statistics
        await tx.referralCode.update({
          where: { id: validation.referralCode!.id },
          data: {
            totalUses: { increment: 1 },
            totalEarnings: { increment: referrerReward }
          }
        })

        // 3. Update user points balances via wallet
        await tx.userWallet.upsert({
          where: { userId: validation.referralCode!.userId },
          update: {
            pointsBalance: { increment: referrerReward },
            lifetimePointsEarned: { increment: referrerReward }
          },
          create: {
            userId: validation.referralCode!.userId,
            pointsBalance: referrerReward,
            lifetimePointsEarned: referrerReward
          }
        })

        await tx.userWallet.upsert({
          where: { userId: newUserId },
          update: {
            pointsBalance: { increment: refereeReward },
            lifetimePointsEarned: { increment: refereeReward }
          },
          create: {
            userId: newUserId,
            pointsBalance: refereeReward,
            lifetimePointsEarned: refereeReward
          }
        })

        return transaction
      })

      const referralTransaction: ReferralTransaction = {
        id: result.id,
        referralCodeId: result.referralCodeId,
        referrerId: result.referrerId,
        refereeId: result.refereeId,
        refereeEmail: result.refereeEmail,
        type: result.type as 'signup' | 'purchase',
        referrerReward: Number(result.referrerReward),
        refereeReward: Number(result.refereeReward),
        status: result.status as 'pending' | 'completed' | 'failed',
        createdAt: result.createdAt.toISOString(),
        completedAt: result.completedAt?.toISOString(),
        metadata: result.metadata as Record<string, any> | undefined
      }

      console.log('Referral processed:', referralTransaction)
      return referralTransaction
    } catch (error) {
      console.error('Error processing referral:', error)
      return null
    }
  }

  // Process additional referral rewards for purchases
  async processReferralPurchase(
    referrerId: string,
    refereeId: string,
    orderValue: number
  ): Promise<ReferralTransaction | null> {
    try {
      // Get the referral code for this referrer-referee pair
      const referralCode = await prisma.referralCode.findFirst({
        where: { userId: referrerId }
      })

      if (!referralCode) {
        console.error('No referral code found for referrer')
        return null
      }

      // Get referee user details
      const refereeUser = await prisma.userProfile.findUnique({
        where: { id: refereeId },
        select: { email: true }
      })

      if (!refereeUser) {
        console.error('Referee user not found')
        return null
      }

      // Calculate commission (5% of order value as points)
      const commission = Math.floor(orderValue * 0.05)
      
      // Create referral transaction using Prisma transaction
      const result = await prisma.$transaction(async (tx) => {
        // 1. Create the referral transaction
        const transaction = await tx.referralTransaction.create({
          data: {
            referralCodeId: referralCode.id,
            referrerId,
            refereeId,
            refereeEmail: refereeUser.email,
            type: 'purchase',
            referrerReward: commission,
            refereeReward: 0, // No additional bonus for referee on purchase
            status: 'completed',
            completedAt: new Date(),
            metadata: {
              orderValue,
              commissionRate: 0.05
            }
          }
        })

        // 2. Update referral code total earnings
        await tx.referralCode.update({
          where: { id: referralCode.id },
          data: {
            totalEarnings: { increment: commission }
          }
        })

        // 3. Update referrer points balance via wallet
        await tx.userWallet.upsert({
          where: { userId: referrerId },
          update: {
            pointsBalance: { increment: commission },
            lifetimePointsEarned: { increment: commission }
          },
          create: {
            userId: referrerId,
            pointsBalance: commission,
            lifetimePointsEarned: commission
          }
        })

        return transaction
      })

      const referralTransaction: ReferralTransaction = {
        id: result.id,
        referralCodeId: result.referralCodeId,
        referrerId: result.referrerId,
        refereeId: result.refereeId,
        refereeEmail: result.refereeEmail,
        type: result.type as 'signup' | 'purchase',
        referrerReward: Number(result.referrerReward),
        refereeReward: Number(result.refereeReward),
        status: result.status as 'pending' | 'completed' | 'failed',
        createdAt: result.createdAt.toISOString(),
        completedAt: result.completedAt?.toISOString(),
        metadata: result.metadata as Record<string, any> | undefined
      }

      console.log('Purchase referral processed:', referralTransaction)
      return referralTransaction
    } catch (error) {
      console.error('Error processing referral purchase:', error)
      return null
    }
  }

  // Get referral statistics for a user
  async getUserReferralStats(userId: string): Promise<{
    referralCode: ReferralCode | null,
    transactions: ReferralTransaction[],
    totalEarnings: number,
    totalReferrals: number
  }> {
    try {
      // Get user's referral code
      const dbReferralCode = await prisma.referralCode.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' }
      })

      let referralCode: ReferralCode | null = null
      if (dbReferralCode) {
        referralCode = {
          id: dbReferralCode.id,
          userId: dbReferralCode.userId,
          code: dbReferralCode.code,
          isActive: dbReferralCode.isActive,
          createdAt: dbReferralCode.createdAt.toISOString(),
          totalUses: dbReferralCode.totalUses,
          totalEarnings: Number(dbReferralCode.totalEarnings),
          description: dbReferralCode.description || ''
        }
      }

      // Get user's referral transactions
      const dbTransactions = await prisma.referralTransaction.findMany({
        where: { referrerId: userId },
        orderBy: { createdAt: 'desc' }
      })

      const transactions: ReferralTransaction[] = dbTransactions.map(tx => ({
        id: tx.id,
        referralCodeId: tx.referralCodeId,
        referrerId: tx.referrerId,
        refereeId: tx.refereeId,
        refereeEmail: tx.refereeEmail,
        type: tx.type as 'signup' | 'purchase',
        referrerReward: Number(tx.referrerReward),
        refereeReward: Number(tx.refereeReward),
        status: tx.status as 'pending' | 'completed' | 'failed',
        createdAt: tx.createdAt.toISOString(),
        completedAt: tx.completedAt?.toISOString(),
        metadata: tx.metadata as Record<string, any> | undefined
      }))

      const totalEarnings = transactions.reduce((sum, tx) => sum + tx.referrerReward, 0)
      const totalReferrals = transactions.filter(tx => tx.type === 'signup').length

      return {
        referralCode,
        transactions,
        totalEarnings,
        totalReferrals
      }
    } catch (error) {
      console.error('Error getting user referral stats:', error)
      return {
        referralCode: null,
        transactions: [],
        totalEarnings: 0,
        totalReferrals: 0
      }
    }
  }

  // Get platform-wide referral statistics (for admin dashboard)
  async getPlatformReferralStats(): Promise<ReferralStats> {
    try {
      // Get total referrals (signup transactions)
      const totalReferrals = await prisma.referralTransaction.count({
        where: { type: 'signup' }
      })

      // Get total earnings distributed
      const totalEarningsResult = await prisma.referralTransaction.aggregate({
        _sum: { referrerReward: true }
      })
      const totalEarnings = Number(totalEarningsResult._sum.referrerReward || 0)

      // Calculate conversion rate (users who made purchases after signup)
      const signupTransactions = await prisma.referralTransaction.findMany({
        where: { type: 'signup' },
        select: { refereeId: true }
      })
      
      const purchaseTransactions = await prisma.referralTransaction.findMany({
        where: {
          type: 'purchase',
          refereeId: { in: signupTransactions.map(t => t.refereeId) }
        },
        select: { refereeId: true }
      })

      const uniquePurchasers = new Set(purchaseTransactions.map(t => t.refereeId))
      const conversionRate = totalReferrals > 0 ? uniquePurchasers.size / totalReferrals : 0

      // Get top performers
      const topPerformersData = await prisma.referralTransaction.groupBy({
        by: ['referrerId'],
        where: { type: 'signup' },
        _count: { referrerId: true },
        _sum: { referrerReward: true },
        orderBy: { _count: { referrerId: 'desc' } },
        take: 10
      })

      const topPerformers = await Promise.all(
        topPerformersData.map(async (performer) => {
          const user = await prisma.userProfile.findUnique({
            where: { id: performer.referrerId },
            select: { displayName: true, email: true }
          })
          
          return {
            userId: performer.referrerId,
            name: user?.displayName || user?.email || 'Unknown User',
            referralCount: performer._count.referrerId,
            earnings: Number(performer._sum.referrerReward || 0)
          }
        })
      )

      return {
        totalReferrals,
        totalEarnings,
        conversionRate,
        topPerformers
      }
    } catch (error) {
      console.error('Error getting platform referral stats:', error)
      return {
        totalReferrals: 0,
        totalEarnings: 0,
        conversionRate: 0,
        topPerformers: []
      }
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
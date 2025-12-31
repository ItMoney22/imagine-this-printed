/**
 * Reward Calculator Utility
 *
 * Calculates ITC (Imagine This Coin) rewards based on order value, user tier, and promotional multipliers
 * All rewards are in ITC - the single currency of ImagineThisPrinted
 */

export interface RewardTier {
  name: 'bronze' | 'silver' | 'gold' | 'platinum'
  itcMultiplier: number
  itcBonus: number
  minSpend: number
}

export interface RewardCalculation {
  itc: number
  baseITC: number
  tierBonus: number
  promoBonus: number
  reason: string
}

export interface ReferralReward {
  referrerITC: number
  refereeITC: number
  reason: string
}

// Reward Tiers Configuration
export const REWARD_TIERS: Record<string, RewardTier> = {
  bronze: {
    name: 'bronze',
    itcMultiplier: 1.0, // 1% back in ITC
    itcBonus: 0,
    minSpend: 0
  },
  silver: {
    name: 'silver',
    itcMultiplier: 1.25, // 1.25% back in ITC
    itcBonus: 0.005, // 0.5% additional bonus
    minSpend: 500
  },
  gold: {
    name: 'gold',
    itcMultiplier: 1.5, // 1.5% back in ITC
    itcBonus: 0.01, // 1% additional bonus
    minSpend: 2000
  },
  platinum: {
    name: 'platinum',
    itcMultiplier: 2.0, // 2% back in ITC
    itcBonus: 0.02, // 2% additional bonus
    minSpend: 10000
  }
}

// ============================================
// ITC EARNINGS CONFIGURATION - CENTRAL SOURCE OF TRUTH
// ============================================

// Commission Rates (% of sale price → ITC)
export const ITC_COMMISSION_RATES = {
  // Creator royalty when their design sells
  creatorRoyalty: 0.15, // 15%

  // Vendor/Kiosk operator commission on sales
  vendorCommission: 0.25, // 25%

  // Location partner commission (optional split with vendor)
  partnerCommission: 0.05, // 5%

  // Community boost reward
  communityBoost: 1, // 1 ITC per boost received
}

// Referral System Configuration
export const REFERRAL_CONFIG = {
  referrerSignupITC: 10, // ITC awarded to referrer when someone signs up
  referrerPurchaseITC: 50, // ITC awarded when referred user makes first purchase
  refereeITC: 0, // No welcome bonus (don't make it too easy to earn)
  cookieDays: 90, // Referral tracking cookie duration
  firstPurchaseBonus: 1.5, // 50% extra ITC on first purchase (multiplier)
}

// Reward Configuration - All ITC based
export const REWARD_CONFIG = {
  // Base reward rate (1 ITC = $0.01, so 1% of order = 1 ITC per dollar)
  baseITCPerDollar: 1,

  // Referral rewards (all ITC) - legacy reference, use REFERRAL_CONFIG instead
  referral: REFERRAL_CONFIG,

  // Promotional multipliers
  promotions: {
    happyHour: 1.5, // 50% bonus during happy hour
    weekendBonus: 1.25, // 25% bonus on weekends
    holiday: 2.0, // 2x ITC on holidays
    flashSale: 3.0 // 3x ITC during flash sales
  }
}

/**
 * Determine user tier based on total spend
 */
export function getUserTier(totalSpent: number): RewardTier {
  if (totalSpent >= REWARD_TIERS.platinum.minSpend) return REWARD_TIERS.platinum
  if (totalSpent >= REWARD_TIERS.gold.minSpend) return REWARD_TIERS.gold
  if (totalSpent >= REWARD_TIERS.silver.minSpend) return REWARD_TIERS.silver
  return REWARD_TIERS.bronze
}

/**
 * Calculate ITC rewards for a completed order
 */
export function calculateOrderRewards(
  orderTotal: number,
  userTier: RewardTier | string,
  promoMultiplier: number = 1.0,
  isFirstPurchase: boolean = false
): RewardCalculation {
  // Get tier object
  const tier = typeof userTier === 'string' ? REWARD_TIERS[userTier] || REWARD_TIERS.bronze : userTier

  // Calculate base ITC (1% of order value = 1 ITC per dollar)
  const baseITC = orderTotal * REWARD_CONFIG.baseITCPerDollar

  // Apply tier multiplier
  const tierMultiplier = tier.itcMultiplier
  const tierBonus = baseITC * (tierMultiplier - 1)

  // Apply promotional multiplier
  const promoBonus = baseITC * (promoMultiplier - 1)

  // First purchase bonus
  const firstPurchaseBonus = isFirstPurchase ? baseITC * (REWARD_CONFIG.referral.firstPurchaseBonus - 1) : 0

  // Total ITC (also add tier bonus percentage)
  const itc = baseITC + tierBonus + promoBonus + firstPurchaseBonus + (orderTotal * tier.itcBonus)

  // Build reason string
  const reasons: string[] = ['Order completed']
  if (tierMultiplier > 1) reasons.push(`${tier.name} tier bonus`)
  if (promoMultiplier > 1) reasons.push('promotional bonus')
  if (isFirstPurchase) reasons.push('first purchase bonus')

  return {
    itc: Math.round(itc * 100) / 100, // Round to 2 decimal places
    baseITC: Math.round(baseITC * 100) / 100,
    tierBonus: Math.round((tierBonus + promoBonus + firstPurchaseBonus) * 100) / 100,
    promoBonus: Math.round(promoBonus * 100) / 100,
    reason: reasons.join(' + ')
  }
}

/**
 * Calculate referral rewards (ITC only)
 * - Signup: 10 ITC to referrer
 * - First purchase: 50 ITC to referrer (flat amount)
 */
export function calculateReferralRewards(
  referralType: 'signup' | 'purchase',
  purchaseAmount?: number
): ReferralReward {
  const config = REWARD_CONFIG.referral

  if (referralType === 'signup') {
    return {
      referrerITC: config.referrerSignupITC,
      refereeITC: config.refereeITC,
      reason: 'Referral signup bonus'
    }
  } else if (referralType === 'purchase') {
    // Flat 50 ITC bonus when referred user makes first purchase
    return {
      referrerITC: config.referrerPurchaseITC,
      refereeITC: 0,
      reason: 'Referral first purchase bonus'
    }
  }

  return {
    referrerITC: 0,
    refereeITC: 0,
    reason: 'Invalid referral type'
  }
}

/**
 * Calculate ITC from milestone achievements
 */
export function calculateMilestoneRewards(
  milestoneType: 'first_order' | 'tenth_order' | 'hundredth_order' | 'review_left' | 'profile_completed'
): { itc: number; reason: string } {
  const milestones = {
    first_order: { itc: 5, reason: 'First order milestone' },
    tenth_order: { itc: 10, reason: '10 orders milestone' },
    hundredth_order: { itc: 100, reason: '100 orders milestone' },
    review_left: { itc: 0.5, reason: 'Product review reward' },
    profile_completed: { itc: 1, reason: 'Profile completion bonus' }
  }

  return milestones[milestoneType] || { itc: 0, reason: 'Unknown milestone' }
}

/**
 * Check if current time qualifies for promotional bonus
 */
export function getCurrentPromoMultiplier(): number {
  const now = new Date()
  const hour = now.getHours()
  const day = now.getDay()

  // Weekend bonus (Saturday and Sunday)
  if (day === 0 || day === 6) {
    return REWARD_CONFIG.promotions.weekendBonus
  }

  // Happy hour (2 PM - 6 PM weekdays)
  if (day >= 1 && day <= 5 && hour >= 14 && hour < 18) {
    return REWARD_CONFIG.promotions.happyHour
  }

  return 1.0 // No bonus
}

/**
 * Validate reward calculation to prevent abuse
 */
export function validateRewardCalculation(
  orderTotal: number,
  calculatedITC: number
): boolean {
  // Maximum realistic ITC: 10% of order value (generous limit for platinum + promo)
  const maxITC = orderTotal * 0.10

  return calculatedITC <= maxITC
}

/**
 * Format reward message for notifications
 */
export function formatRewardMessage(reward: RewardCalculation, orderNumber: string): string {
  const parts: string[] = []

  parts.push(`Order #${orderNumber} completed!`)
  parts.push(`You earned ${reward.itc.toFixed(2)} ITC`)

  if (reward.tierBonus > 0) {
    parts.push(`(includes tier bonus)`)
  }

  return parts.join(' ')
}

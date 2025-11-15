/**
 * Reward Calculator Utility
 *
 * Calculates points and ITC rewards based on order value, user tier, and promotional multipliers
 */

export interface RewardTier {
  name: 'bronze' | 'silver' | 'gold' | 'platinum'
  pointsMultiplier: number
  itcBonus: number
  minSpend: number
}

export interface RewardCalculation {
  points: number
  itc: number
  basePoints: number
  tierBonus: number
  promoBonus: number
  reason: string
}

export interface ReferralReward {
  referrerPoints: number
  referrerITC: number
  refereePoints: number
  refereeITC: number
  reason: string
}

// Reward Tiers Configuration
export const REWARD_TIERS: Record<string, RewardTier> = {
  bronze: {
    name: 'bronze',
    pointsMultiplier: 1.0, // 1% back in points
    itcBonus: 0,
    minSpend: 0
  },
  silver: {
    name: 'silver',
    pointsMultiplier: 1.25, // 1.25% back in points
    itcBonus: 0.005, // 0.5% back in ITC
    minSpend: 500
  },
  gold: {
    name: 'gold',
    pointsMultiplier: 1.5, // 1.5% back in points
    itcBonus: 0.01, // 1% back in ITC
    minSpend: 2000
  },
  platinum: {
    name: 'platinum',
    pointsMultiplier: 2.0, // 2% back in points
    itcBonus: 0.02, // 2% back in ITC
    minSpend: 10000
  }
}

// Reward Configuration
export const REWARD_CONFIG = {
  // Base reward rate (1% of order value = 100 points per $1)
  basePointsPerDollar: 100,

  // ITC conversion rates
  pointsToITC: 0.01, // 100 points = 1 ITC

  // Referral rewards
  referral: {
    referrerPoints: 500, // Points awarded to referrer on signup
    referrerITC: 5, // ITC awarded to referrer on signup
    refereePoints: 250, // Welcome bonus for new user
    refereeITC: 2.5, // Welcome ITC for new user
    firstPurchaseBonus: 1.5 // 1.5x multiplier on first purchase
  },

  // Promotional multipliers
  promotions: {
    happyHour: 1.5, // 50% bonus during happy hour
    weekendBonus: 1.25, // 25% bonus on weekends
    holiday: 2.0, // 2x points on holidays
    flashSale: 3.0 // 3x points during flash sales
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
 * Calculate rewards for a completed order
 */
export function calculateOrderRewards(
  orderTotal: number,
  userTier: RewardTier | string,
  promoMultiplier: number = 1.0,
  isFirstPurchase: boolean = false
): RewardCalculation {
  // Get tier object
  const tier = typeof userTier === 'string' ? REWARD_TIERS[userTier] || REWARD_TIERS.bronze : userTier

  // Calculate base points (1% of order value = 100 points per dollar)
  const basePoints = Math.floor(orderTotal * REWARD_CONFIG.basePointsPerDollar)

  // Apply tier multiplier
  const tierMultiplier = tier.pointsMultiplier
  const tierBonus = Math.floor(basePoints * (tierMultiplier - 1))

  // Apply promotional multiplier
  const promoBonus = Math.floor(basePoints * (promoMultiplier - 1))

  // First purchase bonus
  const firstPurchaseBonus = isFirstPurchase ? Math.floor(basePoints * (REWARD_CONFIG.referral.firstPurchaseBonus - 1)) : 0

  // Total points
  const points = basePoints + tierBonus + promoBonus + firstPurchaseBonus

  // Calculate ITC bonus
  const itc = orderTotal * tier.itcBonus

  // Build reason string
  const reasons: string[] = ['Order completed']
  if (tierMultiplier > 1) reasons.push(`${tier.name} tier bonus`)
  if (promoMultiplier > 1) reasons.push('promotional bonus')
  if (isFirstPurchase) reasons.push('first purchase bonus')

  return {
    points,
    itc,
    basePoints,
    tierBonus: tierBonus + promoBonus + firstPurchaseBonus,
    promoBonus,
    reason: reasons.join(' + ')
  }
}

/**
 * Calculate referral rewards
 */
export function calculateReferralRewards(
  referralType: 'signup' | 'purchase',
  purchaseAmount?: number
): ReferralReward {
  const config = REWARD_CONFIG.referral

  if (referralType === 'signup') {
    return {
      referrerPoints: config.referrerPoints,
      referrerITC: config.referrerITC,
      refereePoints: config.refereePoints,
      refereeITC: config.refereeITC,
      reason: 'Referral signup bonus'
    }
  } else if (referralType === 'purchase' && purchaseAmount) {
    // On first purchase, referrer gets additional 5% of purchase value as points
    const bonusPoints = Math.floor(purchaseAmount * 5)
    return {
      referrerPoints: bonusPoints,
      referrerITC: 0,
      refereePoints: 0,
      refereeITC: 0,
      reason: 'Referral first purchase bonus'
    }
  }

  return {
    referrerPoints: 0,
    referrerITC: 0,
    refereePoints: 0,
    refereeITC: 0,
    reason: 'Invalid referral type'
  }
}

/**
 * Calculate points from milestone achievements
 */
export function calculateMilestoneRewards(
  milestoneType: 'first_order' | 'tenth_order' | 'hundredth_order' | 'review_left' | 'profile_completed'
): { points: number; itc: number; reason: string } {
  const milestones = {
    first_order: { points: 500, itc: 5, reason: 'First order milestone' },
    tenth_order: { points: 1000, itc: 10, reason: '10 orders milestone' },
    hundredth_order: { points: 10000, itc: 100, reason: '100 orders milestone' },
    review_left: { points: 50, itc: 0, reason: 'Product review reward' },
    profile_completed: { points: 100, itc: 1, reason: 'Profile completion bonus' }
  }

  return milestones[milestoneType] || { points: 0, itc: 0, reason: 'Unknown milestone' }
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
  calculatedPoints: number,
  calculatedITC: number
): boolean {
  // Maximum realistic reward: 5% of order value in points (500 points per dollar)
  const maxPoints = orderTotal * 500

  // Maximum realistic ITC: 5% of order value
  const maxITC = orderTotal * 0.05

  return calculatedPoints <= maxPoints && calculatedITC <= maxITC
}

/**
 * Format reward message for notifications
 */
export function formatRewardMessage(reward: RewardCalculation, orderNumber: string): string {
  const parts: string[] = []

  parts.push(`Order #${orderNumber} completed!`)
  parts.push(`You earned ${reward.points.toLocaleString()} points`)

  if (reward.itc > 0) {
    parts.push(`and ${reward.itc.toFixed(2)} ITC`)
  }

  if (reward.tierBonus > 0) {
    parts.push(`(includes tier bonus)`)
  }

  return parts.join(' ')
}

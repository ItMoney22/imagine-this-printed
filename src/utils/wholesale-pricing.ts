import type { WholesaleProduct, WholesalePricing, BulkDiscount } from '../types'

export interface PricingCalculation {
  basePrice: number
  tierPrice: number
  bulkDiscountAmount: number
  finalPrice: number
  savingsAmount: number
  savingsPercentage: number
  minimumQuantity: number
  nextTierQuantity?: number
  nextTierPrice?: number
  volumeDiscount?: BulkDiscount
}

export interface OrderPricingBreakdown {
  subtotal: number
  tierDiscount: number
  bulkDiscount: number
  shippingDiscount: number
  total: number
  totalSavings: number
  items: OrderItemPricing[]
}

export interface OrderItemPricing {
  productId: string
  quantity: number
  basePrice: number
  tierPrice: number
  finalPrice: number
  lineTotal: number
  savings: number
}

export interface PricingTier {
  id: 'bronze' | 'silver' | 'gold' | 'platinum'
  name: string
  description: string
  minimumOrderValue: number
  discountPercentage: number
  paymentTerms: number
  creditLimit: number
  perks: string[]
}

export class WholesalePricingCalculator {
  private tiers: PricingTier[] = [
    {
      id: 'bronze',
      name: 'Bronze Tier',
      description: 'Entry level wholesale pricing',
      minimumOrderValue: 500,
      discountPercentage: 0.15, // 15% off retail
      paymentTerms: 15, // 15 days
      creditLimit: 5000,
      perks: [
        '15% off retail prices',
        '15-day payment terms',
        'Standard shipping rates',
        'Email support'
      ]
    },
    {
      id: 'silver',
      name: 'Silver Tier',
      description: 'Growing business pricing',
      minimumOrderValue: 1000,
      discountPercentage: 0.25, // 25% off retail
      paymentTerms: 30, // 30 days
      creditLimit: 15000,
      perks: [
        '25% off retail prices',
        '30-day payment terms',
        'Reduced shipping rates',
        'Priority email support',
        'Bulk discount eligibility'
      ]
    },
    {
      id: 'gold',
      name: 'Gold Tier',
      description: 'Established business pricing',
      minimumOrderValue: 2500,
      discountPercentage: 0.35, // 35% off retail
      paymentTerms: 45, // 45 days
      creditLimit: 35000,
      perks: [
        '35% off retail prices',
        '45-day payment terms',
        'Free shipping on orders $1000+',
        'Phone and email support',
        'Enhanced bulk discounts',
        'Early access to new products'
      ]
    },
    {
      id: 'platinum',
      name: 'Platinum Tier',
      description: 'Enterprise-level pricing',
      minimumOrderValue: 5000,
      discountPercentage: 0.45, // 45% off retail
      paymentTerms: 60, // 60 days
      creditLimit: 75000,
      perks: [
        '45% off retail prices',
        '60-day payment terms',
        'Free shipping on all orders',
        'Dedicated account manager',
        'Maximum bulk discounts',
        'Custom product development',
        'White-label options'
      ]
    }
  ]

  // Calculate pricing for a single product
  calculateProductPricing(
    product: WholesaleProduct,
    quantity: number,
    userTier: 'bronze' | 'silver' | 'gold' | 'platinum'
  ): PricingCalculation {
    const basePrice = product.retailPrice
    
    // Get tier-specific pricing
    const tierPricing = product.wholesalePricing.find(p => p.tier === userTier)
    const tierPrice = tierPricing?.price || basePrice
    const minimumQuantity = tierPricing?.minimumQuantity || product.minimumOrderQuantity

    // Check if quantity meets minimum requirement
    if (quantity < minimumQuantity) {
      return {
        basePrice,
        tierPrice: basePrice, // Use retail price if below MOQ
        bulkDiscountAmount: 0,
        finalPrice: basePrice,
        savingsAmount: 0,
        savingsPercentage: 0,
        minimumQuantity,
        nextTierQuantity: minimumQuantity,
        nextTierPrice: tierPrice
      }
    }

    // Find applicable bulk discount
    const bulkDiscount = this.findBestBulkDiscount(product.bulkDiscounts, quantity)
    const bulkDiscountAmount = bulkDiscount 
      ? tierPrice * (bulkDiscount.discountPercentage / 100)
      : 0

    const finalPrice = tierPrice - bulkDiscountAmount
    const savingsAmount = basePrice - finalPrice
    const savingsPercentage = (savingsAmount / basePrice) * 100

    // Find next tier information
    const nextTier = this.getNextTier(product.wholesalePricing, userTier)

    return {
      basePrice,
      tierPrice,
      bulkDiscountAmount,
      finalPrice,
      savingsAmount,
      savingsPercentage,
      minimumQuantity,
      nextTierQuantity: nextTier?.minimumQuantity,
      nextTierPrice: nextTier?.price,
      volumeDiscount: bulkDiscount
    }
  }

  // Calculate pricing for entire order
  calculateOrderPricing(
    items: Array<{
      product: WholesaleProduct
      quantity: number
    }>,
    userTier: 'bronze' | 'silver' | 'gold' | 'platinum'
  ): OrderPricingBreakdown {
    const itemPricings: OrderItemPricing[] = []
    let subtotal = 0
    let totalTierDiscount = 0
    let totalBulkDiscount = 0

    items.forEach(item => {
      const pricing = this.calculateProductPricing(item.product, item.quantity, userTier)
      const lineTotal = pricing.finalPrice * item.quantity
      const tierSavings = (pricing.basePrice - pricing.tierPrice) * item.quantity
      const bulkSavings = pricing.bulkDiscountAmount * item.quantity

      itemPricings.push({
        productId: item.product.id,
        quantity: item.quantity,
        basePrice: pricing.basePrice,
        tierPrice: pricing.tierPrice,
        finalPrice: pricing.finalPrice,
        lineTotal,
        savings: tierSavings + bulkSavings
      })

      subtotal += pricing.basePrice * item.quantity
      totalTierDiscount += tierSavings
      totalBulkDiscount += bulkSavings
    })

    // Calculate shipping discount based on tier
    const tierInfo = this.tiers.find(t => t.id === userTier)!
    const orderTotal = subtotal - totalTierDiscount - totalBulkDiscount
    
    let shippingDiscount = 0
    if (tierInfo.id === 'gold' && orderTotal >= 1000) {
      shippingDiscount = 50 // Free shipping saves $50
    } else if (tierInfo.id === 'platinum') {
      shippingDiscount = 50 // Always free shipping
    }

    const total = orderTotal - shippingDiscount
    const totalSavings = totalTierDiscount + totalBulkDiscount + shippingDiscount

    return {
      subtotal,
      tierDiscount: totalTierDiscount,
      bulkDiscount: totalBulkDiscount,
      shippingDiscount,
      total,
      totalSavings,
      items: itemPricings
    }
  }

  // Get tier information
  getTierInfo(tierId: 'bronze' | 'silver' | 'gold' | 'platinum'): PricingTier {
    return this.tiers.find(t => t.id === tierId)!
  }

  // Get all tiers
  getAllTiers(): PricingTier[] {
    return this.tiers
  }

  // Calculate tier upgrade benefits
  calculateTierUpgradeBenefits(
    currentTier: 'bronze' | 'silver' | 'gold' | 'platinum',
    targetTier: 'bronze' | 'silver' | 'gold' | 'platinum',
    monthlyOrderValue: number
  ): {
    additionalSavings: number
    additionalSavingsPercentage: number
    improvedPaymentTerms: number
    additionalCreditLimit: number
    newPerks: string[]
  } {
    const current = this.getTierInfo(currentTier)
    const target = this.getTierInfo(targetTier)

    const additionalSavingsPercentage = target.discountPercentage - current.discountPercentage
    const additionalSavings = monthlyOrderValue * additionalSavingsPercentage

    const improvedPaymentTerms = target.paymentTerms - current.paymentTerms
    const additionalCreditLimit = target.creditLimit - current.creditLimit

    // Find new perks
    const newPerks = target.perks.filter(perk => !current.perks.includes(perk))

    return {
      additionalSavings,
      additionalSavingsPercentage: additionalSavingsPercentage * 100,
      improvedPaymentTerms,
      additionalCreditLimit,
      newPerks
    }
  }

  // Check if user qualifies for tier upgrade
  checkTierEligibility(
    currentTier: 'bronze' | 'silver' | 'gold' | 'platinum',
    _totalSpent: number,
    averageOrderValue: number
  ): {
    currentTier: PricingTier
    qualifiesFor?: PricingTier
    nextTier?: PricingTier
    progressToNext: number // percentage
  } {
    const current = this.getTierInfo(currentTier)
    const sortedTiers = this.tiers.slice().sort((a, b) => a.minimumOrderValue - b.minimumOrderValue)
    const currentIndex = sortedTiers.findIndex(t => t.id === currentTier)

    // Check if they qualify for a higher tier
    let qualifiesFor: PricingTier | undefined
    for (let i = sortedTiers.length - 1; i > currentIndex; i--) {
      if (averageOrderValue >= sortedTiers[i].minimumOrderValue) {
        qualifiesFor = sortedTiers[i]
        break
      }
    }

    // Get next tier and progress
    const nextTier = currentIndex < sortedTiers.length - 1 ? sortedTiers[currentIndex + 1] : undefined
    const progressToNext = nextTier 
      ? Math.min(100, (averageOrderValue / nextTier.minimumOrderValue) * 100)
      : 100

    return {
      currentTier: current,
      qualifiesFor,
      nextTier,
      progressToNext
    }
  }

  // Generate pricing table for product
  generatePricingTable(product: WholesaleProduct, quantities: number[]): Array<{
    quantity: number
    pricing: Record<string, PricingCalculation>
  }> {
    return quantities.map(quantity => ({
      quantity,
      pricing: {
        bronze: this.calculateProductPricing(product, quantity, 'bronze'),
        silver: this.calculateProductPricing(product, quantity, 'silver'),
        gold: this.calculateProductPricing(product, quantity, 'gold'),
        platinum: this.calculateProductPricing(product, quantity, 'platinum')
      }
    }))
  }

  // Calculate ROI for purchasing in bulk
  calculateBulkROI(
    product: WholesaleProduct,
    baseQuantity: number,
    bulkQuantity: number,
    userTier: 'bronze' | 'silver' | 'gold' | 'platinum',
    expectedSellThrough: number = 0.8 // 80% sell-through rate
  ): {
    baseCost: number
    bulkCost: number
    potentialRevenue: number
    roi: number
    paybackPeriod: number // months
    riskAssessment: 'low' | 'medium' | 'high'
  } {
    const basePricing = this.calculateProductPricing(product, baseQuantity, userTier)
    const bulkPricing = this.calculateProductPricing(product, bulkQuantity, userTier)

    const baseCost = basePricing.finalPrice * baseQuantity
    const bulkCost = bulkPricing.finalPrice * bulkQuantity

    // Assume they can sell at 70% of retail price
    const sellingPrice = product.retailPrice * 0.7
    const potentialRevenue = sellingPrice * bulkQuantity * expectedSellThrough

    const roi = ((potentialRevenue - bulkCost) / bulkCost) * 100
    
    // Simple payback period calculation (assuming monthly turnover)
    const paybackPeriod = bulkCost / (potentialRevenue / 3) // 3 month turnover

    // Risk assessment based on quantity increase and ROI
    const quantityIncrease = (bulkQuantity - baseQuantity) / baseQuantity
    let riskAssessment: 'low' | 'medium' | 'high' = 'low'
    
    if (quantityIncrease > 5 || roi < 20) {
      riskAssessment = 'high'
    } else if (quantityIncrease > 2 || roi < 50) {
      riskAssessment = 'medium'
    }

    return {
      baseCost,
      bulkCost,
      potentialRevenue,
      roi,
      paybackPeriod,
      riskAssessment
    }
  }

  // Helper methods
  private findBestBulkDiscount(bulkDiscounts: BulkDiscount[], quantity: number): BulkDiscount | undefined {
    return bulkDiscounts
      .filter(discount => quantity >= discount.minimumQuantity)
      .sort((a, b) => b.discountPercentage - a.discountPercentage)[0]
  }

  private getNextTier(
    wholesalePricing: WholesalePricing[],
    currentTier: 'bronze' | 'silver' | 'gold' | 'platinum'
  ): WholesalePricing | undefined {
    const tierOrder = ['bronze', 'silver', 'gold', 'platinum']
    const currentIndex = tierOrder.indexOf(currentTier)
    
    if (currentIndex < tierOrder.length - 1) {
      const nextTierName = tierOrder[currentIndex + 1] as 'bronze' | 'silver' | 'gold' | 'platinum'
      return wholesalePricing.find(p => p.tier === nextTierName)
    }
    
    return undefined
  }
}

// Pricing display utilities
export class PricingDisplayUtils {
  static formatPrice(price: number): string {
    return `$${price.toFixed(2)}`
  }

  static formatSavings(savings: number, percentage: number): string {
    return `${this.formatPrice(savings)} (${percentage.toFixed(1)}% off)`
  }

  static formatMinimumOrder(quantity: number, unitName: string = 'unit'): string {
    return `${quantity} ${unitName}${quantity !== 1 ? 's' : ''} minimum`
  }

  static generatePriceBreakSummary(
    pricing: PricingCalculation,
    quantity: number
  ): string {
    if (quantity < pricing.minimumQuantity) {
      return `Order ${pricing.minimumQuantity - quantity} more to unlock wholesale pricing`
    }

    if (pricing.nextTierQuantity && pricing.nextTierPrice) {
      const additionalSavings = (pricing.finalPrice - pricing.nextTierPrice) * quantity
      return `Order ${pricing.nextTierQuantity - quantity} more to save an additional ${this.formatPrice(additionalSavings)}`
    }

    return 'Maximum discount tier reached'
  }

  static generateTierComparisonTable(_tiers: PricingTier[]): string {
    // This would generate a comparison table - implementation depends on UI framework
    return 'Tier comparison table'
  }
}

export const wholesalePricingCalculator = new WholesalePricingCalculator()
import type { CostVariables, ProductCostBreakdown, GPTCostQuery, CostAnalytics } from '../types'

export class CostManagementService {
  // Get cost variables for a manager
  async getCostVariables(managerId: string): Promise<CostVariables | null> {
    try {
      // In real app, this would query PostgreSQL with Prisma
      // Mock data for demo
      const mockCostVariables: CostVariables = {
        id: `cost_${managerId}`,
        managerId,
        filamentPricePerGram: 0.025, // $0.025 per gram
        electricityCostPerHour: 0.12, // $0.12 per hour
        averagePackagingCost: 2.50,
        monthlyRent: 3500,
        overheadPercentage: 15, // 15% overhead
        defaultMarginPercentage: 25, // 25% default margin
        laborRatePerHour: 25.00,
        lastUpdated: new Date().toISOString(),
        createdAt: '2025-01-01T00:00:00Z'
      }
      
      return mockCostVariables
    } catch (error) {
      console.error('Error fetching cost variables:', error)
      return null
    }
  }

  // Save cost variables
  async saveCostVariables(costVariables: Partial<CostVariables>): Promise<CostVariables> {
    try {
      // In real app, this would save to PostgreSQL with Prisma
      const savedVariables: CostVariables = {
        id: costVariables.id || `cost_${Date.now()}`,
        managerId: costVariables.managerId || '',
        locationId: costVariables.locationId,
        filamentPricePerGram: costVariables.filamentPricePerGram || 0,
        electricityCostPerHour: costVariables.electricityCostPerHour || 0,
        averagePackagingCost: costVariables.averagePackagingCost || 0,
        monthlyRent: costVariables.monthlyRent || 0,
        overheadPercentage: costVariables.overheadPercentage || 0,
        defaultMarginPercentage: costVariables.defaultMarginPercentage || 25,
        laborRatePerHour: costVariables.laborRatePerHour || 0,
        lastUpdated: new Date().toISOString(),
        createdAt: costVariables.createdAt || new Date().toISOString()
      }

      console.log('Saving cost variables:', savedVariables)
      return savedVariables
    } catch (error) {
      console.error('Error saving cost variables:', error)
      throw new Error('Failed to save cost variables')
    }
  }

  // Calculate product cost breakdown
  calculateProductCost(
    costVariables: CostVariables,
    printTimeHours: number,
    materialUsageGrams: number,
    customLaborHours?: number
  ): ProductCostBreakdown {
    const materialCost = materialUsageGrams * costVariables.filamentPricePerGram
    const electricityCost = printTimeHours * costVariables.electricityCostPerHour
    const laborCost = (customLaborHours || printTimeHours) * costVariables.laborRatePerHour
    const packagingCost = costVariables.averagePackagingCost
    
    // Calculate overhead as percentage of material + electricity + labor
    const directCosts = materialCost + electricityCost + laborCost + packagingCost
    const overheadCost = directCosts * (costVariables.overheadPercentage / 100)
    
    const totalCost = directCosts + overheadCost
    const suggestedMargin = costVariables.defaultMarginPercentage
    const suggestedPrice = totalCost / (1 - (suggestedMargin / 100))

    return {
      id: `breakdown_${Date.now()}`,
      productId: '',
      managerId: costVariables.managerId,
      printTimeHours,
      materialUsageGrams,
      materialCost,
      electricityCost,
      laborCost,
      packagingCost,
      overheadCost,
      totalCost,
      suggestedMargin,
      suggestedPrice,
      lastUpdated: new Date().toISOString(),
      createdAt: new Date().toISOString()
    }
  }

  // Save product cost breakdown
  async saveProductCostBreakdown(breakdown: ProductCostBreakdown): Promise<void> {
    try {
      // In real app, this would save to PostgreSQL with Prisma
      console.log('Saving product cost breakdown:', breakdown)
    } catch (error) {
      console.error('Error saving product cost breakdown:', error)
      throw new Error('Failed to save product cost breakdown')
    }
  }

  // Get cost breakdowns for manager
  async getCostBreakdowns(managerId: string): Promise<ProductCostBreakdown[]> {
    try {
      // Mock data for demo
      const mockBreakdowns: ProductCostBreakdown[] = [
        {
          id: 'breakdown_1',
          productId: 'product_1',
          managerId,
          printTimeHours: 3.5,
          materialUsageGrams: 85,
          materialCost: 2.13,
          electricityCost: 0.42,
          laborCost: 87.50,
          packagingCost: 2.50,
          overheadCost: 13.86,
          totalCost: 106.41,
          suggestedMargin: 25,
          suggestedPrice: 141.88,
          finalPrice: 139.99,
          lastUpdated: new Date().toISOString(),
          createdAt: '2025-01-10T00:00:00Z'
        },
        {
          id: 'breakdown_2',
          productId: 'product_2',
          managerId,
          printTimeHours: 1.2,
          materialUsageGrams: 25,
          materialCost: 0.63,
          electricityCost: 0.14,
          laborCost: 30.00,
          packagingCost: 2.50,
          overheadCost: 4.99,
          totalCost: 38.26,
          suggestedMargin: 25,
          suggestedPrice: 51.01,
          finalPrice: 49.99,
          lastUpdated: new Date().toISOString(),
          createdAt: '2025-01-11T00:00:00Z'
        }
      ]

      return mockBreakdowns
    } catch (error) {
      console.error('Error fetching cost breakdowns:', error)
      return []
    }
  }

  // GPT Cost Assistant
  async queryGPTAssistant(
    query: string,
    costVariables?: CostVariables,
    _context?: any
  ): Promise<string> {
    try {
      // In real app, this would call OpenAI API
      // Mock intelligent responses based on query patterns
      const lowerQuery = query.toLowerCase()

      if (lowerQuery.includes('price') && lowerQuery.includes('margin')) {
        const marginMatch = query.match(/(\d+)%?\s*margin/)
        const costMatch = query.match(/\$?(\d+\.?\d*)\s*(?:cost|costs)/)
        
        if (marginMatch && costMatch) {
          const margin = parseInt(marginMatch[1])
          const cost = parseFloat(costMatch[1])
          const price = cost / (1 - (margin / 100))
          
          return `To achieve a ${margin}% margin on a product that costs you $${cost.toFixed(2)}, you should price it at **$${price.toFixed(2)}**.

**Breakdown:**
- Cost: $${cost.toFixed(2)}
- Desired Margin: ${margin}%
- Selling Price: $${price.toFixed(2)}
- Profit: $${(price - cost).toFixed(2)}

**Analysis:** This gives you a healthy margin for covering unexpected costs and business growth. Consider your market positioning and competitor pricing when finalizing.`
        }
      }

      if (lowerQuery.includes('print') && lowerQuery.includes('cost')) {
        const timeMatch = query.match(/(\d+\.?\d*)\s*hour/)
        const materialMatch = query.match(/(\d+\.?\d*)\s*g/)
        
        if (timeMatch && materialMatch && costVariables) {
          const hours = parseFloat(timeMatch[1])
          const grams = parseFloat(materialMatch[1])
          const breakdown = this.calculateProductCost(costVariables, hours, grams)
          
          return `**Cost Breakdown for ${hours}h print with ${grams}g filament:**

💰 **Direct Costs:**
- Material (${grams}g): $${breakdown.materialCost.toFixed(2)}
- Electricity (${hours}h): $${breakdown.electricityCost.toFixed(2)}
- Labor (${hours}h): $${breakdown.laborCost.toFixed(2)}
- Packaging: $${breakdown.packagingCost.toFixed(2)}

🏢 **Overhead (${costVariables.overheadPercentage}%):** $${breakdown.overheadCost.toFixed(2)}

📊 **Total Cost:** $${breakdown.totalCost.toFixed(2)}
📈 **Suggested Price (${costVariables.defaultMarginPercentage}% margin):** $${breakdown.suggestedPrice.toFixed(2)}

**Recommendation:** This pricing ensures profitability while remaining competitive. Monitor material costs regularly as they can fluctuate.`
        }
      }

      if (lowerQuery.includes('margin') && lowerQuery.includes('recommend')) {
        return `**Recommended Margin Strategy:**

🎯 **Standard Products:** 25-35% margin
- Covers operational costs and growth investment
- Competitive in most markets

💎 **Premium/Custom Products:** 35-50% margin
- Higher value perception
- Justifies custom work and expertise

⚡ **Quick Turnaround:** 40-60% margin
- Premium for speed and priority handling
- Compensates for workflow disruption

📊 **Market Positioning Tips:**
- Research competitor pricing
- Consider your unique value proposition
- Factor in customer service quality
- Account for warranty/support costs

**Remember:** Higher margins allow for better customer service, quality improvements, and business sustainability.`
      }

      // Default response for unrecognized queries
      return `I can help you with cost and pricing calculations! Try asking me:

💡 **Example Questions:**
- "What should I price a product if it costs me $6.25 and I want 30% margin?"
- "How much does a 3-hour print with 80g filament cost at current rates?"
- "What margin should I recommend for premium products?"
- "Calculate the cost breakdown for a 2.5 hour print using 45g of material"

📊 **I can help with:**
- Cost calculations and breakdowns
- Margin analysis and recommendations
- Pricing strategy advice
- Profitability analysis

Just ask your question and I'll provide detailed analysis with actionable insights!`
    } catch (error) {
      console.error('Error querying GPT assistant:', error)
      return 'Sorry, I encountered an error processing your request. Please try again.'
    }
  }

  // Save GPT query for history
  async saveGPTQuery(query: GPTCostQuery): Promise<void> {
    try {
      // In real app, this would save to PostgreSQL with Prisma
      console.log('Saving GPT query:', query)
    } catch (error) {
      console.error('Error saving GPT query:', error)
    }
  }

  // Get cost analytics
  async getCostAnalytics(_managerId: string, period: string = 'month'): Promise<CostAnalytics> {
    try {
      // Mock analytics data
      const mockAnalytics: CostAnalytics = {
        period: `Last ${period}`,
        totalProducts: 24,
        averageCost: 67.45,
        averageMargin: 28.5,
        profitableProducts: 22,
        lowMarginProducts: [
          {
            productId: 'product_5',
            productName: 'Budget Phone Case',
            currentMargin: 12.5,
            suggestedMargin: 25.0
          },
          {
            productId: 'product_8',
            productName: 'Simple Keychain',
            currentMargin: 15.2,
            suggestedMargin: 25.0
          }
        ],
        costTrends: [
          { date: '2025-01-01', averageCost: 65.20, averageMargin: 27.8 },
          { date: '2025-01-02', averageCost: 66.15, averageMargin: 28.1 },
          { date: '2025-01-03', averageCost: 67.45, averageMargin: 28.5 },
          { date: '2025-01-04', averageCost: 68.90, averageMargin: 29.2 },
          { date: '2025-01-05', averageCost: 67.80, averageMargin: 28.9 }
        ]
      }

      return mockAnalytics
    } catch (error) {
      console.error('Error fetching cost analytics:', error)
      throw new Error('Failed to fetch cost analytics')
    }
  }

  // Format currency
  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount)
  }

  // Calculate margin percentage
  calculateMargin(cost: number, price: number): number {
    return ((price - cost) / price) * 100
  }

  // Calculate price from cost and margin
  calculatePriceFromMargin(cost: number, marginPercentage: number): number {
    return cost / (1 - (marginPercentage / 100))
  }

  // Validate cost inputs
  validateCostInputs(costVariables: Partial<CostVariables>): string[] {
    const errors: string[] = []

    if (!costVariables.filamentPricePerGram || costVariables.filamentPricePerGram <= 0) {
      errors.push('Filament price per gram must be greater than 0')
    }

    if (!costVariables.electricityCostPerHour || costVariables.electricityCostPerHour <= 0) {
      errors.push('Electricity cost per hour must be greater than 0')
    }

    if (!costVariables.laborRatePerHour || costVariables.laborRatePerHour <= 0) {
      errors.push('Labor rate per hour must be greater than 0')
    }

    if (costVariables.overheadPercentage !== undefined && (costVariables.overheadPercentage < 0 || costVariables.overheadPercentage > 100)) {
      errors.push('Overhead percentage must be between 0 and 100')
    }

    if (costVariables.defaultMarginPercentage !== undefined && (costVariables.defaultMarginPercentage < 0 || costVariables.defaultMarginPercentage > 100)) {
      errors.push('Default margin percentage must be between 0 and 100')
    }

    return errors
  }
}

export const costManagementService = new CostManagementService()

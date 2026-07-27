import { supabase } from '../lib/supabase'
import type { CostVariables, ProductCostBreakdown, GPTCostQuery, CostAnalytics } from '../types'

const COST_VARIABLES_TABLE = 'cost_variables'

/**
 * Starting values for a manager who has never saved. These are a suggestion,
 * not saved data — anything returned carrying these must be flagged
 * `source: 'defaults'` so the dashboard never implies they came from the DB.
 */
export const DEFAULT_COST_VARIABLES = {
  filamentPricePerGram: 0.025, // $0.025 per gram
  electricityCostPerHour: 0.12, // $0.12 per hour
  averagePackagingCost: 2.50,
  monthlyRent: 3500,
  overheadPercentage: 15, // 15% overhead
  defaultMarginPercentage: 25, // 25% default margin
  laborRatePerHour: 25.00
} as const

// Shape of a public.cost_variables row (see supabase/migrations/20260726_cost_variables.sql)
interface CostVariablesRow {
  id: string
  manager_id: string
  location_id: string | null
  filament_price_per_gram: number | string | null
  electricity_cost_per_hour: number | string | null
  average_packaging_cost: number | string | null
  monthly_rent: number | string | null
  overhead_percentage: number | string | null
  default_margin_percentage: number | string | null
  labor_rate_per_hour: number | string | null
  last_updated: string | null
  created_at: string | null
}

// Postgres DECIMAL arrives as a string over PostgREST; coerce without turning
// a legitimate 0 into a fallback.
function toNumber(value: number | string | null | undefined, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = typeof value === 'number' ? value : parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function mapRow(row: CostVariablesRow): CostVariables {
  return {
    id: row.id,
    managerId: row.manager_id,
    locationId: row.location_id ?? undefined,
    filamentPricePerGram: toNumber(row.filament_price_per_gram, 0),
    electricityCostPerHour: toNumber(row.electricity_cost_per_hour, 0),
    averagePackagingCost: toNumber(row.average_packaging_cost, 0),
    monthlyRent: toNumber(row.monthly_rent, 0),
    overheadPercentage: toNumber(row.overhead_percentage, 0),
    defaultMarginPercentage: toNumber(row.default_margin_percentage, 0),
    laborRatePerHour: toNumber(row.labor_rate_per_hour, 0),
    lastUpdated: row.last_updated || new Date().toISOString(),
    createdAt: row.created_at || new Date().toISOString(),
    source: 'database'
  }
}

export class CostManagementService {
  // Unsaved starting point, explicitly marked so callers can say so in the UI.
  buildDefaultCostVariables(managerId: string, loadError?: string): CostVariables {
    return {
      id: `cost_defaults_${managerId || 'anonymous'}`,
      managerId,
      ...DEFAULT_COST_VARIABLES,
      lastUpdated: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      source: 'defaults',
      ...(loadError ? { loadError } : {})
    }
  }

  /**
   * Read a manager's saved cost variables. Falls back to defaults when the
   * manager has never saved (or when the read fails) — the returned object's
   * `source` field says which, so callers can be honest about it.
   */
  async getCostVariables(managerId: string): Promise<CostVariables | null> {
    if (!managerId) return this.buildDefaultCostVariables('')

    try {
      const { data, error } = await supabase
        .from(COST_VARIABLES_TABLE)
        .select('*')
        .eq('manager_id', managerId)
        .order('last_updated', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        console.error('Error fetching cost variables:', error)
        return this.buildDefaultCostVariables(managerId, error.message)
      }

      if (!data) return this.buildDefaultCostVariables(managerId)

      return mapRow(data as CostVariablesRow)
    } catch (error) {
      console.error('Error fetching cost variables:', error)
      return this.buildDefaultCostVariables(
        managerId,
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }

  /**
   * Persist a manager's cost variables (one row per manager, upserted on
   * manager_id). Throws on failure — callers must not report success unless
   * this resolves.
   */
  async saveCostVariables(costVariables: Partial<CostVariables>): Promise<CostVariables> {
    const managerId = costVariables.managerId

    if (!managerId) {
      throw new Error('Cannot save cost variables without a manager account id.')
    }

    const payload = {
      manager_id: managerId,
      location_id: costVariables.locationId ?? null,
      filament_price_per_gram: costVariables.filamentPricePerGram ?? 0,
      electricity_cost_per_hour: costVariables.electricityCostPerHour ?? 0,
      average_packaging_cost: costVariables.averagePackagingCost ?? 0,
      monthly_rent: costVariables.monthlyRent ?? 0,
      overhead_percentage: costVariables.overheadPercentage ?? 0,
      default_margin_percentage: costVariables.defaultMarginPercentage ?? 25,
      labor_rate_per_hour: costVariables.laborRatePerHour ?? 0,
      last_updated: new Date().toISOString()
    }

    const { data, error } = await supabase
      .from(COST_VARIABLES_TABLE)
      .upsert(payload, { onConflict: 'manager_id' })
      .select()
      .single()

    if (error) {
      console.error('Error saving cost variables:', error)
      throw new Error(`Failed to save cost variables: ${error.message}`)
    }

    if (!data) {
      throw new Error('Failed to save cost variables: the database returned no row.')
    }

    return mapRow(data as CostVariablesRow)
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

  /**
   * Keyword-matched cost assistant. Despite the historical name, this makes NO
   * LLM call — it matches keywords in the question, runs the local pricing
   * formulas, and returns canned guidance. The UI is labelled accordingly
   * ("Keyword Assistant"); keep it that way unless a real model is wired in.
   */
  async queryGPTAssistant(
    query: string,
    costVariables?: CostVariables,
    _context?: any
  ): Promise<string> {
    try {
      // Keyword matching against the question — no network call, no model.
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

      // Default response for unrecognized queries.
      // These examples are kept in the phrasings the matcher above actually
      // recognizes (covered by cost-management.test.ts) — suggesting a question
      // that then falls through to this same text is how the tab earned its
      // "sounds like AI, isn't" reputation.
      return `I can help you with cost and pricing calculations! Try asking me:

💡 **Example Questions:**
- "What price gives a 30% margin on a $6.25 cost?"
- "How much does a 3 hour print with 80g filament cost?"
- "What margin do you recommend for premium products?"

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

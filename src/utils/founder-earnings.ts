import type { FounderEarnings, Order } from '../types'

export interface EarningsCalculation {
  saleAmount: number
  costOfGoods: number
  stripeFee: number
  grossProfit: number
  founderPercentage: number
  founderEarnings: number
  breakdown: {
    revenue: number
    cogs: number
    processingFees: number
    netProfit: number
    founderShare: number
    retainedEarnings: number
  }
}

export interface ProductCOGS {
  productId: string
  productName: string
  category: string
  materialCost: number
  laborCost: number
  overheadCost: number
  totalCOGS: number
  marginPercentage: number
}

export interface EarningsReport {
  period: {
    startDate: string
    endDate: string
    type: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  }
  totalRevenue: number
  totalCOGS: number
  totalStripeFees: number
  grossProfit: number
  founderEarnings: number
  retainedEarnings: number
  averageMargin: number
  topProducts: Array<{
    productId: string
    productName: string
    revenue: number
    profit: number
    units: number
  }>
  categoryBreakdown: Array<{
    category: string
    revenue: number
    profit: number
    margin: number
  }>
}

export class FounderEarningsService {
  private founderPercentage = 0.35 // 35% of profit goes to founder
  private stripeFeeRate = 0.035 // 3.5% Stripe processing fee

  // Calculate founder earnings for an order
  async calculateFounderEarnings(orderId: string): Promise<FounderEarnings> {
    try {
      // Get order details
      const order = await this.getOrder(orderId)
      if (!order) {
        throw new Error('Order not found')
      }

      // Calculate COGS for all items
      const totalCOGS = await this.calculateOrderCOGS(order)
      
      // Calculate breakdown
      const calculation = this.calculateEarningsBreakdown(
        order.total,
        totalCOGS,
        this.stripeFeeRate
      )

      // Create founder earnings record
      const founderEarnings: FounderEarnings = {
        id: `earnings_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        orderId,
        founderId: 'founder_user_id', // In real app, get from settings
        saleAmount: calculation.saleAmount,
        costOfGoods: calculation.costOfGoods,
        stripeFee: calculation.stripeFee,
        grossProfit: calculation.grossProfit,
        founderPercentage: calculation.founderPercentage,
        founderEarnings: calculation.founderEarnings,
        status: 'calculated',
        calculatedAt: new Date().toISOString()
      }

      // Save to database (mock)
      await this.saveFounderEarnings(founderEarnings)

      return founderEarnings
    } catch (error) {
      console.error('Error calculating founder earnings:', error)
      throw new Error('Failed to calculate founder earnings')
    }
  }

  // Calculate earnings breakdown
  calculateEarningsBreakdown(
    saleAmount: number,
    costOfGoods: number,
    stripeFeeRate: number = this.stripeFeeRate
  ): EarningsCalculation {
    const stripeFee = saleAmount * stripeFeeRate
    const grossProfit = saleAmount - costOfGoods - stripeFee
    const founderEarnings = grossProfit * this.founderPercentage
    const retainedEarnings = grossProfit - founderEarnings

    return {
      saleAmount,
      costOfGoods,
      stripeFee,
      grossProfit,
      founderPercentage: this.founderPercentage,
      founderEarnings,
      breakdown: {
        revenue: saleAmount,
        cogs: costOfGoods,
        processingFees: stripeFee,
        netProfit: grossProfit,
        founderShare: founderEarnings,
        retainedEarnings
      }
    }
  }

  // Get founder earnings with filtering
  async getFounderEarnings(
    founderId: string,
    filters?: {
      status?: FounderEarnings['status']
      startDate?: string
      endDate?: string
      limit?: number
      offset?: number
    }
  ): Promise<FounderEarnings[]> {
    try {
      // Mock earnings data - in real app, this would query database
      const mockEarnings: FounderEarnings[] = [
        {
          id: 'earnings_1',
          orderId: 'order_1',
          founderId,
          saleAmount: 89.99,
          costOfGoods: 35.60,
          stripeFee: 3.15,
          grossProfit: 51.24,
          founderPercentage: 0.35,
          founderEarnings: 17.93,
          status: 'paid',
          calculatedAt: '2025-01-10T10:30:00Z',
          paidAt: '2025-01-11T08:00:00Z'
        },
        {
          id: 'earnings_2',
          orderId: 'order_2',
          founderId,
          saleAmount: 156.50,
          costOfGoods: 78.25,
          stripeFee: 5.48,
          grossProfit: 72.77,
          founderPercentage: 0.35,
          founderEarnings: 25.47,
          status: 'calculated',
          calculatedAt: '2025-01-12T14:20:00Z'
        },
        {
          id: 'earnings_3',
          orderId: 'order_3',
          founderId,
          saleAmount: 245.00,
          costOfGoods: 110.25,
          stripeFee: 8.58,
          grossProfit: 126.17,
          founderPercentage: 0.35,
          founderEarnings: 44.16,
          status: 'pending',
          calculatedAt: '2025-01-12T16:45:00Z'
        }
      ]

      // Apply filters
      let filteredEarnings = mockEarnings

      if (filters?.status) {
        filteredEarnings = filteredEarnings.filter(e => e.status === filters.status)
      }

      if (filters?.startDate) {
        filteredEarnings = filteredEarnings.filter(e => e.calculatedAt >= filters.startDate!)
      }

      if (filters?.endDate) {
        filteredEarnings = filteredEarnings.filter(e => e.calculatedAt <= filters.endDate!)
      }

      // Apply pagination
      const offset = filters?.offset || 0
      const limit = filters?.limit || 50
      
      return filteredEarnings.slice(offset, offset + limit)
    } catch (error) {
      console.error('Error getting founder earnings:', error)
      throw new Error('Failed to get founder earnings')
    }
  }

  // Generate earnings report
  async generateEarningsReport(
    founderId: string,
    period: EarningsReport['period']
  ): Promise<EarningsReport> {
    try {
      const earnings = await this.getFounderEarnings(founderId, {
        startDate: period.startDate,
        endDate: period.endDate
      })

      const totalRevenue = earnings.reduce((sum, e) => sum + e.saleAmount, 0)
      const totalCOGS = earnings.reduce((sum, e) => sum + e.costOfGoods, 0)
      const totalStripeFees = earnings.reduce((sum, e) => sum + e.stripeFee, 0)
      const grossProfit = earnings.reduce((sum, e) => sum + e.grossProfit, 0)
      const founderEarnings = earnings.reduce((sum, e) => sum + e.founderEarnings, 0)
      const retainedEarnings = grossProfit - founderEarnings
      const averageMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0

      // Mock top products and category breakdown
      const topProducts = [
        {
          productId: 'product_1',
          productName: 'Custom T-Shirt',
          revenue: 2450.00,
          profit: 1225.00,
          units: 97
        },
        {
          productId: 'product_2',
          productName: 'DTF Transfer Pack',
          revenue: 1890.75,
          profit: 1134.45,
          units: 126
        },
        {
          productId: 'product_3',
          productName: 'Custom Hoodie',
          revenue: 1675.30,
          profit: 753.89,
          units: 42
        }
      ]

      const categoryBreakdown = [
        {
          category: 'shirts',
          revenue: 4250.00,
          profit: 2125.00,
          margin: 50.0
        },
        {
          category: 'dtf-transfers',
          revenue: 2890.75,
          profit: 1734.45,
          margin: 60.0
        },
        {
          category: 'hoodies',
          revenue: 1875.30,
          profit: 843.89,
          margin: 45.0
        }
      ]

      return {
        period,
        totalRevenue,
        totalCOGS,
        totalStripeFees,
        grossProfit,
        founderEarnings,
        retainedEarnings,
        averageMargin,
        topProducts,
        categoryBreakdown
      }
    } catch (error) {
      console.error('Error generating earnings report:', error)
      throw new Error('Failed to generate earnings report')
    }
  }

  // Get product COGS data
  async getProductCOGS(): Promise<ProductCOGS[]> {
    try {
      // Mock COGS data - in real app, this would come from product database
      return [
        {
          productId: 'product_1',
          productName: 'Custom T-Shirt',
          category: 'shirts',
          materialCost: 8.50,
          laborCost: 4.25,
          overheadCost: 2.75,
          totalCOGS: 15.50,
          marginPercentage: 40.0
        },
        {
          productId: 'product_2',
          productName: 'DTF Transfer',
          category: 'dtf-transfers',
          materialCost: 2.75,
          laborCost: 1.50,
          overheadCost: 0.75,
          totalCOGS: 5.00,
          marginPercentage: 44.4
        },
        {
          productId: 'product_3',
          productName: 'Custom Hoodie',
          category: 'hoodies',
          materialCost: 18.50,
          laborCost: 8.25,
          overheadCost: 5.25,
          totalCOGS: 32.00,
          marginPercentage: 30.4
        },
        {
          productId: 'product_4',
          productName: 'Stainless Tumbler',
          category: 'tumblers',
          materialCost: 12.75,
          laborCost: 3.50,
          overheadCost: 2.25,
          totalCOGS: 18.50,
          marginPercentage: 19.6
        }
      ]
    } catch (error) {
      console.error('Error getting product COGS:', error)
      throw new Error('Failed to get product COGS')
    }
  }

  // Update product COGS
  async updateProductCOGS(productId: string, cogs: Partial<ProductCOGS>): Promise<void> {
    try {
      // In real app, this would update the database
      console.log(`Updating COGS for product ${productId}:`, cogs)
    } catch (error) {
      console.error('Error updating product COGS:', error)
      throw new Error('Failed to update product COGS')
    }
  }

  // Process founder payout
  async processFounderPayout(founderId: string, amount?: number): Promise<void> {
    try {
      // Get pending earnings
      const pendingEarnings = await this.getFounderEarnings(founderId, {
        status: 'calculated'
      })

      const totalPending = pendingEarnings.reduce((sum, e) => sum + e.founderEarnings, 0)
      const payoutAmount = amount || totalPending

      if (payoutAmount > totalPending) {
        throw new Error('Insufficient pending earnings for payout')
      }

      // In real app, this would process payment via Stripe or ACH
      console.log(`Processing founder payout: $${payoutAmount} to founder ${founderId}`)

      // Update earnings status
      for (const earning of pendingEarnings) {
        earning.status = 'paid'
        earning.paidAt = new Date().toISOString()
        await this.saveFounderEarnings(earning)
      }

    } catch (error) {
      console.error('Error processing founder payout:', error)
      throw new Error('Failed to process founder payout')
    }
  }

  // Get earnings analytics
  async getEarningsAnalytics(
    _founderId: string,
    _period: 'week' | 'month' | 'quarter' | 'year'
  ): Promise<{
    chartData: Array<{
      date: string
      revenue: number
      profit: number
      founderEarnings: number
    }>
    trends: {
      revenueGrowth: number
      profitGrowth: number
      marginImprovement: number
    }
    projections: {
      monthlyRecurring: number
      annualProjection: number
    }
  }> {
    try {
      // Mock analytics data
      const chartData = [
        { date: '2025-01-01', revenue: 2450.30, profit: 1225.15, founderEarnings: 428.80 },
        { date: '2025-01-02', revenue: 1890.75, profit: 945.38, founderEarnings: 330.88 },
        { date: '2025-01-03', revenue: 3245.60, profit: 1622.80, founderEarnings: 567.98 },
        { date: '2025-01-04', revenue: 1675.30, profit: 837.65, founderEarnings: 293.18 },
        { date: '2025-01-05', revenue: 2789.45, profit: 1394.73, founderEarnings: 488.16 },
        { date: '2025-01-06', revenue: 3567.89, profit: 1783.95, founderEarnings: 624.38 },
        { date: '2025-01-07', revenue: 2234.75, profit: 1117.38, founderEarnings: 391.08 }
      ]

      return {
        chartData,
        trends: {
          revenueGrowth: 22.5, // Percentage growth
          profitGrowth: 28.3,
          marginImprovement: 3.8
        },
        projections: {
          monthlyRecurring: 8450.00,
          annualProjection: 101400.00
        }
      }
    } catch (error) {
      console.error('Error getting earnings analytics:', error)
      throw new Error('Failed to get earnings analytics')
    }
  }

  // Private helper methods
  private async getOrder(orderId: string): Promise<Order | null> {
    // Mock order data - in real app, this would query the database
    return {
      id: orderId,
      userId: 'customer_1',
      items: [
        {
          id: 'item_1',
          product: {
            id: 'product_1',
            name: 'Custom T-Shirt',
            description: 'Custom designed t-shirt',
            price: 25.99,
            images: ['image1.jpg'],
            category: 'shirts',
            inStock: true
          },
          quantity: 2,
          customDesign: 'custom-design-url'
        }
      ],
      total: 89.99,
      status: 'delivered',
      createdAt: '2025-01-10T08:00:00Z'
    }
  }

  private async calculateOrderCOGS(order: Order): Promise<number> {
    const productCOGS = await this.getProductCOGS()
    let totalCOGS = 0

    for (const item of order.items) {
      const cogs = productCOGS.find(c => c.productId === item.product.id)
      if (cogs) {
        totalCOGS += cogs.totalCOGS * item.quantity
      }
    }

    return totalCOGS
  }

  private async saveFounderEarnings(earnings: FounderEarnings): Promise<void> {
    // In real app, this would save to PostgreSQL with Prisma
    console.log('Saving founder earnings:', earnings)
  }

  // Utility methods
  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount)
  }

  formatPercentage(value: number): string {
    return `${value.toFixed(1)}%`
  }

  calculateMargin(revenue: number, cogs: number): number {
    return revenue > 0 ? ((revenue - cogs) / revenue) * 100 : 0
  }
}

export const founderEarningsService = new FounderEarningsService()

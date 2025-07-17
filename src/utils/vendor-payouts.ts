import type { VendorPayout, Order } from '../types'

export interface PayoutCalculation {
  saleAmount: number
  platformFeeRate: number
  platformFee: number
  stripeFeeRate: number
  stripeFee: number
  payoutAmount: number
  breakdown: {
    grossSale: number
    platformFeeAmount: number
    stripeFeeAmount: number
    netPayout: number
  }
}

export interface StripeConnectAccount {
  accountId: string
  isOnboarded: boolean
  payoutsEnabled: boolean
  requiresAction: boolean
  currentlyDue: string[]
  eventuallyDue: string[]
}

export class VendorPayoutService {
  private platformFeeRate = 0.07 // 7% platform fee
  private stripeFeeRate = 0.035 // 3.5% Stripe processing fee

  // Calculate payout breakdown for a sale
  calculatePayout(saleAmount: number): PayoutCalculation {
    const platformFee = saleAmount * this.platformFeeRate
    const stripeFee = saleAmount * this.stripeFeeRate
    const payoutAmount = saleAmount - platformFee - stripeFee

    return {
      saleAmount,
      platformFeeRate: this.platformFeeRate,
      platformFee,
      stripeFeeRate: this.stripeFeeRate,
      stripeFee,
      payoutAmount,
      breakdown: {
        grossSale: saleAmount,
        platformFeeAmount: platformFee,
        stripeFeeAmount: stripeFee,
        netPayout: payoutAmount
      }
    }
  }

  // Process vendor payout for an order
  async processVendorPayout(orderId: string, vendorId: string): Promise<VendorPayout> {
    try {
      // Get order details (mock implementation)
      const order = await this.getOrder(orderId)
      if (!order) {
        throw new Error('Order not found')
      }

      // Calculate payout
      const calculation = this.calculatePayout(order.total)

      // Create payout record
      const payout: VendorPayout = {
        id: `payout_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        vendorId,
        orderId,
        saleAmount: calculation.saleAmount,
        platformFeeRate: calculation.platformFeeRate,
        platformFee: calculation.platformFee,
        stripeFeeRate: calculation.stripeFeeRate,
        stripeFee: calculation.stripeFee,
        payoutAmount: calculation.payoutAmount,
        status: 'pending',
        createdAt: new Date().toISOString(),
        metadata: {
          productIds: order.items.map(item => item.product.id),
          customerEmail: 'customer@example.com' // In real app, get from order
        }
      }

      // In real app, this would save to database
      await this.savePayout(payout)

      // Process Stripe transfer (mock)
      await this.processStripeTransfer(payout)

      return payout
    } catch (error) {
      console.error('Error processing vendor payout:', error)
      throw new Error('Failed to process vendor payout')
    }
  }

  // Get vendor payouts with filtering
  async getVendorPayouts(
    vendorId: string,
    filters?: {
      status?: VendorPayout['status']
      startDate?: string
      endDate?: string
      limit?: number
      offset?: number
    }
  ): Promise<VendorPayout[]> {
    try {
      // Mock payouts data - in real app, this would query database
      const mockPayouts: VendorPayout[] = [
        {
          id: 'payout_1',
          vendorId,
          orderId: 'order_1',
          saleAmount: 89.99,
          platformFeeRate: 0.07,
          platformFee: 6.30,
          stripeFeeRate: 0.035,
          stripeFee: 3.15,
          payoutAmount: 80.54,
          status: 'paid',
          stripeTransferId: 'tr_1234567890',
          processedAt: '2025-01-10T10:30:00Z',
          createdAt: '2025-01-10T08:00:00Z',
          metadata: {
            productIds: ['product_1'],
            customerEmail: 'customer@example.com'
          }
        },
        {
          id: 'payout_2',
          vendorId,
          orderId: 'order_2',
          saleAmount: 156.50,
          platformFeeRate: 0.07,
          platformFee: 10.96,
          stripeFeeRate: 0.035,
          stripeFee: 5.48,
          payoutAmount: 140.06,
          status: 'processing',
          createdAt: '2025-01-12T14:20:00Z',
          metadata: {
            productIds: ['product_2', 'product_3'],
            customerEmail: 'customer2@example.com'
          }
        },
        {
          id: 'payout_3',
          vendorId,
          orderId: 'order_3',
          saleAmount: 245.00,
          platformFeeRate: 0.07,
          platformFee: 17.15,
          stripeFeeRate: 0.035,
          stripeFee: 8.58,
          payoutAmount: 219.27,
          status: 'pending',
          createdAt: '2025-01-12T16:45:00Z',
          metadata: {
            productIds: ['product_4'],
            customerEmail: 'customer3@example.com'
          }
        }
      ]

      // Apply filters
      let filteredPayouts = mockPayouts

      if (filters?.status) {
        filteredPayouts = filteredPayouts.filter(p => p.status === filters.status)
      }

      if (filters?.startDate) {
        filteredPayouts = filteredPayouts.filter(p => p.createdAt >= filters.startDate!)
      }

      if (filters?.endDate) {
        filteredPayouts = filteredPayouts.filter(p => p.createdAt <= filters.endDate!)
      }

      // Apply pagination
      const offset = filters?.offset || 0
      const limit = filters?.limit || 50
      
      return filteredPayouts.slice(offset, offset + limit)
    } catch (error) {
      console.error('Error getting vendor payouts:', error)
      throw new Error('Failed to get vendor payouts')
    }
  }

  // Get payout summary statistics
  async getPayoutSummary(vendorId: string, _period?: 'week' | 'month' | 'year'): Promise<{
    totalPayouts: number
    totalAmount: number
    totalFees: number
    pendingAmount: number
    averagePayout: number
    periodComparison?: {
      change: number
      isPositive: boolean
    }
  }> {
    try {
      const payouts = await this.getVendorPayouts(vendorId)
      
      const totalPayouts = payouts.length
      const totalAmount = payouts.reduce((sum, p) => sum + p.payoutAmount, 0)
      const totalFees = payouts.reduce((sum, p) => sum + p.platformFee + p.stripeFee, 0)
      const pendingAmount = payouts
        .filter(p => p.status === 'pending')
        .reduce((sum, p) => sum + p.payoutAmount, 0)
      const averagePayout = totalPayouts > 0 ? totalAmount / totalPayouts : 0

      return {
        totalPayouts,
        totalAmount,
        totalFees,
        pendingAmount,
        averagePayout,
        periodComparison: {
          change: 15.2, // Mock comparison - in real app, calculate from previous period
          isPositive: true
        }
      }
    } catch (error) {
      console.error('Error getting payout summary:', error)
      throw new Error('Failed to get payout summary')
    }
  }

  // Check Stripe Connect account status
  async getStripeConnectStatus(vendorId: string): Promise<StripeConnectAccount> {
    try {
      // In real app, this would check with Stripe API
      // Mock implementation
      return {
        accountId: `acct_${vendorId}`,
        isOnboarded: true,
        payoutsEnabled: true,
        requiresAction: false,
        currentlyDue: [],
        eventuallyDue: []
      }
    } catch (error) {
      console.error('Error checking Stripe Connect status:', error)
      throw new Error('Failed to check Stripe Connect status')
    }
  }

  // Create Stripe Connect onboarding link
  async createOnboardingLink(vendorId: string, returnUrl: string): Promise<string> {
    try {
      // In real app, this would create an account link with Stripe
      const mockOnboardingUrl = `https://connect.stripe.com/express/onboarding/${vendorId}?return_url=${encodeURIComponent(returnUrl)}`
      
      console.log('Creating onboarding link for vendor:', vendorId)
      return mockOnboardingUrl
    } catch (error) {
      console.error('Error creating onboarding link:', error)
      throw new Error('Failed to create onboarding link')
    }
  }

  // Request payout (for vendors to manually request early payout)
  async requestPayout(vendorId: string, amount?: number): Promise<void> {
    try {
      // Check available balance
      const summary = await this.getPayoutSummary(vendorId)
      const requestAmount = amount || summary.pendingAmount

      if (requestAmount > summary.pendingAmount) {
        throw new Error('Insufficient balance for payout request')
      }

      // In real app, this would trigger immediate payout via Stripe
      console.log(`Processing manual payout request: $${requestAmount} for vendor ${vendorId}`)
      
      // Mock processing time
      await new Promise(resolve => setTimeout(resolve, 1000))
      
    } catch (error) {
      console.error('Error requesting payout:', error)
      throw new Error('Failed to request payout')
    }
  }

  // Get payout analytics
  async getPayoutAnalytics(_vendorId: string, _period: 'week' | 'month' | 'year'): Promise<{
    chartData: Array<{
      date: string
      amount: number
      fees: number
    }>
    topProducts: Array<{
      productId: string
      productName: string
      totalSales: number
      totalPayouts: number
    }>
    monthlyTrends: {
      payoutGrowth: number
      feeOptimization: number
    }
  }> {
    try {
      // Mock analytics data
      const mockChartData = [
        { date: '2025-01-01', amount: 450.30, fees: 47.25 },
        { date: '2025-01-02', amount: 325.75, fees: 34.10 },
        { date: '2025-01-03', amount: 678.90, fees: 71.15 },
        { date: '2025-01-04', amount: 234.50, fees: 24.60 },
        { date: '2025-01-05', amount: 567.25, fees: 59.45 },
        { date: '2025-01-06', amount: 789.40, fees: 82.75 },
        { date: '2025-01-07', amount: 445.80, fees: 46.75 }
      ]

      const mockTopProducts = [
        {
          productId: 'product_1',
          productName: 'Custom T-Shirt Design',
          totalSales: 1250.00,
          totalPayouts: 1117.50
        },
        {
          productId: 'product_2',
          productName: 'DTF Transfer Pack',
          totalSales: 890.75,
          totalPayouts: 796.47
        },
        {
          productId: 'product_3',
          productName: 'Logo Design Service',
          totalSales: 675.30,
          totalPayouts: 603.89
        }
      ]

      return {
        chartData: mockChartData,
        topProducts: mockTopProducts,
        monthlyTrends: {
          payoutGrowth: 18.5, // Percentage growth
          feeOptimization: 2.3 // Percentage fee reduction
        }
      }
    } catch (error) {
      console.error('Error getting payout analytics:', error)
      throw new Error('Failed to get payout analytics')
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
            inStock: true,
            vendorId: 'vendor_1'
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

  private async savePayout(payout: VendorPayout): Promise<void> {
    // In real app, this would save to PostgreSQL with Prisma
    console.log('Saving payout:', payout)
  }

  private async processStripeTransfer(payout: VendorPayout): Promise<void> {
    try {
      // In real app, this would create a transfer via Stripe API
      console.log('Processing Stripe transfer:', {
        amount: payout.payoutAmount,
        destination: `acct_${payout.vendorId}`,
        transferGroup: payout.orderId
      })

      // Mock Stripe API call
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Update payout status
      payout.status = 'processing'
      payout.stripeTransferId = `tr_${Date.now()}`
      
    } catch (error) {
      console.error('Error processing Stripe transfer:', error)
      throw new Error('Failed to process Stripe transfer')
    }
  }

  // Utility method to format currency
  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount)
  }

  // Calculate fee percentage for display
  calculateFeePercentage(_saleAmount: number): number {
    return ((this.platformFeeRate + this.stripeFeeRate) * 100)
  }
}

export const vendorPayoutService = new VendorPayoutService()
import type {
  Kiosk,
  KioskSettings,
  KioskOrder,
  KioskAnalytics,
  StripeTerminalPayment,
  Product
} from '../types'

export class KioskService {
  // Get kiosk by ID
  async getKiosk(kioskId: string): Promise<Kiosk | null> {
    try {
      // Mock data - in real app, this would fetch from database
      const mockKiosk: Kiosk = {
        id: kioskId,
        name: 'Downtown Print Shop Kiosk',
        vendorId: 'vendor_123',
        kioskUserId: 'kiosk_user_123',
        location: 'Downtown Print Shop - Main Counter',
        isActive: true,
        commissionRate: 0.15, // 15% commission
        partnerCommissionRate: 0.05, // 5% partner commission
        accessUrl: `${window.location.origin}/kiosk/${kioskId}`,
        createdAt: '2025-01-01T00:00:00Z',
        lastActivity: new Date().toISOString(),
        totalSales: 15420.50,
        totalOrders: 234,
        settings: {
          allowCash: true,
          allowStripeTerminal: true,
          allowITCWallet: true,
          requireCustomerInfo: false,
          touchOptimized: true,
          kioskMode: true,
          autoLoginEnabled: true,
          sessionTimeout: 30,
          primaryColor: '#6B46C1',
          logoUrl: '/logo-kiosk.png',
          welcomeMessage: 'Welcome! Browse and order custom prints'
        }
      }

      return mockKiosk
    } catch (error) {
      console.error('Error fetching kiosk:', error)
      return null
    }
  }

  // Get vendor products for kiosk
  async getVendorProducts(vendorId: string): Promise<Product[]> {
    try {
      // Mock vendor products - in real app, filter by vendorId
      const mockProducts: Product[] = [
        {
          id: 'product_1',
          name: 'Custom T-Shirt',
          description: 'High-quality custom printed t-shirt',
          price: 24.99,
          images: ['https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&h=600&fit=crop'],
          category: 'shirts',
          inStock: true,
          vendorId,
          approved: true,
          createdAt: '2025-01-01T00:00:00Z'
        },
        {
          id: 'product_2',
          name: 'DTF Transfer',
          description: 'Premium direct-to-film transfer',
          price: 15.99,
          images: ['https://images.unsplash.com/photo-1503341504253-dff4815485f1?w=600&h=600&fit=crop'],
          category: 'dtf-transfers',
          inStock: true,
          vendorId,
          approved: true,
          createdAt: '2025-01-02T00:00:00Z'
        },
        {
          id: 'product_3',
          name: 'Custom Tumbler',
          description: '20oz insulated tumbler with custom design',
          price: 32.99,
          images: ['https://images.unsplash.com/photo-1544145945-f90425340c7e?w=600&h=600&fit=crop'],
          category: 'tumblers',
          inStock: true,
          vendorId,
          approved: true,
          createdAt: '2025-01-03T00:00:00Z'
        },
        {
          id: 'product_4',
          name: 'Premium Hoodie',
          description: 'Soft fleece hoodie perfect for custom printing',
          price: 45.99,
          images: ['https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=600&h=600&fit=crop'],
          category: 'hoodies',
          inStock: true,
          vendorId,
          approved: true,
          createdAt: '2025-01-04T00:00:00Z'
        }
      ]

      return mockProducts
    } catch (error) {
      console.error('Error fetching vendor products:', error)
      return []
    }
  }

  // Create kiosk order
  async createKioskOrder(order: Partial<KioskOrder>): Promise<KioskOrder> {
    try {
      // Fetch kiosk to get current commission rates
      const kiosk = await this.getKiosk(order.kioskId || '')

      // Default to standard rates if kiosk not found or rates not set
      const platformFeeRate = 0.07 // 7% base platform fee
      // Use kiosk specific commission rate if available (this is the partner's cut)
      const partnerCommissionRate = kiosk?.commissionRate || 0.15

      const total = order.total || 0

      // Calculate commissions
      // Partner gets their configured rate (e.g. 15%)
      const partnerCommission = total * partnerCommissionRate

      // Platform gets the fee
      const platformFee = total * platformFeeRate

      // Vendor gets the rest
      const vendorAmount = total - platformFee - partnerCommission

      // Generate Customer Identifier
      // Format: First Name (or Guest) + Last 4 of ID
      const namePart = (order.customerName || 'Guest').split(' ')[0].toUpperCase()
      const idPart = Math.floor(1000 + Math.random() * 9000) // 4 digit random number
      const customerIdentifier = `${namePart}-${idPart}`

      const kioskOrder: KioskOrder = {
        id: `kiosk_order_${Date.now()}`,
        kioskId: order.kioskId || '',
        vendorId: order.vendorId || '',
        customerId: order.customerId,
        items: order.items || [],
        total,
        paymentMethod: order.paymentMethod || 'card',
        paymentStatus: 'pending',
        stripeTerminalPaymentId: order.stripeTerminalPaymentId,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        receiptEmail: order.receiptEmail,
        notes: order.notes,
        customerIdentifier, // Store the identifier
        commission: {
          vendorAmount,
          platformFee,
          partnerCommission
        },
        createdAt: new Date().toISOString()
      }

      // In real app, save to database
      console.log('Creating kiosk order:', kioskOrder)

      return kioskOrder
    } catch (error) {
      console.error('Error creating kiosk order:', error)
      throw new Error('Failed to create kiosk order')
    }
  }

  // Process Stripe Terminal payment
  async processStripeTerminalPayment(
    amount: number,
    terminalId: string,
    metadata?: Record<string, any>
  ): Promise<StripeTerminalPayment> {
    try {
      // Mock Stripe Terminal payment - in real app, use Stripe Terminal SDK
      const payment: StripeTerminalPayment = {
        id: `pi_${Math.random().toString(36).substr(2, 9)}`,
        amount,
        currency: 'usd',
        status: Math.random() > 0.1 ? 'succeeded' : 'failed', // 90% success rate
        paymentMethodId: `pm_${Math.random().toString(36).substr(2, 9)}`,
        terminalId,
        receiptUrl: `https://receipt.stripe.com/${Math.random().toString(36).substr(2, 9)}`,
        metadata
      }

      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, 2000))

      console.log('Stripe Terminal payment processed:', payment)
      return payment
    } catch (error) {
      console.error('Error processing Stripe Terminal payment:', error)
      throw new Error('Payment processing failed')
    }
  }

  // Process cash payment
  async processCashPayment(
    amount: number,
    receivedAmount: number,
    kioskId: string
  ): Promise<{ success: boolean; change: number; receiptId: string }> {
    try {
      if (receivedAmount < amount) {
        throw new Error('Insufficient cash received')
      }

      const change = receivedAmount - amount
      const receiptId = `cash_${kioskId}_${Date.now()}`

      console.log('Cash payment processed:', { amount, receivedAmount, change, receiptId })

      return {
        success: true,
        change,
        receiptId
      }
    } catch (error) {
      console.error('Error processing cash payment:', error)
      throw error
    }
  }

  // Process ITC wallet payment
  async processITCWalletPayment(
    amount: number,
    customerEmail: string,
    kioskId: string
  ): Promise<{ success: boolean; transactionId: string; newBalance: number }> {
    try {
      // Mock ITC wallet processing - in real app, integrate with blockchain/wallet service
      const itcAmount = amount * 10 // $1 = 10 ITC tokens
      const mockCurrentBalance = 1000 // User's current ITC balance

      if (mockCurrentBalance < itcAmount) {
        throw new Error('Insufficient ITC balance')
      }

      const newBalance = mockCurrentBalance - itcAmount
      const transactionId = `itc_${kioskId}_${Date.now()}`

      console.log('ITC wallet payment processed:', {
        amount,
        itcAmount,
        customerEmail,
        transactionId,
        newBalance
      })

      return {
        success: true,
        transactionId,
        newBalance
      }
    } catch (error) {
      console.error('Error processing ITC wallet payment:', error)
      throw error
    }
  }

  // Complete kiosk order
  async completeKioskOrder(orderId: string, paymentData: any): Promise<KioskOrder> {
    try {
      // In real app, update order in database
      const updatedOrder: KioskOrder = {
        id: orderId,
        kioskId: 'kiosk_123',
        vendorId: 'vendor_123',
        items: [],
        total: paymentData.amount || 0,
        paymentMethod: paymentData.method || 'card',
        paymentStatus: 'completed',
        stripeTerminalPaymentId: paymentData.stripeTerminalPaymentId,
        customerName: paymentData.customerName,
        customerEmail: paymentData.customerEmail,
        commission: {
          vendorAmount: 0,
          platformFee: 0,
          partnerCommission: 0
        },
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      }

      console.log('Kiosk order completed:', updatedOrder)
      return updatedOrder
    } catch (error) {
      console.error('Error completing kiosk order:', error)
      throw new Error('Failed to complete order')
    }
  }

  // Get kiosk analytics
  async getKioskAnalytics(kioskId: string, period: string = 'week'): Promise<KioskAnalytics> {
    try {
      // Mock analytics data
      const analytics: KioskAnalytics = {
        kioskId,
        period: `Last ${period}`,
        totalSales: 3240.50,
        totalOrders: 47,
        averageOrderValue: 68.95,
        paymentMethodBreakdown: {
          card: { count: 32, amount: 2180.75 },
          cash: { count: 10, amount: 645.25 },
          itcWallet: { count: 5, amount: 414.50 }
        },
        hourlyBreakdown: [
          { hour: 9, sales: 145.50, orders: 3 },
          { hour: 10, sales: 289.75, orders: 4 },
          { hour: 11, sales: 412.25, orders: 6 },
          { hour: 12, sales: 567.00, orders: 8 },
          { hour: 13, sales: 434.50, orders: 7 },
          { hour: 14, sales: 378.25, orders: 5 },
          { hour: 15, sales: 623.75, orders: 9 },
          { hour: 16, sales: 389.50, orders: 5 }
        ],
        topProducts: [
          { productId: 'product_1', productName: 'Custom T-Shirt', quantity: 18, revenue: 449.82 },
          { productId: 'product_3', productName: 'Custom Tumbler', quantity: 12, revenue: 395.88 },
          { productId: 'product_2', productName: 'DTF Transfer', quantity: 8, revenue: 127.92 },
          { productId: 'product_4', productName: 'Premium Hoodie', quantity: 5, revenue: 229.95 }
        ],
        commission: {
          vendorEarnings: 2754.43,
          platformFees: 226.84,
          partnerCommission: 162.03
        }
      }

      return analytics
    } catch (error) {
      console.error('Error fetching kiosk analytics:', error)
      throw new Error('Failed to fetch analytics')
    }
  }

  // Create new kiosk (admin function)
  async createKiosk(kioskData: Partial<Kiosk>): Promise<Kiosk> {
    try {
      const kioskId = `kiosk_${Date.now()}`
      const kioskUserId = `kiosk_user_${Date.now()}`

      const newKiosk: Kiosk = {
        id: kioskId,
        name: kioskData.name || 'New Kiosk',
        vendorId: kioskData.vendorId || '',
        kioskUserId,
        location: kioskData.location || '',
        isActive: true,
        commissionRate: kioskData.commissionRate || 0.15,
        partnerCommissionRate: kioskData.partnerCommissionRate || 0.05,
        accessUrl: `${window.location.origin}/kiosk/${kioskId}`,
        createdAt: new Date().toISOString(),
        totalSales: 0,
        totalOrders: 0,
        settings: kioskData.settings || {
          allowCash: true,
          allowStripeTerminal: true,
          allowITCWallet: true,
          requireCustomerInfo: false,
          touchOptimized: true,
          kioskMode: true,
          autoLoginEnabled: true,
          sessionTimeout: 30,
          primaryColor: '#6B46C1',
          welcomeMessage: 'Welcome! Browse and order custom prints'
        }
      }

      // In real app, save to database and create kiosk user account
      console.log('Created new kiosk:', newKiosk)

      return newKiosk
    } catch (error) {
      console.error('Error creating kiosk:', error)
      throw new Error('Failed to create kiosk')
    }
  }

  // Get all kiosks (admin function)
  async getAllKiosks(): Promise<Kiosk[]> {
    try {
      // Mock data - in real app, fetch from database
      const mockKiosks: Kiosk[] = [
        {
          id: 'kiosk_1',
          name: 'Downtown Print Shop',
          vendorId: 'vendor_123',
          kioskUserId: 'kiosk_user_123',
          location: 'Downtown Print Shop - Main Counter',
          isActive: true,
          commissionRate: 0.15,
          partnerCommissionRate: 0.05,
          accessUrl: `${window.location.origin}/kiosk/kiosk_1`,
          createdAt: '2025-01-01T00:00:00Z',
          lastActivity: new Date().toISOString(),
          totalSales: 15420.50,
          totalOrders: 234,
          settings: {
            allowCash: true,
            allowStripeTerminal: true,
            allowITCWallet: true,
            requireCustomerInfo: false,
            touchOptimized: true,
            kioskMode: true,
            autoLoginEnabled: true,
            sessionTimeout: 30,
            primaryColor: '#6B46C1',
            welcomeMessage: 'Welcome to Downtown Print Shop!'
          }
        },
        {
          id: 'kiosk_2',
          name: 'Mall Kiosk',
          vendorId: 'vendor_456',
          kioskUserId: 'kiosk_user_456',
          location: 'Westfield Mall - Level 2',
          isActive: true,
          commissionRate: 0.12,
          partnerCommissionRate: 0.08,
          accessUrl: `${window.location.origin}/kiosk/kiosk_2`,
          createdAt: '2025-01-15T00:00:00Z',
          lastActivity: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          totalSales: 8975.25,
          totalOrders: 156,
          settings: {
            allowCash: false,
            allowStripeTerminal: true,
            allowITCWallet: true,
            requireCustomerInfo: true,
            touchOptimized: true,
            kioskMode: true,
            autoLoginEnabled: true,
            sessionTimeout: 15,
            primaryColor: '#EC4899',
            welcomeMessage: 'Quick custom prints at the mall!'
          }
        }
      ]

      return mockKiosks
    } catch (error) {
      console.error('Error fetching all kiosks:', error)
      return []
    }
  }

  // Update kiosk settings
  async updateKioskSettings(kioskId: string, settings: Partial<KioskSettings>): Promise<Kiosk> {
    try {
      // In real app, update in database
      const updatedKiosk = await this.getKiosk(kioskId)
      if (!updatedKiosk) {
        throw new Error('Kiosk not found')
      }

      updatedKiosk.settings = { ...updatedKiosk.settings, ...settings }

      console.log('Updated kiosk settings:', updatedKiosk)
      return updatedKiosk
    } catch (error) {
      console.error('Error updating kiosk settings:', error)
      throw new Error('Failed to update kiosk settings')
    }
  }

  // Generate kiosk access URL or PWA manifest
  generateKioskAccess(kioskId: string): { url: string; pwaManifest: any; qrCode: string } {
    const url = `${window.location.origin}/kiosk/${kioskId}`

    const pwaManifest = {
      name: `Kiosk ${kioskId}`,
      short_name: 'Kiosk',
      description: 'Point of Sale Kiosk',
      start_url: `/kiosk/${kioskId}`,
      display: 'fullscreen',
      orientation: 'landscape',
      theme_color: '#6B46C1',
      background_color: '#FFFFFF',
      icons: [
        {
          src: '/kiosk-icon-192.png',
          sizes: '192x192',
          type: 'image/png'
        },
        {
          src: '/kiosk-icon-512.png',
          sizes: '512x512',
          type: 'image/png'
        }
      ]
    }

    // In real app, generate QR code
    const qrCode = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text x='50' y='50' text-anchor='middle' font-size='8'>QR Code for ${url}</text></svg>`

    return { url, pwaManifest, qrCode }
  }
}

export const kioskService = new KioskService()

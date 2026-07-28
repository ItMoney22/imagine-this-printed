import { supabase } from '../lib/supabase'
import { API_BASE } from '../lib/api'
import type {
  Kiosk,
  KioskSettings,
  KioskOrder,
  KioskAnalytics,
  StripeTerminalPayment,
  Product,
  CartItem
} from '../types'

function mapKioskRow(row: any): Kiosk {
  return {
    id: row.id,
    name: row.name,
    vendorId: row.vendor_id,
    kioskUserId: row.kiosk_user_id,
    location: row.location,
    isActive: row.is_active,
    commissionRate: row.commission_rate,
    partnerCommissionRate: row.partner_commission_rate,
    accessUrl: row.access_url,
    createdAt: row.created_at,
    lastActivity: row.last_activity,
    totalSales: row.total_sales,
    totalOrders: row.total_orders,
    settings: row.settings as KioskSettings
  }
}

function mapProductRow(row: any): Product {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    price: row.price,
    images: row.images || [],
    category: row.category,
    inStock: row.in_stock,
    vendorId: row.vendor_id,
    approved: row.approved,
    createdAt: row.created_at
  }
}

async function parseJsonError(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => ({}))
  throw new Error(body.error || fallback)
}

export class KioskService {
  // Direct Supabase lookup by kiosk ID, RLS-gated: vendors see their own
  // kiosks ("Vendors can manage their own kiosks" — auth.uid() = vendor_id),
  // everyone else gets nothing. The public "any active kiosk is readable"
  // policy this used to rely on was dropped in
  // supabase/migrations/20260728_kiosk_device_sessions.sql — it let the
  // public anon key read every kiosk's commission rates and settings.
  //
  // The kiosk TERMINAL flow does not call this anymore — KioskAuthContext
  // gets kiosk data back from POST /api/kiosk/session instead, gated by a
  // per-device secret rather than a guessable URL id. This stays for
  // admin/vendor tooling (e.g. a future KioskManagement detail view).
  async getKiosk(kioskId: string): Promise<Kiosk | null> {
    try {
      const { data, error } = await supabase.from('kiosks').select('*').eq('id', kioskId).maybeSingle()
      if (error || !data) return null
      return mapKioskRow(data)
    } catch (error) {
      console.error('Error fetching kiosk:', error)
      return null
    }
  }

  // Vendor's sellable catalog, for admin/preview contexts. Safe as a direct
  // client query: `products` already grants public SELECT for
  // approved+active rows (same policy the main storefront uses), so this
  // exposes nothing a shopper couldn't already see in the catalog.
  //
  // The real kiosk terminal flow uses getSessionProducts() below instead,
  // which resolves the vendor from the authenticated session server-side —
  // never from a client-supplied vendorId.
  async getVendorProducts(vendorId: string): Promise<Product[]> {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, description, price, images, category, in_stock, vendor_id, approved, created_at')
        .eq('vendor_id', vendorId)
        .eq('approved', true)
        .eq('status', 'active')
        .eq('in_stock', true)
      if (error || !data) return []
      return data.map(mapProductRow)
    } catch (error) {
      console.error('Error fetching vendor products:', error)
      return []
    }
  }

  // ---------------------------------------------------------------------
  // Authenticated kiosk-terminal operations. Each requires the session
  // token issued by POST /api/kiosk/session (see KioskAuthContext.tsx). The
  // backend (backend/routes/kiosk.ts) resolves kioskId/vendorId from that
  // session, never from anything the client sends — a compromised kiosk
  // can only ever act as itself.

  async getSessionProducts(sessionToken: string): Promise<Product[]> {
    try {
      const res = await fetch(`${API_BASE}/api/kiosk/products`, {
        headers: { Authorization: `Bearer ${sessionToken}` }
      })
      if (!res.ok) return []
      return await res.json()
    } catch (error) {
      console.error('Error fetching session products:', error)
      return []
    }
  }

  // Creates a REAL order + order_items row in Supabase. This replaces the
  // old mock that only console.logged — the actual bug this task fixes is
  // that a customer paying cash at a kiosk left zero record anywhere.
  async createKioskOrder(sessionToken: string, order: {
    items: CartItem[]
    paymentMethod: 'card' | 'cash' | 'itc_wallet'
    customerName?: string
    customerEmail?: string
    customerPhone?: string
  }): Promise<KioskOrder> {
    const res = await fetch(`${API_BASE}/api/kiosk/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify(order)
    })
    if (!res.ok) return parseJsonError(res, 'Failed to create kiosk order')
    return res.json()
  }

  async completeKioskOrder(sessionToken: string, orderId: string, paymentData: { paymentIntentId?: string }): Promise<KioskOrder> {
    const res = await fetch(`${API_BASE}/api/kiosk/orders/${orderId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify(paymentData)
    })
    if (!res.ok) return parseJsonError(res, 'Failed to complete kiosk order')
    return res.json()
  }

  // ---------------------------------------------------------------------
  // Payment processing. Cash and ITC wallet are local calculations (kept
  // as-is from before this task). Card payment is still SIMULATED — wiring
  // real Stripe Terminal hardware (physical reader registration, the
  // Terminal SDK, a connection token endpoint) is a separate follow-up; see
  // the campaign handoff REMAINING section. What changed in THIS task is
  // that createKioskOrder/completeKioskOrder now persist a real row
  // regardless of which of these ran, instead of only console.logging.

  async processStripeTerminalPayment(
    amount: number,
    terminalId: string,
    metadata?: Record<string, any>
  ): Promise<StripeTerminalPayment> {
    try {
      // SIMULATED — see comment above. Not a real Stripe Terminal call.
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

      await new Promise(resolve => setTimeout(resolve, 2000))

      return payment
    } catch (error) {
      console.error('Error processing Stripe Terminal payment:', error)
      throw new Error('Payment processing failed')
    }
  }

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

  async processITCWalletPayment(
    amount: number,
    customerEmail: string,
    kioskId: string
  ): Promise<{ success: boolean; transactionId: string; newBalance: number }> {
    try {
      // Still a placeholder balance check — real ITC wallet debit is out of
      // scope for this task (kiosk session security + real order
      // persistence). Flagged under REMAINING in the campaign handoff.
      const itcAmount = amount * 10 // $1 = 10 ITC tokens
      const mockCurrentBalance = 1000

      if (mockCurrentBalance < itcAmount) {
        throw new Error('Insufficient ITC balance')
      }

      const newBalance = mockCurrentBalance - itcAmount
      const transactionId = `itc_${kioskId}_${Date.now()}`

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

  // ---------------------------------------------------------------------
  // Admin kiosk-management (KioskManagement.tsx). NOT part of this task's
  // deliverables (getKiosk / getVendorProducts / createKioskOrder /
  // completeKioskOrder only) — still mock. Flagged under REMAINING in the
  // campaign handoff rather than silently left as-is.

  async getKioskAnalytics(kioskId: string, period: string = 'week'): Promise<KioskAnalytics> {
    try {
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

  // Create new kiosk (admin function) — still mock, see note above.
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

      console.log('Created new kiosk:', newKiosk)

      return newKiosk
    } catch (error) {
      console.error('Error creating kiosk:', error)
      throw new Error('Failed to create kiosk')
    }
  }

  // Get all kiosks (admin function) — still mock, see note above.
  async getAllKiosks(): Promise<Kiosk[]> {
    try {
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

  // Update kiosk settings (admin function) — still mock, see note above.
  async updateKioskSettings(kioskId: string, settings: Partial<KioskSettings>): Promise<Kiosk> {
    try {
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

    const qrCode = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text x='50' y='50' text-anchor='middle' font-size='8'>QR Code for ${url}</text></svg>`

    return { url, pwaManifest, qrCode }
  }
}

export const kioskService = new KioskService()

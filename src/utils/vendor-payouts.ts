/**
 * Vendor payouts — thin, vendor-scoped client over the real backend.
 *
 * Every method here talks to a live endpoint. There is no mock data, no
 * fabricated history and no setTimeout stand-in for a payout.
 *
 * Two backends are involved, on purpose:
 *   • Stripe Connect ACCOUNT concerns (status / create-account /
 *     onboarding-link) reuse /api/wallet/connect/* — one Express account per
 *     user already lives in stripe_connect_accounts, and the onboarding link
 *     it returns is a real Stripe-hosted accountLinks URL (the old
 *     hand-built connect.stripe.com/express/onboarding/<id> link 404'd).
 *   • Vendor MONEY movement uses /api/vendor/payouts* — vendor earnings are
 *     USD owed on product sales, not an ITC wallet balance, so they must not
 *     go through /api/wallet/connect/cashout (which debits itc_balance).
 */

import { apiFetch } from '../lib/api'
import type { VendorPayout } from '../types'

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

export interface PayoutConfig {
  platformFeeRate: number
  stripeFeeRate: number
  minimumPayoutUsd: number
}

export interface PayoutSummary {
  totalPayouts: number
  totalAmount: number
  totalFees: number
  pendingAmount: number
  processingAmount: number
  paidAmount: number
  availableAmount: number
  averagePayout: number
  periodComparison: { change: number; isPositive: boolean } | null
  config: PayoutConfig
}

export interface PayoutAnalytics {
  chartData: Array<{ date: string; amount: number; fees: number }>
  topProducts: Array<{ productId: string; productName: string; totalSales: number; totalPayouts: number }>
  monthlyTrends: { payoutGrowth: number; feeOptimization: number }
}

/** Shape returned by /api/wallet/connect/status, plus the aliases the UI reads. */
export interface StripeConnectAccount {
  hasAccount: boolean
  accountId: string | null
  isOnboarded: boolean
  payoutsEnabled: boolean
  instantPayoutsEnabled: boolean
  requiresAction: boolean
  currentlyDue: string[]
  externalAccountLast4: string | null
  externalAccountBrand: string | null
}

export interface PayoutRequestResult {
  batchId?: string
  transferId?: string
  payoutId?: string
  amount: number
  payoutCount: number
  message: string
  warning?: string
}

export interface PayoutFilters {
  status?: VendorPayout['status'] | 'all'
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
}

const DEFAULT_CONFIG: PayoutConfig = {
  platformFeeRate: 0.07,
  stripeFeeRate: 0.035,
  minimumPayoutUsd: 25
}

/** A vendor_payouts row exactly as Postgres returns it (snake_case). */
interface PayoutRow {
  id: string
  vendor_id: string
  order_id: string
  product_id?: string | null
  sale_amount?: number | string | null
  platform_fee_rate?: number | string | null
  platform_fee?: number | string | null
  stripe_fee_rate?: number | string | null
  stripe_fee?: number | string | null
  payout_amount?: number | string | null
  status: VendorPayout['status']
  stripe_transfer_id?: string | null
  stripe_payout_id?: string | null
  payout_batch_id?: string | null
  failure_reason?: string | null
  processed_at?: string | null
  created_at: string
  metadata?: VendorPayout['metadata'] | null
}

function mapPayout(row: PayoutRow): VendorPayout {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    orderId: row.order_id,
    productId: row.product_id ?? undefined,
    saleAmount: Number(row.sale_amount) || 0,
    platformFeeRate: Number(row.platform_fee_rate) || 0,
    platformFee: Number(row.platform_fee) || 0,
    stripeFeeRate: Number(row.stripe_fee_rate) || 0,
    stripeFee: Number(row.stripe_fee) || 0,
    payoutAmount: Number(row.payout_amount) || 0,
    status: row.status,
    stripeTransferId: row.stripe_transfer_id ?? undefined,
    stripePayoutId: row.stripe_payout_id ?? undefined,
    payoutBatchId: row.payout_batch_id ?? undefined,
    failureReason: row.failure_reason ?? undefined,
    processedAt: row.processed_at ?? undefined,
    createdAt: row.created_at,
    metadata: row.metadata ?? undefined
  }
}

export class VendorPayoutService {
  /** Last config seen from the server; falls back to the documented split. */
  private config: PayoutConfig = { ...DEFAULT_CONFIG }

  getConfig(): PayoutConfig {
    return this.config
  }

  /** Fee breakdown for a hypothetical sale, using the server's live rates. */
  calculatePayout(saleAmount: number): PayoutCalculation {
    const { platformFeeRate, stripeFeeRate } = this.config
    const round2 = (n: number) => Math.round(n * 100) / 100
    const platformFee = round2(saleAmount * platformFeeRate)
    const stripeFee = round2(saleAmount * stripeFeeRate)
    const payoutAmount = round2(saleAmount - platformFee - stripeFee)

    return {
      saleAmount,
      platformFeeRate,
      platformFee,
      stripeFeeRate,
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

  /** Real payout ledger for the signed-in vendor (identity comes from the JWT). */
  async getVendorPayouts(filters: PayoutFilters = {}): Promise<VendorPayout[]> {
    const params = new URLSearchParams()
    if (filters.status && filters.status !== 'all') params.set('status', filters.status)
    if (filters.startDate) params.set('startDate', filters.startDate)
    if (filters.endDate) params.set('endDate', filters.endDate)
    if (filters.limit) params.set('limit', String(filters.limit))
    if (filters.offset) params.set('offset', String(filters.offset))

    const qs = params.toString()
    const response = await apiFetch(`/api/vendor/payouts${qs ? `?${qs}` : ''}`, { method: 'GET' })
    return (response?.payouts || []).map(mapPayout)
  }

  async getPayoutSummary(): Promise<PayoutSummary> {
    const response = await apiFetch('/api/vendor/payouts/summary', { method: 'GET' })
    const summary: PayoutSummary = response.summary
    if (summary?.config) this.config = summary.config
    return summary
  }

  async getPayoutAnalytics(period: 'week' | 'month' | 'year' = 'week'): Promise<PayoutAnalytics> {
    const response = await apiFetch(`/api/vendor/payouts/analytics?period=${period}`, { method: 'GET' })
    return response.analytics
  }

  /**
   * Live Stripe Connect account status for this vendor. `isOnboarded` is the
   * real details_submitted flag from Stripe — never an unconditional true.
   */
  async getStripeConnectStatus(): Promise<StripeConnectAccount> {
    const response = await apiFetch('/api/wallet/connect/status', { method: 'GET' })
    const status = response?.status || {}
    return {
      hasAccount: !!status.hasAccount,
      accountId: status.accountId ?? null,
      isOnboarded: !!status.onboardingComplete,
      payoutsEnabled: !!status.payoutsEnabled,
      instantPayoutsEnabled: !!status.instantPayoutsEnabled,
      requiresAction: !!status.requiresAction,
      currentlyDue: status.currentlyDue || [],
      externalAccountLast4: status.externalAccountLast4 ?? null,
      externalAccountBrand: status.externalAccountBrand ?? null
    }
  }

  /**
   * Create the Express account if the vendor doesn't have one yet, then return
   * a real Stripe-hosted onboarding URL to send them to.
   */
  async createOnboardingLink(returnUrl: string, refreshUrl?: string): Promise<string> {
    const status = await this.getStripeConnectStatus()

    if (!status.hasAccount) {
      await apiFetch('/api/wallet/connect/create-account', { method: 'POST' })
    }

    const response = await apiFetch('/api/wallet/connect/onboarding-link', {
      method: 'POST',
      body: JSON.stringify({ returnUrl, refreshUrl: refreshUrl || returnUrl })
    })

    if (!response?.url) {
      throw new Error(response?.error || 'Stripe did not return an onboarding link')
    }
    return response.url
  }

  /**
   * Request a real payout. The backend claims the vendor's pending ledger rows,
   * transfers from the platform balance to their connected account and creates
   * the Stripe payout — no timers, no fake success.
   */
  async requestPayout(amount?: number): Promise<PayoutRequestResult> {
    const response = await apiFetch('/api/vendor/payouts/request', {
      method: 'POST',
      body: JSON.stringify(amount !== undefined ? { amount } : {})
    })

    return {
      batchId: response.batchId,
      transferId: response.transferId,
      payoutId: response.payoutId,
      amount: Number(response.amount) || 0,
      payoutCount: Number(response.payoutCount) || 0,
      message: response.message || 'Payout sent.',
      warning: response.warning
    }
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(Number(amount) || 0)
  }

  /** Combined fee percentage, for display. */
  calculateFeePercentage(): number {
    return Math.round((this.config.platformFeeRate + this.config.stripeFeeRate) * 1000) / 10
  }
}

export const vendorPayoutService = new VendorPayoutService()

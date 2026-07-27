import { loadStripe, type Stripe, type StripeElements, type PaymentIntent } from '@stripe/stripe-js'
import { apiFetch } from '../lib/api'
// Single canonical source for the ITC exchange rate and purchase packages —
// backend/config/itc-pricing.ts. Previously this file duplicated a stale
// $0.10/ITC package list here while every redemption path (cashout, store
// credit, checkout ITC application) used $0.01/ITC — a real 10x buy/redeem
// mismatch. Re-exporting instead of duplicating means this can't drift again.
import {
  ITC_TO_USD_RATE,
  ITC_PACKAGES,
  type ITCPackage
} from '../../backend/config/itc-pricing'

const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY

export type { ITCPackage }
export { ITC_TO_USD_RATE, ITC_PACKAGES }

export interface PaymentIntentResponse {
  clientSecret: string
  paymentIntentId: string
  itcAmount: number
  bonusPercent: number
}

export interface ITCPurchaseResult {
  success: boolean
  paymentIntentId?: string
  itcAmount?: number
  error?: string
}

export class StripeITCService {
  private stripe: Stripe | null = null
  private initPromise: Promise<void> | null = null

  constructor() {
    this.initPromise = this.initializeStripe()
    // Mark the rejection handled at construction. This service is instantiated
    // at module load, so a failed Stripe.js load (ad blocker, offline, blocked
    // CDN) would otherwise raise an *unhandled* rejection before any caller
    // exists. ensureInitialized() awaits this same promise and still rethrows,
    // so callers get the real error — this only stops the unhandled warning.
    this.initPromise.catch(() => {})
  }

  private async initializeStripe(): Promise<void> {
    if (!STRIPE_PUBLISHABLE_KEY) {
      console.error('VITE_STRIPE_PUBLISHABLE_KEY not configured')
      throw new Error('Stripe publishable key not configured')
    }

    try {
      this.stripe = await loadStripe(STRIPE_PUBLISHABLE_KEY)
      if (!this.stripe) {
        throw new Error('Failed to load Stripe')
      }
    } catch (error) {
      console.error('Failed to initialize Stripe:', error)
      throw error
    }
  }

  async ensureInitialized(): Promise<Stripe> {
    if (this.initPromise) {
      await this.initPromise
      this.initPromise = null
    }

    if (!this.stripe) {
      throw new Error('Stripe not initialized')
    }

    return this.stripe
  }

  async createPaymentIntent(packagePrice: number): Promise<PaymentIntentResponse> {
    try {
      // Convert dollars to cents
      const amountInCents = Math.round(packagePrice * 100)

      const response = await apiFetch('/api/stripe/create-payment-intent', {
        method: 'POST',
        body: JSON.stringify({
          amount: amountInCents,
          currency: 'usd',
          description: `Purchase ITC tokens - $${packagePrice.toFixed(2)}`
        })
      })

      return response as PaymentIntentResponse
    } catch (error: any) {
      console.error('Failed to create payment intent:', error)
      throw new Error(error.message || 'Failed to create payment intent')
    }
  }

  async confirmPayment(
    clientSecret: string,
    elements: StripeElements
  ): Promise<ITCPurchaseResult> {
    try {
      const stripe = await this.ensureInitialized()

      // Confirm the payment using the Elements instance
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret,
        confirmParams: {
          return_url: `${window.location.origin}/wallet?payment=success`
        },
        redirect: 'if_required'
      })

      if (error) {
        console.error('Payment confirmation error:', error)
        return {
          success: false,
          error: error.message || 'Payment failed'
        }
      }

      if (paymentIntent?.status === 'succeeded') {
        const itcAmount = (paymentIntent as any).metadata?.itcAmount
        return {
          success: true,
          paymentIntentId: paymentIntent.id,
          itcAmount: itcAmount ? parseInt(itcAmount) : undefined
        }
      }

      // Handle other statuses
      if (paymentIntent?.status === 'requires_action') {
        return {
          success: false,
          error: 'Payment requires additional action'
        }
      }

      return {
        success: false,
        error: 'Payment not completed'
      }
    } catch (error: any) {
      console.error('Payment confirmation failed:', error)
      return {
        success: false,
        error: error.message || 'Payment confirmation failed'
      }
    }
  }

  getPackages(): ITCPackage[] {
    return ITC_PACKAGES
  }

  findPackageByPrice(price: number): ITCPackage | undefined {
    return ITC_PACKAGES.find(pkg => pkg.priceUSD === price)
  }

  findPackageByITC(itcAmount: number): ITCPackage | undefined {
    return ITC_PACKAGES.find(pkg => pkg.itcAmount === itcAmount)
  }
}

// Singleton instance
export const stripeITCService = new StripeITCService()

// Legacy compatibility
export const stripeITCBridge = {
  calculateITCAmount: (usdAmount: number) => {
    const pkg = ITC_PACKAGES.find(p => p.priceUSD === usdAmount)
    return pkg?.itcAmount || 0
  },
  getExchangeRate: () => ITC_TO_USD_RATE,
  calculateUSDAmount: (itcAmount: number) => itcAmount * ITC_TO_USD_RATE
}


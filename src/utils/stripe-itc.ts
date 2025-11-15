import { loadStripe, type Stripe, type StripeElements, type PaymentIntent } from '@stripe/stripe-js'
import { apiFetch } from '../lib/api'

const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY

export interface ITCPackage {
  itcAmount: number
  priceUSD: number
  popular?: boolean
  bonusPercent?: number
}

export const ITC_PACKAGES: ITCPackage[] = [
  {
    itcAmount: 50,
    priceUSD: 5.00,
    bonusPercent: 0
  },
  {
    itcAmount: 100,
    priceUSD: 10.00,
    bonusPercent: 0
  },
  {
    itcAmount: 250,
    priceUSD: 22.50,
    bonusPercent: 10,
    popular: true
  },
  {
    itcAmount: 500,
    priceUSD: 40.00,
    bonusPercent: 20
  },
  {
    itcAmount: 1000,
    priceUSD: 70.00,
    bonusPercent: 30
  }
]

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
        const itcAmount = paymentIntent.metadata?.itcAmount
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
  getExchangeRate: () => 0.10,
  calculateUSDAmount: (itcAmount: number) => itcAmount * 0.10
}


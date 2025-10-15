import { apiFetch } from '@/lib/api'

const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
const ITC_WALLET_ADDRESS = import.meta.env.VITE_ITC_WALLET_ADDRESS || '43XyoLPb3aek3poicnYXjrtMU6PUynRb93Q71FULKZ3Q'
const ITC_USD_RATE = parseFloat(import.meta.env.VITE_ITC_USD_RATE || '0.10')

export interface StripePaymentRequest {
  amount: number // USD amount in cents
  currency: string
  description: string
  metadata?: Record<string, string>
}

export interface ITCPurchaseResult {
  success: boolean
  paymentIntentId?: string
  itcAmount: number
  transactionHash?: string
  error?: string
}

export class StripeITCBridge {
  private stripe: any = null

  constructor() {
    this.initializeStripe()
  }

  private async initializeStripe() {
    if (!STRIPE_PUBLISHABLE_KEY) {
      console.error('STRIPE_PUBLISHABLE_KEY not configured')
      return
    }

    try {
      const { loadStripe } = await import('@stripe/stripe-js')
      this.stripe = await loadStripe(STRIPE_PUBLISHABLE_KEY)
    } catch (error) {
      console.error('Failed to load Stripe:', error)
    }
  }

  async purchaseITC(usdAmount: number, userId: string): Promise<ITCPurchaseResult> {
    try {
      const itcAmount = Math.floor(usdAmount / ITC_USD_RATE)
      const amountInCents = Math.round(usdAmount * 100)

      if (!this.stripe || !STRIPE_PUBLISHABLE_KEY) {
        return {
          success: false,
          itcAmount: 0,
          error: 'Stripe not properly initialized'
        }
      }

      // In real app, create payment intent on backend
      const { client_secret } = await apiFetch('/api/create-payment-intent', {
        method: 'POST',
        body: JSON.stringify({
          amount: amountInCents,
          currency: 'usd',
          description: `Purchase ${itcAmount} ITC tokens`,
          metadata: {
            userId,
            itcAmount: itcAmount.toString(),
            walletAddress: ITC_WALLET_ADDRESS
          }
        })
      })

      // Confirm payment with Stripe
      const result = await this.stripe.confirmCardPayment(client_secret, {
        payment_method: {
          card: {
            // Card details would be collected via Stripe Elements
          },
          billing_details: {
            name: 'Customer Name',
          },
        }
      })

      if (result.error) {
        return {
          success: false,
          itcAmount: 0,
          error: result.error.message
        }
      }

      // In real app, backend would handle ITC transfer after successful payment
      const transactionHash = await this.transferITC(ITC_WALLET_ADDRESS, itcAmount)

      return {
        success: true,
        paymentIntentId: result.paymentIntent.id,
        itcAmount,
        transactionHash
      }

    } catch (error) {
      console.error('Error processing ITC purchase:', error)
      return {
        success: false,
        itcAmount: 0,
        error: 'Payment processing failed'
      }
    }
  }

  private async transferITC(_walletAddress: string, amount: number): Promise<string> {
    // In real app, this would interact with the ITC blockchain
    // For demo, return mock transaction hash
    return 'mock_transfer_' + Date.now() + '_' + amount
  }

  calculateITCAmount(usdAmount: number): number {
    return Math.floor(usdAmount / ITC_USD_RATE)
  }

  calculateUSDAmount(itcAmount: number): number {
    return itcAmount * ITC_USD_RATE
  }

  getExchangeRate(): number {
    return ITC_USD_RATE
  }

  getWalletAddress(): string {
    return ITC_WALLET_ADDRESS
  }
}

export const stripeITCBridge = new StripeITCBridge()

// Webhook handler interface for backend
export interface StripeWebhookEvent {
  type: string
  data: {
    object: {
      id: string
      amount: number
      currency: string
      status: string
      metadata: Record<string, string>
    }
  }
}

export const handleStripeWebhook = async (event: StripeWebhookEvent) => {
  switch (event.type) {
    case 'payment_intent.succeeded':
      // Handle successful payment
      const paymentIntent = event.data.object
      const { userId, itcAmount } = paymentIntent.metadata
      
      // In real app:
      // 1. Verify payment amount matches expected
      // 2. Transfer ITC to user's wallet
      // 3. Record transaction in database
      // 4. Send confirmation email to user
      
      console.log(`Payment succeeded for user ${userId}: ${itcAmount} ITC`)
      break
      
    case 'payment_intent.payment_failed':
      // Handle failed payment
      console.log('Payment failed:', event.data.object.id)
      break
      
    default:
      console.log(`Unhandled event type: ${event.type}`)
  }
}
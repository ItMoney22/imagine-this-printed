import React, { useState, useEffect } from 'react'
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'

interface PaymentFormProps {
  clientSecret: string
  onSuccess: () => void
  onError: (error: string) => void
}

const PaymentForm: React.FC<PaymentFormProps> = ({ clientSecret, onSuccess, onError }) => {
  const stripe = useStripe()
  const elements = useElements()
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!stripe || !elements) {
      return
    }

    // Clear any previous error when component mounts
    setErrorMessage(null)
  }, [stripe, elements])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!stripe || !elements) {
      setErrorMessage('Payment system not ready. Please try again.')
      return
    }

    setIsProcessing(true)
    setErrorMessage(null)

    try {
      // Confirm the payment
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/wallet?payment=success`
        },
        redirect: 'if_required'
      })

      if (error) {
        // Payment failed
        const message = error.message || 'An unexpected error occurred.'
        setErrorMessage(message)
        onError(message)
        setIsProcessing(false)
      } else if (paymentIntent && paymentIntent.status === 'succeeded') {
        // Payment succeeded
        onSuccess()
      } else if (paymentIntent && paymentIntent.status === 'requires_action') {
        // 3D Secure authentication required
        setErrorMessage('Additional authentication required. Please complete the verification.')
        setIsProcessing(false)
      } else {
        // Unknown status
        setErrorMessage('Payment status unclear. Please check your wallet or contact support.')
        setIsProcessing(false)
      }
    } catch (err: any) {
      console.error('Payment error:', err)
      const message = err.message || 'Payment processing failed. Please try again.'
      setErrorMessage(message)
      onError(message)
      setIsProcessing(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Payment Element */}
      <div className="p-4 bg-bg rounded-lg border border-primary/20">
        <PaymentElement
          options={{
            layout: 'tabs',
            paymentMethodOrder: ['card', 'apple_pay', 'google_pay']
          }}
        />
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="p-4 bg-red-500/20 border border-red-500 rounded-lg">
          <p className="text-red-400 text-sm">{errorMessage}</p>
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={!stripe || !elements || isProcessing}
        className={`w-full px-6 py-3 rounded-lg font-semibold transition-all ${
          isProcessing
            ? 'bg-gray-600 cursor-not-allowed'
            : 'bg-primary text-white hover:bg-primary/80 shadow-glow'
        }`}
      >
        {isProcessing ? (
          <span className="flex items-center justify-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Processing...
          </span>
        ) : (
          'Complete Payment'
        )}
      </button>

      {/* Security Note */}
      <p className="text-xs text-muted text-center">
        Your payment is secured by Stripe. We never store your card details.
      </p>
    </form>
  )
}

export default PaymentForm


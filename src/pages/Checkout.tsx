import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCart } from '../context/CartContext'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, ExpressCheckoutElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { shippingCalculator } from '../utils/shipping-calculator'
import { apiFetch } from '@/lib/api'
import type { ShippingCalculation } from '../utils/shipping-calculator'

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)

const ExpressCheckout: React.FC<{ total: number, items: any[], shipping: any }> = ({ }) => {
  const { clearCart } = useCart()
  const navigate = useNavigate()
  const stripe = useStripe()

  const handleExpressPayment = async (event: any) => {
    const result = await stripe?.confirmPayment({
      elements: event.elements,
      confirmParams: {
        return_url: `${window.location.origin}/`,
      },
      redirect: 'if_required'
    })

    if (result?.error) {
      console.error('Express payment failed:', result.error)
    } else {
      clearCart()
      navigate('/')
    }
  }

  return (
    <div className="bg-card rounded-lg shadow p-6 mb-6">
      <h2 className="text-lg font-semibold mb-4">Express Checkout</h2>
      <ExpressCheckoutElement
        options={{
          buttonType: {
            applePay: 'buy',
            googlePay: 'buy'
          },
          layout: {
            maxColumns: 1,
            maxRows: 1
          }
        }}
        onConfirm={handleExpressPayment}
      />
      <div className="mt-4 text-center text-sm text-muted">
        <div className="flex items-center">
          <div className="flex-1 border-t card-border"></div>
          <div className="px-3 text-muted">or pay with card</div>
          <div className="flex-1 border-t card-border"></div>
        </div>
      </div>
    </div>
  )
}

const CheckoutForm: React.FC<{ clientSecret: string, total: number, items: any[], shipping: any }> = ({ total, items, shipping }) => {
  const stripe = useStripe()
  const elements = useElements()
  const { clearCart } = useCart()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')

    if (!stripe || !elements) {
      setMessage('Stripe not loaded')
      setLoading(false)
      return
    }

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/`,
      },
      redirect: 'if_required'
    })

    if (error) {
      setMessage(error.message || 'Payment failed')
    } else {
      setMessage('Payment successful!')
      clearCart()
      navigate('/')
    }
    setLoading(false)
  }

  return (
    <div className="space-y-6">
      <ExpressCheckout total={total} items={items} shipping={shipping} />
      
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-card rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Payment Method</h2>
          <PaymentElement />
        </div>

        {message && (
          <div className={`p-3 rounded-md ${
            message.includes('successful') 
              ? 'bg-green-50 text-green-700 border border-green-200' 
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {message}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !stripe || !elements}
          className="w-full btn-primary disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {loading ? 'Processing...' : 'Complete Payment'}
        </button>
      </form>
    </div>
  )
}

const Checkout: React.FC = () => {
  const { state } = useCart()
  const navigate = useNavigate()
  const [clientSecret, setClientSecret] = useState('')
  const [shippingCalculation, setShippingCalculation] = useState<ShippingCalculation | null>(null)
  const [loadingShipping, setLoadingShipping] = useState(false)
  const [formData, setFormData] = useState({
    email: '',
    firstName: '',
    lastName: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'US'
  })

  const subtotal = state.total
  const shipping = shippingCalculation?.selectedRate?.amount || 0
  const tax = subtotal * 0.08
  const total = subtotal + shipping + tax

  useEffect(() => {
    if (state.items.length > 0) {
      calculateShipping()
    }
  }, [state.items, formData.address, formData.city, formData.state, formData.zipCode, formData.country])

  useEffect(() => {
    if (state.items.length > 0 && shippingCalculation) {
      createPaymentIntent()
    }
  }, [state.items, total, shippingCalculation])

  const calculateShipping = async () => {
    if (!formData.address || !formData.city || !formData.state || !formData.zipCode) {
      // Use default shipping calculation without address
      const defaultCalculation = await shippingCalculator.calculateShipping(state.items, {
        name: 'Default',
        address1: '123 Main St',
        city: 'Los Angeles',
        state: 'CA',
        zip: '90210',
        country: 'US'
      })
      setShippingCalculation(defaultCalculation)
      return
    }

    setLoadingShipping(true)
    try {
      const shippingAddress = {
        name: `${formData.firstName} ${formData.lastName}`.trim(),
        address1: formData.address,
        city: formData.city,
        state: formData.state,
        zip: formData.zipCode,
        country: formData.country,
        email: formData.email
      }

      const calculation = await shippingCalculator.calculateShipping(state.items, shippingAddress)
      setShippingCalculation(calculation)
    } catch (error) {
      console.error('Error calculating shipping:', error)
    } finally {
      setLoadingShipping(false)
    }
  }

  const createPaymentIntent = async () => {
    try {
      const data = await apiFetch('/api/create-payment-intent', {
        method: 'POST',
        body: JSON.stringify({
          amount: Math.round(total * 100),
          currency: 'usd',
          items: state.items,
          shipping: formData
        }),
      })

      setClientSecret(data.clientSecret)
    } catch (error) {
      console.error('Error creating payment intent:', error)
    }
  }

  const handleShippingRateChange = (rateId: string) => {
    if (!shippingCalculation) return
    
    const updatedRates = shippingCalculation.rates.map(rate => ({
      ...rate,
      selected: rate.id === rateId
    }))
    
    const selectedRate = updatedRates.find(rate => rate.selected)
    
    setShippingCalculation({
      ...shippingCalculation,
      rates: updatedRates,
      selectedRate
    })
  }

  if (state.items.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold text-text mb-2">No items to checkout</h2>
          <p className="text-muted mb-6">Add items to your cart before proceeding to checkout</p>
          <button 
            onClick={() => navigate('/catalog')}
            className="btn-primary"
          >
            Browse Products
          </button>
        </div>
      </div>
    )
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-text mb-8">Checkout</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <div className="space-y-6">
            <div className="bg-card rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold mb-4">Contact Information</h2>
              <div className="space-y-4">
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="Email address"
                  required
                  className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold mb-4">Shipping Address</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  type="text"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  placeholder="First name"
                  required
                  className="px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <input
                  type="text"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleInputChange}
                  placeholder="Last name"
                  required
                  className="px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <input
                  type="text"
                  name="address"
                  value={formData.address}
                  onChange={handleInputChange}
                  placeholder="Address"
                  required
                  className="md:col-span-2 px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <input
                  type="text"
                  name="city"
                  value={formData.city}
                  onChange={handleInputChange}
                  placeholder="City"
                  required
                  className="px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <select
                  name="state"
                  value={formData.state}
                  onChange={handleInputChange}
                  required
                  className="px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">Select State</option>
                  <option value="AL">Alabama</option>
                  <option value="CA">California</option>
                  <option value="FL">Florida</option>
                  <option value="NY">New York</option>
                  <option value="TX">Texas</option>
                </select>
                <input
                  type="text"
                  name="zipCode"
                  value={formData.zipCode}
                  onChange={handleInputChange}
                  placeholder="ZIP Code"
                  required
                  className="px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <select
                  name="country"
                  value={formData.country}
                  onChange={handleInputChange}
                  className="px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="US">United States</option>
                  <option value="CA">Canada</option>
                </select>
              </div>
            </div>

            {/* Shipping Options */}
            {shippingCalculation && (
              <div className="bg-card rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold mb-4">Shipping Options</h2>
                {loadingShipping ? (
                  <div className="text-center py-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
                    <p className="mt-2 text-muted">Calculating shipping rates...</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {shippingCalculation.rates.map((rate) => (
                      <label
                        key={rate.id}
                        className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${
                          rate.selected 
                            ? 'border-purple-500 bg-purple-50' 
                            : 'card-border hover:border-gray-400'
                        }`}
                      >
                        <div className="flex items-center">
                          <input
                            type="radio"
                            name="shippingRate"
                            value={rate.id}
                            checked={rate.selected}
                            onChange={() => handleShippingRateChange(rate.id)}
                            className="mr-3"
                          />
                          <div>
                            <p className="font-medium">{rate.name}</p>
                            <p className="text-sm text-muted">
                              {rate.provider} • {rate.estimatedDays} business days
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">
                            {rate.amount === 0 ? 'Free' : `$${rate.amount.toFixed(2)}`}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}

                {/* Free Shipping Progress */}
                {!shippingCalculation.isFreeShipping && (
                  <div className="mt-4 p-3 bg-card rounded-lg">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-muted">Free shipping progress</span>
                      <span className="text-sm font-medium">
                        ${shippingCalculation.freeShippingThreshold.toFixed(2)}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                        style={{ 
                          width: `${Math.min(100, (subtotal / shippingCalculation.freeShippingThreshold) * 100)}%` 
                        }}
                      ></div>
                    </div>
                    <p className="text-xs text-muted mt-1">
                      Add ${Math.max(0, shippingCalculation.freeShippingThreshold - subtotal).toFixed(2)} more for free shipping
                    </p>
                  </div>
                )}
              </div>
            )}

            {clientSecret && (
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <CheckoutForm 
                  clientSecret={clientSecret} 
                  total={total}
                  items={state.items}
                  shipping={formData}
                />
              </Elements>
            )}
          </div>
        </div>

        <div>
          <div className="bg-card rounded-lg shadow p-6 sticky top-8">
            <h2 className="text-lg font-semibold mb-4">Order Summary</h2>
            
            <div className="space-y-4 mb-6">
              {state.items.map((item) => (
                <div key={item.id} className="flex items-center space-x-3">
                  <img 
                    src={item.product.images[0]} 
                    alt={item.product.name}
                    className="w-12 h-12 object-cover rounded"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-sm">{item.product.name}</p>
                    <p className="text-muted text-sm">Qty: {item.quantity}</p>
                  </div>
                  <p className="font-semibold">
                    ${(item.product.price * item.quantity).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>

            <div className="border-t pt-4 space-y-2">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Shipping</span>
                <span>{shipping === 0 ? 'Free' : `$${shipping.toFixed(2)}`}</span>
              </div>
              <div className="flex justify-between">
                <span>Tax</span>
                <span>${tax.toFixed(2)}</span>
              </div>
              <div className="border-t pt-2 flex justify-between font-bold text-lg">
                <span>Total</span>
                <span>${total.toFixed(2)}</span>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t">
              <div className="flex items-center text-sm text-muted">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Secure checkout with 256-bit SSL encryption
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Checkout
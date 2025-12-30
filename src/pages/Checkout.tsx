import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/SupabaseAuthContext'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, ExpressCheckoutElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { shippingCalculator, WAREHOUSE_ADDRESS, PICKUP_HOURS, LOCAL_DELIVERY_RADIUS_MILES } from '../utils/shipping-calculator'
import { apiFetch } from '../lib/api'
import type { ShippingCalculation } from '../utils/shipping-calculator'
import { Tag, X, ShoppingBag, Truck, CreditCard, CheckCircle, Shield, Lock, ArrowLeft, Package, MapPin, Calendar, Clock, Store } from 'lucide-react'

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)

const ExpressCheckout: React.FC<{ total: number, items: any[], shipping: any, orderId: string }> = ({ orderId }) => {
  const { clearCart } = useCart()
  const navigate = useNavigate()
  const stripe = useStripe()

  const handleExpressPayment = async (event: any) => {
    const result = await stripe?.confirmPayment({
      elements: event.elements,
      confirmParams: {
        return_url: `${window.location.origin}/order-success?order_id=${orderId}`,
      },
      redirect: 'if_required'
    })

    if (result?.error) {
      console.error('Express payment failed:', result.error)
    } else {
      clearCart()
      navigate(`/order-success?order_id=${orderId}`)
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

const CheckoutForm: React.FC<{ clientSecret: string, total: number, items: any[], shipping: any, orderId: string }> = ({ orderId }) => {
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
        return_url: `${window.location.origin}/order-success?order_id=${orderId}`,
      },
      redirect: 'if_required'
    })

    if (error) {
      setMessage(error.message || 'Payment failed')
    } else {
      setMessage('Payment successful!')
      clearCart()
      navigate(`/order-success?order_id=${orderId}`)
    }
    setLoading(false)
  }

  return (
    <div className="space-y-6">
      <ExpressCheckout total={0} items={[]} shipping={{}} orderId={orderId} />

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-card rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Payment Method</h2>
          <PaymentElement />
        </div>

        {message && (
          <div className={`p-3 rounded-md ${message.includes('successful')
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

// All 50 US States + DC + Territories
const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' }, { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' }, { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' }, { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' }, { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' }, { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
  { code: 'AS', name: 'American Samoa' }, { code: 'GU', name: 'Guam' }, { code: 'MP', name: 'Northern Mariana Islands' },
  { code: 'PR', name: 'Puerto Rico' }, { code: 'VI', name: 'U.S. Virgin Islands' }
]

const Checkout: React.FC = () => {
  const { state, clearCart, appliedCoupon, discount, finalTotal, applyCoupon, removeCoupon, couponLoading } = useCart()
  const { user, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [clientSecret, setClientSecret] = useState('')
  const [paymentIntentId, setPaymentIntentId] = useState('')
  const [orderId, setOrderId] = useState('')
  const [shippingCalculation, setShippingCalculation] = useState<ShippingCalculation | null>(null)
  const [loadingShipping, setLoadingShipping] = useState(false)
  const [processingITCPayment, setProcessingITCPayment] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [couponCode, setCouponCode] = useState('')
  const [couponError, setCouponError] = useState<string | null>(null)
  // ITC Store Credit state
  const [itcCreditAmount, setItcCreditAmount] = useState<number>(0)
  const [applyingITCCredit, setApplyingITCCredit] = useState(false)
  const [itcCreditError, setItcCreditError] = useState<string | null>(null)
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
  // Local pickup appointment state
  const [pickupDate, setPickupDate] = useState('')
  const [pickupTime, setPickupTime] = useState('')
  const [pickupNotes, setPickupNotes] = useState('')

  // Pre-fill form with user profile data
  useEffect(() => {
    if (user) {
      setFormData(prev => ({
        ...prev,
        email: user.email || prev.email,
        firstName: user.firstName || prev.firstName,
        lastName: user.lastName || prev.lastName
      }))
    }
  }, [user])

  // Calculate totals based on payment methods
  const { usdItems, itcItems, usdTotal, itcTotal, requiresITCPayment, requiresUSDPayment } = useMemo(() => {
    const usdItems = state.items.filter(item => !item.paymentMethod || item.paymentMethod === 'usd')
    const itcItems = state.items.filter(item => item.paymentMethod === 'itc')

    const usdTotal = usdItems.reduce((sum, item) => sum + (item.product.price * item.quantity), 0)
    const itcTotal = itcItems.reduce((sum, item) => sum + (item.product.price * item.quantity), 0)

    return {
      usdItems,
      itcItems,
      usdTotal,
      itcTotal,
      requiresITCPayment: itcItems.length > 0,
      requiresUSDPayment: usdItems.length > 0,
    }
  }, [state.items])

  const subtotal = state.total
  // If free_shipping coupon is applied, shipping is $0
  const baseShipping = shippingCalculation?.selectedRate?.amount || 0
  const shipping = appliedCoupon?.freeShipping ? 0 : baseShipping
  const tax = usdTotal * 0.08 // Only apply tax to USD items
  // ITC credit converts to USD at rate of 1 ITC = $0.01
  const itcCreditUSD = itcCreditAmount * 0.01
  const totalUSD = Math.max(0, usdTotal + shipping + tax - itcCreditUSD)
  const totalITC = itcTotal

  // Calculate max ITC that can be applied (user's balance, capped at order total in ITC)
  const userItcBalance = user?.wallet?.itcBalance || 0
  const maxItcCredit = Math.min(userItcBalance, Math.floor((usdTotal + shipping + tax) / 0.01))

  useEffect(() => {
    if (state.items.length > 0) {
      calculateShipping()
    }
  }, [state.items, formData.address, formData.city, formData.state, formData.zipCode, formData.country])

  useEffect(() => {
    if (state.items.length > 0 && shippingCalculation && requiresUSDPayment) {
      createPaymentIntent()
    }
  }, [state.items, totalUSD, shippingCalculation, requiresUSDPayment, discount, itcCreditAmount])

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
      }, state.total)
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

      const calculation = await shippingCalculator.calculateShipping(state.items, shippingAddress, state.total)
      setShippingCalculation(calculation)
    } catch (error) {
      console.error('Error calculating shipping:', error)
    } finally {
      setLoadingShipping(false)
    }
  }

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return
    setCouponError(null)
    const result = await applyCoupon(couponCode.trim(), user?.id)
    if (!result.success) {
      setCouponError(result.error || 'Failed to apply coupon')
    } else {
      setCouponCode('')
    }
  }

  const handleRemoveCoupon = () => {
    removeCoupon()
    setCouponError(null)
  }

  const createPaymentIntent = async () => {
    try {
      // totalUSD already has itcCreditUSD deducted
      const discountedTotal = Math.max(0, totalUSD - discount)
      // Stripe minimum is 50 cents
      if (discountedTotal < 0.50) {
        console.log('Order total too low for Stripe payment')
        // If ITC covers the whole order, we can skip Stripe
        if (itcCreditAmount > 0 && discountedTotal === 0) {
          setClientSecret('') // Clear any existing payment intent
        }
        return
      }
      // Get selected shipping method info
      const selectedShipping = shippingCalculation?.selectedRate
      const isLocalPickup = selectedShipping?.type === 'pickup'
      const isLocalDelivery = selectedShipping?.type === 'delivery'

      const data = await apiFetch('/api/stripe/checkout-payment-intent', {
        method: 'POST',
        body: JSON.stringify({
          amount: Math.round(discountedTotal * 100),
          currency: 'usd',
          items: usdItems,
          shipping: formData,
          couponCode: appliedCoupon?.code,
          discount: discount,
          userId: user?.id || null,
          shippingCost: shipping,
          tax: tax,
          itcCreditAmount: itcCreditAmount,
          itcCreditUSD: itcCreditUSD,
          // Shipping method details
          shippingMethod: selectedShipping?.name || 'Standard',
          shippingType: selectedShipping?.type || 'shipping',
          // Local pickup appointment info
          pickupAppointment: isLocalPickup ? {
            date: pickupDate || null,
            time: pickupTime || null,
            notes: pickupNotes || null
          } : null,
          isLocalDelivery: isLocalDelivery,
          // Pass existing payment intent ID to update instead of create new
          existingPaymentIntentId: paymentIntentId || undefined,
          existingOrderId: orderId || undefined
        }),
      })

      if (data.clientSecret) {
        setClientSecret(data.clientSecret)
        if (data.paymentIntentId) {
          setPaymentIntentId(data.paymentIntentId)
        }
        if (data.orderId) {
          setOrderId(data.orderId)
        }
      } else {
        console.error('No client secret received:', data)
      }
    } catch (error) {
      console.error('Error creating payment intent:', error)
    }
  }

  const handleITCPayment = async () => {
    if (!user) {
      setPaymentError('Please sign in to use ITC wallet')
      return
    }

    if ((user.wallet?.itcBalance || 0) < totalITC) {
      setPaymentError(`Insufficient ITC balance. You need ${totalITC.toFixed(2)} ITC but have ${(user.wallet?.itcBalance || 0).toFixed(2)} ITC`)
      return
    }

    setProcessingITCPayment(true)
    setPaymentError(null)

    try {
      // Call backend to process ITC payment
      const response = await apiFetch('/api/wallet/process-itc-payment', {
        method: 'POST',
        body: JSON.stringify({
          items: itcItems,
          amount: totalITC,
          shipping: formData,
        }),
      })

      if (response.success) {
        // If there are no USD items, complete the order
        if (!requiresUSDPayment) {
          clearCart()
          navigate(`/order-success?order_id=${response.orderId || 'itc'}`)
        }
        // Otherwise, wait for USD payment to complete
      } else {
        setPaymentError(response.error || 'Failed to process ITC payment')
      }
    } catch (error: any) {
      setPaymentError(error.message || 'Failed to process ITC payment')
    } finally {
      setProcessingITCPayment(false)
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
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center">
            <ShoppingBag className="w-12 h-12 text-purple-500" />
          </div>
          <h2 className="text-2xl font-bold text-text mb-3">Your cart is empty</h2>
          <p className="text-muted mb-8">
            Looks like you haven't added anything to your cart yet. Discover our amazing custom printed products!
          </p>
          <div className="space-y-3">
            <button
              onClick={() => navigate('/catalog')}
              className="w-full btn-primary flex items-center justify-center gap-2"
            >
              <Package className="w-5 h-5" />
              Browse Products
            </button>
            <Link
              to="/imagination-station"
              className="block w-full py-3 px-4 bg-gradient-to-r from-purple-600/20 to-pink-600/20 border border-purple-500/30 text-purple-400 rounded-lg font-medium hover:from-purple-600/30 hover:to-pink-600/30 transition-colors"
            >
              Create Custom Design
            </Link>
          </div>
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

  // Determine current step based on filled data
  const currentStep = !formData.email ? 1 : !formData.address ? 2 : 3

  return (
    <div className="min-h-screen bg-gradient-to-b from-bg via-bg to-purple-900/5">
      {/* Header with back button */}
      <div className="bg-card/80 backdrop-blur-sm border-b border-white/10 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => navigate('/cart')}
              className="flex items-center gap-2 text-muted hover:text-text transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="hidden sm:inline">Back to Cart</span>
            </button>
            <h1 className="text-xl font-bold text-text">Secure Checkout</h1>
            <div className="flex items-center gap-1 text-green-500 text-sm">
              <Lock className="w-4 h-4" />
              <span className="hidden sm:inline">SSL Encrypted</span>
            </div>
          </div>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-center mb-8">
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Step 1: Contact */}
            <div className={`flex items-center gap-2 ${currentStep >= 1 ? 'text-primary' : 'text-muted'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                currentStep > 1 ? 'bg-green-500 text-white' : currentStep === 1 ? 'bg-primary text-white' : 'bg-card border border-white/10'
              }`}>
                {currentStep > 1 ? <CheckCircle className="w-5 h-5" /> : '1'}
              </div>
              <span className="hidden sm:inline text-sm font-medium">Contact</span>
            </div>
            <div className={`w-8 sm:w-16 h-0.5 ${currentStep > 1 ? 'bg-green-500' : 'bg-white/10'}`} />

            {/* Step 2: Shipping */}
            <div className={`flex items-center gap-2 ${currentStep >= 2 ? 'text-primary' : 'text-muted'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                currentStep > 2 ? 'bg-green-500 text-white' : currentStep === 2 ? 'bg-primary text-white' : 'bg-card border border-white/10'
              }`}>
                {currentStep > 2 ? <CheckCircle className="w-5 h-5" /> : <Truck className="w-4 h-4" />}
              </div>
              <span className="hidden sm:inline text-sm font-medium">Shipping</span>
            </div>
            <div className={`w-8 sm:w-16 h-0.5 ${currentStep > 2 ? 'bg-green-500' : 'bg-white/10'}`} />

            {/* Step 3: Payment */}
            <div className={`flex items-center gap-2 ${currentStep >= 3 ? 'text-primary' : 'text-muted'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                currentStep === 3 ? 'bg-primary text-white' : 'bg-card border border-white/10'
              }`}>
                <CreditCard className="w-4 h-4" />
              </div>
              <span className="hidden sm:inline text-sm font-medium">Payment</span>
            </div>
          </div>
        </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <div className="space-y-6">
            {/* Contact Information */}
            <div className="bg-card rounded-xl shadow-lg border border-white/10 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                  <span className="text-primary font-bold text-sm">1</span>
                </div>
                <h2 className="text-lg font-semibold">Contact Information</h2>
              </div>
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

            {/* Shipping Address */}
            <div className="bg-card rounded-xl shadow-lg border border-white/10 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                  <Truck className="w-4 h-4 text-primary" />
                </div>
                <h2 className="text-lg font-semibold">Shipping Address</h2>
              </div>
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
                  className="px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 bg-bg text-text"
                >
                  <option value="">Select State</option>
                  {US_STATES.map(state => (
                    <option key={state.code} value={state.code}>{state.name}</option>
                  ))}
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
              <div className="bg-card rounded-xl shadow-lg border border-white/10 p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                    <Package className="w-4 h-4 text-primary" />
                  </div>
                  <h2 className="text-lg font-semibold">Shipping Options</h2>
                </div>
                {loadingShipping ? (
                  <div className="text-center py-4">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
                    <p className="mt-2 text-muted">Calculating shipping rates...</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {shippingCalculation.rates.map((rate) => (
                      <div key={rate.id}>
                        <label
                          className={`flex items-start justify-between p-4 border rounded-lg cursor-pointer transition-colors ${rate.selected
                            ? 'border-purple-500 bg-purple-500/10'
                            : 'card-border hover:border-purple-400/50'
                            }`}
                        >
                          <div className="flex items-start">
                            <input
                              type="radio"
                              name="shippingRate"
                              value={rate.id}
                              checked={rate.selected}
                              onChange={() => handleShippingRateChange(rate.id)}
                              className="mr-3 mt-1"
                            />
                            <div>
                              <div className="flex items-center gap-2">
                                {rate.type === 'pickup' && <Store className="w-4 h-4 text-green-500" />}
                                {rate.type === 'delivery' && <MapPin className="w-4 h-4 text-blue-500" />}
                                {rate.type === 'shipping' && <Truck className="w-4 h-4 text-purple-500" />}
                                <p className="font-medium">{rate.name}</p>
                                {rate.type === 'pickup' && (
                                  <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                                    Recommended
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-muted mt-1">
                                {rate.type === 'pickup' ? (
                                  <>Ready in {rate.estimatedDays} business day</>
                                ) : rate.type === 'delivery' ? (
                                  <>{rate.estimatedDays} business days • Within {LOCAL_DELIVERY_RADIUS_MILES} miles</>
                                ) : (
                                  <>{rate.provider} • {rate.estimatedDays} business days</>
                                )}
                              </p>
                              {rate.description && (
                                <p className="text-xs text-muted/70 mt-1 flex items-center gap-1">
                                  <MapPin className="w-3 h-3" />
                                  {rate.description}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className={`font-semibold ${rate.amount === 0 ? 'text-green-500' : ''}`}>
                              {rate.amount === 0 ? 'FREE' : `$${rate.amount.toFixed(2)}`}
                            </p>
                          </div>
                        </label>

                        {/* Pickup Appointment Booking - Shows when local pickup is selected */}
                        {rate.type === 'pickup' && rate.selected && (
                          <div className="mt-3 ml-6 p-4 bg-green-500/5 border border-green-500/20 rounded-lg">
                            <h4 className="text-sm font-medium text-green-400 mb-3 flex items-center gap-2">
                              <Calendar className="w-4 h-4" />
                              Schedule Your Pickup (Optional but Recommended)
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs text-muted mb-1">Preferred Date</label>
                                <input
                                  type="date"
                                  value={pickupDate}
                                  onChange={(e) => setPickupDate(e.target.value)}
                                  min={new Date().toISOString().split('T')[0]}
                                  className="w-full px-3 py-2 bg-bg border card-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-muted mb-1">Preferred Time</label>
                                <select
                                  value={pickupTime}
                                  onChange={(e) => setPickupTime(e.target.value)}
                                  className="w-full px-3 py-2 bg-bg border card-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                >
                                  <option value="">Select a time</option>
                                  <option value="10:00 AM">10:00 AM</option>
                                  <option value="11:00 AM">11:00 AM</option>
                                  <option value="12:00 PM">12:00 PM</option>
                                  <option value="1:00 PM">1:00 PM</option>
                                  <option value="2:00 PM">2:00 PM</option>
                                  <option value="3:00 PM">3:00 PM</option>
                                  <option value="4:00 PM">4:00 PM</option>
                                  <option value="5:00 PM">5:00 PM</option>
                                  <option value="6:00 PM">6:00 PM</option>
                                  <option value="7:00 PM">7:00 PM</option>
                                  <option value="8:00 PM">8:00 PM</option>
                                </select>
                              </div>
                            </div>
                            <div className="mt-3">
                              <label className="block text-xs text-muted mb-1">Notes (Optional)</label>
                              <input
                                type="text"
                                value={pickupNotes}
                                onChange={(e) => setPickupNotes(e.target.value)}
                                placeholder="e.g., I'll call when arriving"
                                className="w-full px-3 py-2 bg-bg border card-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                              />
                            </div>
                            <div className="mt-3 p-2 bg-card rounded border border-white/5 text-xs text-muted">
                              <div className="flex items-center gap-2 mb-1">
                                <Clock className="w-3 h-3" />
                                <span className="font-medium">Store Hours: {PICKUP_HOURS}</span>
                              </div>
                              <p className="flex items-start gap-2">
                                <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                <span>
                                  {WAREHOUSE_ADDRESS.address}, {WAREHOUSE_ADDRESS.city}, {WAREHOUSE_ADDRESS.state} {WAREHOUSE_ADDRESS.zip}
                                </span>
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Local Delivery Info - Shows when local delivery is selected */}
                        {rate.type === 'delivery' && rate.selected && (
                          <div className="mt-3 ml-6 p-4 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                            <h4 className="text-sm font-medium text-blue-400 mb-2 flex items-center gap-2">
                              <Truck className="w-4 h-4" />
                              Local Delivery Details
                            </h4>
                            <p className="text-xs text-muted">
                              Your order will be delivered directly to your address within {LOCAL_DELIVERY_RADIUS_MILES} miles of our warehouse.
                              We'll contact you to confirm delivery timing.
                            </p>
                          </div>
                        )}
                      </div>
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

            {/* ITC Payment Section */}
            {requiresITCPayment && (
              <div className="bg-card rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <img src="/itc-coin.png" alt="ITC" className="w-5 h-5 object-contain" />
                  ITC Wallet Payment
                </h2>

                <div className="space-y-4">
                  <div className="flex justify-between items-center p-4 bg-secondary/10 border border-secondary/30 rounded">
                    <div>
                      <p className="text-sm text-muted">Total ITC Amount</p>
                      <p className="text-2xl font-bold text-secondary">{totalITC.toFixed(2)} ITC</p>
                    </div>
                    {user && (
                      <div className="text-right">
                        <p className="text-sm text-muted">Your Balance</p>
                        <p className={`text-lg font-semibold ${(user.wallet?.itcBalance || 0) >= totalITC ? 'text-green-400' : 'text-red-400'}`}>
                          {(user.wallet?.itcBalance || 0).toFixed(2)} ITC
                        </p>
                      </div>
                    )}
                  </div>

                  {paymentError && (
                    <div className="p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
                      {paymentError}
                    </div>
                  )}

                  <button
                    onClick={handleITCPayment}
                    disabled={processingITCPayment || !user || (user.wallet?.itcBalance || 0) < totalITC}
                    className={`w-full px-4 py-3 rounded font-medium transition-all ${
                      processingITCPayment || !user || (user.wallet?.itcBalance || 0) < totalITC
                        ? 'bg-secondary/10 text-muted cursor-not-allowed'
                        : 'bg-gradient-to-r from-secondary to-accent hover:shadow-glowLg text-white'
                    }`}
                  >
                    {processingITCPayment ? 'Processing...' : `Pay ${totalITC.toFixed(2)} ITC`}
                  </button>

                  {!user && (
                    <p className="text-xs text-muted text-center">
                      Please sign in to use ITC wallet
                    </p>
                  )}
                </div>
              </div>
            )}

            {requiresUSDPayment && clientSecret && (
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <CheckoutForm
                  clientSecret={clientSecret}
                  total={totalUSD}
                  items={usdItems}
                  shipping={formData}
                  orderId={orderId}
                />
              </Elements>
            )}
          </div>
        </div>

        {/* Order Summary - Right Column */}
        <div>
          <div className="bg-card rounded-xl shadow-lg border border-white/10 p-6 sticky top-24">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Order Summary</h2>
              <span className="text-sm text-muted">{state.items.length} item{state.items.length !== 1 ? 's' : ''}</span>
            </div>

            <div className="space-y-4 mb-6 max-h-[300px] overflow-y-auto pr-2">
              {state.items.map((item) => (
                <div key={item.id} className="flex items-start gap-3 p-3 bg-bg/30 rounded-lg border border-white/5">
                  <div className="relative w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden bg-white/5">
                    <img
                      src={item.product.images?.[0] || '/placeholder-product.png'}
                      alt={item.product.name}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-primary text-white text-xs font-bold rounded-full flex items-center justify-center">
                      {item.quantity}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{item.product.name}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      {item.selectedSize && (
                        <span className="text-xs px-2 py-0.5 bg-primary/20 text-primary rounded">
                          {item.selectedSize}
                        </span>
                      )}
                      {item.selectedColor && (
                        <span
                          className="w-4 h-4 rounded-full border-2 border-white/20"
                          style={{ backgroundColor: item.selectedColor }}
                          title={item.selectedColor}
                        />
                      )}
                      {item.paymentMethod === 'itc' && (
                        <span className="text-xs px-2 py-0.5 bg-secondary/20 text-secondary rounded flex items-center gap-1">
                          <img src="/itc-coin.png" alt="" className="w-3 h-3" />
                          ITC
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="font-semibold text-sm flex-shrink-0">
                    ${(item.product.price * item.quantity).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>

            {/* Coupon Code Section */}
            <div className="border-t pt-4 mb-4">
              <label className="block text-sm font-medium mb-2">Coupon Code</label>
              {appliedCoupon ? (
                <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <Tag className="w-4 h-4 text-green-600" />
                    <span className="font-medium text-green-700">{appliedCoupon.code}</span>
                    <span className="text-green-600 text-sm">
                      {appliedCoupon.freeShipping
                        ? '(Free Shipping)'
                        : `(-$${discount.toFixed(2)})`
                      }
                    </span>
                  </div>
                  <button
                    onClick={handleRemoveCoupon}
                    className="text-green-600 hover:text-green-800"
                    title="Remove coupon"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    placeholder="Enter coupon code"
                    className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                  <button
                    onClick={handleApplyCoupon}
                    disabled={couponLoading || !couponCode.trim()}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {couponLoading ? 'Applying...' : 'Apply'}
                  </button>
                </div>
              )}
              {couponError && (
                <p className="text-red-500 text-sm mt-1">{couponError}</p>
              )}
            </div>

            {/* ITC Store Credit Section */}
            {user && userItcBalance > 0 && requiresUSDPayment && (
              <div className="border-t pt-4 mb-4">
                <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                  <img src="/itc-coin.png" alt="ITC" className="w-4 h-4 object-contain" />
                  Apply ITC as Store Credit
                </label>
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-purple-700">Your ITC Balance:</span>
                    <span className="font-semibold text-purple-700">{userItcBalance.toFixed(2)} ITC</span>
                  </div>
                  <p className="text-xs text-purple-600 mt-1">1 ITC = $0.01 USD</p>
                </div>

                {itcCreditAmount > 0 ? (
                  <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <img src="/itc-coin.png" alt="ITC" className="w-4 h-4 object-contain" />
                      <span className="font-medium text-green-700">{itcCreditAmount.toFixed(2)} ITC applied</span>
                      <span className="text-green-600 text-sm">(-${itcCreditUSD.toFixed(2)})</span>
                    </div>
                    <button
                      onClick={() => setItcCreditAmount(0)}
                      className="text-green-600 hover:text-green-800"
                      title="Remove ITC credit"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="number"
                        min="0"
                        max={maxItcCredit}
                        step="1"
                        placeholder={`Max: ${maxItcCredit.toFixed(0)} ITC`}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        onChange={(e) => {
                          const value = Math.min(Math.max(0, parseFloat(e.target.value) || 0), maxItcCredit)
                          setItcCreditAmount(value)
                        }}
                      />
                    </div>
                    <button
                      onClick={() => setItcCreditAmount(maxItcCredit)}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700"
                    >
                      Use Max
                    </button>
                  </div>
                )}
                {itcCreditError && (
                  <p className="text-red-500 text-sm mt-1">{itcCreditError}</p>
                )}
              </div>
            )}

            <div className="border-t pt-4 space-y-2">
              {requiresUSDPayment && (
                <>
                  <div className="flex justify-between">
                    <span>USD Subtotal</span>
                    <span>${usdTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Shipping</span>
                    <span>
                      {appliedCoupon?.freeShipping ? (
                        <span className="text-green-600">Free (coupon)</span>
                      ) : shipping === 0 ? (
                        'Free'
                      ) : (
                        `$${shipping.toFixed(2)}`
                      )}
                    </span>
                  </div>
                  {discount > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>Discount ({appliedCoupon?.code})</span>
                      <span>-${discount.toFixed(2)}</span>
                    </div>
                  )}
                  {itcCreditAmount > 0 && (
                    <div className="flex justify-between text-purple-600">
                      <span className="flex items-center gap-1">
                        <img src="/itc-coin.png" alt="ITC" className="w-3 h-3 object-contain" />
                        ITC Credit ({itcCreditAmount.toFixed(0)} ITC)
                      </span>
                      <span>-${itcCreditUSD.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Tax</span>
                    <span>${tax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>USD Total</span>
                    <span>${Math.max(0, totalUSD - discount).toFixed(2)}</span>
                  </div>
                </>
              )}

              {requiresITCPayment && (
                <>
                  {requiresUSDPayment && <div className="border-t pt-2" />}
                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1">
                      <img src="/itc-coin.png" alt="ITC" className="w-4 h-4 object-contain" />
                      ITC Total
                    </span>
                    <span className="font-semibold text-secondary">{totalITC.toFixed(2)} ITC</span>
                  </div>
                </>
              )}

              {requiresUSDPayment && requiresITCPayment && (
                <div className="border-t pt-2 mt-2">
                  <p className="text-xs text-muted">
                    You will be charged ${(totalUSD - discount).toFixed(2)} USD and {totalITC.toFixed(2)} ITC
                  </p>
                </div>
              )}
            </div>

            {/* Trust Badges */}
            <div className="mt-6 pt-6 border-t border-white/10 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col items-center text-center p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                  <Shield className="w-5 h-5 text-green-500 mb-1" />
                  <span className="text-xs text-green-400">Secure</span>
                </div>
                <div className="flex flex-col items-center text-center p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                  <Truck className="w-5 h-5 text-blue-500 mb-1" />
                  <span className="text-xs text-blue-400">Fast Ship</span>
                </div>
                <div className="flex flex-col items-center text-center p-3 bg-purple-500/10 rounded-lg border border-purple-500/20">
                  <CheckCircle className="w-5 h-5 text-purple-500 mb-1" />
                  <span className="text-xs text-purple-400">Guarantee</span>
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 text-sm text-muted">
                <Lock className="w-4 h-4" />
                <span>256-bit SSL encrypted checkout</span>
              </div>

              {/* Payment Method Icons */}
              <div className="flex items-center justify-center gap-3 pt-2">
                <img src="https://cdn.jsdelivr.net/gh/lipis/flag-icons/flags/4x3/us.svg" alt="US" className="h-4 rounded opacity-60" />
                <span className="text-xs text-muted">|</span>
                <span className="text-xs text-muted">Visa • Mastercard • Amex • Apple Pay • Google Pay</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}

export default Checkout


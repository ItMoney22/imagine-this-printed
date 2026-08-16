import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle, Package, Truck, ArrowRight, Sparkles, Gift, Clock, XCircle, AlertTriangle, ShoppingCart } from 'lucide-react'
import Confetti from 'react-confetti'
import { useWindowSize } from 'react-use'
import { apiFetch } from '../lib/api'
import { useCart } from '../context/CartContext'

/** Minimal shape returned by GET /api/orders/:orderId/confirmation. */
interface ConfirmationOrder {
  id: string
  order_number: string | null
  status: string | null
  payment_status: string | null
  fulfillment_status: string | null
  total: number | null
  currency: string | null
  customer_name: string | null
  created_at: string | null
}

// How long to keep asking while payment_status is still 'pending'. A card
// payment is normally recorded within a second or two of the redirect, but the
// webhook is a separate network hop and can lag; ACH/bank debits can sit in
// 'processing' far longer, which is why giving up here is not an error state.
const POLL_INTERVAL_MS = 3000
const POLL_ATTEMPTS = 10

const OrderSuccess: React.FC = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { width, height } = useWindowSize()
  const [showConfetti, setShowConfetti] = useState(true)
  const [animateIn, setAnimateIn] = useState(false)
  const [order, setOrder] = useState<ConfirmationOrder | null>(null)
  const [lookupFailed, setLookupFailed] = useState(false)
  const cancelled = useRef(false)
  const { clearCart } = useCart()

  const orderId = searchParams.get('order_id')

  // Previously this page NEVER fetched the order: it sliced the raw UUID to
  // fake an order number (so a customer saw "BF1ABB5F" instead of their real
  // ITP-… reference) and rendered a hardcoded green "Processing" pill no matter
  // what had actually happened to the payment. During the 2026-08-07 webhook
  // outage that pill read "Processing" over an order the database still had at
  // payment_status=pending. The read-only, guest-safe
  // GET /api/orders/:orderId/confirmation endpoint already existed for exactly
  // this purpose and simply had no caller.
  useEffect(() => {
    cancelled.current = false
    if (!orderId) {
      setLookupFailed(true)
      return
    }

    let attempts = 0
    const poll = async () => {
      if (cancelled.current) return
      attempts++
      try {
        const result = await apiFetch(`/api/orders/${orderId}/confirmation`)
        if (cancelled.current) return
        const fetched: ConfirmationOrder | null = result?.order ?? null
        if (fetched) {
          setOrder(fetched)
          setLookupFailed(false)
          // Stop as soon as the payment is recorded (or has definitively
          // failed); keep polling only while it's genuinely still pending.
          const settled = fetched.payment_status !== 'pending'
          if (settled || attempts >= POLL_ATTEMPTS) return
        } else if (attempts >= POLL_ATTEMPTS) {
          setLookupFailed(true)
          return
        }
      } catch (err: any) {
        // Never turn a confirmation screen into an error page — the customer
        // has already paid. Fall back to the reassuring copy below.
        if (cancelled.current) return
        const errMsg = err?.message || ''
        const isNotAvailable = errMsg.includes('HTTP 404') || errMsg.includes('HTTP 400')
        if (isNotAvailable || attempts >= POLL_ATTEMPTS) {
          setLookupFailed(true)
          return
        }
      }
      setTimeout(poll, POLL_INTERVAL_MS)
    }
    poll()

    return () => { cancelled.current = true }
  }, [orderId])

  // Clear the cart if the payment status is confirmed as paid
  useEffect(() => {
    if (order && order.payment_status === 'paid') {
      clearCart()
    }
  }, [order, clearCart])

  useEffect(() => {
    // Trigger animations after mount
    setTimeout(() => setAnimateIn(true), 100)

    // Stop confetti after 8 seconds
    const timer = setTimeout(() => setShowConfetti(false), 8000)
    return () => clearTimeout(timer)
  }, [])

  // Real reference when we have it; the sliced UUID only as a last resort so
  // the customer always has *something* quotable in a support email.
  const orderNumber = order?.order_number
    || (orderId ? orderId.slice(0, 8).toUpperCase() : 'ITP' + Date.now().toString(36).toUpperCase())

  // Status pill derived from actual state instead of asserted.
  const statusPill = (() => {
    if (!order || lookupFailed) return { label: 'Confirming', tone: 'amber' as const, pulse: true }
    if (order.payment_status === 'paid') {
      const fulfilment = (order.fulfillment_status || '').toLowerCase()
      const status = (order.status || '').toLowerCase()
      if (status === 'shipped' || fulfilment === 'fulfilled') return { label: 'Shipped', tone: 'green' as const, pulse: false }
      if (status === 'delivered') return { label: 'Delivered', tone: 'green' as const, pulse: false }
      return { label: 'Paid — in production', tone: 'green' as const, pulse: true }
    }
    if (order.payment_status === 'failed') return { label: 'Payment failed', tone: 'red' as const, pulse: false }
    if (order.payment_status === 'requires_action') return { label: 'Action required', tone: 'red' as const, pulse: true }
    if (order.payment_status === 'processing') return { label: 'Payment processing', tone: 'amber' as const, pulse: true }
    return { label: 'Confirming payment', tone: 'amber' as const, pulse: true }
  })()

  const pillTone = {
    green: { wrap: 'bg-green-500/20 border-green-500/30', dot: 'bg-green-400', text: 'text-green-400' },
    amber: { wrap: 'bg-amber-500/20 border-amber-500/30', dot: 'bg-amber-400', text: 'text-amber-300' },
    red: { wrap: 'bg-red-500/20 border-red-500/30', dot: 'bg-red-400', text: 'text-red-300' }
  }[statusPill.tone]

  const isLoading = !order && !lookupFailed
  const isNotFound = lookupFailed || !orderId
  const isPending = order && order.payment_status === 'pending' && !lookupFailed
  const isPaid = order && order.payment_status === 'paid'
  const isProcessing = order && order.payment_status === 'processing'
  const isFailed = order && (order.payment_status === 'failed' || order.payment_status === 'requires_action')

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-black relative overflow-hidden">
      {/* Confetti (only for successful paid orders) */}
      {showConfetti && isPaid && (
        <Confetti
          width={width}
          height={height}
          recycle={true}
          numberOfPieces={300}
          colors={['#a855f7', '#ec4899', '#8b5cf6', '#06b6d4', '#fbbf24', '#22c55e']}
          gravity={0.15}
        />
      )}

      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-purple-500/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-pink-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-3xl" />

        {/* Floating sparkles */}
        {isPaid && [...Array(20)].map((_, i) => (
          <Sparkles
            key={i}
            className="absolute text-yellow-400/40 animate-pulse"
            style={{
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 2}s`,
              fontSize: `${Math.random() * 16 + 8}px`
            }}
          />
        ))}
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4 py-16">
        <div
          className={`bg-white/10 backdrop-blur-xl rounded-3xl p-8 md:p-12 border border-white/20 shadow-2xl transform transition-all duration-1000 ${
            animateIn ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'
          }`}
        >
          {/* 1. LOADING STATE */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="relative mb-6">
                <div className="w-16 h-16 rounded-full border-4 border-purple-500/30 border-t-purple-400 animate-spin" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Verifying Your Order...</h2>
              <p className="text-white/60 max-w-md">
                We're checking the status of your payment and fetching your order details.
              </p>
            </div>
          )}

          {/* 2. PENDING / CONFIRMING STATE */}
          {isPending && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="relative mb-6">
                <div className="w-16 h-16 rounded-full border-4 border-amber-500/30 border-t-amber-400 animate-spin" />
                <Clock className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 text-amber-400 animate-pulse" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Confirming Payment...</h2>
              <p className="text-white/60 max-w-md mb-6">
                We've found your order! We are currently waiting for Stripe to confirm your payment.
              </p>
              <div className="bg-white/5 rounded-xl p-4 border border-white/10 max-w-xs w-full">
                <p className="text-white/40 text-xs uppercase tracking-wide">Order Number</p>
                <p className="text-xl font-bold text-white font-mono">{orderNumber}</p>
              </div>
            </div>
          )}

          {/* 3. NOT FOUND STATE */}
          {isNotFound && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-6">
                <AlertTriangle className="w-10 h-10 text-red-400 animate-bounce" />
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">
                Order Not Found
              </h1>
              <p className="text-lg text-white/80 mb-8 max-w-md">
                We couldn't verify this order. If you believe this is an error or your payment was processed, please check your email for confirmation or contact our support.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center w-full max-w-md">
                <button
                  onClick={() => navigate('/catalog')}
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-xl text-white font-medium transition-all"
                >
                  Browse Products
                  <ArrowRight className="w-5 h-5" />
                </button>
                <a
                  href="mailto:wecare@imaginethisprinted.com"
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-medium transition-all"
                >
                  Contact Support
                </a>
              </div>
            </div>
          )}

          {/* 4. PAYMENT FAILED / ACTION REQUIRED STATE */}
          {isFailed && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-6">
                <XCircle className="w-10 h-10 text-red-400" />
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-white mb-4">
                {order?.payment_status === 'requires_action' ? 'Authentication Required' : 'Payment Failed'}
              </h1>
              <p className="text-lg text-white/80 mb-2 max-w-md">
                {order?.payment_status === 'requires_action'
                  ? 'Your bank requires additional authentication to complete this payment.'
                  : 'We were unable to process your payment for this order.'}
              </p>
              <p className="text-white/60 mb-6 max-w-md text-sm">
                Your cart has not been cleared. You can return to the cart and try again with a different payment method.
              </p>

              <div className="bg-white/5 rounded-2xl p-6 mb-8 border border-white/10 w-full max-w-md">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="text-left">
                    <p className="text-white/60 text-sm uppercase tracking-wide">Order Number</p>
                    <p className="text-xl font-bold text-white font-mono">{orderNumber}</p>
                  </div>
                  <div className={`flex items-center gap-2 px-4 py-2 rounded-full border ${pillTone.wrap}`}>
                    <div className={`w-2 h-2 rounded-full ${pillTone.dot}`} />
                    <span className={`${pillTone.text} font-medium`}>{statusPill.label}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 justify-center w-full max-w-md">
                <button
                  onClick={() => navigate('/cart')}
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-xl text-white font-medium transition-all shadow-lg shadow-purple-500/30"
                >
                  Return to Cart
                  <ShoppingCart className="w-5 h-5" />
                </button>
                <a
                  href="mailto:wecare@imaginethisprinted.com"
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-medium transition-all"
                >
                  Contact Support
                </a>
              </div>
            </div>
          )}

          {/* 5. PAYMENT PROCESSING STATE */}
          {isProcessing && (
            <div>
              {/* Icon / Mr. Imagine (not packing, but waiting) */}
              <div className="flex justify-center mb-8">
                <div className="relative">
                  <img
                    src="/mr-imagine-packing.png"
                    alt="Mr. Imagine Waiting for Payment"
                    className="w-48 h-48 md:w-64 md:h-64 object-contain opacity-80"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-16 h-16 rounded-full bg-black/60 backdrop-blur border border-amber-500/30 flex items-center justify-center animate-pulse">
                      <Clock className="w-8 h-8 text-amber-400" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Message */}
              <div className="text-center mb-10">
                <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-amber-400 via-orange-400 to-yellow-400 text-transparent bg-clip-text mb-4">
                  Payment Processing
                </h1>
                <p className="text-xl text-white/80 mb-2">
                  We're confirming your payment. This can take a few minutes or hours for bank transfers.
                </p>
                <p className="text-purple-300 text-lg">
                  We'll save your items in your cart and begin production as soon as payment is confirmed!
                </p>
              </div>

              {/* Order Details */}
              <div className="bg-white/5 rounded-2xl p-6 mb-8 border border-white/10">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <p className="text-white/60 text-sm uppercase tracking-wide">Order Number</p>
                    <p className="text-2xl font-bold text-white font-mono">{orderNumber}</p>
                  </div>
                  <div className={`flex items-center gap-2 px-4 py-2 rounded-full border ${pillTone.wrap}`}>
                    <div className={`w-2 h-2 rounded-full ${pillTone.dot} animate-pulse`} />
                    <span className={`${pillTone.text} font-medium`}>{statusPill.label}</span>
                  </div>
                </div>
              </div>

              {/* Timeline */}
              <div className="relative mb-10">
                <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-amber-500 via-purple-500/30 to-purple-500/10" />

                <div className="space-y-6">
                  {/* Step 1 - Complete */}
                  <div className="flex items-start gap-4">
                    <div className="relative z-10 w-16 h-16 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shadow-lg">
                      <CheckCircle className="w-8 h-8 text-white" />
                    </div>
                    <div className="pt-3">
                      <h3 className="text-white font-semibold text-lg">Order Placed</h3>
                      <p className="text-white/60">We've received your order details</p>
                    </div>
                  </div>

                  {/* Step 2 - Current */}
                  <div className="flex items-start gap-4">
                    <div className="relative z-10 w-16 h-16 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg animate-pulse">
                      <Clock className="w-8 h-8 text-white" />
                    </div>
                    <div className="pt-3">
                      <h3 className="text-white font-semibold text-lg">Confirming Payment</h3>
                      <p className="text-white/60">Awaiting clearance from Stripe and your financial institution</p>
                    </div>
                  </div>

                  {/* Step 3 - Pending */}
                  <div className="flex items-start gap-4 opacity-50">
                    <div className="relative z-10 w-16 h-16 rounded-full bg-white/10 border-2 border-white/20 flex items-center justify-center">
                      <Package className="w-8 h-8 text-white/40" />
                    </div>
                    <div className="pt-3">
                      <h3 className="text-white/60 font-semibold text-lg">Preparing Your Order</h3>
                      <p className="text-white/40">We'll craft your items with care once paid</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* What's Next */}
              <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-2xl p-6 border border-purple-500/30 mb-8">
                <h3 className="text-white font-semibold text-lg mb-3 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-yellow-400" />
                  What's Next?
                </h3>
                <ul className="space-y-2 text-white/80">
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                    Your cart items are preserved in this browser so you don't lose them
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                    Once the payment succeeds, we will automatically clear your cart
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                    You will receive a confirmation email when the order goes into production
                  </li>
                </ul>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button
                  onClick={() => navigate('/account/profile')}
                  className="flex items-center justify-center gap-2 px-8 py-4 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-medium transition-all hover:scale-105"
                >
                  View My Orders
                  <ArrowRight className="w-5 h-5" />
                </button>
                <button
                  onClick={() => navigate('/catalog')}
                  className="flex items-center justify-center gap-2 px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-xl text-white font-medium transition-all hover:scale-105 shadow-lg shadow-purple-500/30"
                >
                  Continue Shopping
                  <Sparkles className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}

          {/* 6. SUCCESS / PAID STATE */}
          {isPaid && (
            <div>
              {/* Mr. Imagine Character */}
              <div className="flex justify-center mb-8">
                <div className="relative">
                  <img
                    src="/mr-imagine-packing.png"
                    alt="Mr. Imagine Packing Your Order"
                    className="w-48 h-48 md:w-64 md:h-64 object-contain drop-shadow-[0_0_30px_rgba(168,85,247,0.5)]"
                  />
                  {/* Celebration rings */}
                  <div className="absolute inset-0 animate-ping">
                    <div className="w-full h-full rounded-full border-4 border-purple-400/30" />
                  </div>
                  <div className="absolute -top-4 -right-4">
                    <Gift className="w-12 h-12 text-pink-400 animate-bounce" style={{ animationDelay: '0.5s' }} />
                  </div>
                </div>
              </div>

              {/* Success Message */}
              <div className="text-center mb-10">
                <div className="flex items-center justify-center gap-3 mb-4">
                  <CheckCircle className="w-12 h-12 text-green-400 animate-pulse" />
                  <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-green-400 via-emerald-400 to-teal-400 text-transparent bg-clip-text">
                    Order Confirmed!
                  </h1>
                </div>
                <p className="text-xl text-white/80 mb-2">
                  Thank you for your order! Mr. Imagine is packing it with love!
                </p>
                <p className="text-purple-300 text-lg">
                  Your creativity is about to become reality!
                </p>
              </div>

              {/* Order Details */}
              <div className="bg-white/5 rounded-2xl p-6 mb-8 border border-white/10">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <p className="text-white/60 text-sm uppercase tracking-wide">Order Number</p>
                    <p className="text-2xl font-bold text-white font-mono">{orderNumber}</p>
                  </div>
                  <div className={`flex items-center gap-2 px-4 py-2 rounded-full border ${pillTone.wrap}`}>
                    <div className={`w-2 h-2 rounded-full ${pillTone.dot} ${statusPill.pulse ? 'animate-pulse' : ''}`} />
                    <span className={`${pillTone.text} font-medium`}>{statusPill.label}</span>
                  </div>
                </div>
              </div>

              {/* Timeline */}
              <div className="relative mb-10">
                <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-green-500 via-purple-500 to-purple-500/20" />

                <div className="space-y-6">
                  {/* Step 1 - Complete */}
                  <div className="flex items-start gap-4">
                    <div className="relative z-10 w-16 h-16 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shadow-lg shadow-green-500/30">
                      <CheckCircle className="w-8 h-8 text-white" />
                    </div>
                    <div className="pt-3">
                      <h3 className="text-white font-semibold text-lg">Order Placed</h3>
                      <p className="text-white/60">We've received your order</p>
                    </div>
                  </div>

                  {/* Step 2 - Current */}
                  <div className="flex items-start gap-4">
                    <div className="relative z-10 w-16 h-16 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/30 animate-pulse">
                      <Package className="w-8 h-8 text-white" />
                    </div>
                    <div className="pt-3">
                      <h3 className="text-white font-semibold text-lg">Preparing Your Order</h3>
                      <p className="text-white/60">Our team is crafting your items with care</p>
                    </div>
                  </div>

                  {/* Step 3 - Pending */}
                  <div className="flex items-start gap-4 opacity-50">
                    <div className="relative z-10 w-16 h-16 rounded-full bg-white/10 border-2 border-white/20 flex items-center justify-center">
                      <Truck className="w-8 h-8 text-white/40" />
                    </div>
                    <div className="pt-3">
                      <h3 className="text-white/60 font-semibold text-lg">Shipping</h3>
                      <p className="text-white/40">Your order will be on its way soon</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* What's Next */}
              <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-2xl p-6 border border-purple-500/30 mb-8">
                <h3 className="text-white font-semibold text-lg mb-3 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-yellow-400" />
                  What's Next?
                </h3>
                <ul className="space-y-2 text-white/80">
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                    You'll receive a confirmation email with your order details
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                    We'll send you tracking info once your order ships
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                    Track your order anytime from your profile
                  </li>
                </ul>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button
                  onClick={() => navigate('/account/profile')}
                  className="flex items-center justify-center gap-2 px-8 py-4 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-medium transition-all hover:scale-105"
                >
                  View My Orders
                  <ArrowRight className="w-5 h-5" />
                </button>
                <button
                  onClick={() => navigate('/catalog')}
                  className="flex items-center justify-center gap-2 px-8 py-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-xl text-white font-medium transition-all hover:scale-105 shadow-lg shadow-purple-500/30"
                >
                  Continue Shopping
                  <Sparkles className="w-5 h-5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer message */}
        <p className="text-center text-white/40 mt-8 text-sm">
          Questions? Contact us at wecare@imaginethisprinted.com
        </p>
      </div>
    </div>
  )
}

export default OrderSuccess

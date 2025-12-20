import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle, Package, Truck, ArrowRight, Sparkles, Gift } from 'lucide-react'
import Confetti from 'react-confetti'
import { useWindowSize } from 'react-use'

const OrderSuccess: React.FC = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { width, height } = useWindowSize()
  const [showConfetti, setShowConfetti] = useState(true)
  const [animateIn, setAnimateIn] = useState(false)

  const orderId = searchParams.get('order_id')
  const orderNumber = orderId ? orderId.slice(0, 8).toUpperCase() : 'ITP' + Date.now().toString(36).toUpperCase()

  useEffect(() => {
    // Trigger animations after mount
    setTimeout(() => setAnimateIn(true), 100)

    // Stop confetti after 8 seconds
    const timer = setTimeout(() => setShowConfetti(false), 8000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-black relative overflow-hidden">
      {/* Confetti */}
      {showConfetti && (
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
        {[...Array(20)].map((_, i) => (
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
        {/* Main Content Card */}
        <div
          className={`bg-white/10 backdrop-blur-xl rounded-3xl p-8 md:p-12 border border-white/20 shadow-2xl transform transition-all duration-1000 ${
            animateIn ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'
          }`}
        >
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
              <div className="flex items-center gap-2 px-4 py-2 bg-green-500/20 rounded-full border border-green-500/30">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <span className="text-green-400 font-medium">Processing</span>
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

        {/* Footer message */}
        <p className="text-center text-white/40 mt-8 text-sm">
          Questions? Contact us at wecare@imaginethisprinted.com
        </p>
      </div>
    </div>
  )
}

export default OrderSuccess

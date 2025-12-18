import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { Elements } from '@stripe/react-stripe-js'
import { loadStripe, type StripeElementsOptions } from '@stripe/stripe-js'
import { apiFetch } from '../lib/api'
import type { ITCTransaction } from '../types'
import { type ITCPackage, ITC_PACKAGES } from '../utils/stripe-itc'
import PaymentForm from '../components/PaymentForm'

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY!)

const Wallet: React.FC = () => {
  const { user } = useAuth()
  const [selectedTab, setSelectedTab] = useState<'overview' | 'history' | 'purchase'>('overview')
  const [itcBalance, setItcBalance] = useState(0)
  const [itcHistory, setItcHistory] = useState<ITCTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Purchase ITC state
  const [selectedPackage, setSelectedPackage] = useState<ITCPackage | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const [paymentError, setPaymentError] = useState('')

  // Gift card redemption state
  const [giftCardCode, setGiftCardCode] = useState('')
  const [giftCardLoading, setGiftCardLoading] = useState(false)
  const [giftCardError, setGiftCardError] = useState('')
  const [giftCardSuccess, setGiftCardSuccess] = useState<{ amount: number; newBalance: number } | null>(null)

  // ITC to USD rate (1 ITC = $0.01)
  const itcToUSD = 0.01

  // Load user wallet data
  useEffect(() => {
    if (!user?.id) {
      setLoading(false)
      setError('Please log in to access your wallet')
      return
    }

    loadWalletData()
  }, [user?.id])

  // Check for payment success in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('payment') === 'success') {
      setPaymentSuccess(true)
      loadWalletData()
      // Clean URL
      window.history.replaceState({}, '', '/wallet')
    }
  }, [])

  const loadWalletData = async () => {
    if (!user?.id) return

    try {
      setLoading(true)
      setError('')

      const response = await apiFetch('/api/wallet/get', {
        method: 'GET',
      })

      const wallet = response.wallet

      if (!wallet) {
        throw new Error('No wallet data returned')
      }

      setItcBalance(Number(wallet.itc_balance || 0))

      // Load transaction history
      await loadTransactionHistory()

    } catch (error: any) {
      console.error('Failed to load wallet data:', error)
      setError('Failed to load wallet data: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const loadTransactionHistory = async () => {
    try {
      // Load ITC transactions
      const itcResponse = await apiFetch('/api/wallet/transactions/itc', {
        method: 'GET'
      })

      // Map snake_case to camelCase for ITC transactions
      const mappedItcTransactions = (itcResponse.transactions || []).map((t: any) => ({
        id: t.id,
        userId: t.user_id,
        type: t.type,
        amount: t.amount,
        usdValue: t.metadata?.usd_value || Math.abs(t.amount) * itcToUSD,
        reason: t.reference || t.type || 'ITC Transaction',
        createdAt: t.created_at,
        metadata: t.metadata
      }))
      setItcHistory(mappedItcTransactions)
    } catch (error) {
      console.error('Failed to load transaction history:', error)
      // Non-critical, don't show error
    }
  }

  const handleSelectPackage = async (pkg: ITCPackage) => {
    if (isProcessingPayment) return

    setSelectedPackage(pkg)
    setPaymentError('')
    setIsProcessingPayment(true)

    try {
      // Create payment intent
      const amountInCents = Math.round(pkg.priceUSD * 100)
      const response = await apiFetch('/api/stripe/create-payment-intent', {
        method: 'POST',
        body: JSON.stringify({
          amount: amountInCents,
          currency: 'usd',
          description: `Purchase ${pkg.itcAmount} ITC`
        })
      })

      setClientSecret(response.clientSecret)
    } catch (error: any) {
      console.error('Failed to create payment intent:', error)
      setPaymentError(error.message || 'Failed to initialize payment')
      setIsProcessingPayment(false)
    }
  }

  const handlePaymentSuccess = async () => {
    setPaymentSuccess(true)
    setIsProcessingPayment(false)
    setClientSecret(null)
    setSelectedPackage(null)
    await loadWalletData()

    // Scroll to top and show success message
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleRedeemGiftCard = async () => {
    if (!giftCardCode.trim() || !user?.id) return

    setGiftCardLoading(true)
    setGiftCardError('')
    setGiftCardSuccess(null)

    try {
      const response = await apiFetch('/api/gift-cards/redeem', {
        method: 'POST',
        body: JSON.stringify({
          code: giftCardCode.trim().toUpperCase(),
          userId: user.id
        })
      })

      if (response.success) {
        setGiftCardSuccess({
          amount: response.itc_credited,
          newBalance: response.new_balance
        })
        setGiftCardCode('')
        setItcBalance(response.new_balance)
        await loadTransactionHistory()
      } else {
        setGiftCardError(response.error || 'Failed to redeem gift card')
      }
    } catch (error: any) {
      console.error('Failed to redeem gift card:', error)
      setGiftCardError(error.message || 'Failed to redeem gift card')
    } finally {
      setGiftCardLoading(false)
    }
  }

  const handlePaymentError = (error: string) => {
    setPaymentError(error)
    setIsProcessingPayment(false)
  }

  const handleCancelPayment = () => {
    setClientSecret(null)
    setSelectedPackage(null)
    setIsProcessingPayment(false)
    setPaymentError('')
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="text-center py-12 bg-white rounded-2xl shadow-soft border border-slate-100 p-8 max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-2xl font-display font-bold text-slate-900 mb-2">Access Denied</h2>
          <p className="text-slate-500">Please log in to access your wallet.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-4 text-slate-500">Loading wallet data...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="text-center py-12 bg-white rounded-2xl shadow-soft border border-slate-100 p-8 max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-2xl font-display font-bold text-red-600 mb-2">Error</h2>
          <p className="text-slate-500 mb-6">{error}</p>
          <button
            onClick={loadWalletData}
            className="px-6 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 font-medium transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  const elementsOptions: StripeElementsOptions = {
    clientSecret: clientSecret || undefined,
    appearance: {
      theme: 'stripe',
      variables: {
        colorPrimary: '#9333ea',
        colorBackground: '#ffffff',
        colorText: '#1e293b',
        colorDanger: '#ef4444',
        borderRadius: '12px',
        fontFamily: 'DM Sans, system-ui, sans-serif'
      }
    }
  }

  const tabs = [
    { key: 'overview' as const, label: 'Overview', icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    )},
    { key: 'history' as const, label: 'Transaction History', icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    )},
    { key: 'purchase' as const, label: 'Buy ITC', icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    )}
  ]

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      {/* Header Section */}
      <div className="bg-gradient-to-br from-purple-600 via-purple-700 to-pink-600 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }} />
        </div>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 relative">
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-white mb-2">My Wallet</h1>
          <p className="text-purple-100">Manage your ITC balance</p>
        </div>
      </div>

      {/* Success Message */}
      {paymentSuccess && (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 -mt-4 relative z-10">
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-emerald-800 font-semibold">Payment successful!</p>
              <p className="text-emerald-600 text-sm">Your ITC has been added to your wallet.</p>
            </div>
            <button onClick={() => setPaymentSuccess(false)} className="ml-auto text-emerald-400 hover:text-emerald-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Wallet Overview Card */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 -mt-6 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {/* ITC Balance Card */}
          <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6 hover:shadow-soft-lg transition-shadow">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500/10 to-pink-500/10 flex items-center justify-center p-2">
                <img src="/itc-coin.png" alt="ITC" className="w-full h-full object-contain" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500">ITC Balance</p>
                <p className="text-3xl font-display font-bold text-slate-900">{itcBalance.toFixed(2)}</p>
              </div>
            </div>
            <div className="pt-3 border-t border-slate-100">
              <p className="text-sm text-slate-500">
                <span className="text-purple-600 font-semibold">${(itcBalance * itcToUSD).toFixed(2)}</span> USD value
              </p>
            </div>
          </div>

          {/* Quick Actions Card */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl shadow-soft p-6 text-white">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-14 h-14 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center">
                <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-slate-300">Quick Actions</p>
                <p className="text-lg font-display font-bold">Get More ITC</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setSelectedTab('purchase')}
                className="flex-1 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-medium text-sm transition-colors"
              >
                Buy ITC
              </button>
              <button
                onClick={() => setSelectedTab('history')}
                className="flex-1 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium text-sm transition-colors"
              >
                View History
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 mt-8">
        <div className="bg-white rounded-xl shadow-soft border border-slate-100 p-1.5">
          <nav className="flex gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setSelectedTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm whitespace-nowrap transition-all ${
                  selectedTab === tab.key
                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/25'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 mt-6">
        {selectedTab === 'overview' && (
          <div className="space-y-6">
            {/* What is ITC */}
            <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl border border-purple-100 p-6">
              <h3 className="text-lg font-display font-bold text-slate-900 mb-3">What is ITC?</h3>
              <p className="text-slate-600 mb-4">
                ITC (Imagine This Coin) is the currency of ImagineThisPrinted. Use it to:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl p-4 border border-purple-100">
                  <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center mb-3">
                    <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h4 className="font-semibold text-slate-900 mb-1">AI Design Generation</h4>
                  <p className="text-sm text-slate-500">Create unique designs with AI</p>
                </div>
                <div className="bg-white rounded-xl p-4 border border-purple-100">
                  <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center mb-3">
                    <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <h4 className="font-semibold text-slate-900 mb-1">Store Credit</h4>
                  <p className="text-sm text-slate-500">Apply to purchases</p>
                </div>
                <div className="bg-white rounded-xl p-4 border border-purple-100">
                  <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center mb-3">
                    <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <h4 className="font-semibold text-slate-900 mb-1">Cash Out</h4>
                  <p className="text-sm text-slate-500">Convert to real money</p>
                </div>
              </div>
            </div>

            {/* Redeem Gift Card */}
            <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100">
                <h3 className="text-lg font-display font-bold text-slate-900">Redeem Gift Card</h3>
                <p className="text-slate-500 text-sm mt-1">Enter your gift card code to add ITC to your wallet</p>
              </div>
              <div className="p-6">
                {/* Success Message */}
                {giftCardSuccess && (
                  <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                        <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-emerald-800 font-semibold">Gift Card Redeemed!</p>
                        <p className="text-emerald-600 text-sm">
                          +{giftCardSuccess.amount.toFixed(2)} ITC added to your wallet
                        </p>
                        <p className="text-emerald-600 text-sm">
                          New balance: {giftCardSuccess.newBalance.toFixed(2)} ITC
                        </p>
                      </div>
                      <button
                        onClick={() => setGiftCardSuccess(null)}
                        className="ml-auto text-emerald-400 hover:text-emerald-600"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}

                {/* Error Message */}
                {giftCardError && (
                  <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-red-800 font-semibold">Error</p>
                      <p className="text-red-600 text-sm">{giftCardError}</p>
                    </div>
                    <button
                      onClick={() => setGiftCardError('')}
                      className="ml-auto text-red-400 hover:text-red-600"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )}

                {/* Input Form */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                      </svg>
                    </div>
                    <input
                      type="text"
                      value={giftCardCode}
                      onChange={(e) => setGiftCardCode(e.target.value.toUpperCase())}
                      placeholder="Enter gift card code (e.g., ITP-XXXX-XXXX-XXXX)"
                      className="w-full pl-12 pr-4 py-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm uppercase tracking-wider"
                      disabled={giftCardLoading}
                    />
                  </div>
                  <button
                    onClick={handleRedeemGiftCard}
                    disabled={giftCardLoading || !giftCardCode.trim()}
                    className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-medium hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 min-w-[140px]"
                  >
                    {giftCardLoading ? (
                      <>
                        <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Redeeming...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
                        </svg>
                        <span>Redeem</span>
                      </>
                    )}
                  </button>
                </div>

                <p className="mt-3 text-xs text-slate-400">
                  Gift card codes are case-insensitive. Each code can only be redeemed once.
                </p>
              </div>
            </div>

            {/* Recent Transactions */}
            <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                <h3 className="text-lg font-display font-bold text-slate-900">Recent Transactions</h3>
                {itcHistory.length > 0 && (
                  <button
                    onClick={() => setSelectedTab('history')}
                    className="text-sm text-purple-600 hover:text-purple-700 font-medium"
                  >
                    View All
                  </button>
                )}
              </div>
              <div className="divide-y divide-slate-100">
                {itcHistory.slice(0, 5).map((transaction, index) => (
                  <div key={transaction.id || index} className="flex justify-between items-center px-6 py-4 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        transaction.amount > 0
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-red-50 text-red-600'
                      }`}>
                        {transaction.amount > 0 ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5m5 5V6" />
                          </svg>
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">{transaction.reason}</p>
                        <p className="text-sm text-slate-500">
                          {new Date(transaction.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-semibold ${
                        transaction.amount > 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {transaction.amount > 0 ? '+' : ''}{Math.abs(transaction.amount).toFixed(2)} ITC
                      </p>
                      <p className="text-xs text-slate-400">
                        ${(Math.abs(transaction.amount) * itcToUSD).toFixed(2)}
                      </p>
                    </div>
                  </div>
                ))}
                {itcHistory.length === 0 && (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
                      <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    </div>
                    <p className="text-slate-500 mb-4">No transactions yet</p>
                    <button
                      onClick={() => setSelectedTab('purchase')}
                      className="px-6 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 font-medium transition-colors"
                    >
                      Buy Your First ITC
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {selectedTab === 'purchase' && (
          <div className="space-y-6">
            {!clientSecret ? (
              <>
                <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100">
                    <h3 className="text-lg font-display font-bold text-slate-900">Purchase ITC</h3>
                    <p className="text-slate-500 text-sm mt-1">Select a package below to purchase ITC with your credit card.</p>
                  </div>
                  <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {ITC_PACKAGES.map((pkg) => (
                        <div
                          key={pkg.itcAmount}
                          onClick={() => handleSelectPackage(pkg)}
                          className={`relative p-6 rounded-xl cursor-pointer transition-all ${
                            pkg.popular
                              ? 'border-2 border-purple-500 bg-purple-50 shadow-lg shadow-purple-500/10'
                              : 'border-2 border-slate-200 bg-white hover:border-purple-300 hover:shadow-soft'
                          }`}
                        >
                          {pkg.popular && (
                            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-purple-600 text-white text-xs font-bold rounded-full">
                              POPULAR
                            </div>
                          )}
                          <div className="text-center">
                            <p className="text-3xl font-display font-bold text-slate-900 mb-1">{pkg.itcAmount}</p>
                            <p className="text-sm text-slate-500 mb-4">ITC</p>
                            <p className="text-2xl font-bold text-purple-600 mb-2">${pkg.priceUSD.toFixed(2)}</p>
                            {pkg.bonusPercent && pkg.bonusPercent > 0 && (
                              <span className="inline-block px-2 py-1 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-full">
                                Save {pkg.bonusPercent}%
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {paymentError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                    <p className="text-red-700">{paymentError}</p>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                  <h3 className="text-lg font-display font-bold text-slate-900">Complete Payment</h3>
                  <button
                    onClick={handleCancelPayment}
                    className="text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="p-6">
                  {selectedPackage && (
                    <div className="mb-6 p-4 bg-purple-50 rounded-xl border border-purple-100">
                      <div className="flex justify-between items-center">
                        <div>
                          <p className="text-slate-900 font-semibold">{selectedPackage.itcAmount} ITC</p>
                          {selectedPackage.bonusPercent && selectedPackage.bonusPercent > 0 && (
                            <p className="text-sm text-emerald-600 font-medium">Save {selectedPackage.bonusPercent}%</p>
                          )}
                        </div>
                        <p className="text-2xl font-bold text-purple-600">${selectedPackage.priceUSD.toFixed(2)}</p>
                      </div>
                    </div>
                  )}

                  {paymentError && (
                    <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-4">
                      <p className="text-red-700">{paymentError}</p>
                    </div>
                  )}

                  <Elements stripe={stripePromise} options={elementsOptions}>
                    <PaymentForm
                      clientSecret={clientSecret}
                      onSuccess={handlePaymentSuccess}
                      onError={handlePaymentError}
                    />
                  </Elements>
                </div>
              </div>
            )}
          </div>
        )}

        {selectedTab === 'history' && (
          <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-lg font-display font-bold text-slate-900">Transaction History</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {itcHistory.map((transaction) => (
                <div key={transaction.id} className="flex justify-between items-center px-6 py-4 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      transaction.amount > 0
                        ? 'bg-emerald-50 text-emerald-600'
                        : 'bg-red-50 text-red-600'
                    }`}>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">{transaction.reason}</p>
                      <p className="text-sm text-slate-500">
                        {new Date(transaction.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-semibold text-lg ${
                      transaction.amount > 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      {transaction.amount > 0 ? '+' : ''}{Math.abs(transaction.amount).toFixed(2)} ITC
                    </p>
                    <p className="text-xs text-slate-400">
                      ${(Math.abs(transaction.amount) * itcToUSD).toFixed(2)} USD
                    </p>
                  </div>
                </div>
              ))}
              {itcHistory.length === 0 && (
                <div className="text-center py-12">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
                    <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-slate-500">No transactions yet</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Wallet

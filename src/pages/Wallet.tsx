import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { Elements } from '@stripe/react-stripe-js'
import { loadStripe, type StripeElementsOptions } from '@stripe/stripe-js'
import { apiFetch } from '../lib/api'
import type { PointsTransaction, ITCTransaction } from '../types'
import { type ITCPackage, ITC_PACKAGES } from '../utils/stripe-itc'
import PaymentForm from '../components/PaymentForm'

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY!)

const Wallet: React.FC = () => {
  const { user } = useAuth()
  const [selectedTab, setSelectedTab] = useState<'overview' | 'points' | 'itc' | 'redeem' | 'purchase'>('overview')
  const [pointsBalance, setPointsBalance] = useState(0)
  const [itcBalance, setItcBalance] = useState(0)
  const [pointsHistory, setPointsHistory] = useState<PointsTransaction[]>([])
  const [itcHistory, setItcHistory] = useState<ITCTransaction[]>([])
  const [redeemAmount, setRedeemAmount] = useState('')
  const [redeemType, setRedeemType] = useState<'product' | 'discount' | 'itc'>('itc')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Purchase ITC state
  const [selectedPackage, setSelectedPackage] = useState<ITCPackage | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const [paymentError, setPaymentError] = useState('')

  // Exchange rates
  const pointsToUSD = 0.01 // 1 point = $0.01
  const usdToITC = 0.25 // $1 = 0.25 ITC

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

      setPointsBalance(wallet.points || 0)
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
        usdValue: t.metadata?.usd_value || 0,
        reason: t.reference || 'ITC Transaction',
        createdAt: t.created_at,
        metadata: t.metadata
      }))
      setItcHistory(mappedItcTransactions)

      // Load points transactions
      const pointsResponse = await apiFetch('/api/wallet/transactions/points', {
        method: 'GET'
      })

      // Map snake_case to camelCase for points transactions
      const mappedPointsTransactions = (pointsResponse.transactions || []).map((t: any) => ({
        id: t.id,
        userId: t.user_id,
        type: 'points',
        amount: t.points_change,
        reason: t.reason || 'Points Transaction',
        createdAt: t.created_at,
        relatedId: t.reference
      }))
      setPointsHistory(mappedPointsTransactions)
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
          description: `Purchase ${pkg.itcAmount} ITC tokens`
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

  const handleRedeem = async () => {
    if (!user?.id || !redeemAmount) return

    const amount = parseInt(redeemAmount)
    if (amount > pointsBalance) {
      alert('Insufficient points balance')
      return
    }

    try {
      const result = await apiFetch('/api/wallet/redeem', {
        method: 'POST',
        body: JSON.stringify({
          points: amount,
          redeemType: redeemType
        })
      })

      await loadWalletData()
      setRedeemAmount('')
      alert('Points redeemed successfully!')
    } catch (error) {
      console.error('Redemption error:', error)
      alert('Redemption failed. Please try again.')
    }
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
    { key: 'points' as const, label: 'Points', icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    )},
    { key: 'itc' as const, label: 'ITC', icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )},
    { key: 'redeem' as const, label: 'Redeem', icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
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
          <p className="text-purple-100">Manage your points and ITC tokens</p>
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
              <p className="text-emerald-600 text-sm">Your ITC tokens have been added to your wallet.</p>
            </div>
            <button onClick={() => setPaymentSuccess(false)} className="ml-auto text-emerald-400 hover:text-emerald-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Wallet Overview Cards */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 -mt-6 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          {/* Points Card */}
          <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6 hover:shadow-soft-lg transition-shadow">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500">Points Balance</p>
                <p className="text-2xl font-display font-bold text-slate-900">{pointsBalance.toLocaleString()}</p>
              </div>
            </div>
            <div className="pt-3 border-t border-slate-100">
              <p className="text-sm text-slate-500">
                <span className="text-amber-600 font-medium">${(pointsBalance * pointsToUSD).toFixed(2)}</span> USD value
              </p>
            </div>
          </div>

          {/* ITC Card */}
          <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6 hover:shadow-soft-lg transition-shadow">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500">ITC Tokens</p>
                <p className="text-2xl font-display font-bold text-slate-900">{itcBalance.toFixed(2)}</p>
              </div>
            </div>
            <div className="pt-3 border-t border-slate-100">
              <p className="text-sm text-slate-500">
                <span className="text-purple-600 font-medium">${(itcBalance / usdToITC).toFixed(2)}</span> USD value
              </p>
            </div>
          </div>

          {/* Total Value Card */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl shadow-soft p-6 text-white">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-slate-300">Total Value</p>
                <p className="text-2xl font-display font-bold">
                  ${((pointsBalance * pointsToUSD) + (itcBalance / usdToITC)).toFixed(2)}
                </p>
              </div>
            </div>
            <div className="pt-3 border-t border-white/10">
              <p className="text-sm text-slate-400">Combined wallet value</p>
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
          <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-lg font-display font-bold text-slate-900">Recent Transactions</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {[...itcHistory.slice(0, 3), ...pointsHistory.slice(0, 3)]
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .slice(0, 5)
                .map((transaction, index) => {
                  const date = transaction.createdAt
                  const description = (transaction as any).description || transaction.reason
                  const isItc = 'usd_value' in transaction || 'metadata' in transaction

                  return (
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
                          <p className="font-medium text-slate-900">{description}</p>
                          <p className="text-sm text-slate-500">
                            {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        </div>
                      </div>
                      <p className={`font-semibold ${
                        transaction.amount > 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {transaction.amount > 0 ? '+' : ''}{Math.abs(transaction.amount).toFixed(isItc ? 2 : 0)}
                        <span className="text-xs ml-1 text-slate-400">{isItc ? 'ITC' : 'PTS'}</span>
                      </p>
                    </div>
                  )
                })}
              {itcHistory.length === 0 && pointsHistory.length === 0 && (
                <div className="text-center py-12">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
                    <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <p className="text-slate-500">No transactions yet</p>
                </div>
              )}
            </div>
          </div>
        )}

        {selectedTab === 'purchase' && (
          <div className="space-y-6">
            {!clientSecret ? (
              <>
                <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100">
                    <h3 className="text-lg font-display font-bold text-slate-900">Purchase ITC Tokens</h3>
                    <p className="text-slate-500 text-sm mt-1">Select a package below to purchase ITC tokens with your credit card.</p>
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
                            <p className="text-sm text-slate-500 mb-4">ITC Tokens</p>
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
                          <p className="text-slate-900 font-semibold">{selectedPackage.itcAmount} ITC Tokens</p>
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

        {selectedTab === 'redeem' && (
          <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-lg font-display font-bold text-slate-900">Redeem Points</h3>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Points to Redeem
                </label>
                <input
                  type="number"
                  value={redeemAmount}
                  onChange={(e) => setRedeemAmount(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                  placeholder="Enter points amount"
                  max={pointsBalance}
                />
                <p className="text-sm text-slate-500 mt-2">
                  Available: <span className="font-semibold text-amber-600">{pointsBalance.toLocaleString()}</span> points
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Redeem For
                </label>
                <select
                  value={redeemType}
                  onChange={(e) => setRedeemType(e.target.value as any)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                >
                  <option value="itc">ITC Tokens</option>
                  <option value="discount">Store Discount</option>
                  <option value="product">Free Product</option>
                </select>
              </div>

              {redeemType === 'itc' && redeemAmount && (
                <div className="p-4 bg-purple-50 rounded-xl border border-purple-100">
                  <p className="text-slate-700">
                    <span className="font-semibold">{redeemAmount}</span> points = <span className="font-semibold text-purple-600">${(parseInt(redeemAmount || '0') * pointsToUSD).toFixed(2)}</span> = <span className="font-semibold text-purple-600">{((parseInt(redeemAmount || '0') * pointsToUSD) * usdToITC).toFixed(2)} ITC</span> tokens
                  </p>
                </div>
              )}

              <button
                onClick={handleRedeem}
                disabled={!redeemAmount || parseInt(redeemAmount) > pointsBalance}
                className="w-full px-6 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed font-semibold transition-all"
              >
                Redeem Points
              </button>
            </div>
          </div>
        )}

        {selectedTab === 'points' && (
          <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-lg font-display font-bold text-slate-900">Points History</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {pointsHistory.map((transaction) => {
                const date = transaction.createdAt
                const description = transaction.reason

                return (
                  <div key={transaction.id} className="flex justify-between items-center px-6 py-4 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        transaction.amount > 0
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-red-50 text-red-600'
                      }`}>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">{description}</p>
                        <p className="text-sm text-slate-500">
                          {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                    </div>
                    <p className={`font-semibold ${
                      transaction.amount > 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      {transaction.amount > 0 ? '+' : ''}{Math.abs(transaction.amount)} PTS
                    </p>
                  </div>
                )
              })}
              {pointsHistory.length === 0 && (
                <div className="text-center py-12">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
                    <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                    </svg>
                  </div>
                  <p className="text-slate-500">No points transactions yet</p>
                </div>
              )}
            </div>
          </div>
        )}

        {selectedTab === 'itc' && (
          <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-lg font-display font-bold text-slate-900">ITC Transaction History</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {itcHistory.map((transaction) => {
                const date = transaction.createdAt
                const description = transaction.reason

                return (
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
                        <p className="font-medium text-slate-900">{description}</p>
                        <p className="text-sm text-slate-500">
                          {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                        {transaction.usdValue && (
                          <p className="text-xs text-slate-400">${transaction.usdValue.toFixed(2)} USD</p>
                        )}
                      </div>
                    </div>
                    <p className={`font-semibold text-lg ${
                      transaction.amount > 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      {transaction.amount > 0 ? '+' : ''}{Math.abs(transaction.amount).toFixed(2)} ITC
                    </p>
                  </div>
                )
              })}
              {itcHistory.length === 0 && (
                <div className="text-center py-12">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
                    <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-slate-500">No ITC transactions yet</p>
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

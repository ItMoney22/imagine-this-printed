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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold text-text mb-4">Access Denied</h2>
          <p className="text-muted">Please log in to access your wallet.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted">Loading wallet data...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold text-red-600 mb-4">Error</h2>
          <p className="text-muted">{error}</p>
          <button
            onClick={loadWalletData}
            className="mt-4 px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/80"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const elementsOptions: StripeElementsOptions = {
    clientSecret: clientSecret || undefined,
    appearance: {
      theme: 'night',
      variables: {
        colorPrimary: '#a855f7',
        colorBackground: '#1e1b4b',
        colorText: '#ffffff',
        colorDanger: '#ef4444',
        borderRadius: '8px'
      }
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-text mb-8">My Wallet</h1>

      {/* Success Message */}
      {paymentSuccess && (
        <div className="mb-6 p-4 bg-green-500/20 border border-green-500 rounded-lg">
          <p className="text-green-400 font-semibold">Payment successful! Your ITC tokens have been added to your wallet.</p>
        </div>
      )}

      {/* Wallet Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <div className="bg-card rounded-lg shadow-lg p-6 border border-primary/20">
          <h3 className="text-lg font-semibold text-text mb-2">Points Balance</h3>
          <p className="text-3xl font-bold text-green-400">{pointsBalance.toLocaleString()}</p>
          <p className="text-sm text-muted">≈ ${(pointsBalance * pointsToUSD).toFixed(2)} USD</p>
        </div>

        <div className="bg-card rounded-lg shadow-lg p-6 border border-primary/20">
          <h3 className="text-lg font-semibold text-text mb-2">ITC Tokens</h3>
          <p className="text-3xl font-bold text-primary">{itcBalance.toFixed(2)}</p>
          <p className="text-sm text-muted">≈ ${(itcBalance / usdToITC).toFixed(2)} USD</p>
        </div>

        <div className="bg-card rounded-lg shadow-lg p-6 border border-primary/20">
          <h3 className="text-lg font-semibold text-text mb-2">Total Value</h3>
          <p className="text-3xl font-bold text-accent">
            ${((pointsBalance * pointsToUSD) + (itcBalance / usdToITC)).toFixed(2)}
          </p>
          <p className="text-sm text-muted">Combined wallet value</p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="mb-6">
        <nav className="flex space-x-4 overflow-x-auto">
          {(['overview', 'points', 'itc', 'redeem', 'purchase'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab)}
              className={`px-4 py-2 rounded-md font-medium whitespace-nowrap transition-colors ${
                selectedTab === tab
                  ? 'bg-primary text-white shadow-glow'
                  : 'text-muted hover:text-text hover:bg-card'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {selectedTab === 'overview' && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg shadow-lg p-6 border border-primary/20">
            <h3 className="text-lg font-semibold mb-4">Recent Transactions</h3>
            <div className="space-y-3">
              {[...itcHistory.slice(0, 3), ...pointsHistory.slice(0, 3)]
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .slice(0, 5)
                .map((transaction, index) => {
                  const date = transaction.createdAt
                  const description = (transaction as any).description || transaction.reason
                  const isItc = 'usd_value' in transaction || 'metadata' in transaction

                  return (
                    <div key={transaction.id || index} className="flex justify-between items-center py-3 border-b border-primary/10">
                      <div>
                        <p className="font-medium text-text">{description}</p>
                        <p className="text-sm text-muted">
                          {new Date(date).toLocaleDateString()} {new Date(date).toLocaleTimeString()}
                        </p>
                      </div>
                      <p className={`font-semibold ${
                        transaction.amount > 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {transaction.amount > 0 ? '+' : ''}{Math.abs(transaction.amount).toFixed(isItc ? 2 : 0)}
                        {isItc ? ' ITC' : ' PTS'}
                      </p>
                    </div>
                  )
                })}
              {itcHistory.length === 0 && pointsHistory.length === 0 && (
                <p className="text-muted text-center py-4">No transactions yet</p>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedTab === 'purchase' && (
        <div className="space-y-6">
          {!clientSecret ? (
            // Package selection
            <>
              <div className="bg-card rounded-lg shadow-lg p-6 border border-primary/20">
                <h3 className="text-lg font-semibold mb-4">Purchase ITC Tokens</h3>
                <p className="text-muted mb-6">Select a package below to purchase ITC tokens with your credit card.</p>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {ITC_PACKAGES.map((pkg) => (
                    <div
                      key={pkg.itcAmount}
                      className={`relative p-6 rounded-lg border-2 cursor-pointer transition-all ${
                        pkg.popular
                          ? 'border-primary bg-primary/10 shadow-glow'
                          : 'border-primary/20 bg-card hover:border-primary/50'
                      }`}
                      onClick={() => handleSelectPackage(pkg)}
                    >
                      {pkg.popular && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary text-white text-xs font-bold rounded-full">
                          POPULAR
                        </div>
                      )}
                      <div className="text-center">
                        <p className="text-3xl font-bold text-text mb-2">{pkg.itcAmount}</p>
                        <p className="text-sm text-muted mb-4">ITC Tokens</p>
                        <p className="text-2xl font-bold text-primary mb-2">${pkg.priceUSD.toFixed(2)}</p>
                        {pkg.bonusPercent && pkg.bonusPercent > 0 && (
                          <p className="text-sm text-green-400 font-semibold">
                            Save {pkg.bonusPercent}%
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {paymentError && (
                <div className="bg-red-500/20 border border-red-500 rounded-lg p-4">
                  <p className="text-red-400">{paymentError}</p>
                </div>
              )}
            </>
          ) : (
            // Payment form
            <div className="bg-card rounded-lg shadow-lg p-6 border border-primary/20">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold">Complete Payment</h3>
                <button
                  onClick={handleCancelPayment}
                  className="text-muted hover:text-text"
                >
                  Cancel
                </button>
              </div>

              {selectedPackage && (
                <div className="mb-6 p-4 bg-primary/10 rounded-lg border border-primary/30">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-text font-semibold">{selectedPackage.itcAmount} ITC Tokens</p>
                      {selectedPackage.bonusPercent && selectedPackage.bonusPercent > 0 && (
                        <p className="text-sm text-green-400">Save {selectedPackage.bonusPercent}%</p>
                      )}
                    </div>
                    <p className="text-2xl font-bold text-primary">${selectedPackage.priceUSD.toFixed(2)}</p>
                  </div>
                </div>
              )}

              {paymentError && (
                <div className="mb-4 bg-red-500/20 border border-red-500 rounded-lg p-4">
                  <p className="text-red-400">{paymentError}</p>
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
          )}
        </div>
      )}

      {selectedTab === 'redeem' && (
        <div className="bg-card rounded-lg shadow-lg p-6 border border-primary/20">
          <h3 className="text-lg font-semibold mb-4">Redeem Points</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text mb-2">
                Points to Redeem
              </label>
              <input
                type="number"
                value={redeemAmount}
                onChange={(e) => setRedeemAmount(e.target.value)}
                className="w-full px-3 py-2 bg-bg border border-primary/20 rounded-md text-text focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Enter points amount"
                max={pointsBalance}
              />
              <p className="text-sm text-muted mt-1">
                Available: {pointsBalance} points
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-text mb-2">
                Redeem For
              </label>
              <select
                value={redeemType}
                onChange={(e) => setRedeemType(e.target.value as any)}
                className="w-full px-3 py-2 bg-bg border border-primary/20 rounded-md text-text focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="itc">ITC Tokens</option>
                <option value="discount">Store Discount</option>
                <option value="product">Free Product</option>
              </select>
            </div>

            {redeemType === 'itc' && redeemAmount && (
              <div className="p-3 bg-primary/10 rounded-md border border-primary/30">
                <p className="text-sm text-text">
                  {redeemAmount} points = ${(parseInt(redeemAmount || '0') * pointsToUSD).toFixed(2)} = {((parseInt(redeemAmount || '0') * pointsToUSD) * usdToITC).toFixed(2)} ITC tokens
                </p>
              </div>
            )}

            <button
              onClick={handleRedeem}
              disabled={!redeemAmount || parseInt(redeemAmount) > pointsBalance}
              className="w-full px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/80 disabled:bg-gray-600 disabled:cursor-not-allowed font-semibold shadow-glow transition-all"
            >
              Redeem Points
            </button>
          </div>
        </div>
      )}

      {selectedTab === 'points' && (
        <div className="bg-card rounded-lg shadow-lg p-6 border border-primary/20">
          <h3 className="text-lg font-semibold mb-4">Points History</h3>
          <div className="space-y-3">
            {pointsHistory.map((transaction) => {
              const date = transaction.createdAt
              const description = transaction.reason

              return (
                <div key={transaction.id} className="flex justify-between items-center py-3 border-b border-primary/10">
                  <div>
                    <p className="font-medium text-text">{description}</p>
                    <p className="text-sm text-muted">
                      {new Date(date).toLocaleDateString()} {new Date(date).toLocaleTimeString()}
                    </p>
                  </div>
                  <p className={`font-semibold ${
                    transaction.amount > 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {transaction.amount > 0 ? '+' : ''}{Math.abs(transaction.amount)} PTS
                  </p>
                </div>
              )
            })}
            {pointsHistory.length === 0 && (
              <p className="text-muted text-center py-4">No points transactions yet</p>
            )}
          </div>
        </div>
      )}

      {selectedTab === 'itc' && (
        <div className="bg-card rounded-lg shadow-lg p-6 border border-primary/20">
          <h3 className="text-lg font-semibold mb-4">ITC Transaction History</h3>
          <div className="space-y-3">
            {itcHistory.map((transaction) => {
              const date = transaction.createdAt
              const description = transaction.reason

              return (
                <div key={transaction.id} className="flex justify-between items-center py-3 border-b border-primary/10">
                  <div className="flex-1">
                    <p className="font-medium text-text">{description}</p>
                    <p className="text-sm text-muted">
                      {new Date(date).toLocaleDateString()} {new Date(date).toLocaleTimeString()}
                    </p>
                    {transaction.usdValue && (
                      <p className="text-xs text-muted">≈ ${transaction.usdValue.toFixed(2)} USD</p>
                    )}
                  </div>
                  <p className={`font-semibold text-lg ml-4 ${
                    transaction.amount > 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {transaction.amount > 0 ? '+' : ''}{Math.abs(transaction.amount).toFixed(2)} ITC
                  </p>
                </div>
              )
            })}
            {itcHistory.length === 0 && (
              <p className="text-muted text-center py-4">No ITC transactions yet</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default Wallet


import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { stripeITCBridge } from '../utils/stripe-itc'
import { apiFetch } from '@/lib/api'
// Removed direct Prisma import - using API endpoints instead
import type { PointsTransaction, ITCTransaction } from '../types'

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
  const [purchaseAmount, setPurchaseAmount] = useState('')
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)

  // Exchange rates
  const pointsToUSD = 0.01 // 1 point = $0.01
  const usdToITC = 0.25 // $1 = 0.25 ITC

  // Load user wallet data securely
  useEffect(() => {
    if (!user?.id) {
      setLoading(false)
      setError('Please log in to access your wallet')
      return
    }

    loadWalletData()
  }, [user?.id])

  const loadWalletData = async () => {
    if (!user?.id) return

    try {
      setLoading(true)
      setError('')

      const walletData = await apiFetch('/api/wallet/get', {
        method: 'GET',
      })

      // Set balances (default to 0 if no wallet exists)
      setPointsBalance(walletData.pointsBalance || 0)
      setItcBalance(Number(walletData.itcBalance || 0))
      setPointsHistory(walletData.pointsHistory || [])
      setItcHistory(walletData.itcHistory || [])

    } catch (error: any) {
      console.error('Failed to load wallet data:', error)
      setError('Failed to load wallet data: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handlePurchaseITC = async () => {
    if (!user?.id || !purchaseAmount) return

    setIsProcessingPayment(true)
    try {
      const amount = parseFloat(purchaseAmount)
      const result = await stripeITCBridge.purchaseITC(amount, user.id)
      
      if (result.success) {
        // Refresh wallet data after successful purchase
        await loadWalletData()
        setPurchaseAmount('')
        alert(`Successfully purchased ${result.itcAmount} ITC tokens!`)
      } else {
        alert(`Purchase failed: ${result.error}`)
      }
    } catch (error) {
      console.error('Purchase error:', error)
      alert('Purchase failed. Please try again.')
    } finally {
      setIsProcessingPayment(false)
    }
  }

  const handleRedeem = async () => {
    if (!user?.id || !redeemAmount) return

    const amount = parseInt(redeemAmount)
    if (amount > pointsBalance) {
      alert('Insufficient points balance')
      return
    }

    try {
      if (redeemType === 'itc') {
        const result = await apiFetch('/api/wallet/redeem', {
          method: 'POST',
          body: JSON.stringify({
            amount: amount,
            redeemType: redeemType
          })
        })

        // Refresh data
        await loadWalletData()
        setRedeemAmount('')
        alert(result.message)
      }
    } catch (error) {
      console.error('Redemption error:', error)
      alert('Redemption failed. Please try again.')
    }
  }

  if (!user) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Access Denied</h2>
          <p className="text-gray-600">Please log in to access your wallet.</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading wallet data...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold text-red-600 mb-4">Error</h2>
          <p className="text-gray-600">{error}</p>
          <button 
            onClick={loadWalletData}
            className="mt-4 btn-primary"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">My Wallet</h1>

      {/* Wallet Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Points Balance</h3>
          <p className="text-3xl font-bold text-green-600">{pointsBalance.toLocaleString()}</p>
          <p className="text-sm text-gray-600">≈ ${(pointsBalance * pointsToUSD).toFixed(2)} USD</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">ITC Tokens</h3>
          <p className="text-3xl font-bold text-purple-600">{itcBalance.toFixed(2)}</p>
          <p className="text-sm text-gray-600">≈ ${(itcBalance / usdToITC).toFixed(2)} USD</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Total Value</h3>
          <p className="text-3xl font-bold text-blue-600">
            ${((pointsBalance * pointsToUSD) + (itcBalance / usdToITC)).toFixed(2)}
          </p>
          <p className="text-sm text-gray-600">Combined wallet value</p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="mb-6">
        <nav className="flex space-x-4">
          {['overview', 'points', 'itc', 'redeem', 'purchase'].map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab as any)}
              className={`px-4 py-2 rounded-md font-medium ${
                selectedTab === tab
                  ? 'bg-purple-600 text-white'
                  : 'text-gray-600 hover:text-gray-900'
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
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Recent Transactions</h3>
            <div className="space-y-3">
              {[...pointsHistory.slice(0, 3), ...itcHistory.slice(0, 3)]
                .sort((a, b) => new Date((a as any).createdAt || a.createdAt).getTime() - new Date((b as any).createdAt || b.createdAt).getTime())
                .slice(0, 5)
                .map((transaction, index) => (
                <div key={index} className="flex justify-between items-center py-2 border-b">
                  <div>
                    <p className="font-medium">{transaction.reason}</p>
                    <p className="text-sm text-gray-600">
                      {new Date((transaction as any).createdAt || transaction.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <p className={`font-semibold ${
                    transaction.amount > 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {transaction.amount > 0 ? '+' : ''}{transaction.amount} 
                    {'type' in transaction && transaction.type ? ' ITC' : ' PTS'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedTab === 'redeem' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Redeem Points</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Points to Redeem
              </label>
              <input
                type="number"
                value={redeemAmount}
                onChange={(e) => setRedeemAmount(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="Enter points amount"
                max={pointsBalance}
              />
              <p className="text-sm text-gray-600 mt-1">
                Available: {pointsBalance} points
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Redeem For
              </label>
              <select
                value={redeemType}
                onChange={(e) => setRedeemType(e.target.value as any)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="itc">ITC Tokens</option>
                <option value="discount">Store Discount</option>
                <option value="product">Free Product</option>
              </select>
            </div>

            {redeemType === 'itc' && redeemAmount && (
              <div className="p-3 bg-gray-50 rounded-md">
                <p className="text-sm">
                  {redeemAmount} points = ${(parseInt(redeemAmount || '0') * pointsToUSD).toFixed(2)} = {((parseInt(redeemAmount || '0') * pointsToUSD) * usdToITC).toFixed(2)} ITC tokens
                </p>
              </div>
            )}

            <button
              onClick={handleRedeem}
              disabled={!redeemAmount || parseInt(redeemAmount) > pointsBalance}
              className="w-full btn-primary disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Redeem Points
            </button>
          </div>
        </div>
      )}

      {selectedTab === 'purchase' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Purchase ITC Tokens</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                USD Amount
              </label>
              <input
                type="number"
                value={purchaseAmount}
                onChange={(e) => setPurchaseAmount(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="Enter USD amount"
                min="1"
                step="0.01"
              />
            </div>

            {purchaseAmount && (
              <div className="p-3 bg-gray-50 rounded-md">
                <p className="text-sm">
                  ${purchaseAmount} = {stripeITCBridge.calculateITCAmount(parseFloat(purchaseAmount))} ITC tokens
                </p>
                <p className="text-xs text-gray-600">
                  Exchange rate: 1 USD = {1 / stripeITCBridge.getExchangeRate()} ITC
                </p>
              </div>
            )}

            <button
              onClick={handlePurchaseITC}
              disabled={!purchaseAmount || isProcessingPayment}
              className="w-full btn-primary disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isProcessingPayment ? 'Processing...' : 'Purchase ITC Tokens'}
            </button>
          </div>
        </div>
      )}

      {selectedTab === 'points' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Points History</h3>
          <div className="space-y-3">
            {pointsHistory.map((transaction) => (
              <div key={transaction.id} className="flex justify-between items-center py-2 border-b">
                <div>
                  <p className="font-medium">{transaction.reason}</p>
                  <p className="text-sm text-gray-600">
                    {new Date((transaction as any).createdAt || transaction.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <p className={`font-semibold ${
                  transaction.amount > 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {transaction.amount > 0 ? '+' : ''}{transaction.amount} PTS
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedTab === 'itc' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">ITC Transaction History</h3>
          <div className="space-y-3">
            {itcHistory.map((transaction) => (
              <div key={transaction.id} className="flex justify-between items-center py-2 border-b">
                <div>
                  <p className="font-medium">{transaction.reason}</p>
                  <p className="text-sm text-gray-600">
                    {new Date((transaction as any).createdAt || transaction.createdAt).toLocaleDateString()}
                  </p>
                  {(transaction as any).usdValue && (
                    <p className="text-xs text-gray-500">≈ ${((transaction as any).usdValue as number).toFixed(2)} USD</p>
                  )}
                </div>
                <p className={`font-semibold ${
                  transaction.amount > 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {transaction.amount > 0 ? '+' : ''}{transaction.amount} ITC
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default Wallet
import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { stripeITCBridge } from '../utils/stripe-itc'
import type { PointsTransaction, ITCTransaction, Product } from '../types'

const Wallet: React.FC = () => {
  const { user } = useAuth()
  const [selectedTab, setSelectedTab] = useState<'overview' | 'points' | 'itc' | 'redeem' | 'purchase'>('overview')
  const [pointsBalance, setPointsBalance] = useState(1250)
  const [itcBalance, setItcBalance] = useState(45.67)
  const [pointsHistory, setPointsHistory] = useState<PointsTransaction[]>([])
  const [itcHistory, setItcHistory] = useState<ITCTransaction[]>([])
  const [redeemAmount, setRedeemAmount] = useState('')
  const [redeemType, setRedeemType] = useState<'product' | 'discount' | 'itc'>('itc')
  
  // Purchase ITC state
  const [purchaseAmount, setPurchaseAmount] = useState('')
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [rewardProducts, setRewardProducts] = useState<Product[]>([])
  const [transactionFilter] = useState<'all' | 'points' | 'itc'>('all')

  // Exchange rates
  const pointsToUSD = 0.01 // 1 point = $0.01
  const usdToITC = 0.25 // $1 = 0.25 ITC

  useEffect(() => {
    // Mock transaction history
    const mockPointsHistory: PointsTransaction[] = [
      {
        id: '1',
        userId: user?.id || '',
        type: 'earned',
        amount: 50,
        reason: '3D Model Upload: Dragon Figurine',
        relatedId: 'model1',
        createdAt: '2025-01-10T10:00:00Z'
      },
      {
        id: '2',
        userId: user?.id || '',
        type: 'earned',
        amount: 15,
        reason: 'Model Upvoted: Phone Stand',
        relatedId: 'model2',
        createdAt: '2025-01-09T14:30:00Z'
      },
      {
        id: '3',
        userId: user?.id || '',
        type: 'redeemed',
        amount: -100,
        reason: 'Redeemed for ITC Tokens',
        createdAt: '2025-01-08T16:45:00Z'
      }
    ]

    const mockITCHistory: ITCTransaction[] = [
      {
        id: '1',
        userId: user?.id || '',
        type: 'reward',
        amount: 1.0,
        usdValue: 4.0,
        reason: 'Points Redemption',
        createdAt: '2025-01-08T16:45:00Z'
      },
      {
        id: '2',
        userId: user?.id || '',
        type: 'purchase',
        amount: 10.0,
        usdValue: 40.0,
        reason: 'Token Purchase',
        createdAt: '2025-01-05T12:00:00Z'
      }
    ]

    // Mock reward products
    const mockRewardProducts: Product[] = [
      {
        id: 'reward-1',
        name: 'Custom Sticker Pack',
        description: 'Set of 10 custom stickers',
        price: 15.0,
        images: ['https://images.unsplash.com/photo-1607083206869-4c7672e72a8a?w=200&h=200&fit=crop'],
        category: 'shirts',
        inStock: true
      },
      {
        id: 'reward-2',
        name: 'Premium Badge',
        description: 'Exclusive premium user badge',
        price: 25.0,
        images: ['https://images.unsplash.com/photo-1604173472508-37e4c0b1b6d0?w=200&h=200&fit=crop'],
        category: 'tumblers',
        inStock: true
      }
    ]

    setPointsHistory(mockPointsHistory)
    setItcHistory(mockITCHistory)
    setRewardProducts(mockRewardProducts)
  }, [user?.id, transactionFilter])

  const purchaseITC = async (usdAmount: number) => {
    setIsProcessingPayment(true)
    
    try {
      const result = await stripeITCBridge.purchaseITC(usdAmount, user?.id || '')
      
      if (result.success) {
        // Update ITC balance
        setItcBalance(prev => prev + result.itcAmount)
        
        // Add transaction to history
        const newTransaction: ITCTransaction = {
          id: result.paymentIntentId || Date.now().toString(),
          userId: user?.id || '',
          type: 'purchase',
          amount: result.itcAmount,
          usdValue: usdAmount,
          reason: 'Token Purchase via Stripe',
          createdAt: new Date().toISOString(),
          transactionHash: result.transactionHash
        }
        
        setItcHistory(prev => [newTransaction, ...prev])
        alert(`Successfully purchased ${result.itcAmount} ITC tokens for $${usdAmount.toFixed(2)}!`)
      } else {
        alert(`Payment failed: ${result.error}`)
      }
    } catch (error) {
      console.error('Purchase error:', error)
      alert('Payment processing failed. Please try again.')
    } finally {
      setIsProcessingPayment(false)
      setPurchaseAmount('')
    }
  }

  const handlePurchaseSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const amount = parseFloat(purchaseAmount)
    if (amount >= 5.00) {
      purchaseITC(amount)
    } else {
      alert('Minimum purchase amount is $5.00')
    }
  }

  const handleRedeem = (e: React.FormEvent) => {
    e.preventDefault()
    
    const amount = parseInt(redeemAmount)
    if (amount <= 0 || amount > pointsBalance) {
      alert('Invalid redemption amount')
      return
    }

    if (redeemType === 'itc') {
      const usdValue = amount * pointsToUSD
      const itcAmount = usdValue * usdToITC
      
      setPointsBalance(prev => prev - amount)
      setItcBalance(prev => prev + itcAmount)
      
      // Add transactions
      const pointsTransaction: PointsTransaction = {
        id: Date.now().toString(),
        userId: user?.id || '',
        type: 'redeemed',
        amount: -amount,
        reason: 'Redeemed for ITC Tokens',
        createdAt: new Date().toISOString()
      }
      
      const itcTransaction: ITCTransaction = {
        id: (Date.now() + 1).toString(),
        userId: user?.id || '',
        type: 'reward',
        amount: itcAmount,
        usdValue: usdValue,
        reason: 'Points Redemption',
        createdAt: new Date().toISOString()
      }
      
      setPointsHistory(prev => [pointsTransaction, ...prev])
      setItcHistory(prev => [itcTransaction, ...prev])
      
      alert(`Successfully redeemed ${amount} points for ${itcAmount.toFixed(2)} ITC tokens!`)
    }
    
    setRedeemAmount('')
  }

  const rewardItems = [
    { id: '1', name: 'Custom T-Shirt', points: 500, image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=200&h=200&fit=crop' },
    { id: '2', name: '10% Discount Coupon', points: 100, image: 'https://images.unsplash.com/photo-1607083206869-4c7672e72a8a?w=200&h=200&fit=crop' },
    { id: '3', name: 'Premium Tumbler', points: 750, image: 'https://images.unsplash.com/photo-1544441892-794166f1e3be?w=200&h=200&fit=crop' },
    { id: '4', name: '25% Discount Coupon', points: 250, image: 'https://images.unsplash.com/photo-1607083206869-4c7672e72a8a?w=200&h=200&fit=crop' }
  ]

  if (!user) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
          <p className="text-yellow-800">Please sign in to access your wallet.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Wallet & Rewards</h1>
        <p className="text-gray-600">Manage your points, ITC tokens, and redeem rewards</p>
      </div>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-gradient-to-r from-purple-400 to-purple-600 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-purple-100 text-sm font-medium">Points Balance</p>
              <p className="text-3xl font-bold">{pointsBalance.toLocaleString()}</p>
              <p className="text-purple-100 text-sm">≈ ${(pointsBalance * pointsToUSD).toFixed(2)} USD</p>
            </div>
            <div className="p-3 bg-purple-500 rounded-full">
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-blue-400 to-blue-600 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm font-medium">ITC Token Balance</p>
              <p className="text-3xl font-bold">{itcBalance.toFixed(2)}</p>
              <p className="text-blue-100 text-sm">≈ ${(itcBalance / usdToITC).toFixed(2)} USD</p>
            </div>
            <div className="p-3 bg-blue-500 rounded-full">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-green-400 to-green-600 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm font-medium">Total Value</p>
              <p className="text-3xl font-bold">${((pointsBalance * pointsToUSD) + (itcBalance / usdToITC)).toFixed(2)}</p>
              <p className="text-green-100 text-sm">Combined portfolio</p>
            </div>
            <div className="p-3 bg-green-500 rounded-full">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {['overview', 'points', 'itc', 'redeem', 'purchase'].map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                selectedTab === tab
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab === 'purchase' ? 'Purchase ITC' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {/* Overview Tab */}
      {selectedTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">How to Earn Points</h3>
              <div className="space-y-3">
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center mr-3">
                    <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Upload 3D Models</p>
                    <p className="text-sm text-gray-600">50 points per approved model</p>
                  </div>
                </div>
                
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3">
                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Get Model Upvotes</p>
                    <p className="text-sm text-gray-600">3 points per upvote received</p>
                  </div>
                </div>
                
                <div className="flex items-center">
                  <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center mr-3">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Admin Rewards</p>
                    <p className="text-sm text-gray-600">Variable points for special contributions</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Redemption Options</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                  <div>
                    <p className="font-medium text-gray-900">ITC Tokens</p>
                    <p className="text-sm text-gray-600">100 points = 0.25 ITC</p>
                  </div>
                  <span className="text-purple-600 font-semibold">Best Value</span>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                  <div>
                    <p className="font-medium text-gray-900">Product Discounts</p>
                    <p className="text-sm text-gray-600">100-500 points</p>
                  </div>
                  <span className="text-blue-600 font-semibold">Popular</span>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
                  <div>
                    <p className="font-medium text-gray-900">Free Products</p>
                    <p className="text-sm text-gray-600">500-1000 points</p>
                  </div>
                  <span className="text-green-600 font-semibold">Premium</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Points Tab */}
      {selectedTab === 'points' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Points Transaction History</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reason</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {pointsHistory.map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(transaction.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        transaction.type === 'earned' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {transaction.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <span className={transaction.amount > 0 ? 'text-green-600' : 'text-red-600'}>
                        {transaction.amount > 0 ? '+' : ''}{transaction.amount}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {transaction.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ITC Tab */}
      {selectedTab === 'itc' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">ITC Token History</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ITC Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">USD Value</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reason</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {itcHistory.map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(transaction.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        transaction.type === 'purchase' ? 'bg-blue-100 text-blue-800' :
                        transaction.type === 'reward' ? 'bg-green-100 text-green-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {transaction.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600">
                      {transaction.amount.toFixed(4)} ITC
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ${transaction.usdValue.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {transaction.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Redeem Tab */}
      {selectedTab === 'redeem' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-6">Redeem Points</h3>
            
            <form onSubmit={handleRedeem} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Redemption Type</label>
                  <select
                    value={redeemType}
                    onChange={(e) => setRedeemType(e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="itc">ITC Tokens</option>
                    <option value="discount">Discount Coupon</option>
                    <option value="product">Free Product</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Points to Redeem</label>
                  <input
                    type="number"
                    value={redeemAmount}
                    onChange={(e) => setRedeemAmount(e.target.value)}
                    placeholder="Enter points amount"
                    max={pointsBalance}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                    required
                  />
                </div>
              </div>
              
              {redeemType === 'itc' && redeemAmount && (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                  <p className="text-blue-800">
                    {redeemAmount} points = {((parseInt(redeemAmount) || 0) * pointsToUSD * usdToITC).toFixed(4)} ITC tokens
                  </p>
                </div>
              )}
              
              <button
                type="submit"
                disabled={!redeemAmount || parseInt(redeemAmount) > pointsBalance}
                className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                Redeem Points
              </button>
            </form>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-6">Reward Shop</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {rewardItems.map((item) => (
                <div key={item.id} className="border rounded-lg overflow-hidden">
                  <img src={item.image} alt={item.name} className="w-full h-32 object-cover" />
                  <div className="p-4">
                    <h4 className="font-semibold text-gray-900 mb-2">{item.name}</h4>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-purple-600 font-bold">{item.points} points</span>
                      <span className="text-sm text-gray-500">≈ ${(item.points * pointsToUSD).toFixed(2)}</span>
                    </div>
                    <button
                      disabled={pointsBalance < item.points}
                      className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white text-sm font-medium py-2 px-3 rounded transition-colors"
                    >
                      {pointsBalance >= item.points ? 'Redeem' : 'Not Enough Points'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Purchase ITC Tab */}
      {selectedTab === 'purchase' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900">Purchase ITC Tokens</h3>
              <div className="text-sm text-gray-600">
                Exchange Rate: 1 ITC = ${stripeITCBridge.getExchangeRate().toFixed(2)} USD
              </div>
            </div>
            
            <form onSubmit={handlePurchaseSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">USD Amount</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <span className="text-gray-500 sm:text-sm">$</span>
                    </div>
                    <input
                      type="number"
                      value={purchaseAmount}
                      onChange={(e) => setPurchaseAmount(e.target.value)}
                      placeholder="5.00"
                      min="5.00"
                      step="0.01"
                      className="pl-7 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Minimum purchase: $5.00</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">ITC Tokens You'll Receive</label>
                  <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-md">
                    <span className="text-lg font-semibold text-purple-600">
                      {purchaseAmount ? stripeITCBridge.calculateITCAmount(parseFloat(purchaseAmount) || 0) : 0} ITC
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                <div className="flex items-center">
                  <svg className="w-5 h-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-blue-900">Secure Payment via Stripe</p>
                    <p className="text-sm text-blue-700">
                      Tokens will be sent to wallet: {stripeITCBridge.getWalletAddress().slice(0, 8)}...{stripeITCBridge.getWalletAddress().slice(-8)}
                    </p>
                  </div>
                </div>
              </div>
              
              <button
                type="submit"
                disabled={isProcessingPayment || !purchaseAmount || parseFloat(purchaseAmount) < 5}
                className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:from-gray-400 disabled:to-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-all flex items-center justify-center"
              >
                {isProcessingPayment ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Processing Payment...
                  </>
                ) : (
                  <>🛒 Purchase ITC Tokens</>
                )}
              </button>
            </form>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-6">Quick Purchase Options</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { usd: 10, itc: 100, popular: false },
                { usd: 25, itc: 250, popular: true },
                { usd: 50, itc: 500, popular: false },
                { usd: 100, itc: 1000, popular: false }
              ].map((package_) => (
                <button
                  key={package_.usd}
                  onClick={() => purchaseITC(package_.usd)}
                  disabled={isProcessingPayment}
                  className={`p-4 border rounded-lg text-center hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    package_.popular ? 'border-purple-600 bg-purple-50' : 'border-gray-200'
                  }`}
                >
                  <div className="text-2xl font-bold text-gray-900 mb-1">{package_.itc} ITC</div>
                  <div className="text-lg text-gray-600 mb-2">${package_.usd}</div>
                  {package_.popular && (
                    <div className="text-xs text-purple-600 font-medium mb-2">Most Popular</div>
                  )}
                  <div className="text-xs text-gray-500">≈ ${(package_.usd / package_.itc).toFixed(3)}/ITC</div>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-6">Reward Shop</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {rewardProducts.map((product) => {
                const canAfford = itcBalance >= product.price
                return (
                  <div key={product.id} className="border rounded-lg overflow-hidden">
                    <img src={product.images[0]} alt={product.name} className="w-full h-32 object-cover" />
                    <div className="p-4">
                      <h4 className="font-semibold text-gray-900 mb-2">{product.name}</h4>
                      <p className="text-sm text-gray-600 mb-3">{product.description}</p>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-purple-600 font-bold">{product.price} ITC</span>
                        <span className="text-sm text-gray-500">≈ ${(product.price * stripeITCBridge.getExchangeRate()).toFixed(2)}</span>
                      </div>
                      <button
                        disabled={!canAfford}
                        className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white text-sm font-medium py-2 px-3 rounded transition-colors"
                      >
                        {canAfford ? 'Purchase with ITC' : 'Insufficient Balance'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Wallet
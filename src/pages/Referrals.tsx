import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { referralSystem } from '../utils/referral-system'
import type { ReferralCode, ReferralTransaction } from '../types'

const Referrals: React.FC = () => {
  const { user } = useAuth()
  const [selectedTab, setSelectedTab] = useState<'overview' | 'share' | 'history' | 'leaderboard'>('overview')
  const [referralCode, setReferralCode] = useState<ReferralCode | null>(null)
  const [transactions, setTransactions] = useState<ReferralTransaction[]>([])
  const [totalEarnings, setTotalEarnings] = useState(0)
  const [totalReferrals, setTotalReferrals] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [_showShareModal, _setShowShareModal] = useState(false)
  const [copiedText, setCopiedText] = useState('')

  useEffect(() => {
    if (user) {
      loadReferralData()
    }
  }, [user])

  const loadReferralData = async () => {
    if (!user) return
    
    setIsLoading(true)
    try {
      const stats = await referralSystem.getUserReferralStats(user.id)
      
      // If user doesn't have a referral code, generate one
      if (!stats.referralCode) {
        const newCode = referralSystem.generateReferralCode(user.id, (user as any).firstName || user.email?.split('@')[0] || 'User')
        setReferralCode(newCode)
      } else {
        setReferralCode(stats.referralCode)
      }
      
      setTransactions(stats.transactions)
      setTotalEarnings(stats.totalEarnings)
      setTotalReferrals(stats.totalReferrals)
    } catch (error) {
      console.error('Error loading referral data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedText(label)
      setTimeout(() => setCopiedText(''), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  const openShareUrl = (url: string) => {
    window.open(url, '_blank', 'width=600,height=400')
  }

  const sharingContent = referralCode 
    ? referralSystem.generateSharingContent(referralCode.code, (user as any)?.firstName || 'Friend')
    : null

  if (!user) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
          <p className="text-yellow-800">Please sign in to access your referral dashboard.</p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Referral Program</h1>
        <p className="text-gray-600">Earn points by referring friends to ImagineThisPrinted</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-gradient-to-r from-purple-400 to-purple-600 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-purple-100 text-sm font-medium">Your Referral Code</p>
              <p className="text-2xl font-bold">{referralCode?.code || 'Loading...'}</p>
              <p className="text-purple-100 text-sm">Share with friends</p>
            </div>
            <div className="p-3 bg-purple-500 rounded-full">
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92S19.61 16.08 18 16.08z"/>
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-green-400 to-green-600 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm font-medium">Total Referrals</p>
              <p className="text-3xl font-bold">{totalReferrals}</p>
              <p className="text-green-100 text-sm">Friends joined</p>
            </div>
            <div className="p-3 bg-green-500 rounded-full">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-blue-400 to-blue-600 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm font-medium">Points Earned</p>
              <p className="text-3xl font-bold">{totalEarnings.toLocaleString()}</p>
              <p className="text-blue-100 text-sm">≈ ${(totalEarnings * 0.01).toFixed(2)} value</p>
            </div>
            <div className="p-3 bg-blue-500 rounded-full">
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-yellow-400 to-orange-500 rounded-lg p-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-yellow-100 text-sm font-medium">Conversion Rate</p>
              <p className="text-3xl font-bold">
                {totalReferrals > 0 ? Math.round((transactions.filter(t => t.type === 'purchase').length / totalReferrals) * 100) : 0}%
              </p>
              <p className="text-yellow-100 text-sm">Friends who purchased</p>
            </div>
            <div className="p-3 bg-yellow-500 rounded-full">
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
          {[
            { id: 'overview', label: 'Overview', icon: '📊' },
            { id: 'share', label: 'Share & Invite', icon: '📤' },
            { id: 'history', label: 'Transaction History', icon: '📋' },
            { id: 'leaderboard', label: 'Leaderboard', icon: '🏆' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${
                selectedTab === tab.id
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Overview Tab */}
      {selectedTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">How It Works</h3>
              <div className="space-y-4">
                <div className="flex items-start">
                  <div className="flex-shrink-0 w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center mr-4">
                    <span className="text-purple-600 font-semibold">1</span>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">Share Your Code</h4>
                    <p className="text-sm text-gray-600">Send your unique referral code to friends via email, social media, or direct link</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="flex-shrink-0 w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center mr-4">
                    <span className="text-purple-600 font-semibold">2</span>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">Friend Signs Up</h4>
                    <p className="text-sm text-gray-600">Your friend creates an account using your referral code and gets 50 bonus points</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="flex-shrink-0 w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center mr-4">
                    <span className="text-purple-600 font-semibold">3</span>
                  </div>
                  <div>
                    <h4 className="font-medium text-gray-900">You Earn Rewards</h4>
                    <p className="text-sm text-gray-600">Get 100 points when they sign up, plus 5% commission on their future purchases</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Reward Structure</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-green-50 rounded">
                  <div>
                    <p className="font-medium text-green-900">Friend Signs Up</p>
                    <p className="text-sm text-green-700">One-time bonus</p>
                  </div>
                  <span className="text-green-600 font-bold">100 points</span>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-blue-50 rounded">
                  <div>
                    <p className="font-medium text-blue-900">Friend Makes Purchase</p>
                    <p className="text-sm text-blue-700">5% commission as points</p>
                  </div>
                  <span className="text-blue-600 font-bold">5% value</span>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-purple-50 rounded">
                  <div>
                    <p className="font-medium text-purple-900">Friend's Bonus</p>
                    <p className="text-sm text-purple-700">Welcome bonus for new users</p>
                  </div>
                  <span className="text-purple-600 font-bold">50 points</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold mb-2">Ready to Start Earning?</h3>
                <p className="text-purple-100">Share your referral code and start earning points today!</p>
              </div>
              <button
                onClick={() => setSelectedTab('share')}
                className="bg-white text-purple-600 font-semibold py-2 px-6 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Share Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Tab */}
      {selectedTab === 'share' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-6">Share Your Referral Code</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Your Referral Code</label>
                <div className="flex">
                  <input
                    type="text"
                    value={referralCode?.code || ''}
                    readOnly
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-l-md bg-gray-50 text-lg font-mono"
                  />
                  <button
                    onClick={() => copyToClipboard(referralCode?.code || '', 'code')}
                    className="px-4 py-2 bg-purple-600 text-white rounded-r-md hover:bg-purple-700 transition-colors"
                  >
                    {copiedText === 'code' ? '✓' : 'Copy'}
                  </button>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Your Referral Link</label>
                <div className="flex">
                  <input
                    type="text"
                    value={referralCode ? referralSystem.generateReferralUrl(referralCode.code) : ''}
                    readOnly
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-l-md bg-gray-50 text-sm"
                  />
                  <button
                    onClick={() => copyToClipboard(
                      referralCode ? referralSystem.generateReferralUrl(referralCode.code) : '', 
                      'link'
                    )}
                    className="px-4 py-2 bg-purple-600 text-white rounded-r-md hover:bg-purple-700 transition-colors"
                  >
                    {copiedText === 'link' ? '✓' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>

            {sharingContent && (
              <div>
                <h4 className="text-md font-semibold text-gray-900 mb-4">Share on Social Media</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {sharingContent.messages.map((share) => (
                    <button
                      key={share.platform}
                      onClick={() => openShareUrl(share.url)}
                      className={`p-4 rounded-lg border-2 transition-colors text-center hover:shadow-md ${
                        share.platform === 'email' ? 'border-gray-300 hover:border-gray-400' :
                        share.platform === 'twitter' ? 'border-blue-300 hover:border-blue-400' :
                        share.platform === 'facebook' ? 'border-blue-600 hover:border-blue-700' :
                        'border-green-400 hover:border-green-500'
                      }`}
                    >
                      <div className={`text-2xl mb-2 ${
                        share.platform === 'email' ? 'text-gray-600' :
                        share.platform === 'twitter' ? 'text-blue-500' :
                        share.platform === 'facebook' ? 'text-blue-600' :
                        'text-green-500'
                      }`}>
                        {share.platform === 'email' ? '📧' :
                         share.platform === 'twitter' ? '🐦' :
                         share.platform === 'facebook' ? '📘' : '📱'}
                      </div>
                      <div className="font-medium capitalize text-gray-900">{share.platform}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <div className="flex items-start">
              <svg className="w-6 h-6 text-blue-600 mr-3 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h4 className="font-semibold text-blue-900 mb-2">Pro Tips for Sharing</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• Share with friends who are interested in custom designs and printing</li>
                  <li>• Mention specific benefits like high-quality products and fast delivery</li>
                  <li>• Share your own designs as examples of what's possible</li>
                  <li>• Follow up to help them get started and answer any questions</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History Tab */}
      {selectedTab === 'history' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Referral Transaction History</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Friend</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Your Reward</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(transaction.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {transaction.refereeEmail}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        transaction.type === 'signup' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {transaction.type === 'signup' ? 'Sign Up' : 'Purchase'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                      +{transaction.referrerReward} points
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        transaction.status === 'completed' ? 'bg-green-100 text-green-800' :
                        transaction.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {transaction.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {transactions.length === 0 && (
            <div className="text-center py-12">
              <svg className="w-12 h-12 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-gray-500">No referral transactions yet. Start sharing to earn rewards!</p>
            </div>
          )}
        </div>
      )}

      {/* Leaderboard Tab */}
      {selectedTab === 'leaderboard' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-6">Top Referrers This Month</h3>
            <div className="space-y-4">
              {[
                { rank: 1, name: 'Sarah W.', referrals: 12, earnings: 650, badge: '🥇' },
                { rank: 2, name: 'Mike J.', referrals: 8, earnings: 420, badge: '🥈' },
                { rank: 3, name: 'Emma L.', referrals: 6, earnings: 315, badge: '🥉' },
                { rank: 4, name: 'You', referrals: totalReferrals, earnings: totalEarnings, badge: '👤' },
                { rank: 5, name: 'David R.', referrals: 4, earnings: 210, badge: '🔥' }
              ].map((user) => (
                <div 
                  key={user.rank} 
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    user.name === 'You' ? 'border-purple-200 bg-purple-50' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center">
                    <span className="text-2xl mr-3">{user.badge}</span>
                    <div>
                      <div className={`font-medium ${user.name === 'You' ? 'text-purple-900' : 'text-gray-900'}`}>
                        #{user.rank} {user.name}
                      </div>
                      <div className="text-sm text-gray-600">{user.referrals} referrals</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-semibold ${user.name === 'You' ? 'text-purple-600' : 'text-green-600'}`}>
                      {user.earnings} points
                    </div>
                    <div className="text-sm text-gray-500">≈ ${(user.earnings * 0.01).toFixed(2)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-gradient-to-r from-yellow-400 to-orange-500 rounded-lg p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold mb-2">🏆 Monthly Challenge</h3>
                <p className="text-yellow-100">Refer 10 friends this month and earn a 500 point bonus!</p>
                <div className="mt-2">
                  <div className="bg-yellow-300 rounded-full h-2 w-64">
                    <div 
                      className="bg-white rounded-full h-2 transition-all duration-300"
                      style={{ width: `${Math.min((totalReferrals / 10) * 100, 100)}%` }}
                    ></div>
                  </div>
                  <p className="text-sm text-yellow-100 mt-1">{totalReferrals}/10 referrals</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Referrals
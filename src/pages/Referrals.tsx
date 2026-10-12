import React, { useState, useEffect } from 'react'
import {
  BarChart3,
  ClipboardList,
  Facebook,
  Link2,
  Lock,
  Mail,
  MessageCircle,
  Share2,
  ShoppingBag,
  Twitter,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react'
import { useAuth } from '../context/SupabaseAuthContext'
import { useGuestGate } from '../components/GuestGate'
import { REFERRAL_LINK_DAYS, REFERRAL_REWARDS } from '../lib/referral-program'
import { itcToUsdLabel } from '../lib/itc-pricing'
import { referralSystem } from '../utils/referral-system'
import type { ReferralCode, ReferralTransaction } from '../types'

const { firstOrder: FIRST_ORDER_REWARD, friend: FRIEND_REWARD } = REFERRAL_REWARDS
// "500 ITC ($5.00)", "$15", "10%": the numbers the database pays, in words.
const REFERRER_REWARD = `${FIRST_ORDER_REWARD.referrerItc} ITC (${itcToUsdLabel(FIRST_ORDER_REWARD.referrerItc)})`
const MIN_ORDER = `$${FIRST_ORDER_REWARD.minProductsUsd}`
const FRIEND_OFF = `${FRIEND_REWARD.percentOff}%`

const SHARE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  twitter: Twitter,
  facebook: Facebook,
  whatsapp: MessageCircle,
}

// Logged out: what the program is and how it pays, readable by anyone.
// The dashboard (your link, your friends, your rewards) stays private.
const ReferralsPublic: React.FC = () => {
  const { startAccount } = useGuestGate()

  const steps = [
    {
      icon: UserPlus,
      title: 'Make a free account',
      body: 'Your account comes with your own referral link.',
    },
    {
      icon: Share2,
      title: 'Share your link',
      body: 'Text it, post it, or email it to friends who would love custom prints.',
    },
    {
      icon: UserCheck,
      title: 'A friend joins',
      body: `They make their free account on the phone or computer they opened your link on, within ${REFERRAL_LINK_DAYS} days, and get ${FRIEND_OFF} off their first order.`,
    },
    {
      icon: ShoppingBag,
      title: 'You get rewarded on their first order',
      body: `When that friend's first order of ${MIN_ORDER} or more is paid, you get ${REFERRER_REWARD} in your wallet to spend in the shop.`,
    },
  ]

  return (
    <div className="bg-bg">
      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 sm:pt-14 pb-10">
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
          <div className="animate-fade-in">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wider mb-4">
              <Link2 className="w-3.5 h-3.5" />
              Referral Program
            </span>
            <h1 className="font-display text-4xl sm:text-5xl leading-tight text-text mb-4">
              Share the shop. Get rewarded.
            </h1>
            <p className="text-muted text-base sm:text-lg leading-relaxed mb-6 max-w-xl">
              Send friends your personal link. They get {FRIEND_OFF} off their first order, and when it
              is paid ({MIN_ORDER} or more), you get {REFERRER_REWARD} to spend in the shop.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button type="button" onClick={() => startAccount('referral-link')} className="btn-primary w-full sm:w-auto">
                Get my referral link
              </button>
              <button
                type="button"
                onClick={() => startAccount('referral-link', '/login')}
                className="btn-secondary w-full sm:w-auto !py-3"
              >
                I have an account
              </button>
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-3 rounded-[2rem] bg-gradient-to-br from-primary/20 via-secondary/10 to-accent/20 blur-2xl" aria-hidden="true" />
            <img
              src="/home/how-4-earn.webp"
              alt="A customer smiling at the rewards in their wallet"
              className="relative w-full aspect-[4/3] object-cover rounded-3xl shadow-soft-xl"
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-10">
        <h2 className="font-display text-2xl sm:text-3xl text-text mb-6">How it works</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {steps.map((step, i) => (
            <div key={step.title} className="card-editorial p-5">
              <div className="flex items-center gap-3 mb-3">
                <span className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center font-semibold text-sm">
                  {i + 1}
                </span>
                <step.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-text mb-1">{step.title}</h3>
              <p className="text-sm text-muted leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The dashboard gate, explained */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="rounded-3xl border border-border bg-card p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
            <Lock className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-text text-lg mb-1">Your referral dashboard is private</h2>
            <p className="text-muted text-sm leading-relaxed">
              Your link, the friends who joined with it and the rewards you have earned live on your
              account, so only you can see them. Making an account is free.
            </p>
          </div>
          <button type="button" onClick={() => startAccount('referral-link')} className="btn-primary w-full sm:w-auto shrink-0">
            Create free account
          </button>
        </div>
      </section>
    </div>
  )
}

const Referrals: React.FC = () => {
  const { user } = useAuth()
  const [selectedTab, setSelectedTab] = useState<'overview' | 'share' | 'history' | 'leaderboard'>('overview')
  const [referralCode, setReferralCode] = useState<ReferralCode | null>(null)
  const [transactions, setTransactions] = useState<ReferralTransaction[]>([])
  const [totalEarnings, setTotalEarnings] = useState(0)
  const [totalReferrals, setTotalReferrals] = useState(0)
  const [firstOrders, setFirstOrders] = useState(0)
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
      const stats = await referralSystem.getUserReferralStats()

      // No code yet: create it on the server, so the link shown here is one
      // the API will accept. (It used to be invented in the browser and never
      // saved, so every shared link pointed at a code that did not exist.)
      const code = stats.referralCode
        || await referralSystem.createReferralCode((user as any).firstName || user.email?.split('@')[0] || 'Member')
      setReferralCode(code)

      setTransactions(stats.transactions)
      setTotalEarnings(stats.totalItcEarned)
      setTotalReferrals(stats.totalReferrals)
      setFirstOrders(stats.firstOrders)
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
    ? referralSystem.generateSharingContent(referralCode.code)
    : null

  if (!user) {
    return <ReferralsPublic />
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
        <h1 className="text-3xl font-bold text-text mb-2">Referral Program</h1>
        <p className="text-muted">Earn {REFERRER_REWARD} when a friend you refer pays for a first order of {MIN_ORDER} or more. Your friend gets {FRIEND_OFF} off it.</p>
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
              <p className="text-blue-100 text-sm font-medium">ITC Earned</p>
              <p className="text-3xl font-bold">{totalEarnings.toLocaleString()}</p>
              <p className="text-blue-100 text-sm">≈ {itcToUsdLabel(totalEarnings)} to spend</p>
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
                {totalReferrals > 0 ? Math.round((firstOrders / totalReferrals) * 100) : 0}%
              </p>
              <p className="text-yellow-100 text-sm">Friends who ordered</p>
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
      <div className="border-b card-border mb-6">
        <nav className="-mb-px flex space-x-8 overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview', icon: BarChart3 },
            { id: 'share', label: 'Share & Invite', icon: Share2 },
            { id: 'history', label: 'Transaction History', icon: ClipboardList },
            { id: 'leaderboard', label: 'Your Standing', icon: Users }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center shrink-0 whitespace-nowrap ${
                selectedTab === tab.id
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-muted hover:text-text hover:card-border'
              }`}
            >
              <tab.icon className="w-4 h-4 mr-2" aria-hidden="true" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Overview Tab */}
      {selectedTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-text mb-4">How It Works</h3>
              <div className="space-y-4">
                <div className="flex items-start">
                  <div className="flex-shrink-0 w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center mr-4">
                    <span className="text-purple-600 font-semibold">1</span>
                  </div>
                  <div>
                    <h4 className="font-medium text-text">Share Your Code</h4>
                    <p className="text-sm text-muted">Send your unique referral code to friends via email, social media, or direct link</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="flex-shrink-0 w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center mr-4">
                    <span className="text-purple-600 font-semibold">2</span>
                  </div>
                  <div>
                    <h4 className="font-medium text-text">Friend Joins</h4>
                    <p className="text-sm text-muted">Your friend makes a free account on the phone or computer they opened your link on, within {REFERRAL_LINK_DAYS} days, and gets {FRIEND_OFF} off their first order</p>
                  </div>
                </div>
                
                <div className="flex items-start">
                  <div className="flex-shrink-0 w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center mr-4">
                    <span className="text-purple-600 font-semibold">3</span>
                  </div>
                  <div>
                    <h4 className="font-medium text-text">You Earn Rewards</h4>
                    <p className="text-sm text-muted">Get {REFERRER_REWARD} when their first order of {MIN_ORDER} or more is paid</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-text mb-4">Reward Structure</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-blue-50 rounded">
                  <div>
                    <p className="font-medium text-blue-900">Friend's First Order</p>
                    <p className="text-sm text-blue-700">Paid to you once per friend, on {MIN_ORDER} or more</p>
                  </div>
                  <span className="text-blue-600 font-bold">{FIRST_ORDER_REWARD.referrerItc} ITC</span>
                </div>

                <div className="flex items-center justify-between p-3 bg-green-50 rounded">
                  <div>
                    <p className="font-medium text-green-900">Your Friend Saves</p>
                    <p className="text-sm text-green-700">Off their first order, for {FRIEND_REWARD.days} days after joining</p>
                  </div>
                  <span className="text-green-600 font-bold">{FRIEND_OFF}</span>
                </div>

                <div className="flex items-center justify-between p-3 bg-purple-50 rounded">
                  <div>
                    <p className="font-medium text-purple-900">Your Link Is Remembered</p>
                    <p className="text-sm text-purple-700">On the device your friend opened it on</p>
                  </div>
                  <span className="text-purple-600 font-bold">{REFERRAL_LINK_DAYS} days</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold mb-2">Ready to Start Earning?</h3>
                <p className="text-purple-100">Share your link with friends who would love custom prints.</p>
              </div>
              <button
                onClick={() => setSelectedTab('share')}
                className="bg-card text-purple-600 font-semibold py-2 px-6 rounded-lg hover:bg-card transition-colors"
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
          <div className="bg-card rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-text mb-6">Share Your Referral Code</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-sm font-medium text-text mb-2">Your Referral Code</label>
                <div className="flex">
                  <input
                    type="text"
                    value={referralCode?.code || ''}
                    readOnly
                    className="flex-1 px-3 py-2 border card-border rounded-l-md bg-card text-lg font-mono"
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
                <label className="block text-sm font-medium text-text mb-2">Your Referral Link</label>
                <div className="flex">
                  <input
                    type="text"
                    value={referralCode ? referralSystem.generateReferralUrl(referralCode.code) : ''}
                    readOnly
                    className="flex-1 px-3 py-2 border card-border rounded-l-md bg-card text-sm"
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
                <h4 className="text-md font-semibold text-text mb-4">Share on Social Media</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {sharingContent.messages.map((share) => {
                    const ShareIcon = SHARE_ICONS[share.platform] || Share2
                    return (
                      <button
                        key={share.platform}
                        onClick={() => openShareUrl(share.url)}
                        className={`p-4 rounded-lg border-2 transition-colors text-center hover:shadow-md ${
                          share.platform === 'email' ? 'card-border hover:border-gray-400' :
                          share.platform === 'twitter' ? 'border-blue-300 hover:border-blue-400' :
                          share.platform === 'facebook' ? 'border-blue-600 hover:border-blue-700' :
                          'border-green-400 hover:border-green-500'
                        }`}
                      >
                        <ShareIcon
                          aria-hidden="true"
                          className={`w-7 h-7 mx-auto mb-2 ${
                            share.platform === 'email' ? 'text-muted' :
                            share.platform === 'twitter' ? 'text-blue-500' :
                            share.platform === 'facebook' ? 'text-blue-600' :
                            'text-green-500'
                          }`}
                        />
                        <div className="font-medium capitalize text-text">{share.platform}</div>
                      </button>
                    )
                  })}
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
        <div className="bg-card rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b card-border">
            <h3 className="text-lg font-medium text-text">Referral Transaction History</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-card">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Friend</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Your Reward</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="bg-card divide-y divide-gray-200">
                {transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                      {new Date(transaction.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                      {transaction.refereeEmail}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        transaction.type === 'signup' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {transaction.type === 'signup' ? 'Joined' : 'First order'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                      {transaction.referrerReward > 0 ? `+${transaction.referrerReward} ITC` : <span className="text-muted">Paid on first order</span>}
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
              <p className="text-muted">No referral transactions yet. Start sharing to earn rewards!</p>
            </div>
          )}
        </div>
      )}

      {/* Leaderboard Tab */}
      {selectedTab === 'leaderboard' && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-text mb-6">Your Referral Standing</h3>
            {/* Real numbers only — the old version showed invented competitors
                (Sarah W., Mike J., …). A true cross-user leaderboard needs a
                backend aggregate; until that ships, show the user's own stats. */}
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg border border-purple-200 bg-purple-50">
                <div className="flex items-center">
                  <Users className="w-7 h-7 mr-3 text-purple-600" aria-hidden="true" />
                  <div>
                    <div className="font-medium text-purple-900">You</div>
                    <div className="text-sm text-muted">{totalReferrals} friend{totalReferrals === 1 ? '' : 's'} joined, {firstOrders} ordered</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-purple-600">{totalEarnings} ITC</div>
                  <div className="text-sm text-muted">≈ {itcToUsdLabel(totalEarnings)}</div>
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

import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { founderEarningsService } from '../utils/founder-earnings'
import type { PlatformSettings, AdminEarningsOverview } from '../types'

const AdminControlPanel: React.FC = () => {
  const { user } = useAuth()
  const [settings, setSettings] = useState<PlatformSettings | null>(null)
  const [earningsOverview, setEarningsOverview] = useState<AdminEarningsOverview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [selectedTab, setSelectedTab] = useState<'settings' | 'earnings' | 'payouts' | 'analytics'>('settings')

  useEffect(() => {
    if (user && (user.role === 'admin' || user.role === 'founder')) {
      loadData()
    }
  }, [user])

  const loadData = async () => {
    try {
      setIsLoading(true)

      // Load platform settings and earnings overview
      const [settingsData, overviewData] = await Promise.all([
        loadPlatformSettings(),
        loadEarningsOverview()
      ])

      setSettings(settingsData)
      setEarningsOverview(overviewData)
    } catch (error) {
      console.error('Error loading admin data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const loadPlatformSettings = async (): Promise<PlatformSettings> => {
    // Mock settings - in real app, this would fetch from database
    return {
      id: 'settings_1',
      platformFeePercentage: 0.07,
      stripeFeePercentage: 0.035,
      founderEarningsPercentage: 0.35,
      minimumPayoutAmount: 25.00,
      payoutSchedule: 'weekly',
      autoPayoutEnabled: true,
      lastUpdated: new Date().toISOString(),
      updatedBy: user?.id || 'admin'
    }
  }

  const loadEarningsOverview = async (): Promise<AdminEarningsOverview> => {
    // Mock earnings overview - in real app, this would calculate from database
    return {
      totalRevenue: 45780.25,
      totalPlatformFees: 3204.62,
      totalVendorPayouts: 38925.75,
      totalFounderEarnings: 2849.88,
      pendingPayouts: 5670.00,
      period: 'Last 30 days',
      breakdown: {
        vendorSales: 35680.50,
        inHouseSales: 10099.75,
        subscriptionRevenue: 0,
        otherRevenue: 0
      }
    }
  }

  const saveSettings = async () => {
    if (!settings) return

    try {
      setIsSaving(true)

      // In real app, this would save to database
      console.log('Saving platform settings:', settings)

      // Mock API call
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Update last updated timestamp
      setSettings(prev => prev ? {
        ...prev,
        lastUpdated: new Date().toISOString(),
        updatedBy: user?.id || 'admin'
      } : null)

      alert('Settings saved successfully!')
    } catch (error) {
      console.error('Error saving settings:', error)
      alert('Failed to save settings. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const updateSetting = (key: keyof PlatformSettings, value: any) => {
    if (!settings) return

    setSettings(prev => prev ? {
      ...prev,
      [key]: value
    } : null)
  }

  const processAllPendingPayouts = async () => {
    try {
      // In real app, this would process all pending payouts
      console.log('Processing all pending payouts...')

      // Mock processing
      await new Promise(resolve => setTimeout(resolve, 2000))

      alert('All pending payouts have been processed!')
      await loadData()
    } catch (error) {
      console.error('Error processing payouts:', error)
      alert('Failed to process payouts. Please try again.')
    }
  }

  if (!user || (user.role !== 'admin' && user.role !== 'founder')) {
    return (
      <div className="min-h-screen bg-bg text-text pt-24 pb-12 flex items-center justify-center">
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-8 max-w-md text-center backdrop-blur-md shadow-[0_0_30px_rgba(239,68,68,0.2)]">
          <div className="text-5xl mb-4">🚫</div>
          <h2 className="text-2xl font-bold text-red-400 mb-2">Access Denied</h2>
          <p className="text-muted">You do not have permission to view this page.</p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg text-text pt-24 pb-12 flex items-center justify-center">
        <div className="relative w-24 h-24">
          <div className="absolute inset-0 border-4 border-white/10 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-t-primary rounded-full animate-spin shadow-[0_0_15px_rgba(168,85,247,0.5)]"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg text-text pt-24 pb-12 relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[128px] animate-pulse-slow"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-secondary/20 rounded-full blur-[128px] animate-pulse-slow delay-1000"></div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="mb-10">
          <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary via-purple-400 to-secondary drop-shadow-[0_0_15px_rgba(168,85,247,0.5)] mb-3">
            Admin Control Panel
          </h1>
          <p className="text-muted text-lg">Manage platform settings, payouts, and earnings</p>
        </div>

        {/* Tabs */}
        <div className="bg-card/30 backdrop-blur-md border border-white/10 rounded-2xl p-2 mb-8 flex flex-wrap gap-2">
          {[
            { id: 'settings', label: 'Platform Settings', icon: '⚙️' },
            { id: 'earnings', label: 'Earnings Overview', icon: '💰' },
            { id: 'payouts', label: 'Payout Management', icon: '💳' },
            { id: 'analytics', label: 'Analytics', icon: '📊' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id as any)}
              className={`flex-1 min-w-[150px] py-3 px-4 rounded-xl font-bold transition-all duration-300 flex items-center justify-center space-x-2 ${selectedTab === tab.id
                  ? 'bg-gradient-to-r from-primary to-secondary text-white shadow-lg shadow-primary/25'
                  : 'bg-transparent text-muted hover:bg-white/5 hover:text-text'
                }`}
            >
              <span className="text-xl">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Platform Settings Tab */}
        {selectedTab === 'settings' && settings && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-card/30 backdrop-blur-md rounded-3xl p-8 border border-white/10 shadow-xl">
              <div className="border-b border-white/10 pb-6 mb-6">
                <h3 className="text-2xl font-bold text-text flex items-center">
                  <span className="bg-primary/20 p-2 rounded-lg mr-3 text-primary">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                    </svg>
                  </span>
                  Fee Structure
                </h3>
                <p className="text-muted mt-2 ml-14">Configure platform and processing fees</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-bg/40 rounded-2xl p-6 border border-white/5 hover:border-primary/30 transition-colors">
                  <label className="block text-sm font-bold text-text mb-3 uppercase tracking-wider">
                    Platform Fee Percentage
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.001"
                      value={settings.platformFeePercentage}
                      onChange={(e) => updateSetting('platformFeePercentage', parseFloat(e.target.value))}
                      className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all pr-16 font-mono text-lg"
                    />
                    <span className="absolute right-4 top-3.5 text-primary font-bold">
                      {(settings.platformFeePercentage * 100).toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-sm text-muted mt-3 flex items-center">
                    <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Fee charged to vendors on each sale
                  </p>
                </div>

                <div className="bg-bg/40 rounded-2xl p-6 border border-white/5 hover:border-primary/30 transition-colors">
                  <label className="block text-sm font-bold text-text mb-3 uppercase tracking-wider">
                    Stripe Fee Percentage
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.001"
                      value={settings.stripeFeePercentage}
                      onChange={(e) => updateSetting('stripeFeePercentage', parseFloat(e.target.value))}
                      className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all pr-16 font-mono text-lg"
                    />
                    <span className="absolute right-4 top-3.5 text-primary font-bold">
                      {(settings.stripeFeePercentage * 100).toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-sm text-muted mt-3 flex items-center">
                    <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Payment processing fee
                  </p>
                </div>

                <div className="bg-bg/40 rounded-2xl p-6 border border-white/5 hover:border-primary/30 transition-colors">
                  <label className="block text-sm font-bold text-text mb-3 uppercase tracking-wider">
                    Founder Earnings Percentage
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={settings.founderEarningsPercentage}
                      onChange={(e) => updateSetting('founderEarningsPercentage', parseFloat(e.target.value))}
                      className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all pr-16 font-mono text-lg"
                    />
                    <span className="absolute right-4 top-3.5 text-primary font-bold">
                      {(settings.founderEarningsPercentage * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-sm text-muted mt-3 flex items-center">
                    <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Founder's share of profit from internal products
                  </p>
                </div>

                <div className="bg-bg/40 rounded-2xl p-6 border border-white/5 hover:border-primary/30 transition-colors">
                  <label className="block text-sm font-bold text-text mb-3 uppercase tracking-wider">
                    Minimum Payout Amount
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-3.5 text-muted">$</span>
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      step="0.01"
                      value={settings.minimumPayoutAmount}
                      onChange={(e) => updateSetting('minimumPayoutAmount', parseFloat(e.target.value))}
                      className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all pl-8 font-mono text-lg"
                    />
                  </div>
                  <p className="text-sm text-muted mt-3 flex items-center">
                    <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Minimum amount before payouts are processed
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-card/30 backdrop-blur-md rounded-3xl p-8 border border-white/10 shadow-xl">
              <div className="border-b border-white/10 pb-6 mb-6">
                <h3 className="text-2xl font-bold text-text flex items-center">
                  <span className="bg-secondary/20 p-2 rounded-lg mr-3 text-secondary">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                  </span>
                  Payout Settings
                </h3>
                <p className="text-muted mt-2 ml-14">Configure automatic payout schedule</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-bg/40 rounded-2xl p-6 border border-white/5 hover:border-secondary/30 transition-colors">
                  <label className="block text-sm font-bold text-text mb-3 uppercase tracking-wider">
                    Payout Schedule
                  </label>
                  <select
                    value={settings.payoutSchedule}
                    onChange={(e) => updateSetting('payoutSchedule', e.target.value)}
                    className="w-full bg-bg/50 border border-white/10 rounded-xl px-4 py-3 text-text focus:outline-none focus:ring-2 focus:ring-secondary/50 focus:border-secondary transition-all appearance-none"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                  <p className="text-sm text-muted mt-3 flex items-center">
                    <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    How often automatic payouts are processed
                  </p>
                </div>

                <div className="bg-bg/40 rounded-2xl p-6 border border-white/5 hover:border-secondary/30 transition-colors flex flex-col justify-center">
                  <label className="flex items-center cursor-pointer group">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={settings.autoPayoutEnabled}
                        onChange={(e) => updateSetting('autoPayoutEnabled', e.target.checked)}
                        className="sr-only"
                      />
                      <div className={`block w-14 h-8 rounded-full transition-colors duration-300 ${settings.autoPayoutEnabled ? 'bg-secondary' : 'bg-white/10'}`}></div>
                      <div className={`absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform duration-300 ${settings.autoPayoutEnabled ? 'transform translate-x-6' : ''}`}></div>
                    </div>
                    <span className="ml-4 text-lg font-bold text-text group-hover:text-secondary transition-colors">
                      Enable Automatic Payouts
                    </span>
                  </label>
                  <p className="text-sm text-muted mt-3 ml-[4.5rem]">
                    Automatically process payouts on schedule
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center pt-4">
              <p className="text-sm text-muted bg-white/5 px-4 py-2 rounded-lg border border-white/5">
                Last updated: <span className="text-text font-mono">{new Date(settings.lastUpdated).toLocaleString()}</span>
              </p>
              <button
                onClick={saveSettings}
                disabled={isSaving}
                className="bg-gradient-to-r from-primary to-secondary hover:from-primary/80 hover:to-secondary/80 text-white font-bold px-8 py-4 rounded-xl transition-all shadow-lg hover:shadow-primary/50 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                {isSaving ? (
                  <span className="flex items-center space-x-2">
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Saving...</span>
                  </span>
                ) : (
                  'Save Settings'
                )}
              </button>
            </div>
          </div>
        )}

        {/* Earnings Overview Tab */}
        {selectedTab === 'earnings' && earningsOverview && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-card/30 backdrop-blur-md rounded-2xl p-6 border border-white/10 shadow-lg hover:shadow-green-500/20 transition-all group">
                <div className="flex items-center mb-4">
                  <div className="p-3 rounded-xl bg-green-500/20 text-green-400 group-hover:scale-110 transition-transform">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                    </svg>
                  </div>
                  <div className="ml-auto text-xs font-bold text-green-400 bg-green-500/10 px-2 py-1 rounded-lg border border-green-500/20">
                    REVENUE
                  </div>
                </div>
                <p className="text-3xl font-bold text-text mb-1">
                  {founderEarningsService.formatCurrency(earningsOverview.totalRevenue)}
                </p>
                <p className="text-sm text-muted">{earningsOverview.period}</p>
              </div>

              <div className="bg-card/30 backdrop-blur-md rounded-2xl p-6 border border-white/10 shadow-lg hover:shadow-blue-500/20 transition-all group">
                <div className="flex items-center mb-4">
                  <div className="p-3 rounded-xl bg-blue-500/20 text-blue-400 group-hover:scale-110 transition-transform">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="ml-auto text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-1 rounded-lg border border-blue-500/20">
                    FEES
                  </div>
                </div>
                <p className="text-3xl font-bold text-text mb-1">
                  {founderEarningsService.formatCurrency(earningsOverview.totalPlatformFees)}
                </p>
                <p className="text-sm text-muted">
                  {((earningsOverview.totalPlatformFees / earningsOverview.totalRevenue) * 100).toFixed(1)}% of revenue
                </p>
              </div>

              <div className="bg-card/30 backdrop-blur-md rounded-2xl p-6 border border-white/10 shadow-lg hover:shadow-purple-500/20 transition-all group">
                <div className="flex items-center mb-4">
                  <div className="p-3 rounded-xl bg-purple-500/20 text-purple-400 group-hover:scale-110 transition-transform">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <div className="ml-auto text-xs font-bold text-purple-400 bg-purple-500/10 px-2 py-1 rounded-lg border border-purple-500/20">
                    PAYOUTS
                  </div>
                </div>
                <p className="text-3xl font-bold text-text mb-1">
                  {founderEarningsService.formatCurrency(earningsOverview.totalVendorPayouts)}
                </p>
                <p className="text-sm text-muted">
                  {((earningsOverview.totalVendorPayouts / earningsOverview.totalRevenue) * 100).toFixed(1)}% of revenue
                </p>
              </div>

              <div className="bg-card/30 backdrop-blur-md rounded-2xl p-6 border border-white/10 shadow-lg hover:shadow-yellow-500/20 transition-all group">
                <div className="flex items-center mb-4">
                  <div className="p-3 rounded-xl bg-yellow-500/20 text-yellow-400 group-hover:scale-110 transition-transform">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                  </div>
                  <div className="ml-auto text-xs font-bold text-yellow-400 bg-yellow-500/10 px-2 py-1 rounded-lg border border-yellow-500/20">
                    EARNINGS
                  </div>
                </div>
                <p className="text-3xl font-bold text-text mb-1">
                  {founderEarningsService.formatCurrency(earningsOverview.totalFounderEarnings)}
                </p>
                <p className="text-sm text-muted">Internal products only</p>
              </div>
            </div>

            {/* Revenue Breakdown */}
            <div className="bg-card/30 backdrop-blur-md rounded-3xl p-8 border border-white/10 shadow-xl">
              <div className="border-b border-white/10 pb-6 mb-6">
                <h3 className="text-2xl font-bold text-text">Revenue Breakdown</h3>
              </div>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-6 bg-blue-500/10 rounded-2xl border border-blue-500/20 hover:bg-blue-500/20 transition-colors">
                  <div className="flex items-center">
                    <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center mr-4">
                      <span className="text-2xl">👥</span>
                    </div>
                    <div>
                      <p className="font-bold text-lg text-text">Vendor Sales</p>
                      <p className="text-sm text-muted">Third-party vendor products</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-xl text-text">
                      {founderEarningsService.formatCurrency(earningsOverview.breakdown.vendorSales)}
                    </p>
                    <p className="text-sm text-blue-400 font-bold">
                      {((earningsOverview.breakdown.vendorSales / earningsOverview.totalRevenue) * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-6 bg-green-500/10 rounded-2xl border border-green-500/20 hover:bg-green-500/20 transition-colors">
                  <div className="flex items-center">
                    <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mr-4">
                      <span className="text-2xl">🏠</span>
                    </div>
                    <div>
                      <p className="font-bold text-lg text-text">In-House Sales</p>
                      <p className="text-sm text-muted">Platform-owned products</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-xl text-text">
                      {founderEarningsService.formatCurrency(earningsOverview.breakdown.inHouseSales)}
                    </p>
                    <p className="text-sm text-green-400 font-bold">
                      {((earningsOverview.breakdown.inHouseSales / earningsOverview.totalRevenue) * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Pending Actions */}
            <div className="bg-card/30 backdrop-blur-md rounded-3xl p-8 border border-white/10 shadow-xl">
              <div className="border-b border-white/10 pb-6 mb-6">
                <h3 className="text-2xl font-bold text-text">Pending Actions</h3>
              </div>
              <div className="flex items-center justify-between p-6 bg-yellow-500/10 rounded-2xl border border-yellow-500/20">
                <div className="flex items-center">
                  <div className="w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center mr-4 animate-pulse">
                    <span className="text-2xl">⚠️</span>
                  </div>
                  <div>
                    <p className="font-bold text-lg text-text">Pending Payouts</p>
                    <p className="text-sm text-muted">
                      Vendor payouts awaiting processing
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-6">
                  <p className="font-mono font-bold text-2xl text-text">
                    {founderEarningsService.formatCurrency(earningsOverview.pendingPayouts)}
                  </p>
                  <button
                    onClick={processAllPendingPayouts}
                    className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold px-6 py-3 rounded-xl shadow-lg hover:shadow-yellow-500/50 transition-all transform hover:scale-105"
                  >
                    Process All
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Payout Management Tab */}
        {selectedTab === 'payouts' && (
          <div className="bg-card/30 backdrop-blur-md rounded-3xl p-10 border border-white/10 shadow-xl text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-4xl">🚧</span>
            </div>
            <h3 className="text-2xl font-bold text-text mb-4">Payout Management</h3>
            <p className="text-muted max-w-md mx-auto mb-8">
              Advanced payout management features are currently under development.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto text-left">
              {[
                'View all pending vendor payouts',
                'Process individual or bulk payouts',
                'Payout history and status tracking',
                'Failed payout resolution',
                'Payout schedule management'
              ].map((item, i) => (
                <div key={i} className="flex items-center p-4 bg-white/5 rounded-xl border border-white/5">
                  <div className="w-2 h-2 rounded-full bg-primary mr-3"></div>
                  <span className="text-muted">{item}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Analytics Tab */}
        {selectedTab === 'analytics' && (
          <div className="bg-card/30 backdrop-blur-md rounded-3xl p-10 border border-white/10 shadow-xl text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="text-4xl">📈</span>
            </div>
            <h3 className="text-2xl font-bold text-text mb-4">Platform Analytics</h3>
            <p className="text-muted max-w-md mx-auto mb-8">
              Comprehensive analytics dashboard is coming soon.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto text-left">
              {[
                'Revenue trends and forecasting',
                'Fee optimization analysis',
                'Vendor performance metrics',
                'Product category insights',
                'Customer behavior analytics',
                'Financial reporting and exports'
              ].map((item, i) => (
                <div key={i} className="flex items-center p-4 bg-white/5 rounded-xl border border-white/5">
                  <div className="w-2 h-2 rounded-full bg-secondary mr-3"></div>
                  <span className="text-muted">{item}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminControlPanel

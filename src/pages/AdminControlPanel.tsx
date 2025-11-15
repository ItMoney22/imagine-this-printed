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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Access denied. Admin access required.</p>
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
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-text">Admin Control Panel</h1>
        <p className="text-muted">Manage platform settings, payouts, and earnings</p>
      </div>

      {/* Tabs */}
      <div className="border-b card-border mb-6">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'settings', label: 'Platform Settings', icon: '⚙️' },
            { id: 'earnings', label: 'Earnings Overview', icon: '💰' },
            { id: 'payouts', label: 'Payout Management', icon: '💳' },
            { id: 'analytics', label: 'Analytics', icon: '📊' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${
                selectedTab === tab.id
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-muted hover:text-text hover:card-border'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Platform Settings Tab */}
      {selectedTab === 'settings' && settings && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg shadow">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">Fee Structure</h3>
              <p className="text-sm text-muted">Configure platform and processing fees</p>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-text mb-2">
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
                      className="form-input pr-8"
                    />
                    <span className="absolute right-3 top-2 text-muted">
                      ({(settings.platformFeePercentage * 100).toFixed(1)}%)
                    </span>
                  </div>
                  <p className="text-sm text-muted mt-1">
                    Fee charged to vendors on each sale
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text mb-2">
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
                      className="form-input pr-8"
                    />
                    <span className="absolute right-3 top-2 text-muted">
                      ({(settings.stripeFeePercentage * 100).toFixed(1)}%)
                    </span>
                  </div>
                  <p className="text-sm text-muted mt-1">
                    Payment processing fee
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text mb-2">
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
                      className="form-input pr-8"
                    />
                    <span className="absolute right-3 top-2 text-muted">
                      ({(settings.founderEarningsPercentage * 100).toFixed(0)}%)
                    </span>
                  </div>
                  <p className="text-sm text-muted mt-1">
                    Founder's share of profit from internal products
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    Minimum Payout Amount
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-muted">$</span>
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      step="0.01"
                      value={settings.minimumPayoutAmount}
                      onChange={(e) => updateSetting('minimumPayoutAmount', parseFloat(e.target.value))}
                      className="form-input pl-8"
                    />
                  </div>
                  <p className="text-sm text-muted mt-1">
                    Minimum amount before payouts are processed
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-lg shadow">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">Payout Settings</h3>
              <p className="text-sm text-muted">Configure automatic payout schedule</p>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    Payout Schedule
                  </label>
                  <select
                    value={settings.payoutSchedule}
                    onChange={(e) => updateSetting('payoutSchedule', e.target.value)}
                    className="form-select"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                  <p className="text-sm text-muted mt-1">
                    How often automatic payouts are processed
                  </p>
                </div>

                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={settings.autoPayoutEnabled}
                      onChange={(e) => updateSetting('autoPayoutEnabled', e.target.checked)}
                      className="form-checkbox"
                    />
                    <span className="ml-2 text-sm font-medium text-text">
                      Enable Automatic Payouts
                    </span>
                  </label>
                  <p className="text-sm text-muted mt-1">
                    Automatically process payouts on schedule
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <p className="text-sm text-muted">
              Last updated: {new Date(settings.lastUpdated).toLocaleString()}
            </p>
            <button
              onClick={saveSettings}
              disabled={isSaving}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}

      {/* Earnings Overview Tab */}
      {selectedTab === 'earnings' && earningsOverview && (
        <div className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-card rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted">Total Revenue</p>
                  <p className="text-2xl font-semibold text-text">
                    {founderEarningsService.formatCurrency(earningsOverview.totalRevenue)}
                  </p>
                  <p className="text-sm text-muted">{earningsOverview.period}</p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted">Platform Fees</p>
                  <p className="text-2xl font-semibold text-text">
                    {founderEarningsService.formatCurrency(earningsOverview.totalPlatformFees)}
                  </p>
                  <p className="text-sm text-muted">
                    {((earningsOverview.totalPlatformFees / earningsOverview.totalRevenue) * 100).toFixed(1)}% of revenue
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted">Vendor Payouts</p>
                  <p className="text-2xl font-semibold text-text">
                    {founderEarningsService.formatCurrency(earningsOverview.totalVendorPayouts)}
                  </p>
                  <p className="text-sm text-muted">
                    {((earningsOverview.totalVendorPayouts / earningsOverview.totalRevenue) * 100).toFixed(1)}% of revenue
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted">Founder Earnings</p>
                  <p className="text-2xl font-semibold text-text">
                    {founderEarningsService.formatCurrency(earningsOverview.totalFounderEarnings)}
                  </p>
                  <p className="text-sm text-muted">Internal products only</p>
                </div>
              </div>
            </div>
          </div>

          {/* Revenue Breakdown */}
          <div className="bg-card rounded-lg shadow">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">Revenue Breakdown</h3>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg">
                  <div>
                    <p className="font-medium text-text">Vendor Sales</p>
                    <p className="text-sm text-muted">Third-party vendor products</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-text">
                      {founderEarningsService.formatCurrency(earningsOverview.breakdown.vendorSales)}
                    </p>
                    <p className="text-sm text-muted">
                      {((earningsOverview.breakdown.vendorSales / earningsOverview.totalRevenue) * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg">
                  <div>
                    <p className="font-medium text-text">In-House Sales</p>
                    <p className="text-sm text-muted">Platform-owned products</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-text">
                      {founderEarningsService.formatCurrency(earningsOverview.breakdown.inHouseSales)}
                    </p>
                    <p className="text-sm text-muted">
                      {((earningsOverview.breakdown.inHouseSales / earningsOverview.totalRevenue) * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Pending Actions */}
          <div className="bg-card rounded-lg shadow">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">Pending Actions</h3>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between p-4 bg-yellow-50 rounded-lg">
                <div>
                  <p className="font-medium text-text">Pending Payouts</p>
                  <p className="text-sm text-muted">
                    Vendor payouts awaiting processing
                  </p>
                </div>
                <div className="flex items-center space-x-4">
                  <p className="font-medium text-text">
                    {founderEarningsService.formatCurrency(earningsOverview.pendingPayouts)}
                  </p>
                  <button
                    onClick={processAllPendingPayouts}
                    className="btn-primary text-sm"
                  >
                    Process All
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payout Management Tab */}
      {selectedTab === 'payouts' && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-text mb-4">Payout Management</h3>
            <p className="text-muted">
              Payout management features will be implemented here, including:
            </p>
            <ul className="mt-4 space-y-2 text-muted">
              <li>• View all pending vendor payouts</li>
              <li>• Process individual or bulk payouts</li>
              <li>• Payout history and status tracking</li>
              <li>• Failed payout resolution</li>
              <li>• Payout schedule management</li>
            </ul>
          </div>
        </div>
      )}

      {/* Analytics Tab */}
      {selectedTab === 'analytics' && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-text mb-4">Platform Analytics</h3>
            <p className="text-muted">
              Comprehensive analytics dashboard will be implemented here, including:
            </p>
            <ul className="mt-4 space-y-2 text-muted">
              <li>• Revenue trends and forecasting</li>
              <li>• Fee optimization analysis</li>
              <li>• Vendor performance metrics</li>
              <li>• Product category insights</li>
              <li>• Customer behavior analytics</li>
              <li>• Financial reporting and exports</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminControlPanel

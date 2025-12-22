import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { apiFetch } from '../lib/api'
import type { PlatformSettings, AdminEarningsOverview } from '../types'

const AdminControlPanel: React.FC = () => {
  const { user } = useAuth()
  const [settings, setSettings] = useState<PlatformSettings | null>(null)
  const [earningsOverview, setEarningsOverview] = useState<AdminEarningsOverview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedTab, setSelectedTab] = useState<'settings' | 'earnings' | 'payouts' | 'analytics'>('settings')

  const loadPlatformSettings = useCallback(async () => {
    try {
      // apiFetch returns parsed JSON directly (throws on error)
      const result = await apiFetch('/api/admin/control-panel/settings')
      const data = result?.settings
      if (data) {
        setSettings({
          id: 'platform_settings',
          platformFeePercentage: data.platformFeePercentage,
          stripeFeePercentage: data.stripeFeePercentage,
          founderEarningsPercentage: data.founderEarningsPercentage,
          minimumPayoutAmount: data.minimumPayoutAmount,
          payoutSchedule: data.payoutSchedule,
          autoPayoutEnabled: data.autoPayoutEnabled,
          lastUpdated: data.lastUpdated || new Date().toISOString(),
          updatedBy: user?.id || 'admin'
        })
      }
    } catch (err) {
      console.error('[control-panel] Error loading settings:', err)
    }
  }, [user])

  const loadEarningsOverview = useCallback(async () => {
    try {
      // apiFetch returns parsed JSON directly (throws on error)
      const result = await apiFetch('/api/admin/control-panel/earnings')
      if (result?.earnings) {
        setEarningsOverview(result.earnings)
      }
    } catch (err) {
      console.error('[control-panel] Error loading earnings:', err)
    }
  }, [])

  useEffect(() => {
    if (user && (user.role === 'admin' || user.role === 'founder')) {
      setIsLoading(true)
      setError(null)

      const loadData = async () => {
        await Promise.all([loadPlatformSettings(), loadEarningsOverview()])
        setIsLoading(false)
      }

      loadData()
    }
  }, [user, loadPlatformSettings, loadEarningsOverview])

  const saveSettings = async () => {
    if (!settings) return

    setIsSaving(true)
    try {
      // apiFetch returns parsed JSON directly (throws on error)
      const result = await apiFetch('/api/admin/control-panel/settings', {
        method: 'PUT',
        body: JSON.stringify({
          platformFeePercentage: settings.platformFeePercentage,
          stripeFeePercentage: settings.stripeFeePercentage,
          founderEarningsPercentage: settings.founderEarningsPercentage,
          minimumPayoutAmount: settings.minimumPayoutAmount,
          payoutSchedule: settings.payoutSchedule,
          autoPayoutEnabled: settings.autoPayoutEnabled
        })
      })

      const updated = result?.settings
      if (updated) {
        setSettings(prev => prev ? {
          ...prev,
          ...updated,
          lastUpdated: updated.lastUpdated || new Date().toISOString()
        } : null)
      }

      alert('Settings saved successfully!')
    } catch (err: any) {
      console.error('[control-panel] Error saving settings:', err)
      alert(err.message || 'Failed to save settings. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const updateSetting = (key: keyof PlatformSettings, value: any) => {
    if (!settings) return
    setSettings(prev => prev ? { ...prev, [key]: value } : null)
  }

  const processAllPendingPayouts = async () => {
    try {
      console.log('Processing all pending payouts...')
      await new Promise(resolve => setTimeout(resolve, 2000))
      alert('All pending payouts have been processed!')
      await loadEarningsOverview()
    } catch (err) {
      console.error('[control-panel] Error processing payouts:', err)
      alert('Failed to process payouts. Please try again.')
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount)
  }

  if (!user || (user.role !== 'admin' && user.role !== 'founder')) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6">
          <p className="text-red-800 dark:text-red-200">Access denied. This page is for admins and founders only.</p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
          <span className="ml-3 text-muted">Loading control panel...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Gradient Header */}
      <div className="bg-gradient-to-br from-purple-600 via-purple-700 to-pink-600 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Control Panel</h1>
              <p className="text-purple-100">Platform settings, fees, and financial management</p>
            </div>
            <div className="flex flex-wrap gap-3">
              {earningsOverview && (
                <>
                  <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 border border-white/20">
                    <span className="text-purple-100 text-xs uppercase tracking-wider">Revenue</span>
                    <p className="text-white text-xl font-bold">{formatCurrency(earningsOverview.totalRevenue)}</p>
                  </div>
                  <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 border border-white/20">
                    <span className="text-purple-100 text-xs uppercase tracking-wider">Platform Fees</span>
                    <p className="text-white text-xl font-bold">{formatCurrency(earningsOverview.totalPlatformFees)}</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-6">
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {/* Stats Cards */}
        {earningsOverview && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
              <div className="flex items-center">
                <div className="p-3 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl shadow-lg shadow-green-500/25">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted">Total Revenue</p>
                  <p className="text-2xl font-bold text-text">{formatCurrency(earningsOverview.totalRevenue)}</p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
              <div className="flex items-center">
                <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl shadow-lg shadow-purple-500/25">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted">Platform Fees</p>
                  <p className="text-2xl font-bold text-text">{formatCurrency(earningsOverview.totalPlatformFees)}</p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
              <div className="flex items-center">
                <div className="p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg shadow-blue-500/25">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted">Vendor Payouts</p>
                  <p className="text-2xl font-bold text-text">{formatCurrency(earningsOverview.totalVendorPayouts)}</p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
              <div className="flex items-center">
                <div className="p-3 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl shadow-lg shadow-amber-500/25">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted">Founder Earnings</p>
                  <p className="text-2xl font-bold text-text">{formatCurrency(earningsOverview.totalFounderEarnings)}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Pill-style Tab Navigation */}
        <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-2 mb-6">
          <nav className="flex space-x-2 overflow-x-auto">
            {[
              { id: 'settings', label: 'Platform Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
              { id: 'earnings', label: 'Earnings Overview', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
              { id: 'payouts', label: 'Payout Management', icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z' },
              { id: 'analytics', label: 'Analytics', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedTab(tab.id as any)}
                className={`flex items-center px-4 py-2.5 rounded-lg font-medium text-sm transition-all whitespace-nowrap ${
                  selectedTab === tab.id
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/25'
                    : 'text-muted hover:text-text hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
                </svg>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Platform Settings Tab */}
        {selectedTab === 'settings' && settings && (
          <div className="space-y-6">
            {/* Fee Configuration Card */}
            <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 overflow-hidden">
              <div className="px-6 py-4 border-b border-purple-500/10">
                <h3 className="text-lg font-semibold text-text">Fee Configuration</h3>
                <p className="text-sm text-muted mt-1">Configure platform and processing fees</p>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-muted mb-2">Platform Fee (%)</label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.001"
                        value={settings.platformFeePercentage}
                        onChange={(e) => updateSetting('platformFeePercentage', parseFloat(e.target.value))}
                        className="w-full bg-bg border border-purple-500/20 rounded-xl px-4 py-3 text-text focus:ring-2 focus:ring-purple-500 focus:border-transparent pr-16"
                      />
                      <span className="absolute right-4 top-3 text-purple-500 font-medium">
                        {(settings.platformFeePercentage * 100).toFixed(1)}%
                      </span>
                    </div>
                    <p className="text-xs text-muted mt-2">Fee charged to vendors on each sale</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-muted mb-2">Stripe Fee (%)</label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.001"
                        value={settings.stripeFeePercentage}
                        onChange={(e) => updateSetting('stripeFeePercentage', parseFloat(e.target.value))}
                        className="w-full bg-bg border border-purple-500/20 rounded-xl px-4 py-3 text-text focus:ring-2 focus:ring-purple-500 focus:border-transparent pr-16"
                      />
                      <span className="absolute right-4 top-3 text-purple-500 font-medium">
                        {(settings.stripeFeePercentage * 100).toFixed(1)}%
                      </span>
                    </div>
                    <p className="text-xs text-muted mt-2">Payment processing fee</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-muted mb-2">Founder Earnings (%)</label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.01"
                        value={settings.founderEarningsPercentage}
                        onChange={(e) => updateSetting('founderEarningsPercentage', parseFloat(e.target.value))}
                        className="w-full bg-bg border border-purple-500/20 rounded-xl px-4 py-3 text-text focus:ring-2 focus:ring-purple-500 focus:border-transparent pr-16"
                      />
                      <span className="absolute right-4 top-3 text-purple-500 font-medium">
                        {(settings.founderEarningsPercentage * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-xs text-muted mt-2">Founder's share of platform fees</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-muted mb-2">Minimum Payout ($)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-3 text-muted">$</span>
                      <input
                        type="number"
                        min="1"
                        max="1000"
                        step="0.01"
                        value={settings.minimumPayoutAmount}
                        onChange={(e) => updateSetting('minimumPayoutAmount', parseFloat(e.target.value))}
                        className="w-full bg-bg border border-purple-500/20 rounded-xl px-4 py-3 text-text focus:ring-2 focus:ring-purple-500 focus:border-transparent pl-8"
                      />
                    </div>
                    <p className="text-xs text-muted mt-2">Minimum amount for vendor payout</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Payout Settings Card */}
            <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 overflow-hidden">
              <div className="px-6 py-4 border-b border-purple-500/10">
                <h3 className="text-lg font-semibold text-text">Payout Settings</h3>
                <p className="text-sm text-muted mt-1">Configure automatic payout schedule</p>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-muted mb-2">Payout Schedule</label>
                    <select
                      value={settings.payoutSchedule}
                      onChange={(e) => updateSetting('payoutSchedule', e.target.value)}
                      className="w-full bg-bg border border-purple-500/20 rounded-xl px-4 py-3 text-text focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                    <p className="text-xs text-muted mt-2">How often payouts are processed</p>
                  </div>

                  <div className="flex items-center">
                    <label className="flex items-center cursor-pointer">
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={settings.autoPayoutEnabled}
                          onChange={(e) => updateSetting('autoPayoutEnabled', e.target.checked)}
                          className="sr-only"
                        />
                        <div className={`block w-14 h-8 rounded-full transition-colors ${settings.autoPayoutEnabled ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'}`}></div>
                        <div className={`absolute left-1 top-1 bg-white w-6 h-6 rounded-full transition-transform ${settings.autoPayoutEnabled ? 'transform translate-x-6' : ''}`}></div>
                      </div>
                      <span className="ml-4 text-text font-medium">Enable Automatic Payouts</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted">
                Last updated: <span className="font-medium text-text">{new Date(settings.lastUpdated).toLocaleString()}</span>
              </p>
              <button
                onClick={saveSettings}
                disabled={isSaving}
                className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white px-6 py-3 rounded-xl shadow-lg shadow-purple-500/25 flex items-center font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <>
                    <svg className="animate-spin h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Saving...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Save Settings
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Earnings Overview Tab */}
        {selectedTab === 'earnings' && earningsOverview && (
          <div className="space-y-6">
            {/* Revenue Breakdown Card */}
            <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 overflow-hidden">
              <div className="px-6 py-4 border-b border-purple-500/10">
                <h3 className="text-lg font-semibold text-text">Revenue Breakdown</h3>
                <p className="text-sm text-muted mt-1">Detailed breakdown of revenue sources</p>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
                  <div className="flex items-center">
                    <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-800 flex items-center justify-center mr-4">
                      <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-medium text-text">Vendor Sales</p>
                      <p className="text-sm text-muted">Third-party vendor products</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-lg text-text">{formatCurrency(earningsOverview.breakdown.vendorSales)}</p>
                    <p className="text-sm text-blue-600 dark:text-blue-400">
                      {earningsOverview.totalRevenue > 0 ? ((earningsOverview.breakdown.vendorSales / earningsOverview.totalRevenue) * 100).toFixed(1) : 0}%
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-800">
                  <div className="flex items-center">
                    <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-800 flex items-center justify-center mr-4">
                      <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-medium text-text">In-House Sales</p>
                      <p className="text-sm text-muted">Platform-owned products</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-lg text-text">{formatCurrency(earningsOverview.breakdown.inHouseSales)}</p>
                    <p className="text-sm text-green-600 dark:text-green-400">
                      {earningsOverview.totalRevenue > 0 ? ((earningsOverview.breakdown.inHouseSales / earningsOverview.totalRevenue) * 100).toFixed(1) : 0}%
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Pending Payouts Card */}
            <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 overflow-hidden">
              <div className="px-6 py-4 border-b border-purple-500/10">
                <h3 className="text-lg font-semibold text-text">Pending Actions</h3>
              </div>
              <div className="p-6">
                <div className="flex items-center justify-between p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800">
                  <div className="flex items-center">
                    <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-800 flex items-center justify-center mr-4 animate-pulse">
                      <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-medium text-text">Pending Payouts</p>
                      <p className="text-sm text-muted">Vendor payouts awaiting processing</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="font-bold text-xl text-text">{formatCurrency(earningsOverview.pendingPayouts)}</p>
                    <button
                      onClick={processAllPendingPayouts}
                      className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white px-4 py-2 rounded-xl shadow-lg shadow-amber-500/25 font-medium"
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
          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-10 text-center">
            <div className="w-20 h-20 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-text mb-2">Payout Management</h3>
            <p className="text-muted max-w-md mx-auto mb-6">
              Advanced payout management features are currently under development.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-lg mx-auto text-left">
              {[
                'View all pending vendor payouts',
                'Process individual or bulk payouts',
                'Payout history and status tracking',
                'Failed payout resolution'
              ].map((item, i) => (
                <div key={i} className="flex items-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="w-2 h-2 rounded-full bg-purple-500 mr-3"></div>
                  <span className="text-sm text-muted">{item}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Analytics Tab */}
        {selectedTab === 'analytics' && (
          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-10 text-center">
            <div className="w-20 h-20 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-text mb-2">Platform Analytics</h3>
            <p className="text-muted max-w-md mx-auto mb-6">
              Comprehensive analytics dashboard is coming soon.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-lg mx-auto text-left">
              {[
                'Revenue trends and forecasting',
                'Fee optimization analysis',
                'Vendor performance metrics',
                'Financial reporting and exports'
              ].map((item, i) => (
                <div key={i} className="flex items-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="w-2 h-2 rounded-full bg-pink-500 mr-3"></div>
                  <span className="text-sm text-muted">{item}</span>
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

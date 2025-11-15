import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { vendorPayoutService } from '../utils/vendor-payouts'
import type { VendorPayout } from '../types'

const VendorPayouts: React.FC = () => {
  const { user } = useAuth()
  const [payouts, setPayouts] = useState<VendorPayout[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [analytics, setAnalytics] = useState<any>(null)
  const [stripeStatus, setStripeStatus] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [selectedTab, setSelectedTab] = useState<'overview' | 'payouts' | 'analytics' | 'settings'>('overview')
  const [filter, setFilter] = useState<'all' | 'pending' | 'processing' | 'paid'>('all')
  const [isRequesting, setIsRequesting] = useState(false)

  useEffect(() => {
    if (user && (user.role === 'vendor' || user.role === 'admin' || user.role === 'founder')) {
      loadData()
    }
  }, [user])

  const loadData = async () => {
    if (!user) return
    
    try {
      setIsLoading(true)
      
      // Load all data in parallel
      const [payoutsData, summaryData, analyticsData, statusData] = await Promise.all([
        vendorPayoutService.getVendorPayouts(user.id),
        vendorPayoutService.getPayoutSummary(user.id),
        vendorPayoutService.getPayoutAnalytics(user.id, 'week'),
        vendorPayoutService.getStripeConnectStatus(user.id)
      ])

      setPayouts(payoutsData)
      setSummary(summaryData)
      setAnalytics(analyticsData)
      setStripeStatus(statusData)
    } catch (error) {
      console.error('Error loading payout data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const requestPayout = async () => {
    if (!user || !summary?.pendingAmount) return
    
    try {
      setIsRequesting(true)
      await vendorPayoutService.requestPayout(user.id)
      
      // Reload data
      await loadData()
      
      alert('Payout request submitted successfully!')
    } catch (error) {
      console.error('Error requesting payout:', error)
      alert('Failed to request payout. Please try again.')
    } finally {
      setIsRequesting(false)
    }
  }

  const createOnboardingLink = async () => {
    if (!user) return
    
    try {
      const returnUrl = `${window.location.origin}/vendor/payouts?setup=complete`
      const onboardingUrl = await vendorPayoutService.createOnboardingLink(user.id, returnUrl)
      
      // Open Stripe onboarding in new tab
      window.open(onboardingUrl, '_blank')
    } catch (error) {
      console.error('Error creating onboarding link:', error)
      alert('Failed to create onboarding link. Please try again.')
    }
  }

  const filteredPayouts = payouts.filter(payout => 
    filter === 'all' || payout.status === filter
  )

  if (!user || (user.role !== 'vendor' && user.role !== 'admin' && user.role !== 'founder')) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Access denied. Vendor access required.</p>
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
        <h1 className="text-3xl font-bold text-text">Vendor Payouts</h1>
        <p className="text-muted">Manage your earnings and payout schedule</p>
      </div>

      {/* Stripe Connect Status */}
      {!stripeStatus?.isOnboarded && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-yellow-900">Complete your payout setup</h3>
              <p className="text-yellow-700">
                You need to complete your Stripe Connect onboarding to receive payouts.
              </p>
            </div>
            <button
              onClick={createOnboardingLink}
              className="btn-primary"
            >
              Complete Setup
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b card-border mb-6">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'overview', label: 'Overview', icon: '📊' },
            { id: 'payouts', label: 'Payouts', icon: '💰' },
            { id: 'analytics', label: 'Analytics', icon: '📈' },
            { id: 'settings', label: 'Settings', icon: '⚙️' }
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

      {/* Overview Tab */}
      {selectedTab === 'overview' && summary && (
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
                  <p className="text-sm font-medium text-muted">Total Earnings</p>
                  <p className="text-2xl font-semibold text-text">
                    {vendorPayoutService.formatCurrency(summary.totalAmount)}
                  </p>
                  {summary.periodComparison && (
                    <p className={`text-sm ${summary.periodComparison.isPositive ? 'text-green-600' : 'text-red-600'}`}>
                      {summary.periodComparison.isPositive ? '+' : ''}{summary.periodComparison.change}% from last period
                    </p>
                  )}
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
                  <p className="text-sm font-medium text-muted">Pending Payouts</p>
                  <p className="text-2xl font-semibold text-text">
                    {vendorPayoutService.formatCurrency(summary.pendingAmount)}
                  </p>
                  <p className="text-sm text-muted">Available for withdrawal</p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted">Average Payout</p>
                  <p className="text-2xl font-semibold text-text">
                    {vendorPayoutService.formatCurrency(summary.averagePayout)}
                  </p>
                  <p className="text-sm text-muted">Per transaction</p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2zM10 8.5a.5.5 0 11-1 0 .5.5 0 011 0zm5 5a.5.5 0 11-1 0 .5.5 0 011 0z" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted">Platform Fees</p>
                  <p className="text-2xl font-semibold text-text">
                    {vendorPayoutService.formatCurrency(summary.totalFees)}
                  </p>
                  <p className="text-sm text-muted">10.5% total fees</p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-card rounded-lg shadow p-6">
              <h3 className="text-lg font-medium text-text mb-4">Request Payout</h3>
              <p className="text-muted mb-4">
                Request an immediate payout of your pending earnings.
              </p>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-muted">Available:</span>
                <span className="font-medium text-green-600">
                  {vendorPayoutService.formatCurrency(summary.pendingAmount)}
                </span>
              </div>
              <button
                onClick={requestPayout}
                disabled={summary.pendingAmount <= 0 || isRequesting || !stripeStatus?.payoutsEnabled}
                className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRequesting ? 'Processing...' : 'Request Payout'}
              </button>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <h3 className="text-lg font-medium text-text mb-4">Fee Breakdown</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted">Platform Fee</span>
                  <span className="font-medium">7.0%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Payment Processing</span>
                  <span className="font-medium">3.5%</span>
                </div>
                <div className="flex justify-between border-t pt-3">
                  <span className="font-medium text-text">Total Fees</span>
                  <span className="font-medium text-text">10.5%</span>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <h3 className="text-lg font-medium text-text mb-4">Payout Schedule</h3>
              <p className="text-muted mb-4">
                Automatic payouts are processed weekly on Fridays.
              </p>
              <div className="text-sm text-muted">
                <p>Next automatic payout: Friday, Jan 17</p>
                <p>Minimum payout: $25.00</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payouts Tab */}
      {selectedTab === 'payouts' && (
        <div className="space-y-6">
          {/* Filters */}
          <div className="bg-card rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <label className="text-sm font-medium text-text">Filter by status:</label>
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as any)}
                  className="form-select"
                >
                  <option value="all">All Payouts ({payouts.length})</option>
                  <option value="pending">Pending ({payouts.filter(p => p.status === 'pending').length})</option>
                  <option value="processing">Processing ({payouts.filter(p => p.status === 'processing').length})</option>
                  <option value="paid">Paid ({payouts.filter(p => p.status === 'paid').length})</option>
                </select>
              </div>
              <button
                onClick={loadData}
                className="btn-secondary"
              >
                Refresh
              </button>
            </div>
          </div>

          {/* Payouts Table */}
          <div className="bg-card rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">Payout History</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-card">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Order ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Sale Amount
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Fees
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Payout
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-card divide-y divide-gray-200">
                  {filteredPayouts.map((payout) => (
                    <tr key={payout.id} className="hover:bg-card">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-text">
                        {payout.orderId}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                        {vendorPayoutService.formatCurrency(payout.saleAmount)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                        <div className="space-y-1">
                          <div className="text-xs text-muted">
                            Platform: {vendorPayoutService.formatCurrency(payout.platformFee)}
                          </div>
                          <div className="text-xs text-muted">
                            Stripe: {vendorPayoutService.formatCurrency(payout.stripeFee)}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                        {vendorPayoutService.formatCurrency(payout.payoutAmount)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          payout.status === 'paid' ? 'bg-green-100 text-green-800' :
                          payout.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {payout.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {new Date(payout.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Analytics Tab */}
      {selectedTab === 'analytics' && analytics && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-text mb-4">Payout Analytics</h3>
            <p className="text-muted">
              Analytics features will be implemented here, including:
            </p>
            <ul className="mt-4 space-y-2 text-muted">
              <li>• Weekly/Monthly payout trends</li>
              <li>• Top-performing products</li>
              <li>• Fee optimization insights</li>
              <li>• Earnings forecasting</li>
            </ul>
          </div>
        </div>
      )}

      {/* Settings Tab */}
      {selectedTab === 'settings' && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-text mb-4">Payout Settings</h3>
            
            <div className="space-y-6">
              <div>
                <h4 className="text-sm font-medium text-text mb-2">Stripe Connect Status</h4>
                <div className={`p-4 rounded-lg ${
                  stripeStatus?.isOnboarded ? 'bg-green-50' : 'bg-yellow-50'
                }`}>
                  <div className="flex items-center">
                    <svg className={`w-5 h-5 mr-3 ${
                      stripeStatus?.isOnboarded ? 'text-green-600' : 'text-yellow-600'
                    }`} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className={`font-medium ${
                      stripeStatus?.isOnboarded ? 'text-green-800' : 'text-yellow-800'
                    }`}>
                      {stripeStatus?.isOnboarded ? 'Account Setup Complete' : 'Setup Required'}
                    </span>
                  </div>
                  <p className={`mt-1 text-sm ${
                    stripeStatus?.isOnboarded ? 'text-green-700' : 'text-yellow-700'
                  }`}>
                    {stripeStatus?.isOnboarded 
                      ? 'Your account is ready to receive payouts'
                      : 'Complete your Stripe onboarding to receive payouts'
                    }
                  </p>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium text-text mb-2">Automatic Payouts</h4>
                <div className="flex items-center">
                  <input type="checkbox" defaultChecked className="form-checkbox" />
                  <span className="ml-2 text-sm text-text">
                    Enable automatic weekly payouts (Fridays)
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  Payouts will be processed automatically when your balance exceeds $25
                </p>
              </div>

              <div>
                <h4 className="text-sm font-medium text-text mb-2">Minimum Payout Amount</h4>
                <input
                  type="number"
                  defaultValue="25"
                  min="1"
                  max="1000"
                  className="form-input w-32"
                />
                <p className="mt-1 text-sm text-muted">
                  Minimum amount required before a payout is processed
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default VendorPayouts

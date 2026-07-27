import React, { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import {
  vendorPayoutService,
  type PayoutSummary,
  type PayoutAnalytics,
  type StripeConnectAccount
} from '../utils/vendor-payouts'
import type { VendorPayout } from '../types'

// The payout API is gated by backend/middleware/requireVendorOrAdmin.ts, so the
// page gate has to match it exactly — otherwise the page renders and every
// request behind it 403s.
const ALLOWED_ROLES = ['vendor', 'admin', 'manager']

type PayoutTab = 'overview' | 'payouts' | 'analytics' | 'settings'

const TABS: Array<{ id: PayoutTab; label: string; icon: string }> = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'payouts', label: 'Payouts', icon: '💰' },
  { id: 'analytics', label: 'Analytics', icon: '📈' },
  { id: 'settings', label: 'Settings', icon: '⚙️' }
]
type StatusFilter = 'all' | 'pending' | 'processing' | 'paid' | 'failed'
type AnalyticsPeriod = 'week' | 'month' | 'year'

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

const VendorPayouts: React.FC = () => {
  const { user } = useAuth()
  const [payouts, setPayouts] = useState<VendorPayout[]>([])
  const [summary, setSummary] = useState<PayoutSummary | null>(null)
  const [analytics, setAnalytics] = useState<PayoutAnalytics | null>(null)
  const [stripeStatus, setStripeStatus] = useState<StripeConnectAccount | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedTab, setSelectedTab] = useState<PayoutTab>('overview')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [isRequesting, setIsRequesting] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [payoutMessage, setPayoutMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>('week')

  const hasAccess = !!user && ALLOWED_ROLES.includes(user.role)

  useEffect(() => {
    if (hasAccess) loadData()
    else setIsLoading(false)
  }, [hasAccess])

  const loadData = async () => {
    if (!hasAccess) return

    try {
      setIsLoading(true)
      setLoadError(null)

      // Summary first: it carries the live fee/minimum config the rest of the
      // page formats against.
      const [summaryData, payoutsData, analyticsData, statusData] = await Promise.all([
        vendorPayoutService.getPayoutSummary(),
        vendorPayoutService.getVendorPayouts(),
        vendorPayoutService.getPayoutAnalytics(analyticsPeriod),
        vendorPayoutService.getStripeConnectStatus()
      ])

      setSummary(summaryData)
      setPayouts(payoutsData)
      setAnalytics(analyticsData)
      setStripeStatus(statusData)
    } catch (error) {
      console.error('Error loading payout data:', error)
      setLoadError(errorMessage(error, 'Failed to load payout data'))
    } finally {
      setIsLoading(false)
    }
  }

  // Reload analytics when the period changes (without re-fetching everything).
  useEffect(() => {
    if (!hasAccess || isLoading) return
    vendorPayoutService
      .getPayoutAnalytics(analyticsPeriod)
      .then(setAnalytics)
      .catch((error) => console.error('Error loading payout analytics:', error))
  }, [analyticsPeriod])

  const requestPayout = async () => {
    if (!summary || summary.availableAmount <= 0) return

    try {
      setIsRequesting(true)
      setPayoutMessage(null)

      const result = await vendorPayoutService.requestPayout()

      await loadData()
      setPayoutMessage({
        type: result.warning ? 'error' : 'success',
        text: result.warning
          ? result.warning
          : `${vendorPayoutService.formatCurrency(result.amount)} sent to your Stripe account` +
            (result.payoutCount ? ` (${result.payoutCount} sale${result.payoutCount === 1 ? '' : 's'}).` : '.')
      })
    } catch (error) {
      console.error('Error requesting payout:', error)
      setPayoutMessage({ type: 'error', text: errorMessage(error, 'Failed to request payout.') })
    } finally {
      setIsRequesting(false)
    }
  }

  const startOnboarding = async () => {
    try {
      setIsConnecting(true)
      setPayoutMessage(null)

      const returnUrl = `${window.location.origin}/vendor/payouts?setup=complete`
      const refreshUrl = `${window.location.origin}/vendor/payouts?setup=refresh`
      const onboardingUrl = await vendorPayoutService.createOnboardingLink(returnUrl, refreshUrl)

      // Stripe-hosted onboarding must be a top-level navigation — a popup gets
      // blocked and breaks the return redirect.
      window.location.href = onboardingUrl
    } catch (error) {
      console.error('Error creating onboarding link:', error)
      setPayoutMessage({ type: 'error', text: errorMessage(error, 'Failed to start Stripe onboarding.') })
      setIsConnecting(false)
    }
  }

  const filteredPayouts = useMemo(
    () => payouts.filter((payout) => filter === 'all' || payout.status === filter),
    [payouts, filter]
  )

  const config = summary?.config || vendorPayoutService.getConfig()
  const feePercent = (rate: number) => `${(rate * 100).toFixed(1)}%`
  const totalFeePercent = feePercent(config.platformFeeRate + config.stripeFeeRate)
  const canRequestPayout =
    !!summary &&
    !!stripeStatus?.payoutsEnabled &&
    summary.availableAmount >= config.minimumPayoutUsd &&
    !isRequesting

  if (!user || !hasAccess) {
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

      {loadError && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
          <p className="text-red-800">{loadError}</p>
          <button onClick={loadData} className="btn-secondary">Retry</button>
        </div>
      )}

      {payoutMessage && (
        <div
          className={`mb-6 rounded-lg p-4 border ${
            payoutMessage.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {payoutMessage.text}
        </div>
      )}

      {/* Stripe Connect Status */}
      {stripeStatus && !stripeStatus.payoutsEnabled && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium text-yellow-900">
                {stripeStatus.isOnboarded ? 'Stripe is verifying your account' : 'Complete your payout setup'}
              </h3>
              <p className="text-yellow-700">
                {stripeStatus.isOnboarded
                  ? 'Your details are submitted. Payouts unlock as soon as Stripe finishes its review.'
                  : 'You need to complete your Stripe Connect onboarding to receive payouts.'}
              </p>
              {stripeStatus.currentlyDue.length > 0 && (
                <p className="mt-1 text-sm text-yellow-700">
                  Stripe still needs: {stripeStatus.currentlyDue.join(', ')}
                </p>
              )}
            </div>
            <button onClick={startOnboarding} disabled={isConnecting} className="btn-primary disabled:opacity-50">
              {isConnecting ? 'Opening Stripe…' : stripeStatus.hasAccount ? 'Continue Setup' : 'Complete Setup'}
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b card-border mb-6">
        <nav className="-mb-px flex space-x-8">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id)}
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
                      {summary.periodComparison.isPositive ? '+' : ''}{summary.periodComparison.change}% vs last month
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
                  <p className="text-sm font-medium text-muted">Available Now</p>
                  <p className="text-2xl font-semibold text-text">
                    {vendorPayoutService.formatCurrency(summary.availableAmount)}
                  </p>
                  <p className="text-sm text-muted">
                    {summary.processingAmount > 0
                      ? `${vendorPayoutService.formatCurrency(summary.processingAmount)} in transit`
                      : 'Ready to withdraw'}
                  </p>
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
                  <p className="text-sm text-muted">Across {summary.totalPayouts} sale{summary.totalPayouts === 1 ? '' : 's'}</p>
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
                  <p className="text-sm text-muted">{totalFeePercent} total fees</p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-card rounded-lg shadow p-6">
              <h3 className="text-lg font-medium text-text mb-4">Request Payout</h3>
              <p className="text-muted mb-4">
                Send your available earnings to your connected Stripe account.
              </p>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-muted">Available:</span>
                <span className="font-medium text-green-600">
                  {vendorPayoutService.formatCurrency(summary.availableAmount)}
                </span>
              </div>
              <button
                onClick={requestPayout}
                disabled={!canRequestPayout}
                className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRequesting ? 'Processing…' : 'Request Payout'}
              </button>
              {!stripeStatus?.payoutsEnabled ? (
                <p className="mt-2 text-xs text-muted">Finish Stripe onboarding to enable payouts.</p>
              ) : summary.availableAmount < config.minimumPayoutUsd ? (
                <p className="mt-2 text-xs text-muted">
                  Minimum payout is {vendorPayoutService.formatCurrency(config.minimumPayoutUsd)}.
                </p>
              ) : null}
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <h3 className="text-lg font-medium text-text mb-4">Fee Breakdown</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted">Platform Fee</span>
                  <span className="font-medium">{feePercent(config.platformFeeRate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Payment Processing</span>
                  <span className="font-medium">{feePercent(config.stripeFeeRate)}</span>
                </div>
                <div className="flex justify-between border-t pt-3">
                  <span className="font-medium text-text">Total Fees</span>
                  <span className="font-medium text-text">{totalFeePercent}</span>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <h3 className="text-lg font-medium text-text mb-4">Payout Schedule</h3>
              <p className="text-muted mb-4">
                Earnings accrue as soon as an order is paid, and you withdraw them on demand.
              </p>
              <div className="text-sm text-muted space-y-1">
                <p>Minimum payout: {vendorPayoutService.formatCurrency(config.minimumPayoutUsd)}</p>
                <p>
                  Arrival:{' '}
                  {stripeStatus?.instantPayoutsEnabled
                    ? 'within minutes (instant to your debit card)'
                    : '1–2 business days (standard bank payout)'}
                </p>
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
                  onChange={(e) => setFilter(e.target.value as StatusFilter)}
                  className="form-select"
                >
                  <option value="all">All Payouts ({payouts.length})</option>
                  <option value="pending">Pending ({payouts.filter(p => p.status === 'pending').length})</option>
                  <option value="processing">Processing ({payouts.filter(p => p.status === 'processing').length})</option>
                  <option value="paid">Paid ({payouts.filter(p => p.status === 'paid').length})</option>
                  <option value="failed">Failed ({payouts.filter(p => p.status === 'failed').length})</option>
                </select>
              </div>
              <button onClick={loadData} className="btn-secondary">
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
                      Order
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
                  {filteredPayouts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-sm text-muted">
                        {payouts.length === 0
                          ? 'No earnings yet. Payouts appear here as soon as a customer pays for one of your products.'
                          : 'No payouts match this filter.'}
                      </td>
                    </tr>
                  )}
                  {filteredPayouts.map((payout) => (
                    <tr key={payout.id} className="hover:bg-card">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-text">
                        <div>{payout.metadata?.order_number || payout.orderId}</div>
                        {payout.metadata?.product_name && (
                          <div className="text-xs text-muted">
                            {payout.metadata.product_name}
                            {payout.metadata.quantity ? ` × ${payout.metadata.quantity}` : ''}
                          </div>
                        )}
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
                        {payout.stripeTransferId && (
                          <div className="text-xs text-muted font-normal">{payout.stripeTransferId}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          payout.status === 'paid' ? 'bg-green-100 text-green-800' :
                          payout.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                          payout.status === 'failed' ? 'bg-red-100 text-red-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {payout.status}
                        </span>
                        {payout.failureReason && (
                          <div className="text-xs text-red-600 mt-1 max-w-xs">{payout.failureReason}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        <div>{new Date(payout.createdAt).toLocaleDateString()}</div>
                        {payout.processedAt && (
                          <div className="text-xs">Paid {new Date(payout.processedAt).toLocaleDateString()}</div>
                        )}
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
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-text">Earnings Over Time</h3>
              <select
                value={analyticsPeriod}
                onChange={(e) => setAnalyticsPeriod(e.target.value as AnalyticsPeriod)}
                className="form-select"
              >
                <option value="week">Last 7 days</option>
                <option value="month">Last 30 days</option>
                <option value="year">Last 12 months</option>
              </select>
            </div>

            {analytics.chartData.length === 0 ? (
              <p className="text-muted">No earnings recorded in this period yet.</p>
            ) : (
              <div className="space-y-2">
                {(() => {
                  const max = Math.max(...analytics.chartData.map((d) => d.amount), 0.01)
                  return analytics.chartData.map((point) => (
                    <div key={point.date} className="flex items-center gap-3">
                      <span className="text-xs text-muted w-24 shrink-0">{point.date}</span>
                      <div className="flex-1 h-4 bg-black/5 rounded overflow-hidden">
                        <div
                          className="h-full bg-purple-500"
                          style={{ width: `${Math.max((point.amount / max) * 100, 2)}%` }}
                        />
                      </div>
                      <span className="text-xs text-text w-24 text-right shrink-0">
                        {vendorPayoutService.formatCurrency(point.amount)}
                      </span>
                      <span className="text-xs text-muted w-24 text-right shrink-0">
                        {vendorPayoutService.formatCurrency(point.fees)} fees
                      </span>
                    </div>
                  ))
                })()}
              </div>
            )}

            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-black/5">
                <p className="text-sm text-muted">Growth vs previous period</p>
                <p className={`text-xl font-semibold ${analytics.monthlyTrends.payoutGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {analytics.monthlyTrends.payoutGrowth >= 0 ? '+' : ''}{analytics.monthlyTrends.payoutGrowth}%
                </p>
              </div>
              <div className="p-4 rounded-lg bg-black/5">
                <p className="text-sm text-muted">Effective fee rate</p>
                <p className="text-xl font-semibold text-text">{analytics.monthlyTrends.feeOptimization}%</p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-text mb-4">Top Products</h3>
            {analytics.topProducts.length === 0 ? (
              <p className="text-muted">No product sales in this period yet.</p>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted uppercase">Product</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted uppercase">Gross Sales</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted uppercase">Your Earnings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {analytics.topProducts.map((product) => (
                    <tr key={product.productId}>
                      <td className="px-4 py-2 text-sm text-text">{product.productName}</td>
                      <td className="px-4 py-2 text-sm text-right text-text">
                        {vendorPayoutService.formatCurrency(product.totalSales)}
                      </td>
                      <td className="px-4 py-2 text-sm text-right text-green-600">
                        {vendorPayoutService.formatCurrency(product.totalPayouts)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
                <div className={`p-4 rounded-lg ${stripeStatus?.payoutsEnabled ? 'bg-green-50' : 'bg-yellow-50'}`}>
                  <div className="flex items-center">
                    <svg
                      className={`w-5 h-5 mr-3 ${stripeStatus?.payoutsEnabled ? 'text-green-600' : 'text-yellow-600'}`}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className={`font-medium ${stripeStatus?.payoutsEnabled ? 'text-green-800' : 'text-yellow-800'}`}>
                      {stripeStatus?.payoutsEnabled
                        ? 'Payouts enabled'
                        : stripeStatus?.isOnboarded
                          ? 'Awaiting Stripe verification'
                          : stripeStatus?.hasAccount
                            ? 'Onboarding incomplete'
                            : 'No Stripe account yet'}
                    </span>
                  </div>
                  <div className={`mt-2 text-sm ${stripeStatus?.payoutsEnabled ? 'text-green-700' : 'text-yellow-700'}`}>
                    {stripeStatus?.accountId && <p>Account: {stripeStatus.accountId}</p>}
                    {stripeStatus?.externalAccountLast4 && (
                      <p>
                        Paying out to {stripeStatus.externalAccountBrand || 'account'} ••••{stripeStatus.externalAccountLast4}
                      </p>
                    )}
                    {stripeStatus?.currentlyDue?.length ? (
                      <p>Stripe still needs: {stripeStatus.currentlyDue.join(', ')}</p>
                    ) : null}
                  </div>
                  <button onClick={startOnboarding} disabled={isConnecting} className="btn-secondary mt-3 disabled:opacity-50">
                    {stripeStatus?.hasAccount ? 'Manage Stripe details' : 'Set up Stripe payouts'}
                  </button>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium text-text mb-2">How payouts work</h4>
                <ul className="text-sm text-muted space-y-1 list-disc pl-5">
                  <li>Earnings accrue the moment an order containing your product is paid.</li>
                  <li>
                    You keep the sale minus {feePercent(config.platformFeeRate)} platform fee and{' '}
                    {feePercent(config.stripeFeeRate)} payment processing.
                  </li>
                  <li>
                    Payouts are requested on demand, with a minimum of{' '}
                    {vendorPayoutService.formatCurrency(config.minimumPayoutUsd)}.
                  </li>
                  <li>
                    Funds arrive{' '}
                    {stripeStatus?.instantPayoutsEnabled
                      ? 'within minutes on your linked debit card.'
                      : 'in 1–2 business days on your linked bank account.'}
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default VendorPayouts

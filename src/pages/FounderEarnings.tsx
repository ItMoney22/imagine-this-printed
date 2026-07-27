import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Clock,
  DollarSign,
  ExternalLink,
  FileText,
  RefreshCw,
  TrendingUp
} from 'lucide-react'
import { useAuth } from '../context/SupabaseAuthContext'
import { useToast } from '../hooks/useToast'
import api from '../lib/api'
import {
  FOUNDER_PERCENTAGE,
  countByStatus,
  filterByPeriod,
  formatCents,
  formatPercentage,
  groupEarningsByMonth,
  summarizeInvoices,
  topBilledItems
} from '../utils/founder-earnings'
import type {
  EarningsPeriod,
  FounderInvoice,
  FounderInvoiceStatus,
  InvoiceStatsSummary
} from '../utils/founder-earnings'

const PERIOD_LABELS: Record<EarningsPeriod, string> = {
  week: 'Last 7 days',
  month: 'Last month',
  quarter: 'Last quarter',
  year: 'Last year',
  all: 'All time'
}

const STATUS_BADGE: Record<FounderInvoiceStatus, string> = {
  draft: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  sent: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  paid: 'bg-green-500/20 text-green-400 border-green-500/30',
  overdue: 'bg-red-500/20 text-red-400 border-red-500/30',
  void: 'bg-gray-500/20 text-gray-500 border-gray-500/30',
  uncollectible: 'bg-gray-500/20 text-gray-500 border-gray-500/30'
}

const StatusBadge: React.FC<{ status: FounderInvoiceStatus }> = ({ status }) => (
  <span
    className={`inline-flex px-2 py-1 rounded-full text-xs font-medium border ${
      STATUS_BADGE[status] || STATUS_BADGE.draft
    }`}
  >
    {status.charAt(0).toUpperCase() + status.slice(1)}
  </span>
)

const FounderEarningsPage: React.FC = () => {
  const { user } = useAuth()
  const toast = useToast()

  const [invoices, setInvoices] = useState<FounderInvoice[]>([])
  const [stats, setStats] = useState<InvoiceStatsSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedTab, setSelectedTab] = useState<'overview' | 'invoices' | 'breakdown'>('overview')
  const [selectedPeriod, setSelectedPeriod] = useState<EarningsPeriod>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | FounderInvoiceStatus>('all')

  const hasAccess = user?.role === 'founder' || user?.role === 'admin'

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const [invoicesRes, statsRes] = await Promise.all([
        api.get('/api/invoices'),
        api.get('/api/invoices/stats/summary')
      ])

      setInvoices(invoicesRes.data?.ok ? invoicesRes.data.invoices || [] : [])
      setStats(statsRes.data?.ok ? statsRes.data.stats || null : null)
    } catch (error: unknown) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Could not reach the invoice service.'
      console.error('[FounderEarnings] Failed to load invoice data:', error)
      setLoadError(message)
      toast.error('Failed to load earnings', message)
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (hasAccess) loadData()
    // `loadData` is stable except when the toast context changes; re-running on
    // that is harmless and keeps the lint rule honest.
  }, [hasAccess, loadData])

  const periodInvoices = useMemo(
    () => filterByPeriod(invoices, selectedPeriod),
    [invoices, selectedPeriod]
  )
  const summary = useMemo(() => summarizeInvoices(periodInvoices), [periodInvoices])
  const statusCounts = useMemo(() => countByStatus(periodInvoices), [periodInvoices])
  const monthly = useMemo(() => groupEarningsByMonth(invoices), [invoices])
  const billedItems = useMemo(() => topBilledItems(periodInvoices), [periodInvoices])

  const visibleInvoices = useMemo(
    () =>
      statusFilter === 'all'
        ? periodInvoices
        : periodInvoices.filter(inv => inv.status === statusFilter),
    [periodInvoices, statusFilter]
  )

  if (!hasAccess) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <p className="text-red-400">Access denied. Founder access required.</p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-text">Founder Earnings</h1>
            <p className="text-muted">
              Your {FOUNDER_PERCENTAGE}% share of every invoice you bill, straight from the
              invoice ledger.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={selectedPeriod}
              onChange={e => setSelectedPeriod(e.target.value as EarningsPeriod)}
              className="bg-card text-text border card-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {(Object.keys(PERIOD_LABELS) as EarningsPeriod[]).map(period => (
                <option key={period} value={period}>
                  {PERIOD_LABELS[period]}
                </option>
              ))}
            </select>
            <button
              onClick={loadData}
              disabled={isLoading}
              className="p-2 rounded-lg border card-border hover:bg-white/5 text-muted hover:text-text transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 p-4">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 font-medium">Couldn't load your invoice data</p>
            <p className="text-sm text-muted">{loadError}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b card-border mb-6">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'overview', label: 'Overview', icon: '📊' },
            { id: 'invoices', label: 'Invoices', icon: '🧾' },
            { id: 'breakdown', label: 'Breakdown', icon: '📈' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id as typeof selectedTab)}
              className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${
                selectedTab === tab.id
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-muted hover:text-text'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Overview ─────────────────────────────────────────────────────── */}
      {selectedTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-card rounded-lg shadow p-6">
              <div className="flex items-center">
                <FileText className="w-8 h-8 text-blue-500 flex-shrink-0" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted">Billed</p>
                  <p className="text-2xl font-semibold text-text">
                    {formatCents(summary.billedCents)}
                  </p>
                  <p className="text-sm text-muted">
                    {summary.invoiceCount} invoice{summary.invoiceCount === 1 ? '' : 's'} ·{' '}
                    {PERIOD_LABELS[selectedPeriod].toLowerCase()}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <div className="flex items-center">
                <DollarSign className="w-8 h-8 text-green-500 flex-shrink-0" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted">Collected</p>
                  <p className="text-2xl font-semibold text-text">
                    {formatCents(summary.collectedCents)}
                  </p>
                  <p className="text-sm text-muted">{statusCounts.paid} paid</p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <div className="flex items-center">
                <TrendingUp className="w-8 h-8 text-purple-500 flex-shrink-0" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted">Your earnings</p>
                  <p className="text-2xl font-semibold text-green-500">
                    {formatCents(summary.earnedCents)}
                  </p>
                  <p className="text-sm text-muted">
                    {summary.collectedCents > 0
                      ? `${formatPercentage(summary.effectiveSharePercent)} of collected`
                      : `${FOUNDER_PERCENTAGE}% of paid invoices`}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <div className="flex items-center">
                <Clock className="w-8 h-8 text-yellow-500 flex-shrink-0" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted">Awaiting payment</p>
                  <p className="text-2xl font-semibold text-yellow-500">
                    {formatCents(summary.pendingCents)}
                  </p>
                  <p className="text-sm text-muted">
                    {statusCounts.sent + statusCounts.overdue} sent/overdue
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* All-time totals straight from /api/invoices/stats/summary */}
          <div className="bg-card rounded-lg shadow">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">All-time totals</h3>
              <p className="text-sm text-muted">
                Server-side roll-up from the invoice ledger, independent of the period filter.
              </p>
            </div>
            <div className="p-6">
              {stats ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div>
                    <p className="text-sm text-muted">Total billed</p>
                    <p className="text-xl font-semibold text-text">
                      {formatCents(stats.total_billed_cents)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted">Total collected</p>
                    <p className="text-xl font-semibold text-text">
                      {formatCents(stats.total_collected_cents)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted">Earnings paid out to date</p>
                    <p className="text-xl font-semibold text-green-500">
                      {formatCents(stats.total_earnings_cents)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted">Earnings outstanding</p>
                    <p className="text-xl font-semibold text-yellow-500">
                      {formatCents(stats.pending_earnings_cents)}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted">Summary unavailable.</p>
              )}
            </div>
          </div>

          {/* Draft note — money not billed yet */}
          {summary.draftCents > 0 && (
            <div className="bg-card rounded-lg shadow p-6">
              <h3 className="text-lg font-medium text-text mb-1">Not billed yet</h3>
              <p className="text-muted text-sm">
                {formatCents(summary.draftCents)} of founder share is sitting in{' '}
                {statusCounts.draft} draft invoice{statusCounts.draft === 1 ? '' : 's'}. Send them
                from the Founders Dashboard to start the clock.
              </p>
            </div>
          )}

          {/* How the split is calculated — the documented, single source of truth */}
          <div className="bg-card rounded-lg shadow">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">
                How your {FOUNDER_PERCENTAGE}% is calculated
              </h3>
            </div>
            <div className="p-6 space-y-3 text-sm text-muted">
              <p className="font-mono text-text">
                your share = invoice subtotal × {FOUNDER_PERCENTAGE}% (rounded down to the cent)
              </p>
              <p>
                It's a <strong className="text-text">revenue share on what the client is billed</strong>,
                not a profit share. Cost of goods and Stripe processing fees come out of the
                platform's {100 - FOUNDER_PERCENTAGE}%, not out of your cut — so your number never
                moves because a material price changed.
              </p>
              <p>
                Every invoice stores the rate it was issued under, so historical invoices keep
                their original split if the rate ever changes.
              </p>
              <p>
                Earnings count as <strong className="text-text">yours</strong> once the client pays
                the invoice. Payouts are settled outside this page — talk to admin about the payout
                run.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Invoices ─────────────────────────────────────────────────────── */}
      {selectedTab === 'invoices' && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg shadow p-4">
            <div className="flex flex-wrap items-center gap-4">
              <label className="text-sm font-medium text-text">Filter by status:</label>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
                className="bg-card text-text border card-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="all">All ({periodInvoices.length})</option>
                <option value="draft">Draft ({statusCounts.draft})</option>
                <option value="sent">Sent ({statusCounts.sent})</option>
                <option value="paid">Paid ({statusCounts.paid})</option>
                <option value="overdue">Overdue ({statusCounts.overdue})</option>
                <option value="void">Void ({statusCounts.void})</option>
              </select>
            </div>
          </div>

          <div className="bg-card rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">Invoice earnings</h3>
              <p className="text-sm text-muted">
                One row per real invoice — {PERIOD_LABELS[selectedPeriod].toLowerCase()}.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b card-border">
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Client
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Invoice subtotal
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Rate
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Your share
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Invoice
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {visibleInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center">
                        <p className="text-sm text-muted">
                          {invoices.length === 0
                            ? 'No invoices yet. Create one from the Founders Dashboard and your share will appear here.'
                            : 'No invoices match this period and status.'}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    visibleInvoices.map(invoice => (
                      <tr key={invoice.id} className="hover:bg-white/5 transition-colors">
                        <td className="px-6 py-4">
                          <p className="text-sm font-medium text-text">
                            {invoice.client_name || 'No name'}
                          </p>
                          <p className="text-sm text-muted">{invoice.client_email}</p>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                          {formatCents(invoice.subtotal_cents)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                          {formatPercentage(Number(invoice.founder_percentage) || 0)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-500">
                          {formatCents(invoice.founder_earnings_cents)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <StatusBadge status={invoice.status} />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                          {invoice.paid_at
                            ? `Paid ${new Date(invoice.paid_at).toLocaleDateString()}`
                            : new Date(invoice.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {invoice.stripe_hosted_invoice_url ? (
                            <a
                              href={invoice.stripe_hosted_invoice_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-sm text-purple-500 hover:text-purple-400"
                            >
                              View <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          ) : (
                            <span className="text-sm text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Breakdown ────────────────────────────────────────────────────── */}
      {selectedTab === 'breakdown' && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">Month by month</h3>
              <p className="text-sm text-muted">
                Grouped by the date each invoice was raised. Only months with real invoices are
                listed — no projections.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b card-border">
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Month
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Invoices
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Billed
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Collected
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Your earnings
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Awaiting payment
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {monthly.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center">
                        <p className="text-sm text-muted">
                          Nothing to break down yet — this fills in as invoices are created.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    monthly.map(row => (
                      <tr key={row.month} className="hover:bg-white/5 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-text">
                          {row.label}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                          {row.invoiceCount}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                          {formatCents(row.billedCents)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                          {formatCents(row.collectedCents)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-500">
                          {formatCents(row.earnedCents)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-yellow-500">
                          {formatCents(row.pendingCents)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-card rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">What you're billing for</h3>
              <p className="text-sm text-muted">
                Aggregated from real invoice line items — {PERIOD_LABELS[selectedPeriod].toLowerCase()}.
                Your share per item is that line's pro-rata slice of the invoice's founder share.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b card-border">
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Line item
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Qty
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Invoices
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Billed
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Your share
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {billedItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center">
                        <p className="text-sm text-muted">
                          No line items in this period yet.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    billedItems.map(item => (
                      <tr key={item.description} className="hover:bg-white/5 transition-colors">
                        <td className="px-6 py-4 text-sm font-medium text-text">
                          {item.description}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                          {item.quantity}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                          {item.invoiceCount}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                          {formatCents(item.billedCents)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-500">
                          {formatCents(item.founderShareCents)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default FounderEarningsPage

import React, { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'

interface ConnectAccount {
  id: string
  user_id: string
  stripe_account_id: string
  onboarding_complete: boolean
  payouts_enabled: boolean
  instant_payouts_enabled: boolean
  external_account_last4: string | null
  external_account_brand: string | null
  created_at: string
  user?: {
    email: string
    first_name: string
    last_name: string
  }
}

interface CashoutRequest {
  id: string
  user_id: string
  amount_itc: number
  gross_amount_usd: number
  platform_fee_usd: number
  net_amount_usd: number
  status: string
  created_at: string
  user?: {
    email: string
    first_name: string
    last_name: string
  }
}

interface ConnectStats {
  totalAccounts: number
  activeAccounts: number
  pendingOnboarding: number
  totalCashouts: number
  totalCashedOut: number
  totalPlatformFees: number
  pendingCashouts: number
}

const AdminConnectManagement: React.FC = () => {
  const [accounts, setAccounts] = useState<ConnectAccount[]>([])
  const [cashouts, setCashouts] = useState<CashoutRequest[]>([])
  const [stats, setStats] = useState<ConnectStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<'accounts' | 'cashouts'>('accounts')

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    setError('')

    try {
      const response = await apiFetch('/api/wallet/admin/connect/overview', { method: 'GET' })
      if (response.ok) {
        setAccounts(response.accounts || [])
        setCashouts(response.cashouts || [])
        setStats(response.stats || null)
      } else {
        setError(response.error || 'Failed to load Connect data')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load Connect data')
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-amber-100 text-amber-700',
      processing: 'bg-blue-100 text-blue-700',
      paid: 'bg-emerald-100 text-emerald-700',
      completed: 'bg-emerald-100 text-emerald-700',
      failed: 'bg-red-100 text-red-700',
      cancelled: 'bg-slate-100 text-slate-700'
    }
    return styles[status] || 'bg-slate-100 text-slate-700'
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-12">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
          <span className="ml-3 text-slate-500">Loading Connect data...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700">
          {error}
        </div>
        <button
          onClick={loadData}
          className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl shadow-soft border border-slate-100 p-4">
            <p className="text-sm text-slate-500">Connected Accounts</p>
            <p className="text-2xl font-bold text-slate-900">{stats.totalAccounts}</p>
            <p className="text-xs text-emerald-600">{stats.activeAccounts} active</p>
          </div>
          <div className="bg-white rounded-xl shadow-soft border border-slate-100 p-4">
            <p className="text-sm text-slate-500">Pending Onboarding</p>
            <p className="text-2xl font-bold text-amber-600">{stats.pendingOnboarding}</p>
          </div>
          <div className="bg-white rounded-xl shadow-soft border border-slate-100 p-4">
            <p className="text-sm text-slate-500">Total Cashed Out</p>
            <p className="text-2xl font-bold text-emerald-600">${stats.totalCashedOut.toFixed(2)}</p>
            <p className="text-xs text-slate-500">{stats.totalCashouts} payouts</p>
          </div>
          <div className="bg-white rounded-xl shadow-soft border border-slate-100 p-4">
            <p className="text-sm text-slate-500">Platform Fees Earned</p>
            <p className="text-2xl font-bold text-purple-600">${stats.totalPlatformFees.toFixed(2)}</p>
            <p className="text-xs text-slate-500">7% of cashouts</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
        <div className="border-b border-slate-200 px-6 py-3 flex gap-4">
          <button
            onClick={() => setActiveTab('accounts')}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
              activeTab === 'accounts'
                ? 'bg-purple-600 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Connected Accounts ({accounts.length})
          </button>
          <button
            onClick={() => setActiveTab('cashouts')}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
              activeTab === 'cashouts'
                ? 'bg-purple-600 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Cash-Out Requests ({cashouts.length})
          </button>
        </div>

        {/* Connected Accounts Table */}
        {activeTab === 'accounts' && (
          <div className="overflow-x-auto">
            {accounts.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                No connected accounts yet
              </div>
            ) : (
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">User</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Stripe Account</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Payout Method</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {accounts.map((account) => (
                    <tr key={account.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium text-slate-900">
                            {account.user?.first_name} {account.user?.last_name}
                          </p>
                          <p className="text-sm text-slate-500">{account.user?.email}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 font-mono">
                        {account.stripe_account_id}
                      </td>
                      <td className="px-6 py-4">
                        {account.payouts_enabled ? (
                          <span className="px-2 py-1 text-xs font-medium bg-emerald-100 text-emerald-700 rounded-full">
                            Active
                          </span>
                        ) : account.onboarding_complete ? (
                          <span className="px-2 py-1 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
                            Pending Verification
                          </span>
                        ) : (
                          <span className="px-2 py-1 text-xs font-medium bg-slate-100 text-slate-600 rounded-full">
                            Onboarding Incomplete
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {account.external_account_last4 ? (
                          <span className="text-slate-900">
                            {account.external_account_brand} ****{account.external_account_last4}
                            {account.instant_payouts_enabled && (
                              <span className="ml-2 text-xs text-purple-600">(Instant)</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-400">Not added</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500">
                        {new Date(account.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Cash-Out Requests Table */}
        {activeTab === 'cashouts' && (
          <div className="overflow-x-auto">
            {cashouts.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                No cash-out requests yet
              </div>
            ) : (
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">User</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Amount (ITC)</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Gross USD</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Platform Fee</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Net Payout</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cashouts.map((cashout) => (
                    <tr key={cashout.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-medium text-slate-900">
                            {cashout.user?.first_name} {cashout.user?.last_name}
                          </p>
                          <p className="text-sm text-slate-500">{cashout.user?.email}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-900">
                        {Number(cashout.amount_itc).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-slate-600">
                        ${Number(cashout.gross_amount_usd).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 text-purple-600 font-medium">
                        ${Number(cashout.platform_fee_usd).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 text-emerald-600 font-semibold">
                        ${Number(cashout.net_amount_usd).toFixed(2)}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusBadge(cashout.status)}`}>
                          {cashout.status.charAt(0).toUpperCase() + cashout.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500">
                        {new Date(cashout.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminConnectManagement

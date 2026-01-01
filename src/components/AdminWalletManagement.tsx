import React, { useState, useEffect } from 'react'
import { Search, Plus, Minus, Edit, AlertCircle, CheckCircle, XCircle } from 'lucide-react'
import api from '../lib/api'
import type { UserWalletInfo } from '../types'

type ActionType = 'credit' | 'debit' | 'adjust'

interface WalletActionForm {
  userId: string
  username: string
  amount: number
  newBalance?: number
  reason: string
}

export default function AdminWalletManagement() {
  const [users, setUsers] = useState<UserWalletInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedUser, setSelectedUser] = useState<UserWalletInfo | null>(null)
  const [actionType, setActionType] = useState<ActionType>('credit')
  const [showActionModal, setShowActionModal] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [formData, setFormData] = useState<WalletActionForm>({
    userId: '',
    username: '',
    amount: 0,
    reason: ''
  })
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)

  // ITC to USD conversion rate
  const itcToUSD = 0.01

  useEffect(() => {
    fetchUsers()
  }, [])

  const fetchUsers = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await api.get('/api/admin/wallet/users', {
        params: { limit: 100 }
      })
      setUsers(response.data.users || [])
    } catch (err: any) {
      console.error('Error fetching users:', err)
      setError(err.response?.data?.error || 'Failed to load user wallets')
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      fetchUsers()
      return
    }

    try {
      setLoading(true)
      setError(null)
      const response = await api.get('/api/admin/wallet/users', {
        params: { search: searchQuery, limit: 100 }
      })
      setUsers(response.data.users || [])
    } catch (err: any) {
      console.error('Error searching users:', err)
      setError(err.response?.data?.error || 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  const openActionModal = (user: UserWalletInfo, action: ActionType) => {
    setSelectedUser(user)
    setActionType(action)
    setFormData({
      userId: user.id,
      username: user.username || user.email,
      amount: 0,
      reason: ''
    })
    setShowActionModal(true)
    setError(null)
    setSuccess(null)
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Validation
    if (actionType !== 'adjust' && formData.amount <= 0) {
      setError('Amount must be greater than 0')
      return
    }

    if (actionType === 'adjust' && (formData.newBalance === undefined || formData.newBalance < 0)) {
      setError('New balance must be 0 or greater')
      return
    }

    if (formData.reason.length < 10) {
      setError('Reason must be at least 10 characters')
      return
    }

    setShowConfirmDialog(true)
  }

  const executeWalletAction = async () => {
    setProcessing(true)
    setError(null)
    setShowConfirmDialog(false)

    try {
      let endpoint = ''
      let payload: any = {
        userId: formData.userId,
        currency: 'itc', // Always ITC now
        reason: formData.reason
      }

      if (actionType === 'credit') {
        endpoint = '/api/admin/wallet/credit'
        payload.amount = formData.amount
      } else if (actionType === 'debit') {
        endpoint = '/api/admin/wallet/debit'
        payload.amount = formData.amount
      } else if (actionType === 'adjust') {
        endpoint = '/api/admin/wallet/adjust'
        payload.newBalance = formData.newBalance
      }

      const response = await api.post(endpoint, payload)

      if (response.data.ok) {
        setSuccess(`Successfully ${actionType}ed ITC for ${formData.username}`)
        setShowActionModal(false)
        fetchUsers()

        // Clear success message after 3 seconds
        setTimeout(() => setSuccess(null), 3000)
      }
    } catch (err: any) {
      console.error(`Error performing ${actionType}:`, err)
      setError(err.response?.data?.error || `Failed to ${actionType} wallet`)
    } finally {
      setProcessing(false)
    }
  }

  const getBalancePreview = () => {
    if (!selectedUser?.user_wallets?.[0]) return null

    const wallet = selectedUser.user_wallets[0]
    const currentBalance = wallet.itc_balance

    let newBalance = currentBalance

    if (actionType === 'credit') {
      newBalance = currentBalance + formData.amount
    } else if (actionType === 'debit') {
      newBalance = currentBalance - formData.amount
    } else if (actionType === 'adjust') {
      newBalance = formData.newBalance || 0
    }

    return {
      current: currentBalance,
      new: newBalance,
      difference: newBalance - currentBalance
    }
  }

  const filteredUsers = searchQuery
    ? users.filter(u =>
        u.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : users

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-display font-bold text-slate-900">Wallet Management</h2>
          <p className="text-slate-500 mt-1">Manage user ITC balances</p>
        </div>
      </div>

      {/* Success/Error Alerts */}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <p className="text-emerald-700">{success}</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-red-600">{error}</p>
        </div>
      )}

      {/* Search Bar */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search by username or email..."
            className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
          />
        </div>
        <button
          onClick={handleSearch}
          className="px-6 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 font-medium transition-colors"
        >
          Search
        </button>
      </div>

      {/* Users Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-soft overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">User</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">Email</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">Role</th>
                <th className="px-6 py-4 text-right text-sm font-semibold text-slate-900">ITC Balance</th>
                <th className="px-6 py-4 text-right text-sm font-semibold text-slate-900">USD Value</th>
                <th className="px-6 py-4 text-right text-sm font-semibold text-slate-900">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                    <div className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-600"></div>
                      Loading users...
                    </div>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                    No users found
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => {
                  const wallet = user.user_wallets?.[0]
                  const itcBalance = wallet?.itc_balance || 0
                  return (
                    <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <span className="font-medium text-slate-900">
                          {user.username || 'No username'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-600">{user.email}</td>
                      <td className="px-6 py-4">
                        <span className="px-2.5 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">
                          {user.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="font-mono font-semibold text-slate-900">
                          {itcBalance.toFixed(2)}
                        </span>
                        <span className="text-slate-400 text-sm ml-1">ITC</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="font-mono text-emerald-600">
                          ${(itcBalance * itcToUSD).toFixed(2)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openActionModal(user, 'credit')}
                            className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                            title="Credit ITC"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => openActionModal(user, 'debit')}
                            className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            title="Debit ITC"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => openActionModal(user, 'adjust')}
                            className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                            title="Adjust Balance"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Action Modal */}
      {showActionModal && selectedUser && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-xl font-display font-bold text-slate-900 mb-4 capitalize">
              {actionType} ITC - {formData.username}
            </h3>

            <form onSubmit={handleFormSubmit} className="space-y-4">
              {/* Amount or New Balance */}
              {actionType === 'adjust' ? (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    New ITC Balance
                  </label>
                  <input
                    type="number"
                    value={formData.newBalance || 0}
                    onChange={(e) => setFormData({ ...formData, newBalance: parseFloat(e.target.value) || 0 })}
                    min="0"
                    step="0.01"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                    required
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    ITC Amount
                  </label>
                  <input
                    type="number"
                    value={formData.amount || 0}
                    onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                    min="0.01"
                    step="0.01"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                    required
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    ≈ ${(formData.amount * itcToUSD).toFixed(2)} USD value
                  </p>
                </div>
              )}

              {/* Reason */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Reason (minimum 10 characters)
                </label>
                <textarea
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors resize-none"
                  placeholder="Enter reason for this wallet action..."
                  required
                  minLength={10}
                />
                <p className="text-xs text-slate-400 mt-1">
                  {formData.reason.length}/10 characters
                </p>
              </div>

              {/* Balance Preview */}
              {(() => {
                const preview = getBalancePreview()
                return preview ? (
                  <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Current Balance:</span>
                      <span className="text-slate-900 font-mono">
                        {preview.current.toFixed(2)} ITC
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">New Balance:</span>
                      <span className="text-slate-900 font-mono font-semibold">
                        {preview.new.toFixed(2)} ITC
                      </span>
                    </div>
                    <div className="flex justify-between text-sm pt-2 border-t border-purple-200">
                      <span className="text-slate-600">Difference:</span>
                      <span className={`font-mono font-semibold ${preview.difference > 0 ? 'text-emerald-600' : preview.difference < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                        {preview.difference > 0 ? '+' : ''}{preview.difference.toFixed(2)} ITC
                      </span>
                    </div>
                  </div>
                ) : null
              })()}

              {/* Error Display */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowActionModal(false)
                    setError(null)
                  }}
                  className="flex-1 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium transition-colors"
                  disabled={processing}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={processing}
                >
                  {processing ? 'Processing...' : 'Continue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-display font-bold text-slate-900">Confirm Wallet Action</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Are you sure you want to {actionType} ITC for {formData.username}?
                </p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Action:</span>
                <span className="text-slate-900 font-semibold capitalize">{actionType}</span>
              </div>
              {actionType !== 'adjust' && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Amount:</span>
                  <span className="text-slate-900 font-semibold font-mono">
                    {formData.amount.toFixed(2)} ITC
                  </span>
                </div>
              )}
              {actionType === 'adjust' && (
                <div className="flex justify-between">
                  <span className="text-slate-500">New Balance:</span>
                  <span className="text-slate-900 font-semibold font-mono">
                    {formData.newBalance?.toFixed(2)} ITC
                  </span>
                </div>
              )}
              <div className="pt-2 border-t border-slate-200">
                <span className="text-slate-500">Reason:</span>
                <p className="text-slate-900 text-xs mt-1">{formData.reason}</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmDialog(false)}
                className="flex-1 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium transition-colors"
                disabled={processing}
              >
                Cancel
              </button>
              <button
                onClick={executeWalletAction}
                className="flex-1 px-4 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={processing}
              >
                {processing ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

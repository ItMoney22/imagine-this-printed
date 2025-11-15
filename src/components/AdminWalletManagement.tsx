import React, { useState, useEffect } from 'react'
import { Search, Plus, Minus, Edit, AlertCircle, CheckCircle, XCircle } from 'lucide-react'
import api from '../lib/api'
import type { UserWalletInfo, WalletTransaction } from '../types'

type ActionType = 'credit' | 'debit' | 'adjust'
type Currency = 'points' | 'itc'

interface WalletActionForm {
  userId: string
  username: string
  amount: number
  newBalance?: number
  currency: Currency
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
    currency: 'points',
    reason: ''
  })
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    fetchUsers()
  }, [])

  const fetchUsers = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await api.get('/admin/wallet/users', {
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
      const response = await api.get('/admin/wallet/users', {
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
      currency: 'points',
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
        currency: formData.currency,
        reason: formData.reason
      }

      if (actionType === 'credit') {
        endpoint = '/admin/wallet/credit'
        payload.amount = formData.amount
      } else if (actionType === 'debit') {
        endpoint = '/admin/wallet/debit'
        payload.amount = formData.amount
      } else if (actionType === 'adjust') {
        endpoint = '/admin/wallet/adjust'
        payload.newBalance = formData.newBalance
      }

      const response = await api.post(endpoint, payload)

      if (response.data.ok) {
        setSuccess(`Successfully ${actionType}ed ${formData.currency} for ${formData.username}`)
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
    const currentBalance = formData.currency === 'points' ? wallet.points : wallet.itc_balance

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
          <h2 className="text-2xl font-bold text-text">Wallet Management</h2>
          <p className="text-muted mt-1">Manage user points and ITC balances</p>
        </div>
      </div>

      {/* Success/Error Alerts */}
      {success && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
          <p className="text-green-500">{success}</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-red-500">{error}</p>
        </div>
      )}

      {/* Search Bar */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search by username or email..."
            className="w-full pl-10 pr-4 py-3 bg-card border border-primary/20 rounded-lg text-text placeholder:text-muted focus:outline-none focus:border-primary"
          />
        </div>
        <button
          onClick={handleSearch}
          className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors"
        >
          Search
        </button>
      </div>

      {/* Users Table */}
      <div className="bg-card border border-primary/20 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-primary/10 border-b border-primary/20">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold text-text">User</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-text">Email</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-text">Role</th>
                <th className="px-6 py-4 text-right text-sm font-semibold text-text">Points</th>
                <th className="px-6 py-4 text-right text-sm font-semibold text-text">ITC Balance</th>
                <th className="px-6 py-4 text-right text-sm font-semibold text-text">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-primary/10">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted">
                    Loading users...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted">
                    No users found
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => {
                  const wallet = user.user_wallets?.[0]
                  return (
                    <tr key={user.id} className="hover:bg-primary/5 transition-colors">
                      <td className="px-6 py-4 text-text">
                        {user.username || 'No username'}
                      </td>
                      <td className="px-6 py-4 text-muted">{user.email}</td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 bg-primary/10 text-primary text-xs rounded">
                          {user.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-text font-mono">
                        {wallet ? wallet.points.toLocaleString() : 0}
                      </td>
                      <td className="px-6 py-4 text-right text-text font-mono">
                        {wallet ? wallet.itc_balance.toFixed(2) : '0.00'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openActionModal(user, 'credit')}
                            className="p-2 text-green-500 hover:bg-green-500/10 rounded transition-colors"
                            title="Credit"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => openActionModal(user, 'debit')}
                            className="p-2 text-red-500 hover:bg-red-500/10 rounded transition-colors"
                            title="Debit"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => openActionModal(user, 'adjust')}
                            className="p-2 text-primary hover:bg-primary/10 rounded transition-colors"
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
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-primary/20 rounded-lg max-w-md w-full p-6 shadow-glow">
            <h3 className="text-xl font-bold text-text mb-4 capitalize">
              {actionType} Wallet - {formData.username}
            </h3>

            <form onSubmit={handleFormSubmit} className="space-y-4">
              {/* Currency Selection */}
              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Currency
                </label>
                <select
                  value={formData.currency}
                  onChange={(e) => setFormData({ ...formData, currency: e.target.value as Currency })}
                  className="w-full px-4 py-2 bg-bg border border-primary/20 rounded-lg text-text focus:outline-none focus:border-primary"
                >
                  <option value="points">Points</option>
                  <option value="itc">ITC</option>
                </select>
              </div>

              {/* Amount or New Balance */}
              {actionType === 'adjust' ? (
                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    New Balance
                  </label>
                  <input
                    type="number"
                    value={formData.newBalance || 0}
                    onChange={(e) => setFormData({ ...formData, newBalance: parseFloat(e.target.value) || 0 })}
                    min="0"
                    step={formData.currency === 'itc' ? '0.01' : '1'}
                    className="w-full px-4 py-2 bg-bg border border-primary/20 rounded-lg text-text focus:outline-none focus:border-primary"
                    required
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    Amount
                  </label>
                  <input
                    type="number"
                    value={formData.amount || 0}
                    onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                    min="0.01"
                    step={formData.currency === 'itc' ? '0.01' : '1'}
                    className="w-full px-4 py-2 bg-bg border border-primary/20 rounded-lg text-text focus:outline-none focus:border-primary"
                    required
                  />
                </div>
              )}

              {/* Reason */}
              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Reason (minimum 10 characters)
                </label>
                <textarea
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 bg-bg border border-primary/20 rounded-lg text-text focus:outline-none focus:border-primary resize-none"
                  placeholder="Enter reason for this wallet action..."
                  required
                  minLength={10}
                />
                <p className="text-xs text-muted mt-1">
                  {formData.reason.length}/10 characters
                </p>
              </div>

              {/* Balance Preview */}
              {(() => {
                const preview = getBalancePreview()
                return preview ? (
                  <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">Current Balance:</span>
                      <span className="text-text font-mono">
                        {formData.currency === 'itc' ? preview.current.toFixed(2) : preview.current.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted">New Balance:</span>
                      <span className="text-text font-mono font-semibold">
                        {formData.currency === 'itc' ? preview.new.toFixed(2) : preview.new.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm pt-2 border-t border-primary/20">
                      <span className="text-muted">Difference:</span>
                      <span className={`font-mono font-semibold ${preview.difference > 0 ? 'text-green-500' : preview.difference < 0 ? 'text-red-500' : 'text-text'}`}>
                        {preview.difference > 0 ? '+' : ''}{formData.currency === 'itc' ? preview.difference.toFixed(2) : preview.difference.toLocaleString()}
                      </span>
                    </div>
                  </div>
                ) : null
              })()}

              {/* Error Display */}
              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-500">{error}</p>
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
                  className="flex-1 px-4 py-2 bg-card border border-primary/20 text-text rounded-lg hover:bg-primary/5 transition-colors"
                  disabled={processing}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-card border border-primary/20 rounded-lg max-w-md w-full p-6 shadow-glow">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle className="w-6 h-6 text-yellow-500 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-bold text-text">Confirm Wallet Action</h3>
                <p className="text-sm text-muted mt-1">
                  Are you sure you want to {actionType} {formData.currency} for {formData.username}?
                </p>
              </div>
            </div>

            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 mb-4 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Action:</span>
                <span className="text-text font-semibold capitalize">{actionType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Currency:</span>
                <span className="text-text font-semibold uppercase">{formData.currency}</span>
              </div>
              {actionType !== 'adjust' && (
                <div className="flex justify-between">
                  <span className="text-muted">Amount:</span>
                  <span className="text-text font-semibold font-mono">
                    {formData.currency === 'itc' ? formData.amount.toFixed(2) : formData.amount.toLocaleString()}
                  </span>
                </div>
              )}
              {actionType === 'adjust' && (
                <div className="flex justify-between">
                  <span className="text-muted">New Balance:</span>
                  <span className="text-text font-semibold font-mono">
                    {formData.currency === 'itc' ? formData.newBalance?.toFixed(2) : formData.newBalance?.toLocaleString()}
                  </span>
                </div>
              )}
              <div className="pt-2 border-t border-primary/20">
                <span className="text-muted">Reason:</span>
                <p className="text-text text-xs mt-1">{formData.reason}</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmDialog(false)}
                className="flex-1 px-4 py-2 bg-card border border-primary/20 text-text rounded-lg hover:bg-primary/5 transition-colors"
                disabled={processing}
              >
                Cancel
              </button>
              <button
                onClick={executeWalletAction}
                className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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


import React, { useState, useEffect } from 'react'
import { Search, Plus, Trash2, AlertCircle, CheckCircle, XCircle, Copy, Gift, Download, Filter } from 'lucide-react'
import api from '../lib/api'
import type { GiftCard } from '../types'

interface GiftCardStats {
  total: number
  redeemed: number
  unredeemed: number
  totalItcIssued: number
  totalItcRedeemed: number
}

interface GiftCardFormData {
  itc_amount: number
  expires_at: string
  notes: string
  recipient_email: string
  sender_name: string
  message: string
}

interface BulkFormData {
  count: number
  itc_amount: number
  expires_at: string
  notes: string
}

const defaultFormData: GiftCardFormData = {
  itc_amount: 100,
  expires_at: '',
  notes: '',
  recipient_email: '',
  sender_name: '',
  message: ''
}

const defaultBulkFormData: BulkFormData = {
  count: 10,
  itc_amount: 100,
  expires_at: '',
  notes: ''
}

export default function AdminGiftCardManagement() {
  const [giftCards, setGiftCards] = useState<GiftCard[]>([])
  const [stats, setStats] = useState<GiftCardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'redeemed' | 'unredeemed'>('all')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [formData, setFormData] = useState<GiftCardFormData>(defaultFormData)
  const [bulkFormData, setBulkFormData] = useState<BulkFormData>(defaultBulkFormData)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    fetchGiftCards()
    fetchStats()
  }, [statusFilter])

  const fetchGiftCards = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await api.get('/admin/gift-cards', {
        params: { status: statusFilter }
      })
      setGiftCards(response.data.giftCards || [])
    } catch (err: any) {
      console.error('Error fetching gift cards:', err)
      setError(err.response?.data?.error || 'Failed to load gift cards')
    } finally {
      setLoading(false)
    }
  }

  const fetchStats = async () => {
    try {
      const response = await api.get('/admin/gift-cards/stats')
      setStats(response.data.stats)
    } catch (err) {
      console.error('Error fetching stats:', err)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setProcessing(true)
    setError(null)

    try {
      await api.post('/admin/gift-cards', {
        ...formData,
        expires_at: formData.expires_at ? new Date(formData.expires_at).toISOString() : null
      })
      setSuccess('Gift card created successfully!')
      setShowCreateModal(false)
      setFormData(defaultFormData)
      fetchGiftCards()
      fetchStats()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      console.error('Error creating gift card:', err)
      setError(err.response?.data?.error || 'Failed to create gift card')
    } finally {
      setProcessing(false)
    }
  }

  const handleBulkCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setProcessing(true)
    setError(null)

    try {
      const response = await api.post('/admin/gift-cards/bulk', {
        ...bulkFormData,
        expires_at: bulkFormData.expires_at ? new Date(bulkFormData.expires_at).toISOString() : null
      })
      setSuccess(`Created ${response.data.count} gift cards successfully!`)
      setShowBulkModal(false)
      setBulkFormData(defaultBulkFormData)
      fetchGiftCards()
      fetchStats()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      console.error('Error bulk creating gift cards:', err)
      setError(err.response?.data?.error || 'Failed to create gift cards')
    } finally {
      setProcessing(false)
    }
  }

  const handleDelete = async (giftCard: GiftCard) => {
    if (giftCard.redeemed_by) {
      setError('Cannot delete a redeemed gift card')
      return
    }
    if (!confirm(`Are you sure you want to delete gift card "${giftCard.code}"?`)) return

    try {
      await api.delete(`/admin/gift-cards/${giftCard.id}`)
      setSuccess('Gift card deleted successfully!')
      fetchGiftCards()
      fetchStats()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      console.error('Error deleting gift card:', err)
      setError(err.response?.data?.error || 'Failed to delete gift card')
    }
  }

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    setSuccess(`Copied "${code}" to clipboard!`)
    setTimeout(() => setSuccess(null), 2000)
  }

  const exportCodes = () => {
    const unredeemed = giftCards.filter(gc => !gc.redeemed_by && gc.is_active)
    const csv = ['Code,ITC Amount,Created At,Expires At']
    unredeemed.forEach(gc => {
      csv.push(`${gc.code},${gc.itc_amount},${gc.created_at},${gc.expires_at || 'Never'}`)
    })
    const blob = new Blob([csv.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gift-cards-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const isExpired = (giftCard: GiftCard) => {
    return giftCard.expires_at && new Date(giftCard.expires_at) < new Date()
  }

  const filteredGiftCards = searchQuery
    ? giftCards.filter(gc =>
        gc.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        gc.notes?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        gc.recipient_email?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : giftCards

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-display font-bold text-slate-900">Gift Card Management</h2>
          <p className="text-slate-500 mt-1">Create and manage ITC gift cards</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCodes}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 font-medium transition-colors"
          >
            <Download className="w-5 h-5" />
            Export CSV
          </button>
          <button
            onClick={() => setShowBulkModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-purple-200 text-purple-700 rounded-xl hover:bg-purple-50 font-medium transition-colors"
          >
            <Plus className="w-5 h-5" />
            Bulk Create
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 font-medium transition-colors"
          >
            <Gift className="w-5 h-5" />
            Create Gift Card
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-slate-500 text-sm">Total Created</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{stats.total}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-slate-500 text-sm">Unredeemed</p>
            <p className="text-2xl font-bold text-emerald-600 mt-1">{stats.unredeemed}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2">
              <img src="/itc-coin.png" alt="ITC" className="w-5 h-5 object-contain" />
              <p className="text-slate-500 text-sm">ITC Issued</p>
            </div>
            <p className="text-2xl font-bold text-purple-600 mt-1">{stats.totalItcIssued.toLocaleString()}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2">
              <img src="/itc-coin.png" alt="ITC" className="w-5 h-5 object-contain" />
              <p className="text-slate-500 text-sm">ITC Redeemed</p>
            </div>
            <p className="text-2xl font-bold text-blue-600 mt-1">{stats.totalItcRedeemed.toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Alerts */}
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

      {/* Search and Filter */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by code, email, or notes..."
            className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="pl-10 pr-8 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors appearance-none"
          >
            <option value="all">All Cards</option>
            <option value="unredeemed">Unredeemed</option>
            <option value="redeemed">Redeemed</option>
          </select>
        </div>
      </div>

      {/* Gift Cards Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-soft overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">Code</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">ITC Amount</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">Status</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">Redeemed By</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">Created</th>
                <th className="px-6 py-4 text-right text-sm font-semibold text-slate-900">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                    <div className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-600"></div>
                      Loading gift cards...
                    </div>
                  </td>
                </tr>
              ) : filteredGiftCards.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                    No gift cards found
                  </td>
                </tr>
              ) : (
                filteredGiftCards.map((giftCard) => (
                  <tr key={giftCard.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-slate-900 bg-gradient-to-r from-purple-100 to-pink-100 px-3 py-1 rounded-lg">
                          {giftCard.code}
                        </span>
                        <button
                          onClick={() => copyCode(giftCard.code)}
                          className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                          title="Copy code"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                      {giftCard.notes && (
                        <p className="text-xs text-slate-500 mt-1">{giftCard.notes}</p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5">
                        <img src="/itc-coin.png" alt="ITC" className="w-4 h-4 object-contain" />
                        <span className="font-mono font-semibold text-purple-600">
                          {giftCard.itc_amount.toLocaleString()}
                        </span>
                      </div>
                      <span className="text-slate-400 text-sm">
                        (${(giftCard.itc_amount * 0.10).toFixed(2)})
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {giftCard.redeemed_by ? (
                        <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-full">
                          Redeemed
                        </span>
                      ) : isExpired(giftCard) ? (
                        <span className="px-2.5 py-1 bg-red-100 text-red-700 text-xs font-medium rounded-full">
                          Expired
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {giftCard.redeemer ? (
                        <div>
                          <p className="text-slate-900 text-sm">
                            {giftCard.redeemer.first_name} {giftCard.redeemer.last_name}
                          </p>
                          <p className="text-slate-500 text-xs">{giftCard.redeemer.email}</p>
                          {giftCard.redeemed_at && (
                            <p className="text-slate-400 text-xs">
                              {new Date(giftCard.redeemed_at).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-600 text-sm">
                      {new Date(giftCard.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {!giftCard.redeemed_by && (
                        <button
                          onClick={() => handleDelete(giftCard)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Single Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <Gift className="w-5 h-5 text-white" />
              </div>
              <h3 className="text-xl font-display font-bold text-slate-900">Create Gift Card</h3>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  ITC Amount
                </label>
                <input
                  type="number"
                  value={formData.itc_amount}
                  onChange={(e) => setFormData({ ...formData, itc_amount: parseInt(e.target.value) || 0 })}
                  min="1"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                  required
                />
                <p className="text-xs text-slate-500 mt-1">
                  Value: ${(formData.itc_amount * 0.10).toFixed(2)} USD
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Recipient Email (optional)
                </label>
                <input
                  type="email"
                  value={formData.recipient_email}
                  onChange={(e) => setFormData({ ...formData, recipient_email: e.target.value })}
                  placeholder="recipient@example.com"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Expiration Date (optional)
                </label>
                <input
                  type="date"
                  value={formData.expires_at}
                  onChange={(e) => setFormData({ ...formData, expires_at: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Notes (optional)
                </label>
                <input
                  type="text"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Internal notes..."
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false)
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
                  {processing ? 'Creating...' : 'Create Gift Card'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Create Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                <Plus className="w-5 h-5 text-white" />
              </div>
              <h3 className="text-xl font-display font-bold text-slate-900">Bulk Create Gift Cards</h3>
            </div>

            <form onSubmit={handleBulkCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Number of Cards
                </label>
                <input
                  type="number"
                  value={bulkFormData.count}
                  onChange={(e) => setBulkFormData({ ...bulkFormData, count: parseInt(e.target.value) || 0 })}
                  min="1"
                  max="100"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                  required
                />
                <p className="text-xs text-slate-500 mt-1">Maximum 100 per batch</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  ITC Amount (each)
                </label>
                <input
                  type="number"
                  value={bulkFormData.itc_amount}
                  onChange={(e) => setBulkFormData({ ...bulkFormData, itc_amount: parseInt(e.target.value) || 0 })}
                  min="1"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                  required
                />
                <p className="text-xs text-slate-500 mt-1">
                  Total value: {bulkFormData.count * bulkFormData.itc_amount} ITC (${(bulkFormData.count * bulkFormData.itc_amount * 0.10).toFixed(2)} USD)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Expiration Date (optional)
                </label>
                <input
                  type="date"
                  value={bulkFormData.expires_at}
                  onChange={(e) => setBulkFormData({ ...bulkFormData, expires_at: e.target.value })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Notes (optional)
                </label>
                <input
                  type="text"
                  value={bulkFormData.notes}
                  onChange={(e) => setBulkFormData({ ...bulkFormData, notes: e.target.value })}
                  placeholder="e.g., Holiday promotion batch"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowBulkModal(false)
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
                  {processing ? 'Creating...' : `Create ${bulkFormData.count} Cards`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

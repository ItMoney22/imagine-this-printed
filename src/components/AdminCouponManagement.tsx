import React, { useState, useEffect } from 'react'
import { Search, Plus, Edit, Trash2, AlertCircle, CheckCircle, XCircle, Copy, Tag, Percent, DollarSign, Truck } from 'lucide-react'
import api from '../lib/api'
import type { Coupon } from '../types'

interface CouponFormData {
  code: string
  type: 'percentage' | 'fixed' | 'free_shipping'
  value: number
  description: string
  max_uses?: number
  expires_at: string
  min_order_amount: number
  max_discount_amount?: number
  per_user_limit: number
  applies_to: 'usd' | 'itc' | 'both'
}

const defaultFormData: CouponFormData = {
  code: '',
  type: 'percentage',
  value: 10,
  description: '',
  max_uses: undefined,
  expires_at: '',
  min_order_amount: 0,
  max_discount_amount: undefined,
  per_user_limit: 1,
  applies_to: 'usd'
}

export default function AdminCouponManagement() {
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null)
  const [formData, setFormData] = useState<CouponFormData>(defaultFormData)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    fetchCoupons()
  }, [])

  const fetchCoupons = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await api.get('/api/admin/coupons')
      setCoupons(response.data.coupons || [])
    } catch (err: any) {
      console.error('Error fetching coupons:', err)
      setError(err.response?.data?.error || 'Failed to load coupons')
    } finally {
      setLoading(false)
    }
  }

  const openCreateModal = () => {
    setEditingCoupon(null)
    setFormData({
      ...defaultFormData,
      code: generateCode()
    })
    setShowModal(true)
    setError(null)
  }

  const openEditModal = (coupon: Coupon) => {
    setEditingCoupon(coupon)
    setFormData({
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      description: coupon.description || '',
      max_uses: coupon.max_uses,
      expires_at: coupon.expires_at ? coupon.expires_at.split('T')[0] : '',
      min_order_amount: coupon.min_order_amount || 0,
      max_discount_amount: coupon.max_discount_amount,
      per_user_limit: coupon.per_user_limit || 1,
      applies_to: coupon.applies_to || 'usd'
    })
    setShowModal(true)
    setError(null)
  }

  const generateCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    let code = ''
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return code
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setProcessing(true)
    setError(null)

    try {
      if (editingCoupon) {
        await api.put(`/api/admin/coupons/${editingCoupon.id}`, {
          ...formData,
          expires_at: formData.expires_at ? new Date(formData.expires_at).toISOString() : null
        })
        setSuccess('Coupon updated successfully!')
      } else {
        await api.post('/api/admin/coupons', {
          ...formData,
          expires_at: formData.expires_at ? new Date(formData.expires_at).toISOString() : null
        })
        setSuccess('Coupon created successfully!')
      }
      setShowModal(false)
      fetchCoupons()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      console.error('Error saving coupon:', err)
      setError(err.response?.data?.error || 'Failed to save coupon')
    } finally {
      setProcessing(false)
    }
  }

  const handleDelete = async (coupon: Coupon) => {
    if (!confirm(`Are you sure you want to deactivate the coupon "${coupon.code}"?`)) return

    try {
      await api.delete(`/api/admin/coupons/${coupon.id}`)
      setSuccess('Coupon deactivated successfully!')
      fetchCoupons()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      console.error('Error deleting coupon:', err)
      setError(err.response?.data?.error || 'Failed to deactivate coupon')
    }
  }

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    setSuccess(`Copied "${code}" to clipboard!`)
    setTimeout(() => setSuccess(null), 2000)
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'percentage': return <Percent className="w-4 h-4" />
      case 'fixed': return <DollarSign className="w-4 h-4" />
      case 'free_shipping': return <Truck className="w-4 h-4" />
      default: return <Tag className="w-4 h-4" />
    }
  }

  const formatDiscount = (coupon: Coupon) => {
    switch (coupon.type) {
      case 'percentage': return `${coupon.value}% off`
      case 'fixed': return `$${coupon.value.toFixed(2)} off`
      case 'free_shipping': return 'Free Shipping'
      default: return coupon.value
    }
  }

  const isExpired = (coupon: Coupon) => {
    return coupon.expires_at && new Date(coupon.expires_at) < new Date()
  }

  const filteredCoupons = searchQuery
    ? coupons.filter(c =>
        c.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.description?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : coupons

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-display font-bold text-slate-900">Coupon Management</h2>
          <p className="text-slate-500 mt-1">Create and manage discount codes</p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 font-medium transition-colors"
        >
          <Plus className="w-5 h-5" />
          Create Coupon
        </button>
      </div>

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

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search coupons by code or description..."
          className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
        />
      </div>

      {/* Coupons Table */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-soft overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">Code</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">Discount</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">Usage</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">Expires</th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-slate-900">Status</th>
                <th className="px-6 py-4 text-right text-sm font-semibold text-slate-900">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                    <div className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-600"></div>
                      Loading coupons...
                    </div>
                  </td>
                </tr>
              ) : filteredCoupons.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                    No coupons found
                  </td>
                </tr>
              ) : (
                filteredCoupons.map((coupon) => (
                  <tr key={coupon.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-slate-900 bg-slate-100 px-2 py-1 rounded">
                          {coupon.code}
                        </span>
                        <button
                          onClick={() => copyCode(coupon.code)}
                          className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                          title="Copy code"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                      {coupon.description && (
                        <p className="text-sm text-slate-500 mt-1">{coupon.description}</p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className={`p-1.5 rounded-lg ${
                          coupon.type === 'percentage' ? 'bg-blue-100 text-blue-600' :
                          coupon.type === 'fixed' ? 'bg-emerald-100 text-emerald-600' :
                          'bg-purple-100 text-purple-600'
                        }`}>
                          {getTypeIcon(coupon.type)}
                        </span>
                        <span className="font-medium text-slate-900">{formatDiscount(coupon)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-slate-600">
                        {coupon.current_uses} / {coupon.max_uses || '∞'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {coupon.expires_at ? (
                        <span className={isExpired(coupon) ? 'text-red-500' : 'text-slate-600'}>
                          {new Date(coupon.expires_at).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-slate-400">Never</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {!coupon.is_active ? (
                        <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-full">
                          Inactive
                        </span>
                      ) : isExpired(coupon) ? (
                        <span className="px-2.5 py-1 bg-red-100 text-red-700 text-xs font-medium rounded-full">
                          Expired
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEditModal(coupon)}
                          className="p-2 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(coupon)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Deactivate"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-display font-bold text-slate-900 mb-4">
              {editingCoupon ? 'Edit Coupon' : 'Create Coupon'}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Code */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Coupon Code
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-mono uppercase focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                    required
                  />
                  {!editingCoupon && (
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, code: generateCode() })}
                      className="px-4 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-colors"
                    >
                      Generate
                    </button>
                  )}
                </div>
              </div>

              {/* Type */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Discount Type
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['percentage', 'fixed', 'free_shipping'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setFormData({ ...formData, type })}
                      className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border transition-colors ${
                        formData.type === type
                          ? 'bg-purple-100 border-purple-300 text-purple-700'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {getTypeIcon(type)}
                      <span className="text-sm font-medium capitalize">
                        {type === 'free_shipping' ? 'Free Ship' : type}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Value */}
              {formData.type !== 'free_shipping' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {formData.type === 'percentage' ? 'Percentage Off' : 'Amount Off ($)'}
                  </label>
                  <input
                    type="number"
                    value={formData.value}
                    onChange={(e) => setFormData({ ...formData, value: parseFloat(e.target.value) || 0 })}
                    min="0"
                    max={formData.type === 'percentage' ? 100 : undefined}
                    step={formData.type === 'percentage' ? 1 : 0.01}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                    required
                  />
                </div>
              )}

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="e.g., Summer sale discount"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                />
              </div>

              {/* Min Order Amount */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Minimum Order ($)
                </label>
                <input
                  type="number"
                  value={formData.min_order_amount}
                  onChange={(e) => setFormData({ ...formData, min_order_amount: parseFloat(e.target.value) || 0 })}
                  min="0"
                  step="0.01"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                />
              </div>

              {/* Max Discount (for percentage) */}
              {formData.type === 'percentage' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Maximum Discount ($) - Leave empty for no limit
                  </label>
                  <input
                    type="number"
                    value={formData.max_discount_amount || ''}
                    onChange={(e) => setFormData({ ...formData, max_discount_amount: e.target.value ? parseFloat(e.target.value) : undefined })}
                    min="0"
                    step="0.01"
                    placeholder="No limit"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                  />
                </div>
              )}

              {/* Usage Limits */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Max Total Uses
                  </label>
                  <input
                    type="number"
                    value={formData.max_uses || ''}
                    onChange={(e) => setFormData({ ...formData, max_uses: e.target.value ? parseInt(e.target.value) : undefined })}
                    min="0"
                    placeholder="Unlimited"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Per User Limit
                  </label>
                  <input
                    type="number"
                    value={formData.per_user_limit}
                    onChange={(e) => setFormData({ ...formData, per_user_limit: parseInt(e.target.value) || 1 })}
                    min="1"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                  />
                </div>
              </div>

              {/* Expiration */}
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

              {/* Applies To */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Applies To
                </label>
                <select
                  value={formData.applies_to}
                  onChange={(e) => setFormData({ ...formData, applies_to: e.target.value as 'usd' | 'itc' | 'both' })}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 transition-colors"
                >
                  <option value="usd">USD Payments Only</option>
                  <option value="itc">ITC Payments Only</option>
                  <option value="both">Both USD and ITC</option>
                </select>
              </div>

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
                    setShowModal(false)
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
                  {processing ? 'Saving...' : editingCoupon ? 'Update Coupon' : 'Create Coupon'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

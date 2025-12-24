import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import axios from 'axios'

interface MonthlyTrend {
  month: string
  designs: number
  sales: number
  royalties: number
}

interface BestSellingProduct {
  id: string
  name: string
  generated_image: string
  totalSold: number
}

interface AnalyticsData {
  totalDesigns: number
  totalSales: number
  totalRevenue: number
  totalRoyalties: number
  royaltyRate: string
  bestSellingProduct: BestSellingProduct | null
  monthlyTrends: MonthlyTrend[]
  recentDesigns: { id: string; name: string; generated_image: string; status: string }[]
  designsByStatus: {
    approved: number
    pending: number
    rejected: number
  }
}

export const CreatorAnalytics = () => {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAnalytics()
  }, [])

  const fetchAnalytics = async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const { data } = await axios.get('/api/user-products/creator-analytics', {
        headers: { Authorization: `Bearer ${token}` }
      })

      setAnalytics(data)
    } catch (err: any) {
      console.error('Failed to fetch analytics:', err)
      setError(err.response?.data?.error || 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 rounded-xl text-center">
        <p className="text-red-600">{error}</p>
        <button
          onClick={fetchAnalytics}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!analytics) return null

  // Find max for chart scaling
  const maxRoyalty = Math.max(...analytics.monthlyTrends.map(t => t.royalties), 1)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Creator Analytics</h2>
          <p className="text-gray-500">Track your designs and earnings</p>
        </div>
        <button
          onClick={fetchAnalytics}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          title="Refresh"
        >
          <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Designs */}
        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-4 text-white">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">🎨</span>
            <span className="text-sm opacity-80">Designs</span>
          </div>
          <p className="text-3xl font-bold">{analytics.totalDesigns}</p>
          <div className="mt-2 text-xs opacity-80">
            {analytics.designsByStatus.approved} approved
          </div>
        </div>

        {/* Total Sales */}
        <div className="bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl p-4 text-white">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">📦</span>
            <span className="text-sm opacity-80">Sales</span>
          </div>
          <p className="text-3xl font-bold">{analytics.totalSales}</p>
          <div className="mt-2 text-xs opacity-80">
            items sold
          </div>
        </div>

        {/* Total Royalties */}
        <div className="bg-gradient-to-br from-yellow-500 to-orange-500 rounded-xl p-4 text-white">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">💰</span>
            <span className="text-sm opacity-80">Royalties Earned</span>
          </div>
          <p className="text-3xl font-bold">{analytics.totalRoyalties.toLocaleString()}</p>
          <div className="mt-2 text-xs opacity-80">
            ITC ({analytics.royaltyRate} per sale)
          </div>
        </div>

        {/* Revenue Generated */}
        <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl p-4 text-white">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">📈</span>
            <span className="text-sm opacity-80">Revenue</span>
          </div>
          <p className="text-3xl font-bold">${analytics.totalRevenue.toFixed(2)}</p>
          <div className="mt-2 text-xs opacity-80">
            total product value
          </div>
        </div>
      </div>

      {/* Monthly Trend Chart */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h3 className="font-semibold text-gray-800 mb-4">Royalties Earned (Last 6 Months)</h3>
        <div className="h-48 flex items-end gap-2">
          {analytics.monthlyTrends.map((trend, index) => {
            const height = maxRoyalty > 0 ? (trend.royalties / maxRoyalty) * 100 : 0
            return (
              <div key={trend.month} className="flex-1 flex flex-col items-center gap-2">
                <div
                  className={`w-full rounded-t-lg transition-all duration-500 ${
                    trend.royalties > 0
                      ? 'bg-gradient-to-t from-purple-500 to-purple-400'
                      : 'bg-gray-100'
                  }`}
                  style={{ height: `${Math.max(height, 4)}%` }}
                  title={`${trend.royalties} ITC`}
                />
                <span className="text-xs text-gray-500">{trend.month}</span>
              </div>
            )
          })}
        </div>
        <div className="mt-4 flex items-center justify-center gap-6 text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-purple-500 rounded" />
            <span>ITC Earned</span>
          </div>
        </div>
      </div>

      {/* Best Seller & Design Status */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Best Selling Product */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">Best Selling Design</h3>
          {analytics.bestSellingProduct ? (
            <div className="flex gap-4">
              <div className="w-24 h-24 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                <img
                  src={analytics.bestSellingProduct.generated_image}
                  alt={analytics.bestSellingProduct.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-800 line-clamp-2">
                  {analytics.bestSellingProduct.name}
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  {analytics.bestSellingProduct.totalSold} sold
                </p>
                <div className="mt-2 flex items-center gap-1 text-yellow-500">
                  <span>🏆</span>
                  <span className="text-xs font-medium">Top Performer</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-gray-400">
              <span className="text-4xl mb-2 block">🏷️</span>
              <p className="text-sm">No sales yet</p>
              <p className="text-xs mt-1">Keep creating and promoting!</p>
            </div>
          )}
        </div>

        {/* Design Status Breakdown */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">Design Status</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-sm text-gray-600">Approved</span>
              </div>
              <span className="font-medium">{analytics.designsByStatus.approved}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <span className="text-sm text-gray-600">Pending Review</span>
              </div>
              <span className="font-medium">{analytics.designsByStatus.pending}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span className="text-sm text-gray-600">Rejected</span>
              </div>
              <span className="font-medium">{analytics.designsByStatus.rejected}</span>
            </div>
          </div>

          {/* Progress bar */}
          {analytics.totalDesigns > 0 && (
            <div className="mt-4">
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
                <div
                  className="bg-green-500 transition-all"
                  style={{ width: `${(analytics.designsByStatus.approved / analytics.totalDesigns) * 100}%` }}
                />
                <div
                  className="bg-yellow-500 transition-all"
                  style={{ width: `${(analytics.designsByStatus.pending / analytics.totalDesigns) * 100}%` }}
                />
                <div
                  className="bg-red-500 transition-all"
                  style={{ width: `${(analytics.designsByStatus.rejected / analytics.totalDesigns) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Designs */}
      {analytics.recentDesigns.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h3 className="font-semibold text-gray-800 mb-4">Recent Designs</h3>
          <div className="grid grid-cols-5 gap-3">
            {analytics.recentDesigns.map(design => (
              <div key={design.id} className="relative group">
                <div className="aspect-square rounded-lg overflow-hidden bg-gray-100">
                  <img
                    src={design.generated_image}
                    alt={design.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                </div>
                <div className={`absolute top-1 right-1 w-2 h-2 rounded-full ${
                  design.status === 'approved' ? 'bg-green-500' :
                  design.status === 'pending_approval' ? 'bg-yellow-500' :
                  'bg-red-500'
                }`} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Royalty Info Card */}
      <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl p-6 border border-purple-100">
        <div className="flex items-start gap-4">
          <span className="text-3xl">💎</span>
          <div>
            <h3 className="font-semibold text-gray-800">Earn 10% on Every Sale</h3>
            <p className="text-sm text-gray-600 mt-1">
              Every time someone purchases a product with your design, you automatically earn 10% of the sale in ITC credits.
              Use your ITC to pay for products or generate more AI designs!
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default CreatorAnalytics

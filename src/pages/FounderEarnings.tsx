import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { founderEarningsService } from '../utils/founder-earnings'
import type { ProductCOGS } from '../utils/founder-earnings'
import type { FounderEarnings } from '../types'

const FounderEarningsPage: React.FC = () => {
  const { user } = useAuth()
  const [earnings, setEarnings] = useState<FounderEarnings[]>([])
  const [report, setReport] = useState<any>(null)
  const [analytics, setAnalytics] = useState<any>(null)
  const [productCOGS, setProductCOGS] = useState<ProductCOGS[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedTab, setSelectedTab] = useState<'overview' | 'earnings' | 'cogs' | 'analytics'>('overview')
  const [selectedPeriod, setSelectedPeriod] = useState<'week' | 'month' | 'quarter' | 'year'>('month')
  const [filter, setFilter] = useState<'all' | 'pending' | 'calculated' | 'paid'>('all')
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    if (user && (user.role === 'founder' || user.role === 'admin')) {
      loadData()
    }
  }, [user, selectedPeriod])

  const loadData = async () => {
    if (!user) return
    
    try {
      setIsLoading(true)
      
      // Calculate period dates
      const endDate = new Date()
      const startDate = new Date()
      
      switch (selectedPeriod) {
        case 'week':
          startDate.setDate(endDate.getDate() - 7)
          break
        case 'month':
          startDate.setMonth(endDate.getMonth() - 1)
          break
        case 'quarter':
          startDate.setMonth(endDate.getMonth() - 3)
          break
        case 'year':
          startDate.setFullYear(endDate.getFullYear() - 1)
          break
      }

      // Load all data in parallel
      const [earningsData, reportData, analyticsData, cogsData] = await Promise.all([
        founderEarningsService.getFounderEarnings(user.id),
        founderEarningsService.generateEarningsReport(user.id, {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          type: selectedPeriod === 'quarter' ? 'quarterly' : selectedPeriod === 'year' ? 'yearly' : 'monthly'
        }),
        founderEarningsService.getEarningsAnalytics(user.id, selectedPeriod),
        founderEarningsService.getProductCOGS()
      ])

      setEarnings(earningsData)
      setReport(reportData)
      setAnalytics(analyticsData)
      setProductCOGS(cogsData)
    } catch (error) {
      console.error('Error loading earnings data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const processPayout = async () => {
    if (!user) return
    
    try {
      setIsProcessing(true)
      await founderEarningsService.processFounderPayout(user.id)
      
      // Reload data
      await loadData()
      
      alert('Payout processed successfully!')
    } catch (error) {
      console.error('Error processing payout:', error)
      alert('Failed to process payout. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  const updateCOGS = async (productId: string, newCOGS: Partial<ProductCOGS>) => {
    try {
      await founderEarningsService.updateProductCOGS(productId, newCOGS)
      
      // Update local state
      setProductCOGS(prev => 
        prev.map(cogs => 
          cogs.productId === productId 
            ? { ...cogs, ...newCOGS }
            : cogs
        )
      )
      
      alert('COGS updated successfully!')
    } catch (error) {
      console.error('Error updating COGS:', error)
      alert('Failed to update COGS. Please try again.')
    }
  }

  const filteredEarnings = earnings.filter(earning => 
    filter === 'all' || earning.status === filter
  )

  const pendingEarnings = earnings
    .filter(e => e.status === 'calculated')
    .reduce((sum, e) => sum + e.founderEarnings, 0)

  if (!user || (user.role !== 'founder' && user.role !== 'admin')) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Access denied. Founder access required.</p>
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-text">Founder Earnings</h1>
            <p className="text-muted">Track your 35% profit share from internal product sales</p>
          </div>
          <div className="flex items-center space-x-3">
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value as any)}
              className="form-select"
            >
              <option value="week">Last Week</option>
              <option value="month">Last Month</option>
              <option value="quarter">Last Quarter</option>
              <option value="year">Last Year</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b card-border mb-6">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'overview', label: 'Overview', icon: '📊' },
            { id: 'earnings', label: 'Earnings', icon: '💰' },
            { id: 'cogs', label: 'Cost Management', icon: '📋' },
            { id: 'analytics', label: 'Analytics', icon: '📈' }
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
      {selectedTab === 'overview' && report && (
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
                  <p className="text-sm font-medium text-muted">Total Revenue</p>
                  <p className="text-2xl font-semibold text-text">
                    {founderEarningsService.formatCurrency(report.totalRevenue)}
                  </p>
                  {analytics?.trends && (
                    <p className="text-sm text-green-600">
                      +{analytics.trends.revenueGrowth}% growth
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted">Gross Profit</p>
                  <p className="text-2xl font-semibold text-text">
                    {founderEarningsService.formatCurrency(report.grossProfit)}
                  </p>
                  <p className="text-sm text-muted">
                    {founderEarningsService.formatPercentage(report.averageMargin)} margin
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted">Founder Earnings</p>
                  <p className="text-2xl font-semibold text-text">
                    {founderEarningsService.formatCurrency(report.founderEarnings)}
                  </p>
                  <p className="text-sm text-muted">35% of profit</p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted">Pending Payout</p>
                  <p className="text-2xl font-semibold text-text">
                    {founderEarningsService.formatCurrency(pendingEarnings)}
                  </p>
                  <p className="text-sm text-muted">Ready for withdrawal</p>
                </div>
              </div>
            </div>
          </div>

          {/* Top Products */}
          <div className="bg-card rounded-lg shadow">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">Top Performing Products</h3>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {report.topProducts.map((product: any, index: number) => (
                  <div key={product.productId} className="flex items-center justify-between p-4 bg-card rounded-lg">
                    <div className="flex items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold ${
                        index === 0 ? 'bg-yellow-500' : index === 1 ? 'bg-gray-400' : 'bg-orange-500'
                      }`}>
                        {index + 1}
                      </div>
                      <div className="ml-4">
                        <p className="font-medium text-text">{product.productName}</p>
                        <p className="text-sm text-muted">{product.units} units sold</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-text">
                        {founderEarningsService.formatCurrency(product.revenue)}
                      </p>
                      <p className="text-sm text-green-600">
                        {founderEarningsService.formatCurrency(product.profit)} profit
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Category Breakdown */}
          <div className="bg-card rounded-lg shadow">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">Revenue by Category</h3>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {report.categoryBreakdown.map((category: any) => (
                  <div key={category.category} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-text capitalize">{category.category}</p>
                      <p className="text-sm text-muted">
                        {founderEarningsService.formatPercentage(category.margin)} margin
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-text">
                        {founderEarningsService.formatCurrency(category.revenue)}
                      </p>
                      <p className="text-sm text-green-600">
                        {founderEarningsService.formatCurrency(category.profit)} profit
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-card rounded-lg shadow p-6">
              <h3 className="text-lg font-medium text-text mb-4">Request Payout</h3>
              <p className="text-muted mb-4">
                Withdraw your pending founder earnings to your bank account.
              </p>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-muted">Available:</span>
                <span className="font-medium text-green-600">
                  {founderEarningsService.formatCurrency(pendingEarnings)}
                </span>
              </div>
              <button
                onClick={processPayout}
                disabled={pendingEarnings <= 0 || isProcessing}
                className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? 'Processing...' : 'Request Payout'}
              </button>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <h3 className="text-lg font-medium text-text mb-4">Earnings Forecast</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted">Monthly Projection</span>
                  <span className="font-medium">
                    {analytics?.projections && founderEarningsService.formatCurrency(analytics.projections.monthlyRecurring)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Annual Projection</span>
                  <span className="font-medium">
                    {analytics?.projections && founderEarningsService.formatCurrency(analytics.projections.annualProjection)}
                  </span>
                </div>
                <div className="flex justify-between border-t pt-3">
                  <span className="font-medium text-text">Growth Rate</span>
                  <span className="font-medium text-green-600">
                    {analytics?.trends && `+${analytics.trends.profitGrowth}%`}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Earnings Tab */}
      {selectedTab === 'earnings' && (
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
                  <option value="all">All Earnings ({earnings.length})</option>
                  <option value="pending">Pending ({earnings.filter(e => e.status === 'pending').length})</option>
                  <option value="calculated">Calculated ({earnings.filter(e => e.status === 'calculated').length})</option>
                  <option value="paid">Paid ({earnings.filter(e => e.status === 'paid').length})</option>
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

          {/* Earnings Table */}
          <div className="bg-card rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">Earnings History</h3>
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
                      COGS
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Gross Profit
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Founder Share (35%)
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
                  {filteredEarnings.map((earning) => (
                    <tr key={earning.id} className="hover:bg-card">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-text">
                        {earning.orderId}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                        {founderEarningsService.formatCurrency(earning.saleAmount)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                        {founderEarningsService.formatCurrency(earning.costOfGoods)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                        {founderEarningsService.formatCurrency(earning.grossProfit)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                        {founderEarningsService.formatCurrency(earning.founderEarnings)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          earning.status === 'paid' ? 'bg-green-100 text-green-800' :
                          earning.status === 'calculated' ? 'bg-blue-100 text-blue-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {earning.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {new Date(earning.calculatedAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* COGS Tab */}
      {selectedTab === 'cogs' && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg shadow">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">Cost of Goods Sold (COGS) Management</h3>
              <p className="text-sm text-muted">Manage product costs to optimize profit margins</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-card">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Product
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Material Cost
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Labor Cost
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Overhead
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Total COGS
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Margin %
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-card divide-y divide-gray-200">
                  {productCOGS.map((cogs) => (
                    <tr key={cogs.productId} className="hover:bg-card">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <p className="text-sm font-medium text-text">{cogs.productName}</p>
                          <p className="text-sm text-muted capitalize">{cogs.category}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                        {founderEarningsService.formatCurrency(cogs.materialCost)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                        {founderEarningsService.formatCurrency(cogs.laborCost)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                        {founderEarningsService.formatCurrency(cogs.overheadCost)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-text">
                        {founderEarningsService.formatCurrency(cogs.totalCOGS)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`text-sm font-medium ${
                          cogs.marginPercentage >= 40 ? 'text-green-600' :
                          cogs.marginPercentage >= 30 ? 'text-yellow-600' :
                          'text-red-600'
                        }`}>
                          {founderEarningsService.formatPercentage(cogs.marginPercentage)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button
                          onClick={() => {
                            const newCOGS = prompt('Enter new total COGS:', cogs.totalCOGS.toString())
                            if (newCOGS && !isNaN(parseFloat(newCOGS))) {
                              updateCOGS(cogs.productId, { totalCOGS: parseFloat(newCOGS) })
                            }
                          }}
                          className="text-purple-600 hover:text-purple-900"
                        >
                          Edit
                        </button>
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
            <h3 className="text-lg font-medium text-text mb-4">Earnings Analytics</h3>
            <p className="text-muted">
              Advanced analytics features will be implemented here, including:
            </p>
            <ul className="mt-4 space-y-2 text-muted">
              <li>• Revenue and profit trend charts</li>
              <li>• Product performance analysis</li>
              <li>• Margin optimization insights</li>
              <li>• Seasonal trends and forecasting</li>
              <li>• Cost optimization recommendations</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

export default FounderEarningsPage
import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { kioskService } from '../utils/kiosk-service'
import type { Kiosk, KioskAnalytics, KioskOrder } from '../types'

const KioskAnalyticsPage: React.FC = () => {
  const { user } = useAuth()
  const [kiosks, setKiosks] = useState<Kiosk[]>([])
  const [selectedKiosk, setSelectedKiosk] = useState<string>('all')
  const [selectedPeriod, setSelectedPeriod] = useState<string>('week')
  const [analytics, setAnalytics] = useState<KioskAnalytics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [recentOrders, setRecentOrders] = useState<KioskOrder[]>([])

  // Summary data for all kiosks
  const [summaryData, setSummaryData] = useState({
    totalSales: 0,
    totalOrders: 0,
    averageOrderValue: 0,
    activeKiosks: 0,
    topPerformingKiosk: '',
    totalCommissions: {
      platform: 0,
      vendor: 0,
      partner: 0
    }
  })

  useEffect(() => {
    if (user && (user.role === 'admin' || user.role === 'founder' || user.role === 'vendor')) {
      loadData()
    }
  }, [user, selectedKiosk, selectedPeriod])

  const loadData = async () => {
    try {
      setIsLoading(true)
      
      // Load kiosks list
      const kiosksData = await kioskService.getAllKiosks()
      setKiosks(kiosksData)

      // If vendor, filter to their kiosks only
      const filteredKiosks = user?.role === 'vendor' 
        ? kiosksData.filter(k => k.vendorId === user.id)
        : kiosksData

      // Load analytics for selected kiosk or all kiosks
      if (selectedKiosk === 'all') {
        // Calculate summary data for all kiosks
        const summary = calculateSummaryData(filteredKiosks)
        setSummaryData(summary)
        
        // For "all kiosks" view, create aggregated analytics
        const aggregatedAnalytics = await createAggregatedAnalytics(filteredKiosks, selectedPeriod)
        setAnalytics(aggregatedAnalytics)
      } else {
        // Load specific kiosk analytics
        const kioskAnalytics = await kioskService.getKioskAnalytics(selectedKiosk, selectedPeriod)
        setAnalytics(kioskAnalytics)
      }

      // Load recent orders (mock data)
      setRecentOrders(await loadRecentOrders(selectedKiosk))

    } catch (error) {
      console.error('Error loading analytics data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const calculateSummaryData = (kiosksData: Kiosk[]) => {
    const totalSales = kiosksData.reduce((sum, k) => sum + k.totalSales, 0)
    const totalOrders = kiosksData.reduce((sum, k) => sum + k.totalOrders, 0)
    const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0
    const activeKiosks = kiosksData.filter(k => k.isActive).length
    
    const topKiosk = kiosksData.reduce((top, current) => 
      current.totalSales > top.totalSales ? current : top, 
      kiosksData[0] || { totalSales: 0, name: 'None' }
    )

    // Calculate commission breakdown
    const platformCommission = totalSales * 0.07 // 7% platform fee
    const vendorCommission = totalSales * 0.78 // Remaining to vendor after fees
    const partnerCommission = totalSales * 0.15 // 15% to partners

    return {
      totalSales,
      totalOrders,
      averageOrderValue,
      activeKiosks,
      topPerformingKiosk: topKiosk.name,
      totalCommissions: {
        platform: platformCommission,
        vendor: vendorCommission,
        partner: partnerCommission
      }
    }
  }

  const createAggregatedAnalytics = async (kiosksData: Kiosk[], period: string): Promise<KioskAnalytics> => {
    // Mock aggregated analytics for all kiosks
    const totalSales = kiosksData.reduce((sum, k) => sum + k.totalSales, 0)
    const totalOrders = kiosksData.reduce((sum, k) => sum + k.totalOrders, 0)

    return {
      kioskId: 'all',
      period: `Last ${period}`,
      totalSales,
      totalOrders,
      averageOrderValue: totalOrders > 0 ? totalSales / totalOrders : 0,
      paymentMethodBreakdown: {
        card: { count: Math.floor(totalOrders * 0.7), amount: totalSales * 0.75 },
        cash: { count: Math.floor(totalOrders * 0.2), amount: totalSales * 0.15 },
        itcWallet: { count: Math.floor(totalOrders * 0.1), amount: totalSales * 0.1 }
      },
      hourlyBreakdown: [
        { hour: 9, sales: totalSales * 0.08, orders: Math.floor(totalOrders * 0.08) },
        { hour: 10, sales: totalSales * 0.12, orders: Math.floor(totalOrders * 0.12) },
        { hour: 11, sales: totalSales * 0.15, orders: Math.floor(totalOrders * 0.15) },
        { hour: 12, sales: totalSales * 0.18, orders: Math.floor(totalOrders * 0.18) },
        { hour: 13, sales: totalSales * 0.16, orders: Math.floor(totalOrders * 0.16) },
        { hour: 14, sales: totalSales * 0.12, orders: Math.floor(totalOrders * 0.12) },
        { hour: 15, sales: totalSales * 0.11, orders: Math.floor(totalOrders * 0.11) },
        { hour: 16, sales: totalSales * 0.08, orders: Math.floor(totalOrders * 0.08) }
      ],
      topProducts: [
        { productId: 'product_1', productName: 'Custom T-Shirt', quantity: Math.floor(totalOrders * 0.3), revenue: totalSales * 0.35 },
        { productId: 'product_3', productName: 'Custom Tumbler', quantity: Math.floor(totalOrders * 0.25), revenue: totalSales * 0.28 },
        { productId: 'product_2', productName: 'DTF Transfer', quantity: Math.floor(totalOrders * 0.2), revenue: totalSales * 0.22 },
        { productId: 'product_4', productName: 'Premium Hoodie', quantity: Math.floor(totalOrders * 0.15), revenue: totalSales * 0.15 }
      ],
      commission: {
        vendorEarnings: totalSales * 0.78,
        platformFees: totalSales * 0.07,
        partnerCommission: totalSales * 0.15
      }
    }
  }

  const loadRecentOrders = async (kioskId: string): Promise<KioskOrder[]> => {
    // Mock recent orders data
    const mockOrders: KioskOrder[] = [
      {
        id: 'order_1',
        kioskId: kioskId === 'all' ? 'kiosk_1' : kioskId,
        vendorId: 'vendor_123',
        items: [],
        total: 89.97,
        paymentMethod: 'card',
        paymentStatus: 'completed',
        customerName: 'John Doe',
        commission: {
          vendorAmount: 70.18,
          platformFee: 6.30,
          partnerCommission: 13.49
        },
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        completedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 'order_2',
        kioskId: kioskId === 'all' ? 'kiosk_2' : kioskId,
        vendorId: 'vendor_456',
        items: [],
        total: 45.98,
        paymentMethod: 'cash',
        paymentStatus: 'completed',
        customerEmail: 'customer@example.com',
        commission: {
          vendorAmount: 35.86,
          platformFee: 3.22,
          partnerCommission: 6.90
        },
        createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
        completedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 'order_3',
        kioskId: kioskId === 'all' ? 'kiosk_1' : kioskId,
        vendorId: 'vendor_123',
        items: [],
        total: 24.99,
        paymentMethod: 'itc_wallet',
        paymentStatus: 'completed',
        customerEmail: 'itc.user@example.com',
        commission: {
          vendorAmount: 19.49,
          platformFee: 1.75,
          partnerCommission: 3.75
        },
        createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
        completedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
      }
    ]

    return mockOrders
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount)
  }

  const getPaymentMethodColor = (method: string) => {
    switch (method) {
      case 'card': return 'text-blue-600 bg-blue-100'
      case 'cash': return 'text-green-600 bg-green-100'
      case 'itc_wallet': return 'text-purple-600 bg-purple-100'
      default: return 'text-gray-600 bg-gray-100'
    }
  }

  const getKioskName = (kioskId: string) => {
    const kiosk = kiosks.find(k => k.id === kioskId)
    return kiosk ? kiosk.name : kioskId
  }

  if (!user || (user.role !== 'admin' && user.role !== 'founder' && user.role !== 'vendor')) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Access denied. Admin, Founder, or Vendor access required.</p>
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
        <h1 className="text-3xl font-bold text-gray-900">Kiosk Analytics</h1>
        <p className="text-gray-600">Track kiosk performance and revenue sharing</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Kiosk</label>
              <select
                value={selectedKiosk}
                onChange={(e) => setSelectedKiosk(e.target.value)}
                className="form-select"
              >
                <option value="all">All Kiosks</option>
                {kiosks
                  .filter(k => user.role !== 'vendor' || k.vendorId === user.id)
                  .map(kiosk => (
                    <option key={kiosk.id} value={kiosk.id}>
                      {kiosk.name}
                    </option>
                  ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Period</label>
              <select
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                className="form-select"
              >
                <option value="day">Last 24 Hours</option>
                <option value="week">Last Week</option>
                <option value="month">Last Month</option>
                <option value="quarter">Last Quarter</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Sales</p>
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(analytics?.totalSales || summaryData.totalSales)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M8 11v6h8v-6M8 11H6a2 2 0 00-2 2v6a2 2 0 002 2h12a2 2 0 002-2v-6a2 2 0 00-2-2h-2" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Orders</p>
              <p className="text-2xl font-bold text-gray-900">
                {analytics?.totalOrders || summaryData.totalOrders}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Avg Order Value</p>
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(analytics?.averageOrderValue || summaryData.averageOrderValue)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Active Kiosks</p>
              <p className="text-2xl font-bold text-gray-900">{summaryData.activeKiosks}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Analytics Charts and Data */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Payment Methods Breakdown */}
        {analytics && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Payment Methods</h3>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {Object.entries(analytics.paymentMethodBreakdown).map(([method, data]) => (
                  <div key={method} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span className={`px-2 py-1 text-xs rounded-full ${getPaymentMethodColor(method)} capitalize`}>
                        {method.replace('_', ' ')}
                      </span>
                      <span className="ml-3 text-sm font-medium text-gray-900">
                        {data.count} orders
                      </span>
                    </div>
                    <span className="text-sm font-bold text-gray-900">
                      {formatCurrency(data.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Hourly Performance */}
        {analytics && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Hourly Performance</h3>
            </div>
            <div className="p-6">
              <div className="space-y-3">
                {analytics.hourlyBreakdown.map((hour) => (
                  <div key={hour.hour} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-gray-600 w-16">
                        {hour.hour}:00
                      </span>
                      <div className="ml-3">
                        <div className="w-32 bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-purple-600 h-2 rounded-full"
                            style={{ 
                              width: `${(hour.sales / Math.max(...analytics.hourlyBreakdown.map(h => h.sales))) * 100}%` 
                            }}
                          ></div>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900">{formatCurrency(hour.sales)}</p>
                      <p className="text-xs text-gray-600">{hour.orders} orders</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Top Products and Revenue Share */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Top Products */}
        {analytics && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Top Products</h3>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                {analytics.topProducts.map((product, index) => (
                  <div key={product.productId} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span className="w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-xs font-medium">
                        {index + 1}
                      </span>
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-900">{product.productName}</p>
                        <p className="text-xs text-gray-600">{product.quantity} sold</p>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-gray-900">
                      {formatCurrency(product.revenue)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Commission Breakdown */}
        {analytics && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Revenue Share</h3>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-blue-900">Vendor Earnings</p>
                    <p className="text-xs text-blue-600">After platform and partner fees</p>
                  </div>
                  <span className="text-lg font-bold text-blue-900">
                    {formatCurrency(analytics.commission.vendorEarnings)}
                  </span>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-purple-900">Platform Fees</p>
                    <p className="text-xs text-purple-600">7% platform commission</p>
                  </div>
                  <span className="text-lg font-bold text-purple-900">
                    {formatCurrency(analytics.commission.platformFees)}
                  </span>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-green-900">Partner Commission</p>
                    <p className="text-xs text-green-600">Location partner share</p>
                  </div>
                  <span className="text-lg font-bold text-green-900">
                    {formatCurrency(analytics.commission.partnerCommission)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Recent Orders */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">Recent Orders</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Order ID
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Kiosk
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Customer
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Payment
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Time
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {recentOrders.map((order) => (
                <tr key={order.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {order.id}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {getKioskName(order.kioskId)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {order.customerName || order.customerEmail || 'Guest'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs rounded-full ${getPaymentMethodColor(order.paymentMethod)} capitalize`}>
                      {order.paymentMethod.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {formatCurrency(order.total)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {new Date(order.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default KioskAnalyticsPage
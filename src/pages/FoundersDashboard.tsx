import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import type { Order, Invoice } from '../types'

const FoundersDashboard: React.FC = () => {
  const { user } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [selectedTab, setSelectedTab] = useState<'orders' | 'invoices' | 'earnings'>('orders')
  const [monthlyEarnings, setMonthlyEarnings] = useState(0)

  // Mock data - replace with real Supabase queries
  useEffect(() => {
    const mockOrders: Order[] = [
      {
        id: '1',
        userId: 'customer1',
        items: [
          {
            id: 'item1',
            product: {
              id: 'prod1',
              name: 'Custom T-Shirt',
              description: 'Custom design on premium cotton',
              price: 24.99,
              images: ['https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=200&h=200&fit=crop'],
              category: 'shirts',
              inStock: true
            },
            quantity: 2
          }
        ],
        total: 49.98,
        status: 'pending',
        createdAt: '2025-01-10T10:00:00Z',
        materialCost: 12.50,
        profitMargin: 35,
        assignedTo: user?.id
      },
      {
        id: '2',
        userId: 'customer2',
        items: [
          {
            id: 'item2',
            product: {
              id: 'prod2',
              name: 'Custom Tumbler',
              description: 'Insulated steel tumbler',
              price: 29.99,
              images: ['https://images.unsplash.com/photo-1544441892-794166f1e3be?w=200&h=200&fit=crop'],
              category: 'tumblers',
              inStock: true
            },
            quantity: 1
          }
        ],
        total: 29.99,
        status: 'processing',
        createdAt: '2025-01-09T14:30:00Z',
        materialCost: 8.75,
        profitMargin: 35,
        assignedTo: user?.id
      }
    ]
    setOrders(mockOrders)

    const mockInvoices: Invoice[] = [
      {
        id: 'inv1',
        orderId: '2',
        founderId: user?.id || '',
        amount: 29.99,
        profitShare: 7.44,
        status: 'pending',
        createdAt: '2025-01-09T14:30:00Z'
      }
    ]
    setInvoices(mockInvoices)

    setMonthlyEarnings(145.67)
  }, [user?.id])

  const calculateProfit = (order: Order): number => {
    const profit = order.total - (order.materialCost || 0)
    return profit * ((order.profitMargin || 35) / 100)
  }

  const generateStripeInvoice = async (orderId: string) => {
    // In real app, call Stripe API to create invoice
    alert(`Stripe invoice generated for order ${orderId}`)
    
    // Update invoice status
    setInvoices(prev => prev.map(inv => 
      inv.orderId === orderId 
        ? { ...inv, status: 'paid' as const, stripeInvoiceId: `inv_${Date.now()}` }
        : inv
    ))
  }

  if (user?.role !== 'founder') {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Access denied. This page is for founders only.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Founders Dashboard</h1>
        <p className="text-gray-600">Manage your assigned orders and track earnings</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Assigned Orders</p>
              <p className="text-2xl font-semibold text-gray-900">{orders.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Monthly Earnings</p>
              <p className="text-2xl font-semibold text-gray-900">${monthlyEarnings.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Pending Invoices</p>
              <p className="text-2xl font-semibold text-gray-900">{invoices.filter(inv => inv.status === 'pending').length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Profit Margin</p>
              <p className="text-2xl font-semibold text-gray-900">35%</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {['orders', 'invoices', 'earnings'].map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                selectedTab === tab
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {/* Orders Tab */}
      {selectedTab === 'orders' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Assigned Orders</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Order ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Items</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Sale Price</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Material Cost</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Your Share (35%)</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">#{order.id}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {order.items.map(item => item.product.name).join(', ')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-semibold">${order.total.toFixed(2)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">${(order.materialCost || 0).toFixed(2)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-semibold">${calculateProfit(order).toFixed(2)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        order.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                        order.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                        order.status === 'shipped' ? 'bg-green-100 text-green-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <button
                        onClick={() => generateStripeInvoice(order.id)}
                        className="text-purple-600 hover:text-purple-900 mr-3"
                      >
                        Generate Invoice
                      </button>
                      <button className="text-blue-600 hover:text-blue-900">
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invoices Tab */}
      {selectedTab === 'invoices' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Payment Invoices</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Order ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Your Share</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">#{invoice.id}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">#{invoice.orderId}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${invoice.amount.toFixed(2)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-semibold">${invoice.profitShare.toFixed(2)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        invoice.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'
                      }`}>
                        {invoice.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(invoice.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Earnings Tab */}
      {selectedTab === 'earnings' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-6">Monthly Earnings Report</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gradient-to-r from-green-400 to-blue-500 rounded-lg p-6 text-white">
              <h4 className="text-lg font-semibold mb-2">This Month</h4>
              <p className="text-3xl font-bold">${monthlyEarnings.toFixed(2)}</p>
              <p className="text-sm opacity-90">+12% from last month</p>
            </div>
            
            <div className="bg-gradient-to-r from-purple-400 to-pink-500 rounded-lg p-6 text-white">
              <h4 className="text-lg font-semibold mb-2">Orders Completed</h4>
              <p className="text-3xl font-bold">{orders.filter(o => o.status === 'shipped').length}</p>
              <p className="text-sm opacity-90">Out of {orders.length} assigned</p>
            </div>
          </div>

          <div className="mt-8">
            <h4 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h4>
            <div className="space-y-4">
              {orders.slice(0, 3).map((order) => (
                <div key={order.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">Order #{order.id}</p>
                    <p className="text-sm text-gray-600">{order.items[0]?.product.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-green-600">+${calculateProfit(order).toFixed(2)}</p>
                    <p className="text-sm text-gray-500">{new Date(order.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default FoundersDashboard
import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/SupabaseAuthContext'
import { apiFetch } from '../lib/api'
import { Package, ChevronRight, Clock, CheckCircle, Truck, AlertCircle, XCircle } from 'lucide-react'

interface OrderItem {
  id: string
  product_name: string
  quantity: number
  price: number
  total: number
  variations?: any
  personalization?: any
}

interface Order {
  id: string
  order_number: string
  status: string
  payment_status: string
  fulfillment_status: string
  total: number
  subtotal: number
  tax_amount: number
  shipping_amount: number
  tracking_number: string | null
  created_at: string
  order_items: OrderItem[]
}

const statusConfig: Record<string, { icon: React.ReactNode; color: string; bgColor: string; label: string }> = {
  pending: {
    icon: <Clock className="w-4 h-4" />,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
    label: 'Pending'
  },
  processing: {
    icon: <Package className="w-4 h-4" />,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    label: 'Processing'
  },
  shipped: {
    icon: <Truck className="w-4 h-4" />,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    label: 'Shipped'
  },
  delivered: {
    icon: <CheckCircle className="w-4 h-4" />,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    label: 'Delivered'
  },
  on_hold: {
    icon: <AlertCircle className="w-4 h-4" />,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    label: 'On Hold'
  },
  cancelled: {
    icon: <XCircle className="w-4 h-4" />,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    label: 'Cancelled'
  }
}

export default function MyOrders() {
  const { user } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchMyOrders()
  }, [user])

  const fetchMyOrders = async () => {
    if (!user) return

    setIsLoading(true)
    setError(null)

    try {
      // Fetch orders for the current user
      const result = await apiFetch('/api/orders/my')
      const data = result?.orders || []

      setOrders(data)
    } catch (err: any) {
      console.error('Failed to fetch orders:', err)
      setError(err.message || 'Failed to load orders')
    } finally {
      setIsLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount)
  }

  const getStatusConfig = (status: string) => {
    return statusConfig[status] || statusConfig.pending
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 py-8 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Sign in to view your orders</h2>
          <p className="text-gray-500 mb-6">Track your orders, view order history, and more.</p>
          <Link
            to="/login"
            className="inline-flex items-center px-6 py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 transition-colors"
          >
            Sign In
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">My Orders</h1>
          <p className="text-gray-500">Track and manage your orders</p>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <p className="text-red-600">{error}</p>
            <button
              onClick={fetchMyOrders}
              className="mt-2 text-sm text-red-700 underline hover:no-underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && orders.length === 0 && (
          <div className="text-center py-12 bg-white rounded-2xl shadow-sm border border-gray-100">
            <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-800 mb-2">No orders yet</h2>
            <p className="text-gray-500 mb-6">When you place an order, it will appear here.</p>
            <Link
              to="/catalog"
              className="inline-flex items-center px-6 py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 transition-colors"
            >
              Start Shopping
            </Link>
          </div>
        )}

        {/* Orders List */}
        {!isLoading && orders.length > 0 && (
          <div className="space-y-4">
            {orders.map((order) => {
              const status = getStatusConfig(order.status)
              return (
                <div
                  key={order.id}
                  className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow"
                >
                  {/* Order Header */}
                  <div className="p-4 sm:p-6 border-b border-gray-100">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-sm text-gray-500 mb-1">Order #{order.order_number}</p>
                        <p className="text-sm text-gray-400">{formatDate(order.created_at)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${status.bgColor} ${status.color}`}>
                          {status.icon}
                          {status.label}
                        </span>
                        <span className="text-lg font-semibold text-gray-900">
                          {formatCurrency(order.total)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Order Items */}
                  <div className="p-4 sm:p-6">
                    <div className="space-y-3">
                      {order.order_items.slice(0, 3).map((item) => (
                        <div key={item.id} className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                              <Package className="w-6 h-6 text-gray-400" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-900">{item.product_name}</p>
                              <p className="text-sm text-gray-500">Qty: {item.quantity}</p>
                            </div>
                          </div>
                          <p className="text-sm font-medium text-gray-900">{formatCurrency(item.total)}</p>
                        </div>
                      ))}
                      {order.order_items.length > 3 && (
                        <p className="text-sm text-gray-500">
                          +{order.order_items.length - 3} more item(s)
                        </p>
                      )}
                    </div>

                    {/* Tracking Info */}
                    {order.tracking_number && (
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <p className="text-sm text-gray-500">
                          Tracking: <span className="font-medium text-gray-900">{order.tracking_number}</span>
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Order Footer */}
                  <div className="px-4 sm:px-6 py-3 bg-gray-50 flex items-center justify-between">
                    <div className="text-sm text-gray-500">
                      <span className="font-medium">{order.order_items.length}</span> item(s)
                    </div>
                    <button className="inline-flex items-center gap-1 text-sm font-medium text-purple-600 hover:text-purple-700">
                      View Details
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

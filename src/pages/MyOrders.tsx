import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/SupabaseAuthContext'
import { apiFetch } from '../lib/api'
import { Package, ChevronRight, Clock, CheckCircle, Truck, AlertCircle, XCircle } from 'lucide-react'

interface OrderItem {
  id: string
  product_id?: string
  product_name: string
  quantity: number
  price: number
  total: number
  image_url?: string
  variations?: { size?: string; color?: string }
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
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null)

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

      // Show all orders (users should see pending orders to complete payment)
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
          <div className="space-y-6">
            {orders.map((order) => {
              const status = getStatusConfig(order.status)
              const isExpanded = expandedOrderId === order.id
              return (
                <div
                  key={order.id}
                  className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden hover:shadow-soft-lg transition-shadow"
                >
                  {/* Order Header */}
                  <div className="p-5 sm:p-6 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-display font-bold text-slate-900">
                            Order #{order.order_number || order.id.slice(0, 8).toUpperCase()}
                          </h3>
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${status.bgColor} ${status.color}`}>
                            {status.icon}
                            {status.label}
                          </span>
                        </div>
                        <p className="text-sm text-slate-500">
                          {new Date(order.created_at).toLocaleDateString('en-US', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit'
                          })}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-display font-bold text-slate-900">
                          {formatCurrency(order.total)}
                        </p>
                        {order.payment_status === 'paid' && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 mt-1">
                            <CheckCircle className="w-3.5 h-3.5" />
                            Payment confirmed
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Order Items Preview */}
                  <div className="p-5 sm:p-6">
                    <div className="space-y-4">
                      {(isExpanded ? order.order_items : order.order_items.slice(0, 2)).map((item, idx) => (
                        <div key={item.id || idx} className="flex items-center gap-4 p-3 rounded-xl bg-slate-50/50 hover:bg-slate-50 transition-colors">
                          {/* Product Image */}
                          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0">
                            {item.image_url ? (
                              <img
                                src={item.image_url}
                                alt={item.product_name}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement
                                  target.style.display = 'none'
                                  target.parentElement!.innerHTML = '<div class="w-full h-full flex items-center justify-center"><svg class="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg></div>'
                                }}
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Package className="w-8 h-8 text-slate-300" />
                              </div>
                            )}
                          </div>

                          {/* Product Details */}
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-900 truncate">{item.product_name}</p>
                            <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                              <span>Qty: {item.quantity}</span>
                              {item.variations?.size && (
                                <span className="px-2 py-0.5 bg-white rounded text-xs font-medium border border-slate-200">
                                  {item.variations.size}
                                </span>
                              )}
                              {item.variations?.color && (
                                <span
                                  className="w-5 h-5 rounded-full border-2 border-white shadow-sm"
                                  style={{ backgroundColor: item.variations.color }}
                                  title={item.variations.color}
                                />
                              )}
                            </div>
                          </div>

                          {/* Price */}
                          <div className="text-right flex-shrink-0">
                            <p className="font-semibold text-slate-900">{formatCurrency(item.total || item.price * item.quantity)}</p>
                            {item.quantity > 1 && (
                              <p className="text-xs text-slate-400">{formatCurrency(item.price)} each</p>
                            )}
                          </div>
                        </div>
                      ))}

                      {order.order_items.length > 2 && !isExpanded && (
                        <button
                          onClick={() => setExpandedOrderId(order.id)}
                          className="w-full py-2 text-sm font-medium text-purple-600 hover:text-purple-700 hover:bg-purple-50 rounded-lg transition-colors"
                        >
                          Show {order.order_items.length - 2} more item(s)
                        </button>
                      )}
                    </div>

                    {/* Expanded Order Details */}
                    {isExpanded && (
                      <div className="mt-6 pt-6 border-t border-slate-100 space-y-4">
                        {/* Order Summary */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                          <div className="bg-slate-50 rounded-xl p-4">
                            <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Subtotal</p>
                            <p className="font-semibold text-slate-900">{formatCurrency(order.subtotal || order.total)}</p>
                          </div>
                          {order.shipping_amount > 0 && (
                            <div className="bg-slate-50 rounded-xl p-4">
                              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Shipping</p>
                              <p className="font-semibold text-slate-900">{formatCurrency(order.shipping_amount)}</p>
                            </div>
                          )}
                          {order.tax_amount > 0 && (
                            <div className="bg-slate-50 rounded-xl p-4">
                              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Tax</p>
                              <p className="font-semibold text-slate-900">{formatCurrency(order.tax_amount)}</p>
                            </div>
                          )}
                          <div className="bg-purple-50 rounded-xl p-4">
                            <p className="text-xs text-purple-600 uppercase tracking-wider mb-1">Total</p>
                            <p className="font-bold text-purple-700">{formatCurrency(order.total)}</p>
                          </div>
                        </div>

                        {/* Tracking Info */}
                        {order.tracking_number && (
                          <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl">
                            <Truck className="w-5 h-5 text-blue-600 flex-shrink-0" />
                            <div>
                              <p className="text-sm font-medium text-blue-900">Tracking Number</p>
                              <p className="text-sm text-blue-700 font-mono">{order.tracking_number}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Order Footer */}
                  <div className="px-5 sm:px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-4 text-sm text-slate-500">
                      <span><span className="font-medium text-slate-700">{order.order_items.length}</span> item(s)</span>
                      {order.fulfillment_status && order.fulfillment_status !== 'pending' && (
                        <span className="px-2 py-0.5 bg-slate-200 rounded text-xs font-medium capitalize">
                          {order.fulfillment_status}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-purple-600 hover:text-purple-700 hover:bg-purple-50 rounded-lg transition-colors"
                    >
                      {isExpanded ? 'Hide Details' : 'View Details'}
                      <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
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

import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { supabase } from '../lib/supabase'
import { shippoAPI } from '../utils/shippo'
import type { Order, ShippingAddress } from '../types'

// Database order interface
interface DBOrder {
  id: string
  order_number: string | null
  user_id: string | null
  customer_email: string | null
  customer_name: string | null
  subtotal: number
  tax_amount: number
  shipping_amount: number
  discount_amount: number
  total: number
  status: string
  payment_status: string
  fulfillment_status: string
  shipping_address: any
  tracking_number: string | null
  shipping_label_url: string | null
  notes: string | null
  internal_notes: string | null
  created_at: string
  updated_at: string
  order_items: {
    id: string
    product_id: string | null
    product_name: string
    quantity: number
    price: number
    total: number
    variations: any
    personalization: any
  }[]
}

const OrderManagement: React.FC = () => {
  const { user } = useAuth()
  const [selectedTab, setSelectedTab] = useState<'pending' | 'processing' | 'shipped' | 'on_hold' | 'all'>('pending')
  const [orders, setOrders] = useState<Order[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [showOrderModal, setShowOrderModal] = useState(false)
  const [showShippingModal, setShowShippingModal] = useState(false)
  const [isGeneratingLabel, setIsGeneratingLabel] = useState(false)
  const [internalNotes, setInternalNotes] = useState('')
  const [customerNotes, setCustomerNotes] = useState('')

  // Fetch orders from database
  useEffect(() => {
    fetchOrders()
  }, [])

  const fetchOrders = async () => {
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            id,
            product_id,
            product_name,
            quantity,
            price,
            total,
            variations,
            personalization
          )
        `)
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) {
        console.error('Error fetching orders:', error)
        return
      }

      // Transform database orders to the Order type expected by the UI
      const transformedOrders: Order[] = (data || []).map((dbOrder: DBOrder) => ({
        id: dbOrder.order_number || dbOrder.id.slice(0, 8).toUpperCase(),
        orderId: dbOrder.id,
        userId: dbOrder.user_id || '',
        items: (dbOrder.order_items || []).map(item => ({
          id: item.id,
          product: {
            id: item.product_id || '',
            name: item.product_name,
            description: '',
            price: item.price,
            images: [] as string[],
            category: 'shirts' as const, // Default to shirts for type compatibility
            inStock: true
          },
          quantity: item.quantity,
          customDesign: item.personalization?.designUrl
        })),
        total: dbOrder.total || 0,
        status: dbOrder.status as Order['status'],
        paymentStatus: dbOrder.payment_status,
        createdAt: dbOrder.created_at,
        updatedAt: dbOrder.updated_at,
        trackingNumber: dbOrder.tracking_number || undefined,
        shippingLabelUrl: dbOrder.shipping_label_url || undefined,
        shippingAddress: dbOrder.shipping_address ? {
          name: dbOrder.customer_name || (dbOrder.shipping_address.firstName + ' ' + dbOrder.shipping_address.lastName) || '',
          address1: dbOrder.shipping_address.address || '',
          city: dbOrder.shipping_address.city || '',
          state: dbOrder.shipping_address.state || '',
          zip: dbOrder.shipping_address.zipCode || '',
          country: dbOrder.shipping_address.country || 'US',
          email: dbOrder.customer_email || dbOrder.shipping_address.email || '',
          phone: dbOrder.shipping_address.phone
        } : undefined,
        customerNotes: dbOrder.notes || '',
        internalNotes: dbOrder.internal_notes || ''
      }))

      setOrders(transformedOrders)
    } catch (err) {
      console.error('Failed to fetch orders:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const updateOrderStatus = async (orderId: string, newStatus: Order['status']) => {
    // Find the order to get the actual database ID
    const order = orders.find(o => o.id === orderId)
    const dbOrderId = (order as any)?.orderId || orderId

    try {
      const { error } = await supabase
        .from('orders')
        .update({
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', dbOrderId)

      if (error) {
        console.error('Error updating order status:', error)
        return
      }

      setOrders(prev => prev.map(o =>
        o.id === orderId
          ? { ...o, status: newStatus, updatedAt: new Date().toISOString() }
          : o
      ))

      console.log(`Order ${orderId} status updated to ${newStatus}`)
    } catch (err) {
      console.error('Failed to update order status:', err)
    }
  }

  const updateOrderNotes = async (orderId: string, internal: string, customer: string) => {
    // Find the order to get the actual database ID
    const order = orders.find(o => o.id === orderId)
    const dbOrderId = (order as any)?.orderId || orderId

    try {
      const { error } = await supabase
        .from('orders')
        .update({
          internal_notes: internal,
          notes: customer,
          updated_at: new Date().toISOString()
        })
        .eq('id', dbOrderId)

      if (error) {
        console.error('Error updating order notes:', error)
        return
      }

      setOrders(prev => prev.map(o =>
        o.id === orderId
          ? { ...o, internalNotes: internal, customerNotes: customer }
          : o
      ))

      console.log(`Order ${orderId} notes updated`)
    } catch (err) {
      console.error('Failed to update order notes:', err)
    }
  }

  const generateShippingLabel = async (order: Order) => {
    if (!order.shippingAddress) {
      alert('No shipping address found for this order')
      return
    }

    setIsGeneratingLabel(true)
    try {
      // Mock business address - in real app, get from settings
      const fromAddress: ShippingAddress = {
        name: 'ImagineThisPrinted',
        company: 'ImagineThisPrinted LLC',
        address1: '123 Business St',
        city: 'San Francisco',
        state: 'CA',
        zip: '94105',
        country: 'US',
        phone: '+1-555-PRINT',
        email: 'shipping@imaginethisprinted.com'
      }

      // Create shipment
      const shipment = await shippoAPI.createShipment(
        fromAddress,
        order.shippingAddress,
        order.items
      )

      // Create label using first rate
      const label = await shippoAPI.createLabel(shipment.rates[0].object_id)

      // Update order with shipping info
      setOrders(prev => prev.map(o =>
        o.id === order.id
          ? {
            ...o,
            status: 'shipped',
            shippingLabelUrl: label.labelUrl,
            trackingNumber: label.trackingNumber,
            estimatedDelivery: label.estimatedDelivery
          }
          : o
      ))

      alert(`Shipping label generated! Tracking: ${label.trackingNumber}`)
      setShowShippingModal(false)

    } catch (error) {
      console.error('Error generating shipping label:', error)
      alert('Failed to generate shipping label. Please try again.')
    } finally {
      setIsGeneratingLabel(false)
    }
  }

  const downloadShippingLabel = (labelUrl: string) => {
    window.open(labelUrl, '_blank')
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800'
      case 'processing': return 'bg-blue-100 text-blue-800'
      case 'printed': return 'bg-blue-100 text-blue-800'
      case 'shipped': return 'bg-green-100 text-green-800'
      case 'delivered': return 'bg-green-100 text-green-800'
      case 'completed': return 'bg-green-100 text-green-800'
      case 'on_hold': return 'bg-red-100 text-red-800'
      case 'cancelled': return 'bg-gray-100 text-gray-800'
      default: return 'bg-card text-gray-800'
    }
  }

  const filteredOrders = selectedTab === 'all'
    ? orders
    : orders.filter(order => order.status === selectedTab)

  if (user?.role !== 'admin' && user?.role !== 'manager') {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Access denied. This page is for managers and administrators only.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text mb-2">Order Management</h1>
        <p className="text-muted">Manage order status, shipping labels, and customer communications</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-8">
        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Pending</p>
              <p className="text-2xl font-semibold text-text">{orders.filter(o => o.status === 'pending').length}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Processing</p>
              <p className="text-2xl font-semibold text-text">{orders.filter(o => o.status === 'processing').length}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Shipped</p>
              <p className="text-2xl font-semibold text-text">{orders.filter(o => o.status === 'shipped').length}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-red-100 rounded-lg">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">On Hold</p>
              <p className="text-2xl font-semibold text-text">{orders.filter(o => o.status === 'on_hold').length}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Total Orders</p>
              <p className="text-2xl font-semibold text-text">{orders.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
          <p className="mt-4 text-muted">Loading orders...</p>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b card-border mb-6">
        <nav className="-mb-px flex space-x-8">
          {['pending', 'processing', 'shipped', 'on_hold', 'all'].map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${selectedTab === tab
                ? 'border-purple-500 text-purple-600'
                : 'border-transparent text-muted hover:text-text hover:card-border'
                }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1).replace('_', ' ')}
            </button>
          ))}
        </nav>
      </div>

      {/* Orders Table */}
      <div className="bg-card rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-card">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Order ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Customer</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Items</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Total</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Created</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-card divide-y divide-gray-200">
              {filteredOrders.map((order) => (
                <tr key={order.id} className="hover:bg-card">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-text">{order.id}</div>
                    {order.trackingNumber && (
                      <div className="text-xs text-muted">Tracking: {order.trackingNumber}</div>
                    )}
                    {order.customerIdentifier && (
                      <div className="text-xs font-bold text-purple-600">Pickup: {order.customerIdentifier}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-text">{order.shippingAddress?.name || 'N/A'}</div>
                    <div className="text-xs text-muted">{order.shippingAddress?.email}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-text">{order.items.length} item(s)</div>
                    <div className="text-xs text-muted">{order.items[0]?.product.name}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-text">
                    ${order.total.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(order.status)}`}>
                      {order.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                    {new Date(order.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <button
                      onClick={() => {
                        setSelectedOrder(order)
                        setInternalNotes(order.internalNotes || '')
                        setCustomerNotes(order.customerNotes || '')
                        setShowOrderModal(true)
                      }}
                      className="text-purple-600 hover:text-purple-900 mr-3"
                    >
                      Manage
                    </button>
                    {(order.status === 'printed' || order.status === 'processing') && !order.shippingLabelUrl && (
                      <button
                        onClick={() => {
                          setSelectedOrder(order)
                          setShowShippingModal(true)
                        }}
                        className="text-blue-600 hover:text-blue-900 mr-3"
                      >
                        Ship
                      </button>
                    )}
                    {order.shippingLabelUrl && (
                      <button
                        onClick={() => downloadShippingLabel(order.shippingLabelUrl!)}
                        className="text-green-600 hover:text-green-900"
                      >
                        Label
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order Management Modal */}
      {showOrderModal && selectedOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-text">Manage Order {selectedOrder.id}</h3>
              <button
                onClick={() => setShowOrderModal(false)}
                className="text-gray-400 hover:text-muted"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <h4 className="font-semibold text-text mb-3">Order Details</h4>
                <div className="space-y-2 text-sm">
                  <p><span className="font-medium">Order ID:</span> {selectedOrder.id}</p>
                  <p><span className="font-medium">Created:</span> {new Date(selectedOrder.createdAt).toLocaleString()}</p>
                  <p><span className="font-medium">Total:</span> ${selectedOrder.total.toFixed(2)}</p>
                  <p><span className="font-medium">Items:</span> {selectedOrder.items.length}</p>
                  {selectedOrder.trackingNumber && (
                    <p><span className="font-medium">Tracking:</span> {selectedOrder.trackingNumber}</p>
                  )}
                  {selectedOrder.customerIdentifier && (
                    <p className="text-purple-600"><span className="font-medium">Pickup Code:</span> {selectedOrder.customerIdentifier}</p>
                  )}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-text mb-3">Shipping Address</h4>
                <div className="text-sm text-text">
                  <p>{selectedOrder.shippingAddress?.name}</p>
                  {selectedOrder.shippingAddress?.company && <p>{selectedOrder.shippingAddress.company}</p>}
                  <p>{selectedOrder.shippingAddress?.address1}</p>
                  {selectedOrder.shippingAddress?.address2 && <p>{selectedOrder.shippingAddress.address2}</p>}
                  <p>{selectedOrder.shippingAddress?.city}, {selectedOrder.shippingAddress?.state} {selectedOrder.shippingAddress?.zip}</p>
                  <p>{selectedOrder.shippingAddress?.country}</p>
                  {selectedOrder.shippingAddress?.phone && <p>{selectedOrder.shippingAddress.phone}</p>}
                  {selectedOrder.shippingAddress?.email && <p>{selectedOrder.shippingAddress.email}</p>}
                </div>
              </div>
            </div>

            <div className="mb-6">
              <h4 className="font-semibold text-text mb-3">Status Management</h4>
              <div className="flex flex-wrap gap-2">
                {['pending', 'processing', 'shipped', 'delivered', 'on_hold', 'cancelled'].map((status) => (
                  <button
                    key={status}
                    onClick={() => updateOrderStatus(selectedOrder.id, status as Order['status'])}
                    className={`px-4 py-2 rounded text-sm font-medium ${selectedOrder.status === status
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-200 text-text hover:bg-gray-300'
                      }`}
                  >
                    {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-sm font-medium text-text mb-2">Internal Notes</label>
                <textarea
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="Internal notes for staff only..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">Customer Notes</label>
                <textarea
                  value={customerNotes}
                  onChange={(e) => setCustomerNotes(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="Notes visible to customer..."
                />
              </div>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={() => {
                  updateOrderNotes(selectedOrder.id, internalNotes, customerNotes)
                  setShowOrderModal(false)
                }}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-2 px-4 rounded"
              >
                Save Changes
              </button>
              <button
                onClick={() => setShowOrderModal(false)}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-text py-2 px-4 rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shipping Modal */}
      {showShippingModal && selectedOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-lg max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-text">Generate Shipping Label</h3>
              <button
                onClick={() => setShowShippingModal(false)}
                className="text-gray-400 hover:text-muted"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mb-6">
              <p className="text-sm text-muted mb-4">
                This will generate a shipping label for order {selectedOrder.id} and mark it as shipped.
              </p>

              <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                <div className="flex">
                  <svg className="w-5 h-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <h4 className="text-sm font-medium text-blue-900">Shipping Details</h4>
                    <p className="text-sm text-blue-700 mt-1">
                      Service: USPS Priority Mail<br />
                      Estimated Cost: $8.50<br />
                      Estimated Delivery: 1-3 business days
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={() => generateShippingLabel(selectedOrder)}
                disabled={isGeneratingLabel}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white py-2 px-4 rounded flex items-center justify-center"
              >
                {isGeneratingLabel ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Generating...
                  </>
                ) : (
                  'Generate Label'
                )}
              </button>
              <button
                onClick={() => setShowShippingModal(false)}
                className="flex-1 bg-gray-300 hover:bg-gray-400 text-text py-2 px-4 rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default OrderManagement

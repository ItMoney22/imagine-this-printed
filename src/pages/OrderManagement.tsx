import React, { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { useToast } from '../hooks/useToast'
import { apiFetch } from '../lib/api'
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
  metadata: any
  // PRODUCTION SCHEMA (see the header comment in backend/routes/stripe.ts):
  // order_items is (id, order_id, product_id, product_name, variant_id,
  // variant_name, quantity, unit_price, subtotal, metadata jsonb, created_at).
  // This interface used to declare `price`, `total`, `variations` and
  // `personalization` — four columns that do not exist — so the mapping below
  // read undefined for the unit price and the design URL on every single line.
  order_items: {
    id: string
    product_id: string | null
    product_name: string
    variant_name: string | null
    quantity: number
    unit_price: number
    subtotal: number
    metadata: {
      client_product_id?: string | null
      image_url?: string | null
      size?: string | null
      color?: string | null
      print_location?: string | null
      custom_design?: string | null
      design_url?: string | null
      print_files?: Record<string, string> | null
      addons?: { id?: string; name?: string; price?: number }[] | null
      addons_total?: number | null
    } | null
    /**
     * Production files resolved from the PRODUCT, attached by
     * backend/services/product-files.ts. Not a DB column — order_items has no
     * knowledge of mockups, clean art, DTF or halftone.
     */
    product_files?: ProductFiles | null
  }[]
}

/** Mirrors ProductFiles in backend/services/product-files.ts. */
interface ProductFiles {
  design: string | null
  halftone: string | null
  dtf: string | null
  mockups: { role: string; url: string }[]
  designAssetId: string | null
}

const EMPTY_FILES: ProductFiles = { design: null, halftone: null, dtf: null, mockups: [], designAssetId: null }

/**
 * Everything the print floor needs to actually MAKE one line of an order.
 * The Manage Order modal previously showed a line-item COUNT and nothing else —
 * no design, no size, no colour, no print location, no artwork link — so the
 * crew could not work an order from it at all.
 */
interface FulfilmentLine {
  id: string
  name: string
  variant: string | null
  quantity: number
  unitPrice: number
  subtotal: number
  size: string | null
  color: string | null
  printLocation: string | null
  /** Mockup/product image — what it should look like. */
  previewUrl: string | null
  /** Press-ready artwork. `print_files` (per placement) wins over a single design. */
  designUrl: string | null
  printFiles: { placement: string; url: string }[]
  addons: { name: string; price: number }[]
  /** Product id, needed to generate a halftone against the right product. */
  productId: string | null
  /** Mockups / clean PNG / DTF / halftone, resolved from the product. */
  files: ProductFiles
}

/**
 * What the customer picked at checkout, as written to orders.metadata.shipping
 * by snapshotShippingChoice() in backend/routes/stripe.ts. Absent on orders
 * placed before 2026-08-07 — before that the backend received the selection and
 * discarded it, so a $0 shipping line was ambiguous between "local pickup" and
 * "free shipping over $50" and no pickup appointment was ever stored.
 */
interface ShippingChoice {
  method?: string | null
  type?: 'shipping' | 'pickup' | 'delivery' | string | null
  rush?: boolean
  rush_fee?: number
  amount?: number
  free_shipping_applied?: boolean
  pickup_appointment?: { date?: string | null; time?: string | null; notes?: string | null } | null
}

type AdminOrder = Order & {
  shippingChoice?: ShippingChoice | null
  /** Production detail per line — see FulfilmentLine. */
  fulfilmentLines?: FulfilmentLine[]
  /** orders.metadata.print, mirrored by the Watchtower print bridge. */
  printStatus?: { status?: string; railStatus?: string; printer?: string; updatedAt?: string } | null
}

/** One download chip. Renders nothing when the file doesn't exist. */
const FileButton: React.FC<{ url: string | null; label: string; tone?: 'solid' | 'outline' }> = ({ url, label, tone = 'outline' }) => {
  if (!url) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={tone === 'solid'
        ? 'px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold'
        : 'px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-text text-xs font-medium'}
    >
      ⬇ {label}
    </a>
  )
}

const OrderManagement: React.FC = () => {
  const { user } = useAuth()
  const toast = useToast()
  const [selectedTab, setSelectedTab] = useState<'pending' | 'processing' | 'shipped' | 'on_hold' | 'all'>('pending')
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState<AdminOrder | null>(null)
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
      // Use backend API to fetch orders (bypasses RLS issues)
      // apiFetch handles API_BASE, auth token, and returns parsed JSON directly
      const result = await apiFetch('/api/orders')
      const data = result?.orders

      if (!data) {
        console.error('No orders data returned')
        return
      }

      // Show all orders (admins need to see all orders to manage them)
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
            // Real columns — `price` and `personalization` never existed.
            price: Number(item.unit_price) || 0,
            images: item.metadata?.image_url ? [item.metadata.image_url] : ([] as string[]),
            category: 'shirts' as const, // Default to shirts for type compatibility
            inStock: true
          },
          quantity: item.quantity,
          customDesign: item.metadata?.custom_design || item.metadata?.design_url || undefined
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
        internalNotes: dbOrder.internal_notes || '',
        shippingChoice: (dbOrder.metadata?.shipping as ShippingChoice | undefined) ?? null,
        printStatus: dbOrder.metadata?.print ?? null,
        // Prefer the order_items rows; fall back to the orders.metadata.items
        // snapshot, which is the ONLY record for orders placed while the
        // order_items insert was silently failing against the wrong columns.
        fulfilmentLines: (dbOrder.order_items || []).length > 0
          ? (dbOrder.order_items || []).map(item => {
              const m = item.metadata || {}
              return {
                id: item.id,
                name: item.product_name,
                variant: item.variant_name || null,
                quantity: Number(item.quantity) || 1,
                unitPrice: Number(item.unit_price) || 0,
                subtotal: Number(item.subtotal) || 0,
                size: m.size || null,
                color: m.color || null,
                printLocation: m.print_location || null,
                previewUrl: m.image_url || null,
                designUrl: m.custom_design || m.design_url || null,
                printFiles: Object.entries(m.print_files || {})
                  .filter(([, url]) => typeof url === 'string' && url)
                  .map(([placement, url]) => ({ placement, url: String(url) })),
                addons: (m.addons || [])
                  .filter(Boolean)
                  .map(a => ({ name: a?.name || 'Add-on', price: Number(a?.price) || 0 })),
                productId: item.product_id || m.client_product_id || null,
                files: item.product_files || EMPTY_FILES
              } as FulfilmentLine
            })
          : ((dbOrder.metadata?.items as any[]) || []).map((snap, i) => ({
              id: `snap-${i}`,
              name: snap?.name || snap?.product?.name || 'Product',
              variant: null,
              quantity: Number(snap?.quantity) || 1,
              unitPrice: Number(snap?.price ?? snap?.product?.price) || 0,
              subtotal: (Number(snap?.price ?? snap?.product?.price) || 0) * (Number(snap?.quantity) || 1),
              size: snap?.size ?? null,
              color: snap?.color ?? null,
              printLocation: snap?.printLocation ?? null,
              previewUrl: snap?.image ?? null,
              designUrl: snap?.customDesign ?? null,
              printFiles: [],
              addons: [],
              // This branch only runs when the order has no order_items rows at
              // all, so the backend had nothing to hang product files off.
              productId: snap?.product?.id ?? snap?.id ?? null,
              files: EMPTY_FILES
            } as FulfilmentLine))
      }))

      setOrders(transformedOrders)
    } catch (err) {
      console.error('Failed to fetch orders:', err)
    } finally {
      setIsLoading(false)
    }
  }

  // apiFetch throws `HTTP <code>: <body>` — pull the backend's `error` string
  // out of the JSON body so the toast shows the real reason (e.g. an illegal
  // status transition) rather than a raw status line.
  const extractApiError = (err: unknown, fallback: string): string => {
    const raw = err instanceof Error ? err.message : String(err)
    const body = raw.replace(/^HTTP \d+:\s*/, '')
    try {
      const parsed = JSON.parse(body)
      if (parsed?.error) return String(parsed.error)
    } catch {
      // not JSON — fall through
    }
    return body || fallback
  }

  // The list is keyed by display id (order_number), but every write needs the
  // real orders.id uuid.
  const dbId = (order: Order | undefined, fallback: string) =>
    (order as any)?.orderId || fallback

  // Status and notes both go through PATCH /api/orders/:orderId. These used to
  // be direct supabase writes from the browser: they ran under RLS as the
  // signed-in admin, failed silently when a policy said no, and left local
  // state showing a change that was never persisted.
  const updateOrderStatus = async (orderId: string, newStatus: Order['status']) => {
    const order = orders.find(o => o.id === orderId)

    try {
      const result = await apiFetch(`/api/orders/${dbId(order, orderId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      })

      const persisted = result?.order
      setOrders(prev => prev.map(o =>
        o.id === orderId
          ? { ...o, status: (persisted?.status ?? newStatus) as Order['status'], updatedAt: persisted?.updated_at || new Date().toISOString() }
          : o
      ))
      setSelectedOrder(prev => prev && prev.id === orderId
        ? { ...prev, status: (persisted?.status ?? newStatus) as Order['status'] }
        : prev)

      toast.success('Status updated', `Order ${orderId} is now ${String(persisted?.status ?? newStatus).replace('_', ' ')}.`)
    } catch (err) {
      // State was never changed optimistically, so the UI still shows the last
      // persisted value — nothing to roll back.
      console.error('Failed to update order status:', err)
      toast.error('Status update failed', extractApiError(err, 'Could not update the order status.'))
    }
  }

  const updateOrderNotes = async (orderId: string, internal: string, customer: string) => {
    const order = orders.find(o => o.id === orderId)

    try {
      await apiFetch(`/api/orders/${dbId(order, orderId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ internal_notes: internal, notes: customer })
      })

      setOrders(prev => prev.map(o =>
        o.id === orderId
          ? { ...o, internalNotes: internal, customerNotes: customer }
          : o
      ))

      toast.success('Notes saved', `Order ${orderId} notes updated.`)
      return true
    } catch (err) {
      console.error('Failed to update order notes:', err)
      toast.error('Notes not saved', extractApiError(err, 'Could not save the order notes.'))
      return false
    }
  }

  const generateShippingLabel = async (order: Order) => {
    if (!order.shippingAddress) {
      toast.error('Missing shipping address', `Order ${order.id.slice(0, 8)} has no shipping address — can't generate a label.`)
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

      // The label is bought and postage is already spent — reflect it on
      // screen unconditionally, then try to persist it. A persist failure
      // must NOT look like a success: the toast and modal state below make
      // that distinction explicit instead of silently discarding a paid-for
      // label the way this flow used to (see 9b87aac's original design,
      // which this restores after a later refactor dropped the DB write
      // entirely and left every label local-state-only).
      setOrders(prev => prev.map(o =>
        o.id === order.id
          ? {
            ...o,
            shippingLabelUrl: label.labelUrl,
            trackingNumber: label.trackingNumber,
            estimatedDelivery: label.estimatedDelivery
          }
          : o
      ))

      try {
        const result = await apiFetch(`/api/orders/${dbId(order, order.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'shipped',
            shipping_label_url: label.labelUrl,
            tracking_number: label.trackingNumber,
            ...(label.estimatedDelivery ? { estimated_delivery: label.estimatedDelivery } : {})
          })
        })

        const persisted = result?.order
        setOrders(prev => prev.map(o =>
          o.id === order.id
            ? { ...o, status: (persisted?.status ?? 'shipped') as Order['status'] }
            : o
        ))

        toast.success('Shipping label generated', `Tracking #${label.trackingNumber}`)
        setShowShippingModal(false)
      } catch (persistErr) {
        // Postage is already bought — do not let the UI claim this silently
        // failed to nothing. Keep the label/tracking number visible (set
        // above) so staff can still open/print it, but make the save
        // failure loud so nobody assumes it's durably attached to the order.
        console.error('Shipping label bought but failed to save to the order:', persistErr)
        toast.error(
          'Label created but NOT saved',
          `Tracking #${label.trackingNumber} was purchased but could not be saved to order ${order.id.slice(0, 8)}: ${extractApiError(persistErr, 'unknown error')}. Retry saving or record it manually.`
        )
      }

    } catch (error) {
      console.error('Error generating shipping label:', error)
      toast.error('Label generation failed', 'Please try again. If it keeps failing, check the order shipping address.')
    } finally {
      setIsGeneratingLabel(false)
    }
  }

  // Lines currently having a halftone generated, keyed by line id.
  const [halftoning, setHalftoning] = useState<Record<string, boolean>>({})

  /**
   * Run the local halftone engine for a line and splice the result into state.
   * The endpoint is admin-only (requireAdmin in routes/image-flow.ts) even
   * though this page is open to manager/founder, so the button is gated to
   * admins rather than letting them click into a 403.
   */
  const generateHalftone = async (orderId: string, line: FulfilmentLine) => {
    const source = line.files.design || line.designUrl
    if (!line.productId || !source) return
    setHalftoning(prev => ({ ...prev, [line.id]: true }))
    try {
      const res = await apiFetch('/api/image-flow/halftone', {
        method: 'POST',
        body: JSON.stringify({
          productId: line.productId,
          // Prefer the asset id: it lets the API resolve the product itself and
          // record the parent, so the halftone is traceable to its source.
          ...(line.files.designAssetId ? { parentAssetId: line.files.designAssetId } : { imageUrl: source }),
          assetRole: 'design_halftone'
        })
      })
      const url = res?.url
      if (!url) throw new Error('halftone returned no url')

      // Patch every line sharing this product — one product, one halftone.
      setOrders(prev => prev.map(o => o.id !== orderId ? o : {
        ...o,
        fulfilmentLines: (o.fulfilmentLines || []).map(l =>
          l.productId === line.productId ? { ...l, files: { ...l.files, halftone: url } } : l
        )
      }))
      setSelectedOrder(prev => !prev || prev.id !== orderId ? prev : {
        ...prev,
        fulfilmentLines: (prev.fulfilmentLines || []).map(l =>
          l.productId === line.productId ? { ...l, files: { ...l.files, halftone: url } } : l
        )
      })
      toast.success('Halftone generated')
    } catch (err: any) {
      toast.error(err?.message || 'Halftone generation failed')
    } finally {
      setHalftoning(prev => ({ ...prev, [line.id]: false }))
    }
  }

  const downloadShippingLabel = (labelUrl: string) => {
    window.open(labelUrl, '_blank')
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
      case 'processing': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
      case 'printed': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
      case 'shipped': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
      case 'delivered': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
      case 'completed': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
      case 'on_hold': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
      case 'cancelled': return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400'
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400'
    }
  }

  const filteredOrders = selectedTab === 'all'
    ? orders
    : orders.filter(order => order.status === selectedTab)

  // Stats (memoized to avoid filtering on every render)
  const { pendingCount, processingCount, shippedCount, onHoldCount } = useMemo(() => ({
    pendingCount: orders.filter(o => o.status === 'pending').length,
    processingCount: orders.filter(o => o.status === 'processing').length,
    shippedCount: orders.filter(o => o.status === 'shipped').length,
    onHoldCount: orders.filter(o => o.status === 'on_hold').length
  }), [orders])
  const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0)

  if (user?.role !== 'admin' && user?.role !== 'manager' && user?.role !== 'founder') {
    return (
      <div className="min-h-screen bg-bg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
            <p className="text-red-800 dark:text-red-400">Access denied. This page is for managers and administrators only.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Gradient Header */}
      <div className="bg-gradient-to-br from-purple-600 via-purple-700 to-pink-600 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Order Management</h1>
              <p className="text-purple-100">Manage order status, shipping labels, and customer communications</p>
            </div>
            <div className="flex flex-wrap gap-3">
              {/* Glass Stats in Header */}
              <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-2 border border-white/20">
                <p className="text-purple-100 text-xs">Total Orders</p>
                <p className="text-white text-xl font-bold">{orders.length}</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-2 border border-white/20">
                <p className="text-purple-100 text-xs">Revenue</p>
                <p className="text-white text-xl font-bold">${totalRevenue.toFixed(2)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-8">
          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-yellow-500 to-orange-600 rounded-xl shadow-lg shadow-yellow-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted">Pending</p>
                <p className="text-2xl font-bold text-text">{pendingCount}</p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg shadow-blue-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted">Processing</p>
                <p className="text-2xl font-bold text-text">{processingCount}</p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl shadow-lg shadow-green-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted">Shipped</p>
                <p className="text-2xl font-bold text-text">{shippedCount}</p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-red-500 to-rose-600 rounded-xl shadow-lg shadow-red-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted">On Hold</p>
                <p className="text-2xl font-bold text-text">{onHoldCount}</p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl shadow-lg shadow-purple-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted">Total Orders</p>
                <p className="text-2xl font-bold text-text">{orders.length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Pill-Style Tabs */}
        <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-2 mb-6">
          <nav className="flex space-x-2 overflow-x-auto">
            {[
              { id: 'pending', label: 'Pending', count: pendingCount },
              { id: 'processing', label: 'Processing', count: processingCount },
              { id: 'shipped', label: 'Shipped', count: shippedCount },
              { id: 'on_hold', label: 'On Hold', count: onHoldCount },
              { id: 'all', label: 'All Orders', count: orders.length }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedTab(tab.id as any)}
                className={`flex items-center px-4 py-2.5 rounded-lg font-medium text-sm transition-all whitespace-nowrap ${
                  selectedTab === tab.id
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/25'
                    : 'text-muted hover:text-text hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {tab.label}
                <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                  selectedTab === tab.id
                    ? 'bg-white/20 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-muted'
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </nav>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-12 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
            <p className="mt-4 text-muted">Loading orders...</p>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && filteredOrders.length === 0 && (
          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-12 text-center">
            <svg className="w-16 h-16 mx-auto text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <h3 className="text-lg font-semibold text-text mb-2">No orders found</h3>
            <p className="text-muted">
              {selectedTab === 'all'
                ? 'No orders have been placed yet.'
                : `No ${selectedTab.replace('_', ' ')} orders at the moment.`}
            </p>
          </div>
        )}

        {/* Orders Table */}
        {!isLoading && filteredOrders.length > 0 && (
          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50 dark:bg-gray-800/50">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted uppercase tracking-wider">Order ID</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted uppercase tracking-wider">Customer</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted uppercase tracking-wider">Items</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted uppercase tracking-wider">Total</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted uppercase tracking-wider">Status</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted uppercase tracking-wider">Created</th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-muted uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredOrders.map((order) => (
                    <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-semibold text-text">{order.id}</div>
                        {order.trackingNumber && (
                          <div className="text-xs text-muted mt-1">Tracking: {order.trackingNumber}</div>
                        )}
                        {order.customerIdentifier && (
                          <div className="text-xs font-bold text-purple-600 mt-1">Pickup: {order.customerIdentifier}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-text">{order.shippingAddress?.name || 'N/A'}</div>
                        <div className="text-xs text-muted">{order.shippingAddress?.email}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-text">{order.items.length} item(s)</div>
                        <div className="text-xs text-muted truncate max-w-[150px]">{order.items[0]?.product.name}</div>
                        {/* Pickup vs ship, visible without opening the order —
                            the difference decides whether it goes on a truck. */}
                        {order.shippingChoice && (
                          <div className="mt-1 flex items-center gap-1 flex-wrap">
                            <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${
                              order.shippingChoice.type === 'pickup'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                : order.shippingChoice.type === 'delivery'
                                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                            }`}>
                              {order.shippingChoice.type === 'pickup'
                                ? '🏪 Pickup'
                                : order.shippingChoice.type === 'delivery'
                                  ? '🚗 Local delivery'
                                  : '📦 Ship'}
                            </span>
                            {order.shippingChoice.rush && (
                              <span className="text-[11px] px-1.5 py-0.5 rounded font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                ⚡ RUSH
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-bold text-text">${order.total.toFixed(2)}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(order.status)}`}>
                          {order.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-muted">{new Date(order.createdAt).toLocaleDateString()}</div>
                        <div className="text-xs text-muted">{new Date(order.createdAt).toLocaleTimeString()}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => {
                              setSelectedOrder(order)
                              setInternalNotes(order.internalNotes || '')
                              setCustomerNotes(order.customerNotes || '')
                              setShowOrderModal(true)
                            }}
                            className="px-3 py-1.5 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-lg text-sm font-medium hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors"
                          >
                            Manage
                          </button>
                          {(order.status === 'printed' || order.status === 'processing') && !order.shippingLabelUrl && (
                            <button
                              onClick={() => {
                                setSelectedOrder(order)
                                setShowShippingModal(true)
                              }}
                              className="px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg text-sm font-medium hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                            >
                              Ship
                            </button>
                          )}
                          {order.shippingLabelUrl && (
                            <button
                              onClick={() => downloadShippingLabel(order.shippingLabelUrl!)}
                              className="px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-lg text-sm font-medium hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                            >
                              Label
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Order Management Modal */}
      {showOrderModal && selectedOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto border border-purple-500/10">
            <div className="sticky top-0 bg-card border-b border-purple-500/10 px-6 py-4 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold text-text">Manage Order</h3>
                <p className="text-sm text-muted">Order #{selectedOrder.id}</p>
              </div>
              <button
                onClick={() => setShowOrderModal(false)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <svg className="w-6 h-6 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
                  <h4 className="font-semibold text-text mb-3 flex items-center">
                    <svg className="w-5 h-5 mr-2 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    Order Details
                  </h4>
                  <div className="space-y-2 text-sm">
                    <p className="flex justify-between"><span className="text-muted">Order ID:</span> <span className="font-medium text-text">{selectedOrder.id}</span></p>
                    <p className="flex justify-between"><span className="text-muted">Created:</span> <span className="font-medium text-text">{new Date(selectedOrder.createdAt).toLocaleString()}</span></p>
                    <p className="flex justify-between"><span className="text-muted">Total:</span> <span className="font-bold text-text">${selectedOrder.total.toFixed(2)}</span></p>
                    <p className="flex justify-between"><span className="text-muted">Items:</span> <span className="font-medium text-text">{selectedOrder.items.length}</span></p>
                    {selectedOrder.trackingNumber && (
                      <p className="flex justify-between"><span className="text-muted">Tracking:</span> <span className="font-medium text-text">{selectedOrder.trackingNumber}</span></p>
                    )}
                    {selectedOrder.customerIdentifier && (
                      <p className="flex justify-between"><span className="text-muted">Pickup Code:</span> <span className="font-bold text-purple-600">{selectedOrder.customerIdentifier}</span></p>
                    )}
                  </div>
                </div>

                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4">
                  <h4 className="font-semibold text-text mb-3 flex items-center">
                    <svg className="w-5 h-5 mr-2 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {selectedOrder.shippingChoice?.type === 'pickup' ? 'Customer Address (pickup order)' : 'Shipping Address'}
                  </h4>
                  <div className="text-sm text-text space-y-1">
                    <p className="font-medium">{selectedOrder.shippingAddress?.name}</p>
                    {selectedOrder.shippingAddress?.company && <p className="text-muted">{selectedOrder.shippingAddress.company}</p>}
                    <p>{selectedOrder.shippingAddress?.address1}</p>
                    {selectedOrder.shippingAddress?.address2 && <p>{selectedOrder.shippingAddress.address2}</p>}
                    <p>{selectedOrder.shippingAddress?.city}, {selectedOrder.shippingAddress?.state} {selectedOrder.shippingAddress?.zip}</p>
                    <p>{selectedOrder.shippingAddress?.country}</p>
                    {selectedOrder.shippingAddress?.phone && <p className="text-muted">{selectedOrder.shippingAddress.phone}</p>}
                    {selectedOrder.shippingAddress?.email && <p className="text-muted">{selectedOrder.shippingAddress.email}</p>}
                  </div>
                </div>
              </div>

              {/* PRODUCTION — what to actually make. This modal used to show a
                  line-item COUNT and nothing else: no design, no size, no
                  colour, no print location, no artwork link. The crew could not
                  work an order from it, which is why orders sat untouched. */}
              <div className="mb-6">
                <h4 className="font-semibold text-text mb-3 flex items-center">
                  <svg className="w-5 h-5 mr-2 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  Production — what to make
                </h4>

                {(selectedOrder.fulfilmentLines || []).length === 0 ? (
                  <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-800 dark:text-amber-200">
                    No line items recorded on this order. Check the customer's confirmation email
                    or the Stripe payment description before producing anything.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(selectedOrder.fulfilmentLines || []).map(line => (
                      <div key={line.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40 p-4">
                        <div className="flex gap-4">
                          {line.previewUrl ? (
                            <a href={line.previewUrl} target="_blank" rel="noreferrer" className="shrink-0">
                              <img
                                src={line.previewUrl}
                                alt={line.name}
                                className="w-24 h-24 object-contain rounded-lg bg-gray-100 dark:bg-gray-800"
                              />
                            </a>
                          ) : (
                            <div className="w-24 h-24 shrink-0 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-xs text-muted text-center px-1">
                              No image
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3 flex-wrap">
                              <p className="font-semibold text-text">{line.name}</p>
                              <p className="text-sm font-bold text-text whitespace-nowrap">
                                {line.quantity} × ${line.unitPrice.toFixed(2)}
                                {line.subtotal > 0 && (
                                  <span className="text-muted font-normal"> = ${line.subtotal.toFixed(2)}</span>
                                )}
                              </p>
                            </div>

                            {/* The specs. Quantity is repeated as a chip because
                                it is the single most expensive thing to get
                                wrong on a press run. */}
                            <div className="mt-2 flex flex-wrap gap-2 text-xs">
                              <span className="px-2 py-1 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 font-bold">
                                QTY {line.quantity}
                              </span>
                              <span className={`px-2 py-1 rounded font-medium ${line.size
                                ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                                Size: {line.size || 'NOT SET'}
                              </span>
                              <span className="px-2 py-1 rounded bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 font-medium inline-flex items-center gap-1">
                                Colour:
                                {line.color && /^#[0-9a-f]{3,8}$/i.test(line.color) && (
                                  <span
                                    className="inline-block w-3 h-3 rounded-full border border-gray-400"
                                    style={{ backgroundColor: line.color }}
                                  />
                                )}
                                <span>{line.color || '—'}</span>
                              </span>
                              <span className={`px-2 py-1 rounded font-medium ${line.printLocation
                                ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                                Print: {line.printLocation ? line.printLocation.replace(/_/g, ' ') : 'NOT SET'}
                              </span>
                              {line.variant && (
                                <span className="px-2 py-1 rounded bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 font-medium">
                                  {line.variant}
                                </span>
                              )}
                            </div>

                            {line.addons.length > 0 && (
                              <p className="mt-2 text-xs text-muted">
                                Add-ons: {line.addons.map(a => `${a.name} ($${a.price.toFixed(2)})`).join(', ')}
                              </p>
                            )}

                            {/* Press-ready artwork. Without this the crew has a
                                mockup and no file to actually print. */}
                            <div className="mt-3 flex flex-wrap gap-2">
                              {line.printFiles.length > 0 ? (
                                line.printFiles.map(pf => (
                                  <a
                                    key={pf.placement}
                                    href={pf.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold"
                                  >
                                    ⬇ Print file — {pf.placement.replace(/_/g, ' ')}
                                  </a>
                                ))
                              ) : line.designUrl ? (
                                <a
                                  href={line.designUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold"
                                >
                                  ⬇ Download design
                                </a>
                              ) : (
                                <span className="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-xs font-semibold">
                                  No print-ready file on this line — use the product artwork
                                </span>
                              )}
                              {line.previewUrl && (
                                <a
                                  href={line.previewUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-text text-xs font-medium"
                                >
                                  View mockup
                                </a>
                              )}
                            </div>

                            {/* PRODUCT FILES — mockups, the clean PNG and the
                                press files. These live on the product, not the
                                order line, so before this the floor could see a
                                thumbnail and nothing downloadable. */}
                            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                              <p className="text-[11px] uppercase tracking-wide text-muted mb-2">Product files</p>
                              <div className="flex flex-wrap gap-2">
                                <FileButton url={line.files.design} label="Design PNG" tone="solid" />
                                <FileButton url={line.files.dtf} label="DTF print file" tone="solid" />
                                <FileButton url={line.files.halftone} label="Halftone PNG" tone="solid" />

                                {/* Halftone is generated on demand: nothing in
                                    the pipeline makes one, so every product
                                    starts without it. Local + deterministic, $0. */}
                                {!line.files.halftone && (line.files.design || line.designUrl) && line.productId && (
                                  user?.role === 'admin' ? (
                                    <button
                                      onClick={() => generateHalftone(selectedOrder.id, line)}
                                      disabled={!!halftoning[line.id]}
                                      className="px-3 py-1.5 rounded-lg border border-purple-400 text-purple-700 dark:text-purple-300 text-xs font-semibold disabled:opacity-50"
                                    >
                                      {halftoning[line.id] ? 'Generating…' : '✨ Generate halftone'}
                                    </button>
                                  ) : (
                                    <span className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-muted text-xs">
                                      No halftone yet — an admin can generate one
                                    </span>
                                  )
                                )}

                                {line.files.mockups.map((mk, i) => (
                                  <a
                                    key={`${mk.role}-${i}`}
                                    href={mk.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-text text-xs font-medium"
                                  >
                                    ⬇ {mk.role.replace(/^mockup_/, '').replace(/_/g, ' ')}
                                  </a>
                                ))}

                                {!line.files.design && !line.files.dtf && !line.files.halftone
                                  && line.files.mockups.length === 0 && (
                                  <span className="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-xs font-semibold">
                                    No product files — this product has no generated assets
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {selectedOrder.printStatus?.status && (
                  <p className="mt-3 text-xs text-muted">
                    3D print status (from the print factory): <span className="font-semibold text-text">{selectedOrder.printStatus.status}</span>
                    {selectedOrder.printStatus.printer ? ` · ${selectedOrder.printStatus.printer}` : ''}
                  </p>
                )}
              </div>

              {/* Fulfilment method. Sits above Status Management because it
                  decides what the crew physically does: a pickup treated as a
                  shipment is a customer waiting in the lobby for a box already
                  on a truck. */}
              {(() => {
                const c = selectedOrder.shippingChoice
                const type = String(c?.type || '').toLowerCase()
                const isPickup = type === 'pickup'
                const isDelivery = type === 'delivery'
                const appt = c?.pickup_appointment
                const apptLine = [appt?.date, appt?.time].filter(Boolean).join(' at ')
                const tone = isPickup
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700'
                  : isDelivery
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700'
                    : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
                return (
                  <div className={`mb-6 rounded-xl p-4 border ${tone}`}>
                    <h4 className="font-semibold text-text mb-2 flex items-center">
                      <svg className="w-5 h-5 mr-2 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                      </svg>
                      Fulfilment Method
                    </h4>
                    {c ? (
                      <>
                        <p className="text-lg font-bold text-text">
                          {isPickup ? '🏪 ' : isDelivery ? '🚗 ' : '📦 '}{c.method || 'Standard Shipping'}
                        </p>
                        <p className="text-sm text-muted mt-1">
                          {Number(c.amount) > 0
                            ? `Customer paid $${Number(c.amount).toFixed(2)} shipping`
                            : 'No shipping charge'}
                          {c.free_shipping_applied ? ' · free-shipping applied' : ''}
                        </p>
                        {c.rush && (
                          <p className="text-sm font-semibold text-amber-600 dark:text-amber-400 mt-1">
                            ⚡ RUSH — next business day{Number(c.rush_fee) > 0 ? ` (+$${Number(c.rush_fee).toFixed(2)})` : ''}
                          </p>
                        )}
                        {isPickup && (
                          <p className="text-sm mt-2 text-emerald-700 dark:text-emerald-300 font-medium">
                            {apptLine ? `Pickup: ${apptLine}` : 'Pickup — no appointment time chosen'}
                            {appt?.notes && (
                              <span className="block font-normal text-muted mt-1">Note: {appt.notes}</span>
                            )}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-muted">
                        Not recorded — this order predates fulfilment-choice tracking (2026-08-07).
                        Check with the customer before shipping.
                      </p>
                    )}
                  </div>
                )
              })()}

              <div className="mb-6">
                <h4 className="font-semibold text-text mb-3 flex items-center">
                  <svg className="w-5 h-5 mr-2 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Status Management
                </h4>
                <div className="flex flex-wrap gap-2">
                  {['pending', 'processing', 'shipped', 'delivered', 'on_hold', 'cancelled'].map((status) => (
                    <button
                      key={status}
                      onClick={() => updateOrderStatus(selectedOrder.id, status as Order['status'])}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${selectedOrder.status === status
                        ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/25'
                        : 'bg-gray-100 dark:bg-gray-800 text-text hover:bg-gray-200 dark:hover:bg-gray-700'
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
                    className="w-full bg-bg border border-purple-500/20 rounded-xl px-4 py-3 text-text focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    placeholder="Internal notes for staff only..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text mb-2">Customer Notes</label>
                  <textarea
                    value={customerNotes}
                    onChange={(e) => setCustomerNotes(e.target.value)}
                    rows={4}
                    className="w-full bg-bg border border-purple-500/20 rounded-xl px-4 py-3 text-text focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    placeholder="Notes visible to customer..."
                  />
                </div>
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={async () => {
                    // Only close once the save actually persisted — closing on
                    // a failed write is how the old UI hid the failure.
                    const saved = await updateOrderNotes(selectedOrder.id, internalNotes, customerNotes)
                    if (saved) setShowOrderModal(false)
                  }}
                  className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white py-3 px-6 rounded-xl shadow-lg shadow-purple-500/25 font-medium transition-all"
                >
                  Save Changes
                </button>
                <button
                  onClick={() => setShowOrderModal(false)}
                  className="flex-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-text py-3 px-6 rounded-xl font-medium transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Shipping Modal */}
      {showShippingModal && selectedOrder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-card rounded-2xl shadow-2xl max-w-md w-full border border-purple-500/10">
            <div className="border-b border-purple-500/10 px-6 py-4 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold text-text">Generate Shipping Label</h3>
                <p className="text-sm text-muted">Order #{selectedOrder.id}</p>
              </div>
              <button
                onClick={() => setShowShippingModal(false)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                <svg className="w-6 h-6 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6">
              <p className="text-sm text-muted mb-4">
                This will generate a shipping label and mark the order as shipped.
              </p>

              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-6">
                <div className="flex">
                  <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-300">Shipping Details</h4>
                    <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
                      Service: USPS Priority Mail<br />
                      Estimated Cost: $8.50<br />
                      Estimated Delivery: 1-3 business days
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => generateShippingLabel(selectedOrder)}
                  disabled={isGeneratingLabel}
                  className="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-gray-400 disabled:to-gray-500 text-white py-3 px-6 rounded-xl shadow-lg shadow-blue-500/25 font-medium transition-all flex items-center justify-center"
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
                  className="flex-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-text py-3 px-6 rounded-xl font-medium transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default OrderManagement

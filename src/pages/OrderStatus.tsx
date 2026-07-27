import React, { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  Package, Truck, CheckCircle, Clock, AlertCircle, XCircle,
  ExternalLink, MapPin, Mail
} from 'lucide-react'
import { API_BASE } from '../lib/api'

// Public, no-login order status. Reached from the tokenized link in every
// transactional email (/order-status/:orderId?t=…), so guest buyers who never
// made an account can still see where their order is.

interface StatusItem {
  product_name: string
  quantity: number
  price: number
  total?: number
  image_url?: string | null
  variations?: { size?: string; color?: string } | null
}

interface OrderStatusPayload {
  order_number: string
  status: string
  payment_status: string
  fulfillment_status: string
  subtotal: number
  tax_amount: number
  shipping_amount: number
  discount_amount: number
  total: number
  currency: string
  customer_name: string | null
  customer_email_masked: string
  tracking_number: string | null
  carrier: string | null
  tracking_url: string | null
  estimated_delivery: string | null
  shipped_at: string | null
  delivered_at: string | null
  created_at: string
  print?: { status?: string } | null
  items: StatusItem[]
}

const statusConfig: Record<string, { icon: React.ReactNode; color: string; bgColor: string; label: string; blurb: string }> = {
  pending: {
    icon: <Clock className="w-5 h-5" />, color: 'text-yellow-600', bgColor: 'bg-yellow-50',
    label: 'Pending', blurb: "We've got your order and we're lining it up for production."
  },
  confirmed: {
    icon: <CheckCircle className="w-5 h-5" />, color: 'text-blue-600', bgColor: 'bg-blue-50',
    label: 'Confirmed', blurb: "Payment's in and your order is confirmed."
  },
  processing: {
    icon: <Package className="w-5 h-5" />, color: 'text-blue-600', bgColor: 'bg-blue-50',
    label: 'In Production', blurb: "We're printing and prepping your order right now."
  },
  shipped: {
    icon: <Truck className="w-5 h-5" />, color: 'text-purple-600', bgColor: 'bg-purple-50',
    label: 'Shipped', blurb: 'Your order has left our shop and is on its way to you.'
  },
  delivered: {
    icon: <CheckCircle className="w-5 h-5" />, color: 'text-green-600', bgColor: 'bg-green-50',
    label: 'Delivered', blurb: 'Delivered! We hope you love it.'
  },
  on_hold: {
    icon: <AlertCircle className="w-5 h-5" />, color: 'text-orange-600', bgColor: 'bg-orange-50',
    label: 'On Hold', blurb: "We've paused this order — reply to your confirmation email and we'll sort it out."
  },
  cancelled: {
    icon: <XCircle className="w-5 h-5" />, color: 'text-red-600', bgColor: 'bg-red-50',
    label: 'Cancelled', blurb: 'This order was cancelled.'
  },
  refunded: {
    icon: <XCircle className="w-5 h-5" />, color: 'text-gray-600', bgColor: 'bg-gray-100',
    label: 'Refunded', blurb: 'This order was refunded.'
  }
}

const STEPS = ['confirmed', 'processing', 'shipped', 'delivered'] as const

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`

const OrderStatus: React.FC = () => {
  const { orderId } = useParams<{ orderId: string }>()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('t') || searchParams.get('token') || ''

  const [order, setOrder] = useState<OrderStatusPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (!orderId || !token) {
        setError('This link is missing its access code. Please use the "Track My Order" button from your order email.')
        setLoading(false)
        return
      }
      try {
        const res = await fetch(`${API_BASE}/api/orders/status/${encodeURIComponent(orderId)}?t=${encodeURIComponent(token)}`)
        if (!res.ok) {
          throw new Error(res.status === 404 ? 'notfound' : 'failed')
        }
        const data = await res.json()
        if (!cancelled) setOrder(data.order)
      } catch (err: any) {
        if (!cancelled) {
          setError(
            err?.message === 'notfound'
              ? "We couldn't find that order. The link may have expired or been mistyped — check the most recent email we sent you."
              : "Something went wrong loading your order. Please try again in a moment."
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [orderId, token])

  const config = order ? (statusConfig[order.status] || statusConfig.pending) : null
  const stepIndex = order ? STEPS.indexOf(order.status as typeof STEPS[number]) : -1
  const firstName = order?.customer_name?.trim().split(/\s+/)[0]

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted">Looking up your order…</p>
        </div>
      </div>
    )
  }

  if (error || !order) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-card rounded-2xl border border-gray-200 dark:border-gray-700 p-8 text-center">
          <AlertCircle className="w-12 h-12 text-orange-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-text mb-2">We couldn't open that order</h1>
          <p className="text-muted text-sm mb-6">{error}</p>
          <Link to="/contact" className="inline-block px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-colors">
            Contact Us
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen py-10 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <p className="text-xs uppercase tracking-widest text-muted mb-2">Order Status</p>
          <h1 className="text-3xl font-bold text-text">
            {firstName ? `${firstName}, here's your order` : "Here's your order"}
          </h1>
          <p className="text-purple-600 dark:text-purple-400 text-lg font-mono font-bold mt-2">{order.order_number}</p>
          <p className="text-muted text-sm mt-1">Placed {fmtDate(order.created_at)}</p>
        </div>

        {/* Status banner */}
        <div className={`${config!.bgColor} rounded-2xl p-6 mb-6 text-center`}>
          <div className={`inline-flex items-center gap-2 ${config!.color} font-bold text-lg`}>
            {config!.icon}
            {config!.label}
          </div>
          <p className="text-gray-700 text-sm mt-2">{config!.blurb}</p>
          {order.estimated_delivery && order.status !== 'delivered' && (
            <p className="text-gray-600 text-sm mt-2">
              Estimated delivery: <strong>{fmtDate(order.estimated_delivery)}</strong>
            </p>
          )}
        </div>

        {/* Progress rail */}
        {stepIndex >= 0 && (
          <div className="bg-card rounded-2xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="flex items-center justify-between">
              {STEPS.map((step, i) => {
                const done = i <= stepIndex
                return (
                  <React.Fragment key={step}>
                    <div className="flex flex-col items-center flex-shrink-0">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center ${done ? 'bg-purple-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-400'}`}>
                        {statusConfig[step].icon}
                      </div>
                      <span className={`text-[11px] mt-2 text-center ${done ? 'text-text font-semibold' : 'text-muted'}`}>
                        {statusConfig[step].label}
                      </span>
                    </div>
                    {i < STEPS.length - 1 && (
                      <div className={`flex-1 h-1 mx-1 rounded ${i < stepIndex ? 'bg-purple-600' : 'bg-gray-200 dark:bg-gray-700'}`} />
                    )}
                  </React.Fragment>
                )
              })}
            </div>
          </div>
        )}

        {/* Tracking */}
        {order.tracking_number && (
          <div className="bg-card rounded-2xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Truck className="w-5 h-5 text-blue-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-text">
                    Tracking{order.carrier ? ` · ${order.carrier}` : ''}
                  </p>
                  <p className="text-sm text-muted font-mono">{order.tracking_number}</p>
                </div>
              </div>
              {order.tracking_url && (
                <a
                  href={order.tracking_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  Track Package <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
            {order.shipped_at && (
              <p className="text-xs text-muted mt-3 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Shipped {fmtDate(order.shipped_at)}
              </p>
            )}
          </div>
        )}

        {/* Items */}
        <div className="bg-card rounded-2xl border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h2 className="font-bold text-text mb-4">What's in this order</h2>
          <div className="space-y-3">
            {order.items.map((item, i) => (
              <div key={i} className="flex items-center gap-4 pb-3 border-b border-gray-100 dark:border-gray-700 last:border-0 last:pb-0">
                {item.image_url ? (
                  <img src={item.image_url} alt={item.product_name} className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0">
                    <Package className="w-6 h-6 text-gray-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text truncate">{item.product_name}</p>
                  <p className="text-xs text-muted">
                    Qty {item.quantity}
                    {item.variations?.size ? ` · ${item.variations.size}` : ''}
                    {item.variations?.color ? ` · ${item.variations.color}` : ''}
                  </p>
                </div>
                <p className="text-sm font-semibold text-text flex-shrink-0">
                  {money(item.total ?? item.price * item.quantity)}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-5 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-1 text-sm">
            <div className="flex justify-between text-muted"><span>Subtotal</span><span>{money(order.subtotal)}</span></div>
            {Number(order.shipping_amount) > 0 && (
              <div className="flex justify-between text-muted"><span>Shipping</span><span>{money(order.shipping_amount)}</span></div>
            )}
            {Number(order.tax_amount) > 0 && (
              <div className="flex justify-between text-muted"><span>Tax</span><span>{money(order.tax_amount)}</span></div>
            )}
            {Number(order.discount_amount) > 0 && (
              <div className="flex justify-between text-green-600"><span>Discount</span><span>-{money(order.discount_amount)}</span></div>
            )}
            <div className="flex justify-between font-bold text-text text-base pt-2">
              <span>Total</span><span>{money(order.total)}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-sm text-muted">
          <p className="flex items-center justify-center gap-2">
            <Mail className="w-4 h-4" /> Confirmation sent to {order.customer_email_masked}
          </p>
          <p className="mt-3">
            Questions? <Link to="/contact" className="text-purple-600 hover:underline font-semibold">Get in touch</Link> — or just reply to your order email.
          </p>
          <p className="mt-6">
            <Link to="/" className="text-purple-600 hover:underline">Imagine This Printed</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default OrderStatus

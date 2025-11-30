import React, { useState, useEffect, useCallback } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { kioskService } from '../utils/kiosk-service'
import type { Kiosk, Product, CartItem, KioskOrder } from '../types'

interface KioskInterfaceProps {
  previewData?: Kiosk
}

const KioskInterface: React.FC<KioskInterfaceProps> = ({ previewData }) => {
  const { kioskId } = useParams<{ kioskId: string }>()
  const [kiosk, setKiosk] = useState<Kiosk | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [currentView, setCurrentView] = useState<'products' | 'cart' | 'checkout' | 'payment' | 'receipt'>('products')
  const [isLoading, setIsLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'cash' | 'itc_wallet'>('card')
  const [paymentProcessing, setPaymentProcessing] = useState(false)
  const [currentOrder, setCurrentOrder] = useState<KioskOrder | null>(null)

  // Customer info for receipt (optional)
  const [customerInfo, setCustomerInfo] = useState({
    name: '',
    email: '',
    phone: ''
  })

  // Cash payment state
  const [cashReceived, setCashReceived] = useState<number>(0)
  const [_showCashInput, setShowCashInput] = useState(false)

  // Session timeout
  const [_sessionTimeout, setSessionTimeout] = useState<number>(0)

  useEffect(() => {
    if (previewData) {
      setKiosk(previewData)
      // Load mock products for preview
      kioskService.getVendorProducts('preview_vendor').then(setProducts)
      setIsLoading(false)
    } else if (kioskId) {
      loadKioskData()
    }
  }, [kioskId, previewData])

  // Session timeout handler
  useEffect(() => {
    if (kiosk?.settings.sessionTimeout && cart.length === 0) {
      const timeout = setTimeout(() => {
        resetSession()
      }, kiosk.settings.sessionTimeout * 60 * 1000)

      return () => clearTimeout(timeout)
    }
  }, [cart.length, kiosk?.settings.sessionTimeout])

  // Touch interaction tracking for session timeout
  useEffect(() => {
    const resetSessionTimer = () => {
      setSessionTimeout(Date.now())
    }

    const events = ['touchstart', 'touchmove', 'touchend', 'click', 'mousemove']
    events.forEach(event => {
      document.addEventListener(event, resetSessionTimer)
    })

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, resetSessionTimer)
      })
    }
  }, [])

  const loadKioskData = async () => {
    try {
      setIsLoading(true)

      if (!kioskId) return

      const [kioskData, productsData] = await Promise.all([
        kioskService.getKiosk(kioskId),
        kioskService.getVendorProducts('vendor_123') // In real app, get from kiosk.vendorId
      ])

      if (!kioskData || !kioskData.isActive) {
        return // Will show error state
      }

      setKiosk(kioskData)
      setProducts(productsData)
    } catch (error) {
      console.error('Error loading kiosk data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const resetSession = useCallback(() => {
    setCart([])
    setCurrentView('products')
    setCustomerInfo({ name: '', email: '', phone: '' })
    setCashReceived(0)
    setShowCashInput(false)
    setCurrentOrder(null)
  }, [])

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existingItem = prev.find(item => item.product.id === product.id)
      if (existingItem) {
        return prev.map(item =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      } else {
        return [...prev, {
          id: `cart_${Date.now()}_${product.id}`,
          product,
          quantity: 1
        }]
      }
    })
  }

  const updateCartQuantity = (itemId: string, quantity: number) => {
    if (quantity <= 0) {
      setCart(prev => prev.filter(item => item.id !== itemId))
    } else {
      setCart(prev => prev.map(item =>
        item.id === itemId ? { ...item, quantity } : item
      ))
    }
  }

  const getCartTotal = () => {
    return cart.reduce((total, item) => total + (item.product.price * item.quantity), 0)
  }

  const getUniqueCategories = () => {
    const categories = [...new Set(products.map(p => p.category))]
    return ['all', ...categories]
  }

  const getFilteredProducts = () => {
    if (selectedCategory === 'all') {
      return products
    }
    return products.filter(p => p.category === selectedCategory)
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount)
  }

  const getCategoryDisplayName = (category: string) => {
    const categoryNames: Record<string, string> = {
      'all': 'All Products',
      'shirts': 'T-Shirts',
      'hoodies': 'Hoodies',
      'dtf-transfers': 'DTF Transfers',
      'tumblers': 'Tumblers',
      '3d-models': '3D Models'
    }
    return categoryNames[category] || category
  }

  const processPayment = async () => {
    if (!kiosk || cart.length === 0) return

    try {
      setPaymentProcessing(true)
      const total = getCartTotal()

      // Create the order first
      const orderData: Partial<KioskOrder> = {
        kioskId: kiosk.id,
        vendorId: kiosk.vendorId,
        items: cart,
        total,
        paymentMethod,
        customerName: customerInfo.name || undefined,
        customerEmail: customerInfo.email || undefined,
        customerPhone: customerInfo.phone || undefined
      }

      const order = await kioskService.createKioskOrder(orderData)

      // Process payment based on method
      let paymentResult: any

      switch (paymentMethod) {
        case 'card':
          paymentResult = await kioskService.processStripeTerminalPayment(
            total * 100, // Convert to cents
            'terminal_123', // In real app, get from kiosk settings
            { orderId: order.id, kioskId: kiosk.id }
          )

          if (paymentResult.status !== 'succeeded') {
            throw new Error('Card payment failed')
          }
          break

        case 'cash':
          if (cashReceived < total) {
            throw new Error('Insufficient cash received')
          }

          paymentResult = await kioskService.processCashPayment(
            total,
            cashReceived,
            kiosk.id
          )
          break

        case 'itc_wallet':
          paymentResult = await kioskService.processITCWalletPayment(
            total,
            customerInfo.email || 'guest@kiosk.local',
            kiosk.id
          )
          break

        default:
          throw new Error('Invalid payment method')
      }

      // Complete the order
      const completedOrder = await kioskService.completeKioskOrder(order.id, {
        amount: total,
        method: paymentMethod,
        ...paymentResult,
        customerName: customerInfo.name,
        customerEmail: customerInfo.email
      })

      setCurrentOrder(completedOrder)
      setCurrentView('receipt')

      // Auto-reset after showing receipt
      setTimeout(() => {
        resetSession()
      }, 30000) // 30 seconds

    } catch (error) {
      console.error('Payment processing error:', error)
      alert(`Payment failed: ${error}`)
    } finally {
      setPaymentProcessing(false)
    }
  }

  if (!kioskId && !previewData) {
    return <Navigate to="/" replace />
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-card flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-xl text-muted">Loading kiosk...</p>
        </div>
      </div>
    )
  }

  if (!kiosk || !kiosk.isActive) {
    return (
      <div className="min-h-screen bg-red-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="w-16 h-16 text-red-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <h2 className="text-2xl font-bold text-red-800 mb-2">Kiosk Unavailable</h2>
          <p className="text-red-600">This kiosk is currently offline or inactive.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-card" style={{
      fontFamily: kiosk.settings.touchOptimized ? 'system-ui, sans-serif' : 'inherit',
      fontSize: kiosk.settings.touchOptimized ? '1.125rem' : 'inherit'
    }}>
      {/* Header */}
      <header className="bg-card shadow-sm border-b-4" style={{ borderColor: kiosk.settings.primaryColor }}>
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              {kiosk.settings.logoUrl && (
                <img src={kiosk.settings.logoUrl} alt="Logo" className="h-12 w-auto" />
              )}
              <div>
                <h1 className="text-2xl font-bold text-text">{kiosk.name}</h1>
                <p className="text-muted">{kiosk.location}</p>
              </div>
            </div>

            {/* Cart Summary */}
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <p className="text-sm text-muted">Items: {cart.reduce((sum, item) => sum + item.quantity, 0)}</p>
                <p className="text-lg font-bold" style={{ color: kiosk.settings.primaryColor }}>
                  {formatCurrency(getCartTotal())}
                </p>
              </div>
              {cart.length > 0 && (
                <button
                  onClick={() => setCurrentView('cart')}
                  className="px-6 py-3 rounded-lg text-white font-medium touch-manipulation"
                  style={{ backgroundColor: kiosk.settings.primaryColor }}
                >
                  View Cart
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* Welcome Message */}
        {currentView === 'products' && cart.length === 0 && (
          <div className="text-center mb-8 p-8 bg-card rounded-lg shadow-sm">
            <h2 className="text-3xl font-bold text-text mb-2">
              {kiosk.settings.welcomeMessage}
            </h2>
            <p className="text-xl text-muted">
              Touch any product to add it to your cart
            </p>
          </div>
        )}

        {/* Products View */}
        {currentView === 'products' && (
          <div>
            {/* Category Filter */}
            <div className="mb-6 flex flex-wrap gap-3">
              {getUniqueCategories().map(category => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`px-6 py-3 rounded-lg font-medium touch-manipulation transition-colors ${selectedCategory === category
                    ? 'text-white'
                    : 'bg-card text-text hover:bg-card'
                    }`}
                  style={{
                    backgroundColor: selectedCategory === category ? kiosk.settings.primaryColor : undefined
                  }}
                >
                  {getCategoryDisplayName(category)}
                </button>
              ))}
            </div>

            {/* Products Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {getFilteredProducts().map(product => (
                <div
                  key={product.id}
                  onClick={() => addToCart(product)}
                  className="bg-card rounded-lg shadow-sm overflow-hidden cursor-pointer touch-manipulation transform transition-transform hover:scale-105 active:scale-95"
                >
                  <img
                    src={product.images[0]}
                    alt={product.name}
                    className="w-full h-48 object-cover"
                  />
                  <div className="p-4">
                    <h3 className="font-bold text-text mb-2 text-lg">{product.name}</h3>
                    <p className="text-muted text-sm mb-3 line-clamp-2">{product.description}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-bold" style={{ color: kiosk.settings.primaryColor }}>
                        {formatCurrency(product.price)}
                      </span>
                      <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-sm">
                        In Stock
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cart View */}
        {currentView === 'cart' && (
          <div className="bg-card rounded-lg shadow-sm">
            <div className="px-6 py-4 border-b card-border flex items-center justify-between">
              <h2 className="text-2xl font-bold text-text">Your Cart</h2>
              <button
                onClick={() => setCurrentView('products')}
                className="px-4 py-2 text-muted hover:text-gray-800 touch-manipulation"
              >
                ← Continue Shopping
              </button>
            </div>

            <div className="p-6">
              {cart.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xl text-muted">Your cart is empty</p>
                  <button
                    onClick={() => setCurrentView('products')}
                    className="mt-4 px-6 py-3 rounded-lg text-white font-medium touch-manipulation"
                    style={{ backgroundColor: kiosk.settings.primaryColor }}
                  >
                    Browse Products
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-4 mb-6">
                    {cart.map(item => (
                      <div key={item.id} className="flex items-center space-x-4 p-4 border card-border rounded-lg">
                        <img
                          src={item.product.images[0]}
                          alt={item.product.name}
                          className="w-16 h-16 object-cover rounded"
                        />
                        <div className="flex-1">
                          <h3 className="font-medium text-text">{item.product.name}</h3>
                          <p className="text-muted">{formatCurrency(item.product.price)}</p>
                        </div>
                        <div className="flex items-center space-x-3">
                          <button
                            onClick={() => updateCartQuantity(item.id, item.quantity - 1)}
                            className="w-10 h-10 rounded-full bg-gray-200 text-muted hover:bg-gray-300 touch-manipulation flex items-center justify-center"
                          >
                            -
                          </button>
                          <span className="text-xl font-medium w-8 text-center">{item.quantity}</span>
                          <button
                            onClick={() => updateCartQuantity(item.id, item.quantity + 1)}
                            className="w-10 h-10 rounded-full text-white hover:opacity-90 touch-manipulation flex items-center justify-center"
                            style={{ backgroundColor: kiosk.settings.primaryColor }}
                          >
                            +
                          </button>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold" style={{ color: kiosk.settings.primaryColor }}>
                            {formatCurrency(item.product.price * item.quantity)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Cart Total */}
                  <div className="border-t card-border pt-4 mb-6">
                    <div className="flex items-center justify-between text-2xl font-bold">
                      <span>Total:</span>
                      <span style={{ color: kiosk.settings.primaryColor }}>
                        {formatCurrency(getCartTotal())}
                      </span>
                    </div>
                  </div>

                  {/* Checkout Button */}
                  <button
                    onClick={() => setCurrentView('checkout')}
                    className="w-full py-4 rounded-lg text-white font-bold text-xl touch-manipulation shadow-lg"
                    style={{ backgroundColor: kiosk.settings.primaryColor }}
                  >
                    Proceed to Checkout
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Checkout View (Payment Selection) */}
        {currentView === 'checkout' && (
          <div className="bg-card rounded-lg shadow-sm max-w-2xl mx-auto">
            <div className="px-6 py-4 border-b card-border flex items-center justify-between">
              <h2 className="text-2xl font-bold text-text">Checkout</h2>
              <button
                onClick={() => setCurrentView('cart')}
                className="px-4 py-2 text-muted hover:text-gray-800 touch-manipulation"
              >
                ← Back to Cart
              </button>
            </div>

            <div className="p-6">
              <div className="mb-8">
                <h3 className="text-lg font-medium mb-4">Select Payment Method</h3>
                <div className="grid grid-cols-1 gap-4">
                  {kiosk.settings.allowStripeTerminal && (
                    <button
                      onClick={() => setPaymentMethod('card')}
                      className={`p-6 rounded-lg border-2 text-left transition-colors ${paymentMethod === 'card'
                        ? 'border-purple-600 bg-purple-50'
                        : 'border-gray-200 hover:border-gray-300'
                        }`}
                    >
                      <span className="block text-lg font-bold mb-1">Card Payment</span>
                      <span className="text-muted">Tap, insert, or swipe your card</span>
                    </button>
                  )}

                  {kiosk.settings.allowCash && (
                    <button
                      onClick={() => setPaymentMethod('cash')}
                      className={`p-6 rounded-lg border-2 text-left transition-colors ${paymentMethod === 'cash'
                        ? 'border-purple-600 bg-purple-50'
                        : 'border-gray-200 hover:border-gray-300'
                        }`}
                    >
                      <span className="block text-lg font-bold mb-1">Cash</span>
                      <span className="text-muted">Pay at the counter</span>
                    </button>
                  )}

                  {kiosk.settings.allowITCWallet && (
                    <button
                      onClick={() => setPaymentMethod('itc_wallet')}
                      className={`p-6 rounded-lg border-2 text-left transition-colors ${paymentMethod === 'itc_wallet'
                        ? 'border-purple-600 bg-purple-50'
                        : 'border-gray-200 hover:border-gray-300'
                        }`}
                    >
                      <span className="block text-lg font-bold mb-1">ITC Wallet</span>
                      <span className="text-muted">Pay with your account balance</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Customer Info (Optional) */}
              {kiosk.settings.requireCustomerInfo && (
                <div className="mb-8">
                  <h3 className="text-lg font-medium mb-4">Your Information</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-muted mb-1">Name</label>
                      <input
                        type="text"
                        value={customerInfo.name}
                        onChange={e => setCustomerInfo(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full bg-background border border-input rounded-lg px-4 py-3"
                        placeholder="John Doe"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-muted mb-1">Email (for receipt)</label>
                      <input
                        type="email"
                        value={customerInfo.email}
                        onChange={e => setCustomerInfo(prev => ({ ...prev, email: e.target.value }))}
                        className="w-full bg-background border border-input rounded-lg px-4 py-3"
                        placeholder="john@example.com"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="border-t card-border pt-6">
                <div className="flex justify-between text-xl font-bold mb-6">
                  <span>Total to Pay:</span>
                  <span style={{ color: kiosk.settings.primaryColor }}>
                    {formatCurrency(getCartTotal())}
                  </span>
                </div>

                <button
                  onClick={processPayment}
                  disabled={paymentProcessing}
                  className="w-full py-4 rounded-lg text-white font-bold text-xl touch-manipulation shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                  style={{ backgroundColor: kiosk.settings.primaryColor }}
                >
                  {paymentProcessing ? (
                    <>
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white mr-3"></div>
                      Processing...
                    </>
                  ) : (
                    'Pay Now'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Receipt View */}
        {currentView === 'receipt' && currentOrder && (
          <div className="max-w-md mx-auto bg-white p-8 rounded-lg shadow-lg text-center">
            <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h2 className="text-2xl font-bold text-gray-900 mb-2">Payment Successful!</h2>
            <p className="text-gray-600 mb-8">Thank you for your purchase.</p>

            <div className="border-t border-b border-gray-200 py-4 mb-6">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Order ID:</span>
                  <span>{currentOrder.id}</span>
                </div>
                {currentOrder.customerIdentifier && (
                  <div className="flex justify-between font-bold text-purple-600">
                    <span>Pickup Code:</span>
                    <span>{currentOrder.customerIdentifier}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Date:</span>
                  <span>{new Date().toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between font-bold text-lg mt-2">
                  <span>Total:</span>
                  <span>{formatCurrency(currentOrder.total)}</span>
                </div>
              </div>
            </div>

            <p className="text-sm text-gray-500 mb-6">
              A receipt has been sent to {currentOrder.customerEmail || 'your email'}.
            </p>

            <button
              onClick={resetSession}
              className="w-full py-3 rounded-lg font-medium text-white"
              style={{ backgroundColor: kiosk.settings.primaryColor }}
            >
              Start New Order
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

export default KioskInterface

import React, { useState, useEffect, useCallback } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import { kioskService } from '../utils/kiosk-service'
import type { Kiosk, Product, CartItem, KioskOrder } from '../types'

const KioskInterface: React.FC = () => {
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
    if (kioskId) {
      loadKioskData()
    }
  }, [kioskId])

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

  if (!kioskId) {
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
                  className={`px-6 py-3 rounded-lg font-medium touch-manipulation transition-colors ${
                    selectedCategory === category
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
                    className="w-full py-4 rounded-lg text-white text-xl font-bold touch-manipulation"
                    style={{ backgroundColor: kiosk.settings.primaryColor }}
                  >
                    Proceed to Checkout
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Checkout View */}
        {currentView === 'checkout' && (
          <div className="bg-card rounded-lg shadow-sm">
            <div className="px-6 py-4 border-b card-border flex items-center justify-between">
              <h2 className="text-2xl font-bold text-text">Checkout</h2>
              <button
                onClick={() => setCurrentView('cart')}
                className="px-4 py-2 text-muted hover:text-gray-800 touch-manipulation"
              >
                ← Back to Cart
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Customer Info (Optional) */}
              {kiosk.settings.requireCustomerInfo && (
                <div>
                  <h3 className="text-lg font-medium text-text mb-4">Customer Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <input
                      type="text"
                      placeholder="Name"
                      value={customerInfo.name}
                      onChange={(e) => setCustomerInfo(prev => ({ ...prev, name: e.target.value }))}
                      className="form-input text-lg py-3 touch-manipulation"
                    />
                    <input
                      type="email"
                      placeholder="Email"
                      value={customerInfo.email}
                      onChange={(e) => setCustomerInfo(prev => ({ ...prev, email: e.target.value }))}
                      className="form-input text-lg py-3 touch-manipulation"
                    />
                    <input
                      type="tel"
                      placeholder="Phone"
                      value={customerInfo.phone}
                      onChange={(e) => setCustomerInfo(prev => ({ ...prev, phone: e.target.value }))}
                      className="form-input text-lg py-3 touch-manipulation"
                    />
                  </div>
                </div>
              )}

              {/* Payment Method Selection */}
              <div>
                <h3 className="text-lg font-medium text-text mb-4">Payment Method</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {kiosk.settings.allowStripeTerminal && (
                    <button
                      onClick={() => setPaymentMethod('card')}
                      className={`p-6 border-2 rounded-lg touch-manipulation transition-colors ${
                        paymentMethod === 'card'
                          ? 'border-current text-white'
                          : 'card-border text-text hover:card-border'
                      }`}
                      style={{
                        backgroundColor: paymentMethod === 'card' ? kiosk.settings.primaryColor : undefined,
                        borderColor: paymentMethod === 'card' ? kiosk.settings.primaryColor : undefined
                      }}
                    >
                      <div className="text-center">
                        <svg className="w-8 h-8 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                        </svg>
                        <p className="font-medium">Card Payment</p>
                      </div>
                    </button>
                  )}

                  {kiosk.settings.allowCash && (
                    <button
                      onClick={() => setPaymentMethod('cash')}
                      className={`p-6 border-2 rounded-lg touch-manipulation transition-colors ${
                        paymentMethod === 'cash'
                          ? 'border-current text-white'
                          : 'card-border text-text hover:card-border'
                      }`}
                      style={{
                        backgroundColor: paymentMethod === 'cash' ? kiosk.settings.primaryColor : undefined,
                        borderColor: paymentMethod === 'cash' ? kiosk.settings.primaryColor : undefined
                      }}
                    >
                      <div className="text-center">
                        <svg className="w-8 h-8 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                        <p className="font-medium">Cash Payment</p>
                      </div>
                    </button>
                  )}

                  {kiosk.settings.allowITCWallet && (
                    <button
                      onClick={() => setPaymentMethod('itc_wallet')}
                      className={`p-6 border-2 rounded-lg touch-manipulation transition-colors ${
                        paymentMethod === 'itc_wallet'
                          ? 'border-current text-white'
                          : 'card-border text-text hover:card-border'
                      }`}
                      style={{
                        backgroundColor: paymentMethod === 'itc_wallet' ? kiosk.settings.primaryColor : undefined,
                        borderColor: paymentMethod === 'itc_wallet' ? kiosk.settings.primaryColor : undefined
                      }}
                    >
                      <div className="text-center">
                        <svg className="w-8 h-8 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                        </svg>
                        <p className="font-medium">ITC Wallet</p>
                      </div>
                    </button>
                  )}
                </div>
              </div>

              {/* Cash Input */}
              {paymentMethod === 'cash' && (
                <div>
                  <h3 className="text-lg font-medium text-text mb-4">Cash Payment</h3>
                  <div className="bg-card p-4 rounded-lg">
                    <p className="text-lg mb-4">Total: {formatCurrency(getCartTotal())}</p>
                    <div className="flex items-center space-x-4">
                      <label className="text-sm font-medium text-text">Cash Received:</label>
                      <input
                        type="number"
                        step="0.01"
                        min={getCartTotal()}
                        value={cashReceived || ''}
                        onChange={(e) => setCashReceived(parseFloat(e.target.value) || 0)}
                        className="form-input text-lg py-2 touch-manipulation"
                        placeholder="0.00"
                      />
                    </div>
                    {cashReceived > getCartTotal() && (
                      <p className="text-green-600 mt-2">
                        Change: {formatCurrency(cashReceived - getCartTotal())}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* ITC Wallet Info */}
              {paymentMethod === 'itc_wallet' && (
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-blue-800">
                    This will deduct {Math.ceil(getCartTotal() * 10)} ITC tokens from the customer's wallet.
                  </p>
                  {customerInfo.email && (
                    <p className="text-sm text-blue-600 mt-1">
                      Wallet: {customerInfo.email}
                    </p>
                  )}
                </div>
              )}

              {/* Order Summary */}
              <div className="border-t card-border pt-4">
                <h3 className="text-lg font-medium text-text mb-4">Order Summary</h3>
                <div className="space-y-2 mb-4">
                  {cart.map(item => (
                    <div key={item.id} className="flex justify-between">
                      <span>{item.product.name} x{item.quantity}</span>
                      <span>{formatCurrency(item.product.price * item.quantity)}</span>
                    </div>
                  ))}
                </div>
                <div className="text-2xl font-bold flex justify-between">
                  <span>Total:</span>
                  <span style={{ color: kiosk.settings.primaryColor }}>
                    {formatCurrency(getCartTotal())}
                  </span>
                </div>
              </div>

              {/* Process Payment Button */}
              <button
                onClick={processPayment}
                disabled={paymentProcessing || (paymentMethod === 'cash' && cashReceived < getCartTotal())}
                className="w-full py-4 rounded-lg text-white text-xl font-bold touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: kiosk.settings.primaryColor }}
              >
                {paymentProcessing ? 'Processing...' : `Pay ${formatCurrency(getCartTotal())}`}
              </button>
            </div>
          </div>
        )}

        {/* Receipt View */}
        {currentView === 'receipt' && currentOrder && (
          <div className="bg-card rounded-lg shadow-sm">
            <div className="px-6 py-4 border-b card-border text-center">
              <h2 className="text-2xl font-bold text-green-600">Payment Successful!</h2>
            </div>
            
            <div className="p-6 text-center">
              <div className="text-6xl mb-4">✓</div>
              <h3 className="text-xl font-medium text-text mb-4">Thank you for your purchase!</h3>
              
              <div className="bg-card p-4 rounded-lg mb-6 text-left max-w-md mx-auto">
                <h4 className="font-medium text-text mb-2">Receipt</h4>
                <div className="text-sm space-y-1">
                  <div className="flex justify-between">
                    <span>Order ID:</span>
                    <span>{currentOrder.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Date:</span>
                    <span>{new Date().toLocaleDateString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Payment:</span>
                    <span className="capitalize">{currentOrder.paymentMethod.replace('_', ' ')}</span>
                  </div>
                  <div className="flex justify-between font-bold pt-2 border-t">
                    <span>Total:</span>
                    <span>{formatCurrency(currentOrder.total)}</span>
                  </div>
                </div>
              </div>

              <p className="text-muted mb-6">
                A new order will start automatically in a few seconds.
              </p>

              <button
                onClick={resetSession}
                className="px-8 py-3 rounded-lg text-white font-medium touch-manipulation"
                style={{ backgroundColor: kiosk.settings.primaryColor }}
              >
                Start New Order
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default KioskInterface
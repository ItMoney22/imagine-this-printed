import React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useCart } from '../context/CartContext'
import ProductRecommendations from '../components/ProductRecommendations'

const Cart: React.FC = () => {
  const { state, removeFromCart, updateQuantity } = useCart()
  const navigate = useNavigate()

  if (state.items.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4m0 0L7 13m0 0l-3.5 7M7 13l-3.5 7m0 0h8m-8 0h8m0-10V9a3 3 0 013-3v0a3 3 0 013 3v4" />
          </svg>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Your cart is empty</h2>
          <p className="text-gray-600 mb-6">Start shopping to add items to your cart</p>
          <Link to="/catalog" className="btn-primary">
            Browse Products
          </Link>
        </div>
      </div>
    )
  }

  const handleQuantityChange = (itemId: string, newQuantity: number) => {
    if (newQuantity === 0) {
      removeFromCart(itemId)
    } else {
      updateQuantity(itemId, newQuantity)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Shopping Cart</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold">Cart Items ({state.items.length})</h2>
            </div>
            
            <div className="divide-y divide-gray-200">
              {state.items.map((item) => (
                <div key={item.id} className="p-6 flex items-center space-x-4">
                  <img 
                    src={item.product.images[0]} 
                    alt={item.product.name}
                    className="w-20 h-20 object-cover rounded-md"
                  />
                  
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900">{item.product.name}</h3>
                    <p className="text-gray-600">{item.product.description}</p>
                    {item.customDesign && (
                      <p className="text-sm text-purple-600 mt-1">Custom Design Included</p>
                    )}
                    <p className="text-lg font-bold text-purple-600 mt-2">
                      ${item.product.price.toFixed(2)}
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleQuantityChange(item.id, item.quantity - 1)}
                      className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-100"
                    >
                      -
                    </button>
                    <span className="w-12 text-center font-semibold">{item.quantity}</span>
                    <button
                      onClick={() => handleQuantityChange(item.id, item.quantity + 1)}
                      className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center hover:bg-gray-100"
                    >
                      +
                    </button>
                  </div>

                  <div className="text-right">
                    <p className="text-lg font-bold">
                      ${(item.product.price * item.quantity).toFixed(2)}
                    </p>
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="text-red-600 hover:text-red-800 text-sm mt-1"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow p-6 sticky top-8">
            <h2 className="text-lg font-semibold mb-4">Order Summary</h2>
            
            <div className="space-y-3 mb-6">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>${state.total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Shipping</span>
                <span>{state.total >= 50 ? 'Free' : '$9.99'}</span>
              </div>
              <div className="flex justify-between">
                <span>Tax</span>
                <span>${(state.total * 0.08).toFixed(2)}</span>
              </div>
              <div className="border-t pt-3 flex justify-between font-bold text-lg">
                <span>Total</span>
                <span>
                  ${(state.total + (state.total >= 50 ? 0 : 9.99) + state.total * 0.08).toFixed(2)}
                </span>
              </div>
            </div>

            {state.total < 50 && (
              <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mb-4">
                <p className="text-sm text-blue-800">
                  Add ${(50 - state.total).toFixed(2)} more for free shipping!
                </p>
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={() => navigate('/checkout')}
                className="w-full btn-primary"
              >
                Proceed to Checkout
              </button>
              <Link 
                to="/catalog"
                className="w-full btn-secondary text-center block"
              >
                Continue Shopping
              </Link>
            </div>

            <div className="mt-6 pt-6 border-t">
              <h3 className="font-semibold mb-2">Need Help?</h3>
              <p className="text-sm text-gray-600">
                Contact our support team for assistance with your order.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Cart-based Recommendations */}
      {state.items.length > 0 && (
        <div className="mt-12">
          <ProductRecommendations
            context={{
              page: 'cart',
              cartItems: state.items,
              limit: 6,
              excludeIds: state.items.map(item => item.product.id)
            }}
            title="Complete Your Order"
            showReason={true}
            onProductClick={(product, _position) => {
              navigate(`/product/${product.id}`)
            }}
          />
        </div>
      )}
    </div>
  )
}

export default Cart
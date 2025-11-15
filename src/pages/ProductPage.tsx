import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Palette, ShoppingCart, Zap } from 'lucide-react'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/SupabaseAuthContext'
import { supabase } from '../lib/supabase'
import { productRecommender } from '../utils/product-recommender'
import ProductRecommendations from '../components/ProductRecommendations'
import DesignStudioModal from '../components/DesignStudioModal'
import type { Product } from '../types'

const ProductPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { addToCart } = useCart()
  const { user } = useAuth()
  const [quantity, setQuantity] = useState(1)
  const [selectedImage, setSelectedImage] = useState(0)
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(true)
  const [showDesignModal, setShowDesignModal] = useState(false)

  // Load product from database
  useEffect(() => {
    const loadProduct = async () => {
      if (!id) {
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('id', id)
          .single()

        if (error) throw error

        if (data) {
          const mappedProduct: Product = {
            id: data.id,
            name: data.name,
            description: data.description || '',
            price: data.price || 0,
            images: data.images || [],
            category: data.category || 'shirts',
            inStock: data.is_active !== false,
            createdAt: data.created_at,
            updatedAt: data.updated_at
          }
          setProduct(mappedProduct)
        }
      } catch (error) {
        console.error('Error loading product:', error)
      } finally {
        setLoading(false)
      }
    }

    loadProduct()
  }, [id])

  // Track product view for recommendations
  useEffect(() => {
    if (product && user) {
      productRecommender.updateUserBehavior(user.id, 'view', {
        productId: product.id,
        category: product.category
      })
    }
  }, [product, user])

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-center items-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </div>
    )
  }

  if (!product) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-text mb-4">Product Not Found</h1>
          <button
            onClick={() => navigate('/catalog')}
            className="btn-primary shadow-glow"
          >
            Back to Catalog
          </button>
        </div>
      </div>
    )
  }

  const handleAddToCart = () => {
    addToCart(product, quantity)
    alert('Product added to cart!')
  }

  const handleBuyNow = () => {
    addToCart(product, quantity)
    navigate('/checkout')
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <button
        onClick={() => navigate(-1)}
        className="mb-6 text-primary hover:text-secondary flex items-center transition-colors"
      >
        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        Back
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <div className="mb-4">
            <img
              src={product.images && product.images.length > 0
                ? product.images[selectedImage]
                : 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=600&h=600&fit=crop'}
              alt={product.name}
              className="w-full h-96 object-cover rounded-lg shadow-lg"
              onError={(e) => {
                (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=600&h=600&fit=crop'
              }}
            />
          </div>

          {product.images && product.images.length > 1 && (
            <div className="flex space-x-2 overflow-x-auto">
              {product.images.map((image, index) => (
                <button
                  key={index}
                  onClick={() => setSelectedImage(index)}
                  className={`flex-shrink-0 w-20 h-20 rounded-md overflow-hidden border-2 ${
                    selectedImage === index ? 'border-primary shadow-glow' : 'card-border'
                  }`}
                >
                  <img
                    src={image}
                    alt={`${product.name} ${index + 1}`}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=600&h=600&fit=crop'
                    }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-text mb-2">{product.name}</h1>
            <p className="text-3xl font-bold text-primary">${product.price}</p>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2 text-text">Description</h3>
            <p className="text-muted leading-relaxed">{product.description}</p>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2 text-text">Features</h3>
            <ul className="text-muted space-y-1">
              <li>• High-quality materials</li>
              <li>• Custom printing available</li>
              <li>• Fast processing time</li>
              <li>• Satisfaction guaranteed</li>
            </ul>
          </div>

          <div className="border-t card-border pt-6">
            <div className="flex items-center space-x-4 mb-4">
              <label className="text-sm font-medium text-text">Quantity:</label>
              <div className="flex items-center border card-border rounded-md">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="px-3 py-1 hover:bg-card transition-colors"
                >
                  -
                </button>
                <span className="px-4 py-1 border-x card-border">{quantity}</span>
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="px-3 py-1 hover:bg-card transition-colors"
                >
                  +
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => setShowDesignModal(true)}
                className="w-full bg-gradient-to-r from-primary via-secondary to-accent hover:shadow-glowLg text-white font-bold py-4 px-6 rounded-lg transition-all transform hover:scale-105 flex items-center justify-center gap-3 text-lg shadow-glow"
              >
                <Palette className="w-6 h-6" />
                Start Designing
              </button>

              <button
                onClick={handleAddToCart}
                disabled={!product.inStock}
                className="w-full btn-primary shadow-glow disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <ShoppingCart className="w-4 h-4" />
                {product.inStock ? 'Add to Cart' : 'Out of Stock'}
              </button>

              <button
                onClick={handleBuyNow}
                disabled={!product.inStock}
                className="w-full btn-secondary disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Zap className="w-4 h-4" />
                Buy Now
              </button>
            </div>
          </div>

          <div className="bg-card card-border p-4 rounded-lg">
            <h4 className="font-semibold mb-2 text-text">Shipping Information</h4>
            <p className="text-sm text-muted">
              • Free shipping on orders over $50<br/>
              • Standard delivery: 3-5 business days<br/>
              • Express delivery: 1-2 business days
            </p>
          </div>
        </div>
      </div>

      {/* Similar Products Recommendations */}
      <div className="mt-16">
        <ProductRecommendations
          context={{
            page: 'product',
            currentProduct: product,
            limit: 6,
            excludeIds: [product.id]
          }}
          title="Similar Products"
          showReason={true}
          onProductClick={(recommendedProduct, _position) => {
            navigate(`/product/${recommendedProduct.id}`)
          }}
        />
      </div>

      {/* Cross-sell Recommendations */}
      <div className="mt-8">
        <ProductRecommendations
          context={{
            page: 'product',
            currentProduct: product,
            limit: 4,
            excludeIds: [product.id]
          }}
          title="Customers Also Bought"
          className="border-t pt-8"
          onProductClick={(recommendedProduct, _position) => {
            navigate(`/product/${recommendedProduct.id}`)
          }}
        />
      </div>

      <DesignStudioModal
        isOpen={showDesignModal}
        onClose={() => setShowDesignModal(false)}
        product={product}
        template={product.category === 'shirts' || product.category === 'hoodies' ? 'shirt' : 'tumbler'}
        initialDesignImage={product.images?.[0]}
      />
    </div>
  )
}

export default ProductPage

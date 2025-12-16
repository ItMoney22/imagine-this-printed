import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Sparkles, ShoppingCart, Zap } from 'lucide-react'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/SupabaseAuthContext'
import { supabase } from '../lib/supabase'
import { productRecommender } from '../utils/product-recommender'
import ProductRecommendations from '../components/ProductRecommendations'
import type { Product } from '../types'

const ProductPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { addToCart } = useCart()
  const { user } = useAuth()
  const [quantity, setQuantity] = useState(1)
  const [selectedImage, setSelectedImage] = useState(0)
  const [product, setProduct] = useState<Product | null>(null)
  const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSize, setSelectedSize] = useState<string>('')
  const [selectedColor, setSelectedColor] = useState<string>('')

  // Load product and source image from database
  useEffect(() => {
    const loadProduct = async () => {
      if (!id) {
        setLoading(false)
        return
      }

      try {
        setLoading(true)

        // Fetch product
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
            updatedAt: data.updated_at,
            metadata: data.metadata || {},
            isThreeForTwentyFive: data.metadata?.isThreeForTwentyFive || false,
            sizes: data.metadata?.sizes || [],
            colors: data.metadata?.colors || []
          }
          setProduct(mappedProduct)

          // Fetch source image from product_assets (the original Flux-generated image)
          const { data: assetsData } = await supabase
            .from('product_assets')
            .select('url, kind')
            .eq('product_id', id)
            .in('kind', ['source', 'nobg']) // Prefer source, fallback to nobg
            .order('kind', { ascending: true }) // 'nobg' comes before 'source' alphabetically, so we'll pick source first below

          if (assetsData && assetsData.length > 0) {
            // Prefer 'source' (original Flux image), then 'nobg' (background removed)
            const sourceAsset = assetsData.find(a => a.kind === 'source')
            const nobgAsset = assetsData.find(a => a.kind === 'nobg')
            setSourceImageUrl(sourceAsset?.url || nobgAsset?.url || null)
          }
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
    if (product?.sizes?.length && !selectedSize) {
      alert('Please select a size')
      return
    }
    if (product?.colors?.length && !selectedColor) {
      alert('Please select a color')
      return
    }
    if (product) {
      addToCart(product, quantity, selectedSize, selectedColor)
      alert('Product added to cart!')
    }
  }

  const handleBuyNow = () => {
    if (product?.sizes?.length && !selectedSize) {
      alert('Please select a size')
      return
    }
    if (product?.colors?.length && !selectedColor) {
      alert('Please select a color')
      return
    }
    if (product) {
      addToCart(product, quantity, selectedSize, selectedColor)
      navigate('/checkout')
    }
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
                  className={`flex-shrink-0 w-20 h-20 rounded-md overflow-hidden border-2 ${selectedImage === index ? 'border-primary shadow-glow' : 'card-border'
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
            {/* Variants */}
            {product.sizes && product.sizes.length > 0 && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-text mb-2">Size</label>
                <div className="flex flex-wrap gap-2">
                  {product.sizes.map(size => (
                    <button
                      key={size}
                      onClick={() => setSelectedSize(size)}
                      className={`px-4 py-2 rounded-md border transition-colors ${selectedSize === size
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-gray-700 hover:border-gray-500 text-text'
                        }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {product.colors && product.colors.length > 0 && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-text mb-2">Color</label>
                <div className="flex flex-wrap gap-2">
                  {product.colors.map(color => (
                    <button
                      key={color}
                      onClick={() => setSelectedColor(color)}
                      className={`px-4 py-2 rounded-md border transition-colors ${selectedColor === color
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-gray-700 hover:border-gray-500 text-text'
                        }`}
                    >
                      {color}
                    </button>
                  ))}
                </div>
              </div>
            )}

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
                onClick={() => {
                  // Navigate to Imagination Station with the SOURCE image (original Flux-generated)
                  // sourceImageUrl is fetched from product_assets table (kind='source' or 'nobg')
                  const imageToAdd = sourceImageUrl || product.images?.[0] || ''
                  if (!imageToAdd) {
                    alert('No source image available for this product')
                    return
                  }
                  const params = new URLSearchParams({
                    addImage: imageToAdd,
                    productName: product.name,
                    productId: product.id
                  })
                  navigate(`/imagination-station?${params.toString()}`)
                }}
                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 hover:shadow-glowLg text-white font-bold py-4 px-6 rounded-lg transition-all transform hover:scale-105 flex items-center justify-center gap-3 text-lg shadow-[0_0_20px_rgba(168,85,247,0.4)]"
              >
                <Sparkles className="w-6 h-6" />
                Add to Imagination Sheet™
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
              • Free shipping on orders over $50<br />
              • Standard delivery: 3-5 business days<br />
              • Express delivery: 1-2 business days
            </p>
          </div>

          <div className="bg-purple-50 border border-purple-200 p-4 rounded-lg relative overflow-hidden group shadow-sm">
            <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
              <svg className="w-16 h-16 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
              </svg>
            </div>
            <h4 className="font-bold text-purple-900 mb-2 flex items-center gap-2">
              <span className="text-xl">💎</span> Earn ITC for Your Designs!
            </h4>
            <p className="text-sm text-purple-800 mb-3 font-medium">
              Did you know you can earn Imagine This Coin (ITC) when your submitted designs sell?
            </p>
            <button
              onClick={() => navigate('/creator-signup')}
              className="text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-full transition-all shadow-md hover:shadow-lg"
            >
              Become a Creator →
            </button>
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
    </div>
  )
}

export default ProductPage

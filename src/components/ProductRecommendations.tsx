import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { productRecommender } from '../utils/product-recommender'
import type { Product, RecommendationContext } from '../types'

interface ProductRecommendationsProps {
  context: RecommendationContext
  title?: string
  className?: string
  showReason?: boolean
  onProductClick?: (product: Product, position: number) => void
}

const ProductRecommendations: React.FC<ProductRecommendationsProps> = ({
  context,
  title = "You Might Also Like",
  className = "",
  showReason = false,
  onProductClick
}) => {
  const { user } = useAuth()
  const [recommendations, setRecommendations] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadRecommendations()
  }, [context, user])

  const loadRecommendations = async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const recommendationContext: RecommendationContext = {
        ...context,
        user: user ? {
          id: user.id,
          email: user.email || '',
          role: user.role as any,
          firstName: (user as any).firstName,
          lastName: (user as any).lastName
        } : undefined
      }
      
      const products = await productRecommender.getRecommendations(recommendationContext)
      setRecommendations(products)
    } catch (err) {
      setError('Failed to load recommendations')
      console.error('Error loading recommendations:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleProductClick = (product: Product, position: number) => {
    // Track recommendation click
    if (user) {
      productRecommender.trackRecommendationClick(
        user.id,
        product.id,
        context.page,
        position
      )
      
      // Update user behavior
      productRecommender.updateUserBehavior(user.id, 'view', {
        productId: product.id,
        category: product.category
      })
    }
    
    if (onProductClick) {
      onProductClick(product, position)
    }
  }

  if (isLoading) {
    return (
      <div className={`bg-white rounded-lg shadow p-6 ${className}`}>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[...Array(6)].map((_, index) => (
            <div key={index} className="animate-pulse">
              <div className="bg-gray-200 rounded-lg h-40 mb-2"></div>
              <div className="bg-gray-200 rounded h-4 mb-1"></div>
              <div className="bg-gray-200 rounded h-3 w-2/3"></div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`bg-white rounded-lg shadow p-6 ${className}`}>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        <div className="text-center py-8">
          <p className="text-gray-500">{error}</p>
          <button
            onClick={loadRecommendations}
            className="mt-2 text-purple-600 hover:text-purple-700 font-medium"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  if (recommendations.length === 0) {
    return null
  }

  return (
    <div className={`bg-white rounded-lg shadow p-6 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <div className="flex items-center text-sm text-gray-500">
          <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          </svg>
          Personalized for you
        </div>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {recommendations.map((product, index) => (
          <div
            key={product.id}
            className="group cursor-pointer"
            onClick={() => handleProductClick(product, index)}
          >
            <div className="bg-gray-100 rounded-lg overflow-hidden mb-2 group-hover:shadow-md transition-shadow">
              <img
                src={product.images[0] || '/placeholder-product.jpg'}
                alt={product.name}
                className="w-full h-40 object-cover group-hover:scale-105 transition-transform duration-200"
              />
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="bg-white rounded-full p-1 shadow-md">
                  <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </div>
              </div>
            </div>
            
            <div>
              <h4 className="font-medium text-gray-900 text-sm group-hover:text-purple-600 transition-colors line-clamp-2">
                {product.name}
              </h4>
              <p className="text-purple-600 font-semibold text-sm mt-1">
                ${product.price.toFixed(2)}
              </p>
              
              {showReason && (
                <p className="text-xs text-gray-500 mt-1">
                  Trending this week
                </p>
              )}
              
              {!product.inStock && (
                <span className="inline-block bg-red-100 text-red-800 text-xs px-2 py-1 rounded mt-1">
                  Out of Stock
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      
      <div className="mt-4 text-center">
        <button className="text-purple-600 hover:text-purple-700 font-medium text-sm">
          View All Recommendations →
        </button>
      </div>
    </div>
  )
}

export default ProductRecommendations
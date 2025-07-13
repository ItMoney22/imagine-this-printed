import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { socialService } from '../utils/social-service'
import SocialBadge from './SocialBadge'
import type { Product, SocialPost } from '../types'

interface ProductCardProps {
  product: Product
  showSocialBadges?: boolean
}

const ProductCard: React.FC<ProductCardProps> = ({ product, showSocialBadges = true }) => {
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (showSocialBadges) {
      loadSocialPosts()
    }
  }, [product.id, showSocialBadges])

  const loadSocialPosts = async () => {
    try {
      setIsLoading(true)
      const posts = await socialService.getPostsByProduct(product.id)
      setSocialPosts(posts)
    } catch (error) {
      console.error('Error loading social posts for product:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const getFeaturedPlatforms = () => {
    const platforms = new Set<string>()
    socialPosts.forEach(post => {
      if (post.isFeatured) {
        platforms.add(post.platform)
      }
    })
    return Array.from(platforms)
  }

  const getMostEngagedPlatform = () => {
    if (socialPosts.length === 0) return null
    
    const platformEngagement = socialPosts.reduce((acc, post) => {
      const totalEngagement = post.engagement.likes + post.engagement.shares + post.engagement.comments
      acc[post.platform] = (acc[post.platform] || 0) + totalEngagement
      return acc
    }, {} as Record<string, number>)

    const topPlatform = Object.entries(platformEngagement).reduce((a, b) => 
      a[1] > b[1] ? a : b
    )[0]

    return topPlatform
  }

  const featuredPlatforms = getFeaturedPlatforms()
  const topPlatform = getMostEngagedPlatform()

  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden hover:shadow-xl transition-shadow">
      <div className="relative">
        <Link to={`/product/${product.id}`}>
          <img 
            src={product.images[0]} 
            alt={product.name}
            className="w-full h-48 object-cover hover:scale-105 transition-transform"
          />
        </Link>
        
        {/* Social Badges Overlay */}
        {showSocialBadges && !isLoading && socialPosts.length > 0 && (
          <div className="absolute top-2 left-2 space-y-1">
            {featuredPlatforms.length > 0 && (
              <SocialBadge 
                platform={featuredPlatforms[0] as any}
                type="featured_in"
                size="small"
              />
            )}
            {!featuredPlatforms.includes(topPlatform || '') && topPlatform && (
              <SocialBadge 
                platform={topPlatform as any}
                type="as_seen_on"
                size="small"
              />
            )}
          </div>
        )}

        {/* Stock Status Badge */}
        <div className="absolute top-2 right-2">
          {product.inStock ? (
            <span className="bg-green-100 text-green-800 text-xs font-medium px-2 py-1 rounded-full">
              In Stock
            </span>
          ) : (
            <span className="bg-red-100 text-red-800 text-xs font-medium px-2 py-1 rounded-full">
              Out of Stock
            </span>
          )}
        </div>
      </div>

      <div className="p-4">
        <Link to={`/product/${product.id}`}>
          <h3 className="text-lg font-semibold text-gray-900 mb-2 hover:text-purple-600 line-clamp-1">
            {product.name}
          </h3>
        </Link>
        <p className="text-gray-600 text-sm mb-3 line-clamp-2">{product.description}</p>
        
        {/* Social Stats */}
        {showSocialBadges && socialPosts.length > 0 && (
          <div className="flex items-center space-x-3 text-xs text-gray-500 mb-3">
            <span>📱 {socialPosts.length} social mentions</span>
            <span>⭐ {socialPosts.filter(p => p.isFeatured).length} featured</span>
          </div>
        )}

        <div className="flex justify-between items-center mb-3">
          <span className="text-xl font-bold text-purple-600">${product.price}</span>
        </div>
        
        <Link 
          to={`/product/${product.id}`}
          className="btn-primary w-full text-center block"
        >
          View Details
        </Link>
      </div>
    </div>
  )
}

export default ProductCard
import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Sparkles, Loader2 } from 'lucide-react'
import { socialService } from '../utils/social-service'
import { supabase } from '../lib/supabase'
import SocialBadge from './SocialBadge'
import type { Product, SocialPost } from '../types'

interface ProductCardProps {
  product: Product
  showSocialBadges?: boolean
}

const ProductCard: React.FC<ProductCardProps> = ({ product, showSocialBadges = true }) => {
  const navigate = useNavigate()
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isAddingToSheet, setIsAddingToSheet] = useState(false)

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

  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isHovered, setIsHovered] = useState(false)

  useEffect(() => {
    let interval: NodeJS.Timeout

    if (isHovered && product.images && product.images.length > 1) {
      interval = setInterval(() => {
        setCurrentImageIndex((prev) => (prev + 1) % product.images.length)
      }, 1500)
    } else {
      setCurrentImageIndex(0)
    }

    return () => clearInterval(interval)
  }, [isHovered, product.images])

  // Fallback image if no images available
  const productImage = product.images && product.images.length > 0
    ? product.images[currentImageIndex]
    : 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=600&h=600&fit=crop'

  return (
    <div
      className="group relative bg-card border border-white/10 rounded-xl overflow-hidden transition-all duration-300 hover:shadow-glow hover:-translate-y-1"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="relative aspect-square overflow-hidden">
        <Link to={`/product/${product.id}`}>
          <img
            src={productImage}
            alt={product.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 transition-opacity"
            onError={(e) => {
              // Fallback if image fails to load
              (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=600&h=600&fit=crop'
            }}
          />
        </Link>

        {/* Social Badges Overlay */}
        {showSocialBadges && !isLoading && socialPosts.length > 0 && (
          <div className="absolute top-2 left-2 space-y-1 z-10">
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
        <div className="absolute top-2 right-2 z-10">
          {product.inStock ? (
            <span className="bg-green-500/20 backdrop-blur-md border border-green-500/50 text-green-400 text-xs font-bold px-2 py-1 rounded-full shadow-[0_0_10px_rgba(74,222,128,0.3)]">
              In Stock
            </span>
          ) : (
            <span className="bg-red-500/20 backdrop-blur-md border border-red-500/50 text-red-400 text-xs font-bold px-2 py-1 rounded-full shadow-[0_0_10px_rgba(248,113,113,0.3)]">
              Out of Stock
            </span>
          )}
        </div>

        {/* Promo Badge */}
        {(product.isThreeForTwentyFive || product.metadata?.isThreeForTwentyFive) && (
          <div className="absolute top-2 left-2 z-10 mt-8">
            <span className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg border border-white/20 animate-pulse">
              3 for $25!
            </span>
          </div>
        )}

        {/* User Submitted Badge */}
        {(product as any).isUserSubmitted && (
          <div className="absolute top-2 left-2 z-10 mt-16">
            <span className="bg-gradient-to-r from-pink-500 to-rose-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg border border-white/20">
              User Design
            </span>
          </div>
        )}

        {/* Overlay Gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-bg/90 via-transparent to-transparent opacity-60"></div>
      </div>

      <div className="p-5 relative">
        <Link to={`/product/${product.id}`}>
          <h3 className="text-lg font-display font-bold text-text mb-2 group-hover:text-primary transition-colors line-clamp-1">
            {product.name}
          </h3>
        </Link>
        <p className="text-muted text-sm mb-4 line-clamp-2">{product.description}</p>

        {/* Social Stats */}
        {showSocialBadges && socialPosts.length > 0 && (
          <div className="flex items-center space-x-3 text-xs text-muted mb-4">
            <span>📱 {socialPosts.length} social mentions</span>
            <span>⭐ {socialPosts.filter(p => p.isFeatured).length} featured</span>
          </div>
        )}

        <div className="flex justify-between items-center mb-4">
          <span className="text-xl font-bold text-primary drop-shadow-[0_0_10px_rgba(168,85,247,0.5)]">${product.price}</span>
        </div>

        <div className="space-y-3">
          <Link
            to={`/product/${product.id}`}
            className="btn-primary w-full text-center block text-sm uppercase tracking-wider"
          >
            View Details
          </Link>

          <button
            onClick={async () => {
              // Fetch SOURCE image from product_assets (original Flux-generated image)
              setIsAddingToSheet(true)
              try {
                const { data: assetsData } = await supabase
                  .from('product_assets')
                  .select('url, kind')
                  .eq('product_id', product.id)
                  .in('kind', ['source', 'nobg'])

                let imageToAdd = product.images?.[0] || ''

                if (assetsData && assetsData.length > 0) {
                  // Prefer 'source' (original Flux image), then 'nobg' (background removed)
                  const sourceAsset = assetsData.find(a => a.kind === 'source')
                  const nobgAsset = assetsData.find(a => a.kind === 'nobg')
                  imageToAdd = sourceAsset?.url || nobgAsset?.url || imageToAdd
                }

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
              } catch (error) {
                console.error('Error fetching source image:', error)
                // Fallback to first image
                const params = new URLSearchParams({
                  addImage: product.images?.[0] || '',
                  productName: product.name,
                  productId: product.id
                })
                navigate(`/imagination-station?${params.toString()}`)
              } finally {
                setIsAddingToSheet(false)
              }
            }}
            disabled={isAddingToSheet}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold py-2 px-4 rounded-lg transition-all flex items-center justify-center gap-2 text-sm uppercase tracking-wider shadow-[0_0_15px_rgba(168,85,247,0.3)] hover:shadow-[0_0_20px_rgba(168,85,247,0.5)] disabled:opacity-70"
          >
            {isAddingToSheet ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {isAddingToSheet ? 'Loading...' : 'Add to Imagination Sheet'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ProductCard

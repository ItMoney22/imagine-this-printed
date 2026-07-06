import React, { useEffect, useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Sparkles, Loader2, ShoppingCart, Check } from 'lucide-react'
import { socialService } from '../utils/social-service'
import { supabase } from '../lib/supabase'
import SocialBadge from './SocialBadge'
import ProtectedImage from './ProtectedImage'
import { useCart } from '../context/CartContext'
import { getColorName, isLightSwatch } from '../utils/color-presets'
import { getPromoBadge } from '../utils/product-promo'
import { usdToItcLabel } from '../lib/itc-pricing'
import { productKindOf, defaultSizesFor, getGalleryImages } from '../lib/product-kind'
import type { Product, SocialPost } from '../types'

interface ProductCardProps {
  product: Product
  showSocialBadges?: boolean
}

const ProductCard: React.FC<ProductCardProps> = ({ product, showSocialBadges = true }) => {
  const navigate = useNavigate()
  const { addToCart } = useCart()
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isAddingToSheet, setIsAddingToSheet] = useState(false)
  const [showSizePicker, setShowSizePicker] = useState(false)
  const [selectedSize, setSelectedSize] = useState<string | null>(null)
  const [selectedColor, setSelectedColor] = useState<string | null>(null)
  const [addedToCart, setAddedToCart] = useState(false)

  // Product kind drives type-aware UI (metal/3D must not look like a t-shirt).
  const kind = productKindOf(product)
  const isApparel = kind === 'apparel'

  // Get sizes from product metadata
  const sizes = product.sizes || product.metadata?.sizes || []
  const hasSizes = sizes.length > 0

  // Fallback sizes are type-aware: metal → print sizes, 3D → tiers, else apparel.
  const defaultSizes = defaultSizesFor(kind)
  const displaySizes = hasSizes ? sizes : defaultSizes

  // Get colors from product (admin saves them as hex strings on product.colors / metadata.colors)
  const colors: string[] = product.colors || product.metadata?.colors || []
  const hasColors = colors.length > 0

  // Quick Add is satisfied when every visible picker has been answered.
  // Size picker always shows during Quick Add (uses default sizes when the
  // product has none explicit), so size always needs to be picked. Color
  // picker only shows when the product has colors, so color is conditional.
  const colorSatisfied = !hasColors || !!selectedColor
  const sizeSatisfied = !!selectedSize
  const readyToAdd = colorSatisfied && sizeSatisfied

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

  const featuredPlatforms = useMemo(() => getFeaturedPlatforms(), [socialPosts])
  const topPlatform = useMemo(() => getMostEngagedPlatform(), [socialPosts])

  const [isHovered, setIsHovered] = useState(false)

  // Display set is role-aware (getGalleryImages): contextual mockups first,
  // then clean art — NEVER the halftone / DTF deliverables (a raw halftone
  // looks bad as a grid thumbnail). Crossfade to the 2nd display image on hover.
  const FALLBACK = 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=600&h=600&fit=crop'
  const galleryImgs = getGalleryImages(product)
  const imgs = galleryImgs.length > 0 ? galleryImgs : [FALLBACK]
  const primaryImage = imgs[0]
  const hoverImage = imgs.length > 1 ? (imgs[1] || imgs[2] || null) : null

  return (
    <div
      className="group relative bg-card card-border rounded-xl overflow-hidden transition-all duration-300 hover:shadow-glow hover:-translate-y-1"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="relative aspect-square overflow-hidden">
        <Link to={`/product/${product.id}`}>
          {/* Primary image — ghost mannequin (images[0]) */}
          <ProtectedImage
            src={primaryImage}
            alt={product.name}
            className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 group-hover:scale-105 ${hoverImage ? (isHovered ? 'opacity-0' : 'opacity-100') : ''}`}
            onError={(e) => {
              (e.target as HTMLImageElement).src = FALLBACK
            }}
          />
          {/* Hover image — flat lay (images[1]) or Mr. Imagine (images[2]); lazy-loaded */}
          {hoverImage && (
            <ProtectedImage
              src={hoverImage}
              alt={`${product.name} alternate view`}
              loading="lazy"
              className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 group-hover:scale-105 ${isHovered ? 'opacity-100' : 'opacity-0'}`}
              onError={(e) => {
                (e.target as HTMLImageElement).src = FALLBACK
              }}
            />
          )}
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
        {(product.is_user_generated || (product as any).isUserSubmitted || product.metadata?.user_submitted) && (
          <div className="absolute top-2 left-2 z-10 mt-16">
            <span className="bg-gradient-to-r from-pink-500 to-rose-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg border border-white/20 flex items-center gap-1">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
              </svg>
              Creator Design
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
          <span className="flex flex-col">
            <span className="flex items-baseline gap-2">
              <span className="text-xl font-bold text-primary drop-shadow-[0_0_10px_rgba(168,85,247,0.5)]">${product.price}</span>
              {(() => {
                const promo = getPromoBadge(product)
                if (!promo) return null
                return (
                  <>
                    <span className="text-sm text-muted line-through">${promo.originalPrice.toFixed(2)}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500 text-slate-900 shadow-[0_0_8px_rgba(245,158,11,0.6)]">
                      {promo.percentOff}% off
                    </span>
                  </>
                )
              })()}
            </span>
            {Number(product.price) > 0 && (
              <span className="text-[11px] text-muted">or {usdToItcLabel(Number(product.price))}</span>
            )}
          </span>
          {selectedSize && (
            <span className="text-xs bg-primary/20 text-primary px-2 py-1 rounded-full">
              Size: {selectedSize}
            </span>
          )}
        </div>

        {/* Quick Size Picker — always shown during Quick Add (uses default
            sizes if the product has none explicitly set, matching prior UX). */}
        {showSizePicker && (
          <div className="mb-3 p-3 bg-bg/50 rounded-lg border border-primary/20 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted font-medium">Select Size:</p>
              {isApparel && displaySizes.some((s: string) => ['2XL', '2X', 'XXL', '3XL', '3X', 'XXXL', '4XL', '4X', 'XXXXL', '5XL', '5X', 'XXXXXL'].some(ps => s.toUpperCase().includes(ps))) && (
                <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded">
                  2XL+ = +$2.50
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {displaySizes.map((size: string) => {
                const isPlusSize = isApparel && ['2XL', '2X', 'XXL', '3XL', '3X', 'XXXL', '4XL', '4X', 'XXXXL', '5XL', '5X', 'XXXXXL'].some(ps => size.toUpperCase().includes(ps))
                return (
                  <button
                    key={size}
                    onClick={() => setSelectedSize(size)}
                    title={isPlusSize ? '+$2.50 upcharge' : undefined}
                    className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all relative ${
                      selectedSize === size
                        ? 'bg-primary text-white shadow-[0_0_10px_rgba(168,85,247,0.5)]'
                        : 'bg-card card-border text-text hover:border-primary/50 hover:bg-primary/10'
                    } ${isPlusSize ? 'pr-5' : ''}`}
                  >
                    {size}
                    {isPlusSize && (
                      <span className={`absolute right-1 top-1/2 -translate-y-1/2 text-[8px] font-bold ${selectedSize === size ? 'text-amber-200' : 'text-amber-400'}`}>
                        +$
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Quick Color Picker — same trigger flag as size; appears whenever the
            product has color options. Selecting is required before Add. */}
        {showSizePicker && hasColors && (
          <div className="mb-3 p-3 bg-bg/50 rounded-lg border border-primary/20 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-muted font-medium">Select Color:</p>
              {selectedColor && (
                <span className="text-[10px] text-muted">{getColorName(selectedColor)}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {colors.map((hex) => {
                const label = getColorName(hex)
                const isSelected = selectedColor === hex
                return (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setSelectedColor(hex)}
                    title={label}
                    aria-label={`Select ${label}`}
                    className={`w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center ${
                      isSelected
                        ? 'border-primary ring-2 ring-primary/40 ring-offset-1 ring-offset-bg'
                        : 'border-slate-200 hover:border-slate-400'
                    }`}
                    style={{ backgroundColor: hex }}
                  >
                    {isSelected && (
                      <Check className={`w-4 h-4 ${isLightSwatch(hex) ? 'text-slate-800' : 'text-white'}`} />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {/* Add to Cart Button */}
          <button
            onClick={() => {
              if (!showSizePicker) {
                setShowSizePicker(true)
                return
              }
              if (!readyToAdd) {
                // Picker(s) already visible; user still needs to make required selections
                return
              }
              addToCart(product, 1, selectedSize ?? undefined, selectedColor ?? undefined)
              setAddedToCart(true)
              // Dispatch custom event for cart notification
              window.dispatchEvent(new CustomEvent('cart-item-added', {
                detail: { product, size: selectedSize, color: selectedColor }
              }))
              setTimeout(() => {
                setAddedToCart(false)
                setShowSizePicker(false)
                setSelectedSize(null)
                setSelectedColor(null)
              }, 2000)
            }}
            disabled={!product.inStock}
            className={`w-full font-bold py-2.5 px-4 rounded-lg transition-all flex items-center justify-center gap-2 text-sm uppercase tracking-wider ${
              addedToCart
                ? 'bg-green-500 text-white shadow-[0_0_15px_rgba(34,197,94,0.5)]'
                : showSizePicker && !readyToAdd
                ? 'bg-amber-500/80 hover:bg-amber-500 text-white shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                : 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-white shadow-[0_0_15px_rgba(34,197,94,0.3)] hover:shadow-[0_0_20px_rgba(34,197,94,0.5)]'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {addedToCart ? (
              <>
                <Check className="w-4 h-4" />
                Added to Cart!
              </>
            ) : showSizePicker && !readyToAdd ? (
              <>
                <ShoppingCart className="w-4 h-4" />
                {!sizeSatisfied && !colorSatisfied
                  ? 'Pick Size & Color'
                  : !sizeSatisfied
                  ? 'Pick a Size'
                  : 'Pick a Color'}
              </>
            ) : (
              <>
                <ShoppingCart className="w-4 h-4" />
                {showSizePicker ? 'Add to Cart' : 'Quick Add'}
              </>
            )}
          </button>

          {/* View Details Link */}
          <Link
            to={`/product/${product.id}`}
            className="block w-full text-center py-2 text-sm text-muted hover:text-primary transition-colors"
          >
            View Details
          </Link>

          {/* Add to Imagination Sheet — DTF/apparel only (metal & 3D are
              finished pieces, not designs to drop on a print sheet). */}
          {isApparel && (
          <button
            onClick={async () => {
              setIsAddingToSheet(true)
              try {
                const { data: assetsData } = await supabase
                  .from('product_assets')
                  .select('url, kind')
                  .eq('product_id', product.id)
                  .in('kind', ['source', 'nobg'])

                let imageToAdd = product.images?.[0] || ''

                if (assetsData && assetsData.length > 0) {
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
            className="w-full bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-400 font-medium py-2 px-4 rounded-lg transition-all flex items-center justify-center gap-2 text-xs disabled:opacity-70"
          >
            {isAddingToSheet ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            {isAddingToSheet ? 'Loading...' : 'Add to Imagination Sheet'}
          </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default React.memo(ProductCard)

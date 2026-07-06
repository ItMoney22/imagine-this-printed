import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Sparkles, ShoppingCart, Zap, Check, Upload, Loader2 } from 'lucide-react'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/SupabaseAuthContext'
import { useToast } from '../hooks/useToast'
import { supabase } from '../lib/supabase'
import { productRecommender } from '../utils/product-recommender'
import ProductRecommendations from '../components/ProductRecommendations'
import ProtectedImage from '../components/ProtectedImage'
import { getColorName, isLightSwatch } from '../utils/color-presets'
import { getPromoBadge } from '../utils/product-promo'
import { imaginationApi, apiFetch } from '../lib/api'
import { resolveProductAddons, addonsUnitTotal, getGalleryImages, hasDigitalDeliverables } from '../lib/product-kind'
import type { Product, CartAddon } from '../types'

const ProductPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { addToCart } = useCart()
  const { user } = useAuth()
  const toast = useToast()
  const [quantity, setQuantity] = useState(1)
  const [selectedImage, setSelectedImage] = useState(0)
  const [product, setProduct] = useState<Product | null>(null)
  const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSize, setSelectedSize] = useState<string>('')
  const [selectedColor, setSelectedColor] = useState<string>('')
  const [selectedAddons, setSelectedAddons] = useState<CartAddon[]>([])
  const [uploading, setUploading] = useState(false)
  // Digital download product: deliverables are returned ONLY by the gated
  // endpoints (never read from product.metadata, which is public-readable).
  const [digitalDeliverables, setDigitalDeliverables] = useState<{ kind: string; label: string; url: string }[] | null>(null)
  const [ownsDigital, setOwnsDigital] = useState(false)
  const [buyingDigital, setBuyingDigital] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load product and source image from database
  useEffect(() => {
    const loadProduct = async () => {
      if (!id) {
        setLoading(false)
        return
      }

      try {
        setLoading(true)

        // The :id param accepts a UUID or an SEO slug (/product/my-cool-tee)
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
        const productResult = isUuid
          ? await supabase.from('products').select('*').eq('id', id).single()
          : await supabase.from('products').select('*').eq('slug', id).single()

        if (productResult.error) throw productResult.error

        const assetsResult = productResult.data
          ? await supabase.from('product_assets').select('url, kind').eq('product_id', productResult.data.id).in('kind', ['source', 'nobg'])
          : { data: null }

        if (productResult.data) {
          const data = productResult.data
          const mappedProduct: Product = {
            id: data.id,
            slug: data.slug || undefined,
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
            // sizes/colors live on the products columns (set at approval); fall
            // back to metadata for legacy rows.
            sizes: data.sizes || data.metadata?.sizes || [],
            colors: data.colors || data.metadata?.colors || [],
            product_type: data.product_type,
            digital_price: data.digital_price || 0
          }
          setProduct(mappedProduct)

          // Prefer 'source' (original Flux image), then 'nobg' (background removed)
          const assetsData = assetsResult.data
          if (assetsData && assetsData.length > 0) {
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

  // Client-side SEO: title, description and canonical for the loaded design
  // (bots get these server-injected via api/product-meta.mjs; this keeps the
  // rendered DOM consistent for Google's JS pass and for humans' tab titles).
  useEffect(() => {
    if (!product) return
    const prevTitle = document.title
    document.title = `${product.name} | Imagine This Printed`

    const desc = product.description?.replace(/\s+/g, ' ').slice(0, 155) || ''
    let metaDesc = document.querySelector('meta[name="description"]') as HTMLMetaElement | null
    if (!metaDesc) {
      metaDesc = document.createElement('meta')
      metaDesc.name = 'description'
      document.head.appendChild(metaDesc)
    }
    const prevDesc = metaDesc.content
    if (desc) metaDesc.content = desc

    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.appendChild(canonical)
    }
    canonical.href = `https://www.imaginethisprinted.com/product/${product.slug || product.id}`

    return () => {
      document.title = prevTitle
      if (metaDesc && prevDesc) metaDesc.content = prevDesc
    }
  }, [product])

  // Track product view for recommendations
  useEffect(() => {
    if (product && user) {
      productRecommender.updateUserBehavior(user.id, 'view', {
        productId: product.id,
        category: product.category
      })
    }
  }, [product, user])

  // Reveal digital downloads only if the user already owns this digital product.
  // Deliverable URLs come from the gated endpoint, never from product.metadata.
  // MUST stay above the early returns below — hooks run unconditionally.
  useEffect(() => {
    if (!product || !user || !hasDigitalDeliverables(product)) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch(`/api/user-products/${product.id}/digital-download`)
        if (!cancelled && data?.owned) {
          setOwnsDigital(true)
          setDigitalDeliverables(data.deliverables || [])
        }
      } catch { /* not owned / not signed in — stay hidden */ }
    })()
    return () => { cancelled = true }
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

  // Determine product kind so the page renders type-appropriate options:
  // apparel (shirt sizes + DTF tools), metal wall art (print sizes + finish),
  // or 3D prints (size tiers). Mirrors AdminCreatorProductsTab.productKind.
  const productKind: 'metal' | '3d' | 'apparel' = (() => {
    const c = (product.category || '').toLowerCase()
    const t = String(product.metadata?.product_template || '').toLowerCase()
    if (c.includes('metal') || t.includes('metal') || t.includes('wall')) return 'metal'
    if (c.includes('3d') || c.includes('toy') || t.includes('3d') || t.includes('toy')) return '3d'
    return 'apparel'
  })()
  const isApparel = productKind === 'apparel'

  // Optional add-on upsells configured at approval (metal-art easel stand,
  // wall mount, etc.). Empty for products without any.
  const availableAddons = resolveProductAddons(product)
  const addonsTotal = addonsUnitTotal(selectedAddons)
  const toggleAddon = (addon: { id: string; name: string; price: number }) => {
    setSelectedAddons(prev =>
      prev.some(a => a.id === addon.id)
        ? prev.filter(a => a.id !== addon.id)
        : [...prev, { id: addon.id, name: addon.name, price: addon.price }]
    )
  }

  // Gallery = artwork/photos + the contextual mockup (metadata.mockup_url),
  // which was previously never shown. Falls back to the unsplash placeholder.
  const galleryImages = getGalleryImages(product)


  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !product) return

    if (!user) {
      toast.error('Sign in required', 'Please sign in to upload your own design')
      return
    }

    setUploading(true)
    try {
      const printType = product.category === 'tumblers' ? 'uv_dtf' : 'dtf'
      const sheet = await imaginationApi.createSheet({
        name: 'Design for ' + product.name,
        print_type: printType,
        sheet_height: printType === 'uv_dtf' ? 12 : 24
      })

      const { data: uploadedLayer } = await imaginationApi.uploadImage(sheet.data.id, file)

      const params = new URLSearchParams({
        productName: product.name,
        productId: product.id
      })
      navigate('/imagination-station/' + sheet.data.id + '?' + params.toString())
      toast.success('Image uploaded', 'Taking you to the Imagination Station')
    } catch (err: any) {
      console.error('[ProductPage] Upload failed:', err)
      toast.error('Upload failed', err.message || 'Failed to upload image')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleAddToCart = () => {
    // Size is always required (we show default sizes if product doesn't have them)
    if (!selectedSize) {
      toast.warning('Selection required', 'Please select a size')
      return
    }
    if (product?.colors?.length && !selectedColor) {
      toast.warning('Selection required', 'Please select a color')
      return
    }
    if (product) {
      addToCart(product, quantity, selectedSize, selectedColor, undefined, undefined, undefined, selectedAddons.length ? selectedAddons : undefined)
      toast.success('Added to cart', product.name)
    }
  }

  const handleBuyNow = () => {
    // Size is always required (we show default sizes if product doesn't have them)
    if (!selectedSize) {
      toast.warning('Selection required', 'Please select a size')
      return
    }
    if (product?.colors?.length && !selectedColor) {
      toast.warning('Selection required', 'Please select a color')
      return
    }
    if (product) {
      addToCart(product, quantity, selectedSize, selectedColor, undefined, undefined, undefined, selectedAddons.length ? selectedAddons : undefined)
      navigate('/checkout')
    }
  }

  const handleBuyDigital = async () => {
    if (!product) return
    if (!user) { toast.warning('Sign in required', 'Please sign in to buy the digital download'); return }
    setBuyingDigital(true)
    try {
      const data = await apiFetch(`/api/user-products/${product.id}/buy-digital`, { method: 'POST' })
      if (data?.success) {
        setOwnsDigital(true)
        setDigitalDeliverables(data.deliverables || [])
        toast.success('Unlocked!', data.alreadyOwned ? 'You already own this — downloads ready.' : (data.message || 'Digital download unlocked.'))
      } else {
        toast.error('Purchase failed', data?.error || 'Could not complete the purchase')
      }
    } catch (err: any) {
      toast.error('Purchase failed', err?.message || 'Could not complete the purchase')
    } finally {
      setBuyingDigital(false)
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
            <ProtectedImage
              src={galleryImages.length > 0
                ? galleryImages[selectedImage]
                : 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=600&h=600&fit=crop'}
              alt={product.name}
              // object-contain (was object-cover) — mockups have varying
              // aspect ratios and the previous "cover" was cropping the top
              // off taller designs. The bg-bg/40 fills any letterbox area
              // with a subtle backdrop instead of leaving raw white space.
              className="w-full h-96 object-contain bg-bg/40 rounded-lg shadow-lg"
              onError={(e) => {
                (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=600&h=600&fit=crop'
              }}
            />
          </div>

          {galleryImages.length > 1 && (
            <div className="flex space-x-2 overflow-x-auto">
              {galleryImages.map((image, index) => (
                <button
                  key={index}
                  onClick={() => setSelectedImage(index)}
                  className={`flex-shrink-0 w-20 h-20 rounded-md overflow-hidden border-2 ${selectedImage === index ? 'border-primary shadow-glow' : 'card-border'
                    }`}
                >
                  <img
                    src={image}
                    alt={`${product.name} ${index + 1}`}
                    className="w-full h-full object-contain bg-bg/40"
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
            <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-primary via-purple-500 to-secondary bg-clip-text text-transparent animate-gradient-text drop-shadow-[0_0_15px_rgba(168,85,247,0.5)]">{product.name}</h1>
            <div className="flex items-baseline gap-3 flex-wrap">
              <p className="text-3xl font-bold text-text">${product.price}</p>
              {(() => {
                const promo = getPromoBadge(product)
                if (!promo) return null
                return (
                  <>
                    <span className="text-lg text-muted line-through">${promo.originalPrice.toFixed(2)}</span>
                    <span className="text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-amber-500 text-slate-900 shadow-[0_0_10px_rgba(245,158,11,0.6)]">
                      {promo.percentOff}% off
                    </span>
                  </>
                )
              })()}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2 text-text font-serif italic">The Vision</h3>
            <p className="text-muted leading-relaxed italic border-l-2 border-primary/30 pl-4">"{product.description}"</p>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2 text-text">Essence & Quality</h3>
            <ul className="text-muted space-y-2">
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-primary/40"></div>
                <span>Crafted for the Extraordinary</span>
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-primary/40"></div>
                <span>Frequency-Aligned Print Quality</span>
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-primary/40"></div>
                <span>{productKind === 'metal' ? 'Museum-Grade Metal Finish' : productKind === '3d' ? 'Durable, Detail-Rich Build' : 'Truth in Every Thread'}</span>
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-primary/40"></div>
                <span>Consciously Produced</span>
              </li>
            </ul>
          </div>

          <div className="border-t card-border pt-6">
            {/* Size selector — type-aware: apparel shirt sizes, metal print sizes, or 3D tiers */}
            {(() => {
              // Default sizes depend on the product kind. Real products carry
              // their sizes on the column (set at approval); these are fallbacks
              // for legacy rows that predate per-type sizing.
              const defaultSizes =
                productKind === 'metal' ? ['4x6', '8x11']
                : productKind === '3d' ? ['mini', 'small', 'medium', 'large']
                : ['S', 'M', 'L', 'XL', '2XL']
              const displaySizes = product.sizes && product.sizes.length > 0 ? product.sizes : defaultSizes
              // Plus-size upcharge is apparel-only — metal/3D sizes never qualify.
              const hasPlusSizes = isApparel && displaySizes.some(s => ['2XL', '2X', 'XXL', '3XL', '3X', 'XXXL', '4XL', '4X', 'XXXXL', '5XL', '5X', 'XXXXXL'].some(ps => s.toUpperCase().includes(ps)))
              const sizeLabel = productKind === 'metal' ? 'Print Size' : productKind === '3d' ? 'Size' : 'Size'

              return (
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <label className="block text-sm font-medium text-text">{sizeLabel}</label>
                    {hasPlusSizes && (
                      <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
                        2XL+ = +$2.50
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {displaySizes.map(size => {
                      const isPlusSize = isApparel && ['2XL', '2X', 'XXL', '3XL', '3X', 'XXXL', '4XL', '4X', 'XXXXL', '5XL', '5X', 'XXXXXL'].some(ps => size.toUpperCase().includes(ps))
                      const isSelected = selectedSize === size
                      return (
                        <button
                          key={size}
                          onClick={() => setSelectedSize(size)}
                          className={`px-4 py-2 rounded-md border-2 font-bold transition-all relative group ${isSelected
                            ? 'border-primary bg-primary text-white shadow-[0_0_15px_rgba(168,85,247,0.5)] scale-105 ring-2 ring-primary/30 ring-offset-2 ring-offset-bg'
                            : 'border-slate-300 bg-card hover:border-primary/60 hover:bg-primary/5 text-text'
                            } ${isPlusSize ? 'pr-6' : ''}`}
                          title={isPlusSize ? '+$2.50 upcharge for plus sizes' : undefined}
                        >
                          {size}
                          {isPlusSize && (
                            <span className={`absolute right-1 top-1/2 -translate-y-1/2 text-[10px] font-medium ${isSelected ? 'text-amber-200' : 'text-amber-400'}`}>
                              +$
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {productKind === 'metal' && product.metadata?.finish && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-text mb-2">Finish</label>
                <span className="inline-block px-4 py-2 rounded-md border-2 border-primary bg-primary/10 text-text font-bold capitalize">
                  {String(product.metadata.finish)}
                </span>
              </div>
            )}

            {product.colors && product.colors.length > 0 && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-text mb-2">
                  Color
                  {selectedColor && (
                    <span className="ml-2 text-muted font-normal">— {getColorName(selectedColor)}</span>
                  )}
                </label>
                <div className="flex flex-wrap gap-2">
                  {product.colors.map(color => {
                    const label = getColorName(color)
                    const isSelected = selectedColor === color
                    return (
                      <button
                        key={color}
                        onClick={() => setSelectedColor(color)}
                        title={label}
                        aria-label={`Select ${label}`}
                        className={`flex items-center gap-2 px-3 py-2 rounded-md border transition-all ${
                          isSelected
                            ? 'border-primary bg-primary/10 text-text ring-2 ring-primary/30'
                            : 'border-slate-300 hover:border-slate-400 text-text'
                        }`}
                      >
                        <span
                          className="w-5 h-5 rounded-full border border-white/20 flex items-center justify-center shrink-0"
                          style={{ backgroundColor: color }}
                        >
                          {isSelected && (
                            <Check className={`w-3.5 h-3.5 ${isLightSwatch(color) ? 'text-slate-800' : 'text-white'}`} />
                          )}
                        </span>
                        <span className="text-sm">{label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {availableAddons.length > 0 && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-text mb-2">Add-ons</label>
                <div className="space-y-2">
                  {availableAddons.map(addon => {
                    const checked = selectedAddons.some(a => a.id === addon.id)
                    return (
                      <button
                        key={addon.id}
                        type="button"
                        onClick={() => toggleAddon(addon)}
                        className={`w-full flex items-start gap-3 text-left px-4 py-3 rounded-lg border-2 transition-all ${
                          checked
                            ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                            : 'border-slate-300 bg-card hover:border-primary/60'
                        }`}
                      >
                        <span className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${checked ? 'bg-primary border-primary' : 'border-slate-300'}`}>
                          {checked && <Check className="w-3.5 h-3.5 text-white" />}
                        </span>
                        <span className="flex-1">
                          <span className="flex items-center justify-between">
                            <span className="font-bold text-text">{addon.name}</span>
                            <span className="font-bold text-primary">+${addon.price.toFixed(2)}</span>
                          </span>
                          <span className="block text-xs text-muted mt-0.5">{addon.blurb}{addon.printed ? ' · Made in-house' : ''}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
                {addonsTotal > 0 && (
                  <p className="text-sm text-muted mt-2">
                    Item total: <span className="font-bold text-text">${(product.price + addonsTotal).toFixed(2)}</span>
                    <span className="text-xs"> (base ${product.price.toFixed(2)} + add-ons ${addonsTotal.toFixed(2)})</span>
                  </p>
                )}
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

              {/* DTF/apparel-only customization. Metal wall art and 3D prints
                  are finished pieces — no upload-your-own or sheet placement. */}
              {isApparel && (
                <>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept="image/*"
                    className="hidden"
                  />

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="w-full bg-white/10 hover:bg-white/20 border-2 border-primary/50 text-text font-bold py-4 px-6 rounded-lg transition-all transform hover:scale-105 flex items-center justify-center gap-3 text-lg mb-2 shadow-[0_0_15px_rgba(168,85,247,0.2)]"
                  >
                    {uploading ? (
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    ) : (
                      <Upload className="w-6 h-6 text-primary" />
                    )}
                    {uploading ? "Uploading..." : "Upload Your Own Design"}
                  </button>

                  <button
                    onClick={() => {
                      // Navigate to Imagination Station with the SOURCE image (original Flux-generated)
                      // sourceImageUrl is fetched from product_assets table (kind='source' or 'nobg')
                      const imageToAdd = sourceImageUrl || product.images?.[0] || ''
                      if (!imageToAdd) {
                        toast.error('No source image', 'This product has no source image to add to a sheet')
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
                </>
              )}

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

          {hasDigitalDeliverables(product) && (
            <div className="bg-card card-border p-4 rounded-lg">
              <h4 className="font-semibold mb-1 text-text flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                Digital Download
              </h4>
              {ownsDigital && digitalDeliverables ? (
                <div className="space-y-2 mt-2">
                  <p className="text-sm text-green-600">You own this — download your files:</p>
                  {digitalDeliverables.map(d => (
                    <a
                      key={d.kind}
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between px-3 py-2 rounded-md border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors text-sm text-text"
                    >
                      <span>{d.label}</span>
                      <span className="text-primary font-medium">Download ↓</span>
                    </a>
                  ))}
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted mb-3 mt-1">
                    Get the print-ready files — clean design, halftone version, and DTF print-ready. Instant download.
                  </p>
                  <button
                    onClick={handleBuyDigital}
                    disabled={buyingDigital}
                    className="w-full btn-primary shadow-glow flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {buyingDigital && <Loader2 className="w-4 h-4 animate-spin" />}
                    {buyingDigital
                      ? 'Processing…'
                      : `Buy Digital Download${Number(product.digital_price) > 0 ? ` — $${Number(product.digital_price).toFixed(2)}` : ''}`}
                  </button>
                </>
              )}
            </div>
          )}

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
              onClick={() => navigate('/my-designs')}
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



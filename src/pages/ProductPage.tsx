import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Sparkles, ShoppingCart, Check, Upload, Loader2, Store, Truck, ShieldCheck, ChevronDown } from 'lucide-react'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/SupabaseAuthContext'
import { useToast } from '../hooks/useToast'
import { supabase } from '../lib/supabase'
import { productRecommender } from '../utils/product-recommender'
import ProtectedImage from '../components/ProtectedImage'
import VirtualTryOn from '../components/VirtualTryOn'
import { SocialShareButtons } from '../components/SocialShareButtons'
import { getColorName, isLightSwatch } from '../utils/color-presets'
import { getPromoBadge } from '../utils/product-promo'
import { STANDARD_FULFILLMENT_DAYS, FREE_SHIPPING_THRESHOLD } from '../utils/shipping-calculator'
import { BUSINESS_EMAIL, SHOP_PLACE } from '../config/business-info'
import { SIZE_CHARTS, chartRows, sizeChartFor } from '../lib/size-charts'
import { plainDescription } from '../lib/plain-text'
import { SizeGuide } from '../components/product/SizeGuide'
import { YouMayAlsoLike } from '../components/product/YouMayAlsoLike'
import { imaginationApi, apiFetch, tryonApi } from '../lib/api'
import TeamPersonalizePanel, { type TeamTemplateSummary } from '../components/TeamPersonalizePanel'
import { canonicalCategoryOf, resolveProductAddons, addonsUnitTotal, getGalleryImages, hasDigitalDeliverables, isBlankProduct, unitBasePrice, startingPrice, hasPriceRange, metalSizePrice, productKindOf, sizeChoicesFor, listingOptionSets, colorChoicesFor, defaultSizeFor, sizePriceDelta, formatPriceDelta, placementChoicesFor, defaultPrintLocation, printLocationLabel } from '../lib/product-kind'
import { isYouthSize, YOUTH_SIZE_DISCOUNT_DOLLARS } from '../../backend/shared/catalog-capability'
import { DEFAULT_GARMENT_TIER_ID, garmentTierUpcharge, garmentTiersFor } from '../lib/garment-tiers'
import { blankPricingOf, blankUnitPriceDollars, blankFromPriceDollars } from '../../backend/shared/blank-pricing'
import { blankTierById, compareToLabel, BLANK_LABEL_NOTE } from '../../backend/shared/blank-line'
import type { Product, CartAddon, TshirtPrintLocation } from '../types'

// Perceived-luminance check for blank-garment swatches (their hexes come off
// metadata, not the fixed COLOR_PRESETS list isLightSwatch knows about).
function isLightHex(hex: string | undefined): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return false
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b > 186
}

// Breadcrumb names for the catalog shelves (ProductCatalog's category ids).
const SHELF_LABELS: Record<string, string> = {
  shirts: 'T-Shirts',
  hoodies: 'Hoodies',
  '3d-prints': '3D Prints',
  'metal-art': 'Metal Art',
  'dtf-transfers': 'DTF Transfers',
  tumblers: 'Tumblers'
}

const ProductPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { addToCart } = useCart()
  const { user } = useAuth()
  const toast = useToast()
  const [quantity, setQuantity] = useState(1)
  const [selectedImage, setSelectedImage] = useState(0)
  // Spin hero video (metadata.hero_video_url) plays as the landing media when
  // present; thumbnails switch to stills, the play tile switches back.
  const [videoActive, setVideoActive] = useState(true)
  const [product, setProduct] = useState<Product | null>(null)
  const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSize, setSelectedSize] = useState<string>('')
  const [selectedColor, setSelectedColor] = useState<string>('')
  const [selectedPrintLocation, setSelectedPrintLocation] = useState<string>('')
  // Garment quality tier (printed apparel only) — defaults to the standard
  // blank so checkout works with zero interaction; premium tiers upcharge.
  const [selectedTier, setSelectedTier] = useState<string>(DEFAULT_GARMENT_TIER_ID)
  // Team shirt personalization (products.metadata.team_template).
  const [personalization, setPersonalization] = useState<Record<string, string>>({})
  // Set when the API turns out not to serve /api/team-plate yet — Vercel
  // deploys ahead of Render, so the panel has to be able to bow out and let
  // the shirt sell as an ordinary product.
  const [personalizeUnsupported, setPersonalizeUnsupported] = useState(false)
  /** Placement → the mockup rendered at that print scale (currently pocket only). */
  const [placementShots, setPlacementShots] = useState<Record<string, string>>({})
  const [selectedAddons, setSelectedAddons] = useState<CartAddon[]>([])
  const [uploading, setUploading] = useState(false)
  // Digital download product: deliverables are returned ONLY by the gated
  // endpoints (never read from product.metadata, which is public-readable).
  const [digitalDeliverables, setDigitalDeliverables] = useState<{ kind: string; label: string; url: string }[] | null>(null)
  const [ownsDigital, setOwnsDigital] = useState(false)
  const [buyingDigital, setBuyingDigital] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showSizeGuide, setShowSizeGuide] = useState(false)
  const [descOpen, setDescOpen] = useState(false)

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
          ? await supabase.from('product_assets').select('url, kind, asset_role').eq('product_id', productResult.data.id).in('kind', ['source', 'nobg', 'mockup'])
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
            // SEO metadata from Merch Studio (products.meta_title / meta_description
            // / search_keywords / alt_text — populated by the storefront publish API)
            metaTitle: data.meta_title || undefined,
            metaDescription: data.meta_description || undefined,
            searchKeywords: data.search_keywords || undefined,
            altText: data.alt_text || undefined,
            isThreeForTwentyFive: data.metadata?.isThreeForTwentyFive || false,
            // sizes/colors live on the products columns (set at approval); fall
            // back to metadata for legacy rows.
            sizes: data.sizes || data.metadata?.sizes || [],
            // A garment with no colour list but a recorded shirt_color is a
            // one-colour product: expose it so the buy box preselects it.
            colors: (data.colors?.length ? data.colors : data.metadata?.colors?.length ? data.metadata.colors : (data.metadata?.shirt_color ? [data.metadata.shirt_color] : [])),
            // products.print_locations TEXT[] — the actual root cause of the
            // "no consumer" bug: this mapping never read the column at all,
            // so product.print_locations was always undefined here regardless
            // of what the admin wizard saved or the DB CHECK enforced.
            print_locations: (data.print_locations && data.print_locations.length ? data.print_locations : data.metadata?.print_locations) || [],
            product_type: data.product_type,
            digital_price: data.digital_price || 0
          }
          setProduct(mappedProduct)
          // Open on everything a machine can answer, so Add to Cart works
          // without a pick: a metal print's smallest panel and a transfer's
          // adult size (a real, buyable price), a one-size listing's size,
          // a one-colour listing's colour (most tees are Black only), and the
          // placement the design is actually printed at (David 2026-10-07:
          // "Print Placement - required" with no default emptied the cart on
          // f09a7d64). Garment sizes are never guessed.
          setSelectedSize(defaultSizeFor(mappedProduct))
          const openingColors = colorChoicesFor(mappedProduct)
          setSelectedColor(openingColors.length === 1 ? openingColors[0] : '')
          setSelectedPrintLocation(defaultPrintLocation(mappedProduct) ?? '')
          setSelectedTier(DEFAULT_GARMENT_TIER_ID)

          // Prefer 'source' (original Flux image), then 'nobg' (background removed)
          const assetsData = assetsResult.data
          if (assetsData && assetsData.length > 0) {
            const sourceAsset = assetsData.find(a => a.kind === 'source')
            const nobgAsset = assetsData.find(a => a.kind === 'nobg')
            setSourceImageUrl(sourceAsset?.url || nobgAsset?.url || null)

            // Placement → mockup. A pocket print looks nothing like a chest
            // print, so picking "Pocket" should show the pocket-scale shot
            // rather than leaving a full-size chest mockup on screen.
            const pocketShot = assetsData.find(a => a.kind === 'mockup' && a.asset_role === 'mockup_pocket')?.url
            setPlacementShots(pocketShot ? { pocket: pocketShot } : {})
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

  // Client-side SEO: title, description, keywords, and canonical for the loaded
  // design. Merch Studio products carry dedicated meta_title / meta_description /
  // search_keywords / alt_text columns; fall back to the product name/description
  // for legacy products that predate the SEO columns. This keeps the rendered DOM
  // consistent for Google's JS pass and for humans' tab titles.
  useEffect(() => {
    if (!product) return
    const prevTitle = document.title
    // SEO title first, then product name, then the site suffix
    const pageTitle = product.metaTitle || product.name
    document.title = `${pageTitle} | Imagine This Printed`

    // Meta description: dedicated SEO description, then product description
    const desc = (product.metaDescription || product.description || '').replace(/\s+/g, ' ').slice(0, 155)
    let metaDesc = document.querySelector('meta[name="description"]') as HTMLMetaElement | null
    if (!metaDesc) {
      metaDesc = document.createElement('meta')
      metaDesc.name = 'description'
      document.head.appendChild(metaDesc)
    }
    const prevDesc = metaDesc.content
    if (desc) metaDesc.content = desc

    // Keywords meta tag (surfaced only when the product carries search_keywords)
    let metaKw = document.querySelector('meta[name="keywords"]') as HTMLMetaElement | null
    if (product.searchKeywords) {
      if (!metaKw) {
        metaKw = document.createElement('meta')
        metaKw.name = 'keywords'
        document.head.appendChild(metaKw)
      }
      metaKw.content = product.searchKeywords
    } else if (metaKw) {
      metaKw.remove()
    }

    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.appendChild(canonical)
    }
    const canonicalUrl = `https://www.imaginethisprinted.com/product/${product.slug || product.id}`
    canonical.href = canonicalUrl

    // Product JSON-LD. For bot user-agents the server already injected a block
    // built from the raw DB row (api/_seo/bot-meta.mjs) — that one is richer
    // than anything the SPA can produce, so it is left alone while it still
    // describes THIS url. It only goes stale on a client-side navigation to a
    // different product, and only then do we swap in a client-built block.
    // Every block either side writes carries data-itp-jsonld, so this never
    // touches JSON-LD emitted by anything else on the page.
    const existing = document.querySelector('script[type="application/ld+json"][data-itp-jsonld]')
    let existingMatches = false
    if (existing?.textContent) {
      try {
        existingMatches = String(JSON.parse(existing.textContent)['@id'] || '').startsWith(canonicalUrl)
      } catch {
        existingMatches = false
      }
    }
    if (!existingMatches) {
      document.querySelectorAll('script[type="application/ld+json"][data-itp-jsonld]').forEach(n => n.remove())
      const images = (product.images || []).filter(Boolean).slice(0, 6)
      const ld: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        '@id': `${canonicalUrl}#product`,
        name: product.name,
        description: desc,
        image: images.length ? images : ['https://www.imaginethisprinted.com/itp-logo-v3.png'],
        url: canonicalUrl,
        sku: product.id,
        brand: { '@type': 'Brand', name: 'Imagine This Printed' }
      }
      if (product.category) ld.category = product.category
      const ldPrice = startingPrice(product)
      if (Number.isFinite(ldPrice) && ldPrice > 0) {
        ld.offers = {
          '@type': 'Offer',
          url: canonicalUrl,
          price: ldPrice.toFixed(2),
          priceCurrency: 'USD',
          availability: product.inStock === false ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
          itemCondition: 'https://schema.org/NewCondition'
        }
      }
      const script = document.createElement('script')
      script.type = 'application/ld+json'
      script.dataset.itpJsonld = 'client'
      script.textContent = JSON.stringify(ld)
      document.head.appendChild(script)
    }

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
  // or 3D prints (size tiers).
  const productKind = productKindOf(product)
  // What the shopper is buying, and so which pickers render (David
  // 2026-10-07): a DTF transfer gets transfer size / quantity / gang sheet
  // only, a hoodie its hoodie blanks, a tee its tee blanks, and upload only
  // where the shopper brings the art (blanks, personalizable templates).
  const options = listingOptionSets(product)
  const isTransfer = options.kind === 'dtf-transfer'
  // The sizes this listing actually offers. Empty = a one-size product (a 3D
  // print with no explicit tiers), which hides the picker below and drops the
  // "please select a size" gate — it used to demand a choice between four
  // sizes the listing never had.
  const sizeChoices = sizeChoicesFor(product)
  const requiresSize = sizeChoices.length > 0
  const colorChoices = colorChoicesFor(product)
  const placementChoices = placementChoicesFor(product)
  // Blank garments are sold as-is (no print, no quality upsell — the blank IS
  // its tier, priced outright). Seeded with metadata.garment.blank = true.
  const isBlank = isBlankProduct(product)
  // Quality picker: tee blanks on a tee, hoodie blanks on a hoodie, none on a
  // transfer or a blank. Only the tee line carries a tier to the cart today —
  // a hoodie has the one blank, which needs no recording.
  const blankTiers = garmentTiersFor(options.blankPicker)
  const showGarmentTiers = blankTiers.length > 0
  const cartTier = options.blankPicker === 'tee' ? selectedTier : undefined
  const tierUpcharge = cartTier ? garmentTierUpcharge(cartTier) : 0

  // The template is read straight off the product row. Only `fields` and
  // `upcharge` are used here — zones, fonts and colours never leave the
  // server, because only the server draws anything.
  const rawTemplate: any = (product as any)?.metadata?.team_template
  const teamTemplate: TeamTemplateSummary | null =
    !personalizeUnsupported && rawTemplate && Array.isArray(rawTemplate.fields) && rawTemplate.fields.length > 0
      ? { version: rawTemplate.version, fields: rawTemplate.fields, upcharge: rawTemplate.upcharge }
      : null
  const personalizationComplete =
    !teamTemplate || teamTemplate.fields.every((f: any) => (personalization[f.key] ?? '').length > 0)

  // Blank garment pricing — per size + colour group off the product's own
  // table (backend/shared/blank-pricing.ts). products.price is only the
  // "from" figure; the size buttons and the header show the real unit price.
  const blankPricing = isBlank ? blankPricingOf(product.metadata) : null
  const blankUnit = blankPricing ? blankUnitPriceDollars(blankPricing, selectedSize, selectedColor) : null
  const blankFrom = blankPricing ? blankFromPriceDollars(blankPricing) : null
  const blankTier = isBlank ? blankTierById(product.metadata?.garment?.tier) : null
  // Colour NAME → swatch hex (and, when rendered, the colour's own product
  // shot) for blanks (products.colors holds Jiffy names).
  const blankSwatches: Record<string, string> = {}
  const blankColorImages: Record<string, string> = {}
  if (isBlank && Array.isArray(product.metadata?.garment?.colors)) {
    for (const c of product.metadata.garment.colors) {
      if (c?.name && c?.hex) blankSwatches[String(c.name)] = String(c.hex)
      if (c?.name && typeof c?.image === 'string' && c.image) blankColorImages[String(c.name)] = String(c.image)
    }
  }

  // Optional add-on upsells configured at approval (metal-art easel stand,
  // wall mount, etc.). A metal print offers the whole metal catalog by
  // default (magnets, 3D-printed stands, ...); empty for other products
  // without any.
  const availableAddons = resolveProductAddons(product)
  const addonsTotal = addonsUnitTotal(selectedAddons)
  // Per-unit BASE price for the current selection — a metal print's follows
  // the panel size (4x6 $8.95 / 8x10 $16.95), shared with the cart/checkout
  // and the server's pricing engine so the number can't change on the way
  // to the receipt. Everything else is products.price.
  const unitPrice = unitBasePrice(product, selectedSize)
  const priceIsFrom = productKind === 'metal' && !selectedSize && hasPriceRange(product)
  const toggleAddon = (addon: { id: string; name: string; price: number }) => {
    setSelectedAddons(prev =>
      prev.some(a => a.id === addon.id)
        ? prev.filter(a => a.id !== addon.id)
        : [...prev, { id: addon.id, name: addon.name, price: addon.price }]
    )
  }

  // Gallery = artwork/photos + the contextual mockup (metadata.mockup_url),
  // which was previously never shown. Falls back to the unsplash placeholder.
  const baseGallery = getGalleryImages(product)
  // The pocket shot may not be in products.images[] (it is appended to the
  // gallery contract, and older published rows predate it), so surface it here
  // rather than silently having nothing to switch to.
  const pocketShotUrl = placementShots.pocket
  // Blank garments: the picked colour's render takes the hero slot so the main
  // image follows the swatch (scripts/render-blank-colors.ts writes one per
  // colour; seed-blanks.ts records it on metadata.garment.colors[].image).
  const blankColorShot = isBlank && selectedColor ? blankColorImages[selectedColor] : undefined
  const galleryWithColor = blankColorShot
    ? [blankColorShot, ...baseGallery.filter(u => u !== blankColorShot)]
    : baseGallery
  const galleryImages = pocketShotUrl && !galleryWithColor.includes(pocketShotUrl)
    ? [...galleryWithColor, pocketShotUrl]
    : galleryWithColor
  const heroVideoUrl = typeof (product?.metadata as Record<string, unknown> | undefined)?.hero_video_url === 'string'
    ? String((product?.metadata as Record<string, unknown>).hero_video_url)
    : undefined


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

  // A print-location choice is only required when the product actually
  // offers more than one — a single-option (or no) print_locations list
  // means there's nothing to choose, per the task's acceptance criteria.
  // It opens pre-picked on where the design is printed (defaultPrintLocation).
  const requiresPrintLocation = placementChoices.length > 1
  // What the cart line carries: the picked placement, or nothing for a
  // listing without one (a transfer, a blank — its seeded print_locations
  // exist only to satisfy the shirts CHECK constraint — metal, 3D).
  const cartPrintLocation = placementChoices.length > 0
    ? ((selectedPrintLocation || undefined) as TshirtPrintLocation | undefined)
    : undefined

  /**
   * ONE add-to-cart event for the try-on funnel, fired from BOTH the main
   * button and the try-on card. `attribution` is only present on the latter —
   * a cart with no tryonId from a shopper who saw the card is exactly the
   * control-cohort data point the conversion report needs, so this must never
   * be limited to try-on users.
   */
  const trackCartForTryOn = (attribution?: { tryonId: string | null; secondsSinceTryon: number }) => {
    if (!user || !product) return
    void tryonApi.track({
      eventType: 'add_to_cart',
      productId: product.id,
      tryonId: attribution?.tryonId ?? null,
      secondsSinceTryon: attribution?.secondsSinceTryon
    })
  }

  const handleAddToCart = (attribution?: { tryonId: string | null; secondsSinceTryon: number }) => {
    // Size is required only when the listing actually offers sizes — a
    // one-size 3D print has no picker to answer.
    if (requiresSize && !selectedSize) {
      toast.warning('Selection required', 'Please select a size')
      return
    }
    if (colorChoices.length && !selectedColor) {
      toast.warning('Selection required', 'Please select a color')
      return
    }
    if (requiresPrintLocation && !selectedPrintLocation) {
      toast.warning('Selection required', 'Please select a print placement')
      return
    }
    if (teamTemplate && !personalizationComplete) {
      toast.warning('Selection required', `Please enter the ${teamTemplate.fields.map((f: any) => f.label.toLowerCase()).join(' and ')}`)
      return
    }
    if (product) {
      addToCart(product, quantity, selectedSize, colorChoices.length ? selectedColor : undefined, undefined, undefined, undefined, selectedAddons.length ? selectedAddons : undefined, cartPrintLocation, cartTier, teamTemplate ? personalization : undefined)
      trackCartForTryOn(attribution)
      toast.success('Added to cart', product.name)
    }
  }

  const handleBuyNow = () => {
    // Size is required only when the listing actually offers sizes — a
    // one-size 3D print has no picker to answer.
    if (requiresSize && !selectedSize) {
      toast.warning('Selection required', 'Please select a size')
      return
    }
    if (colorChoices.length && !selectedColor) {
      toast.warning('Selection required', 'Please select a color')
      return
    }
    if (requiresPrintLocation && !selectedPrintLocation) {
      toast.warning('Selection required', 'Please select a print placement')
      return
    }
    if (teamTemplate && !personalizationComplete) {
      toast.warning('Selection required', `Please enter the ${teamTemplate.fields.map((f: any) => f.label.toLowerCase()).join(' and ')}`)
      return
    }
    if (product) {
      addToCart(product, quantity, selectedSize, colorChoices.length ? selectedColor : undefined, undefined, undefined, undefined, selectedAddons.length ? selectedAddons : undefined, cartPrintLocation, cartTier, teamTemplate ? personalization : undefined)
      // Buy Now still puts the item in the cart, so it counts in the funnel.
      trackCartForTryOn()
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

  // Breadcrumb shelf + the Size guide's measurements (approved mock 394b217c).
  const shelfId = isBlank ? 'blanks' : canonicalCategoryOf(product)
  const shelf = isBlank
    ? { label: 'Blank Tees', to: '/blanks' }
    : { label: SHELF_LABELS[shelfId] || 'Shop', to: SHELF_LABELS[shelfId] ? `/catalog/${shelfId}` : '/catalog' }
  const guideTier = isBlank && blankTier
    ? { label: blankTier.name, compareTo: compareToLabel(blankTier) }
    : (() => {
        const t = blankTiers.find(x => x.id === selectedTier) ?? blankTiers[0]
        return t ? { label: t.label, compareTo: t.compareTo } : null
      })()
  const adultChart = productKind === 'apparel' && !isTransfer && guideTier ? sizeChartFor(guideTier.compareTo) : null
  const youthOffered = sizeChoices.filter(sz => isYouthSize(sz))
  const guideAdultRows = adultChart ? chartRows(adultChart, sizeChoices.filter(sz => !isYouthSize(sz))) : []
  const guideYouthRows = options.blankPicker === 'tee' && youthOffered.length
    ? chartRows(SIZE_CHARTS['5000B'], youthOffered.map(sz => sz.replace(/^Y/i, ''))).map(r => ({ ...r, size: `Y${r.size}` }))
    : []
  const description = plainDescription(product.description)
  const optionLabel = 'block text-sm font-semibold text-text mb-2'
  const chip = (on: boolean) =>
    `rounded-xl border-2 font-semibold transition-colors ${on ? 'border-primary bg-primary text-white' : 'border-border bg-card text-text hover:border-primary'}`

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-8 pb-16">
      <nav aria-label="Breadcrumb" className="mb-4 sm:mb-6 text-sm text-muted flex items-center gap-2">
        <Link to="/catalog" className="text-primary hover:underline">Shop</Link>
        <span aria-hidden="true">/</span>
        <Link to={shelf.to} className="hover:text-text">{shelf.label}</Link>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-12">
        {/* Gallery: one big photo that stays in view while the buy box scrolls. */}
        <div className="lg:sticky lg:top-6 self-start">
          <div className="rounded-3xl bg-card border border-border shadow-soft overflow-hidden">
            {/* Signature hero: when the product has a spin video (model turning,
                shirt changing color), it IS the landing media — autoplay, muted,
                looping. Tapping any thumbnail switches to stills; the play tile
                brings the video back. */}
            {heroVideoUrl && videoActive ? (
              <video
                src={heroVideoUrl}
                autoPlay muted loop playsInline
                poster={galleryImages[0]}
                className="w-full aspect-square object-contain"
              />
            ) : (
              <ProtectedImage
                src={galleryImages.length > 0
                  ? galleryImages[selectedImage]
                  : 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=600&h=600&fit=crop'}
                alt={product.altText || product.name}
                // object-contain — mockups have varying aspect ratios and
                // "cover" cropped the top off taller designs.
                className="w-full aspect-square object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=600&h=600&fit=crop'
                }}
              />
            )}
          </div>

          {(galleryImages.length > 1 || heroVideoUrl) && (
            <div className="flex gap-2 sm:gap-3 overflow-x-auto mt-3 pb-1">
              {heroVideoUrl && (
                <button
                  onClick={() => setVideoActive(true)}
                  className={`flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border-2 relative bg-card ${videoActive ? 'border-primary' : 'border-border'}`}
                  aria-label="Play product video"
                >
                  <video src={heroVideoUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white text-lg">▶</span>
                </button>
              )}
              {galleryImages.map((image, index) => (
                <button
                  key={index}
                  onClick={() => { setSelectedImage(index); setVideoActive(false) }}
                  className={`flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border-2 bg-card ${!videoActive && selectedImage === index ? 'border-primary' : 'border-border'}`}
                  aria-label={`Show photo ${index + 1}`}
                >
                  <img
                    src={image}
                    alt={`${product.altText || product.name} ${index + 1}`}
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=600&h=600&fit=crop'
                    }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Buy box: name, price, the options, ONE Add to cart. */}
        <div>
          <div className="flex items-start justify-between gap-4 mb-2">
            <h1 className="font-display text-3xl sm:text-4xl text-text leading-tight">{product.name}</h1>
            {/* Quick share. Prefers the SEO slug so the shared link matches the
                canonical URL rather than exposing a UUID. */}
            <div className="shrink-0 pt-1">
              <SocialShareButtons
                productId={product.slug || product.id}
                productName={product.name}
                productImage={galleryImages[0]}
                menuPlacement="bottom-right"
              />
            </div>
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            {isBlank ? (
              <>
                <p className="font-display text-3xl text-text">
                  {blankUnit !== null ? `$${blankUnit.toFixed(2)}` : `from $${(blankFrom ?? product.price).toFixed(2)}`}
                </p>
                <span className="text-sm text-muted">
                  {blankUnit !== null
                    ? `${selectedSize}${selectedColor ? ` · ${selectedColor}` : ''}`
                    : 'pick a size and colour for the exact price'}
                </span>
              </>
            ) : (
              <p className="font-display text-3xl text-text">
                {priceIsFrom && <span className="text-base font-body text-muted mr-1.5">from</span>}
                ${unitPrice.toFixed(2)}
              </p>
            )}
            {(() => {
              const promo = getPromoBadge(product)
              if (!promo) return null
              return (
                <>
                  <span className="text-lg text-muted line-through">${promo.originalPrice.toFixed(2)}</span>
                  <span className="text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-primary text-white">
                    {promo.percentOff}% off
                  </span>
                </>
              )
            })()}
          </div>
          <p className="text-sm text-text-secondary mt-2">
            {isBlank
              ? `Ships from ${SHOP_PLACE.town}, ${SHOP_PLACE.stateCode} within ${STANDARD_FULFILLMENT_DAYS} business days of payment.`
              : `Printed to order in ${SHOP_PLACE.town}, ${SHOP_PLACE.stateCode}. Ships within ${STANDARD_FULFILLMENT_DAYS} business days of payment.`}
          </p>

          {/* Blank garment spec sheet — David 2026-09-02: "make sure it has the
              stats". House name only; the manufacturer appears solely on the
              "Compared to" line. Specs come from the shared blank line table
              (same source the seed wrote to metadata). */}
          {isBlank && blankTier && (
            <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 mt-5">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-bg-warm text-primary">
                  {blankTier.grade}
                </span>
                <span className="text-xs text-muted">{compareToLabel(blankTier)}</span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted">Weight</dt>
                <dd className="text-text font-medium">{blankTier.specs.weightOz} oz</dd>
                <dt className="text-muted">Fabric</dt>
                <dd className="text-text font-medium">{blankTier.specs.fabric}</dd>
                <dt className="text-muted">Fit</dt>
                <dd className="text-text font-medium">{blankTier.specs.fit}</dd>
                <dt className="text-muted">Body</dt>
                <dd className="text-text font-medium capitalize">{blankTier.specs.seams}</dd>
                <dt className="text-muted">Collar</dt>
                <dd className="text-text font-medium">{blankTier.specs.collar}</dd>
                <dt className="text-muted">Sizes</dt>
                <dd className="text-text font-medium">{blankTier.sizes[0]}–{blankTier.sizes[blankTier.sizes.length - 1]}</dd>
                <dt className="text-muted">Colours</dt>
                <dd className="text-text font-medium">{product.colors?.length ?? blankTier.colors.length}</dd>
                <dt className="text-muted">Label</dt>
                <dd className="text-text font-medium">{blankTier.specs.label}</dd>
              </dl>
              <ul className="mt-3 space-y-1.5 text-sm text-muted">
                {blankTier.specs.construction.map(line => (
                  <li key={line} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">{BLANK_LABEL_NOTE}</p>
              <p className="mt-1 text-xs text-muted">Best for: {blankTier.specs.bestFor}</p>
            </div>
          )}

          <div className="border-t border-border mt-5 pt-5 space-y-5">
            {/* Size selector — type-aware: apparel shirt sizes, metal print sizes, or 3D tiers */}
            {(() => {
              // sizeChoicesFor() owns the whole decision: metal always shows
              // the canonical panel list (legacy '8x11' rows collapse onto the
              // real 8x10 panel; an empty column offers both), everything else
              // shows its own column when set and a type-aware fallback
              // otherwise. Blanks carry their real per-size price on the button.
              const displaySizes: string[] = sizeChoices
              // A one-size product (a 3D print with no explicit tiers) has no
              // picker at all — see the requiresSize gate on add-to-cart.
              if (displaySizes.length === 0) return null
              const sizeLabel = productKind === 'metal' ? 'Print Size' : isTransfer ? 'Transfer Size' : 'Size'

              // Shirts and hoodies sell the adult cut AND the youth cut on the
              // same listing (David 2026-09-07). They're split into two labelled
              // rows rather than one long strip because "YM" sitting next to "M"
              // in a single row of buttons is exactly how a parent buys the
              // wrong shirt. Only split when there IS a youth band — a metal
              // print or a blank still renders the one plain row it always did.
              const youthSizes = displaySizes.filter(sz => isYouthSize(sz))
              const adultSizes = displaySizes.filter(sz => !isYouthSize(sz))
              const splitBands = youthSizes.length > 0 && adultSizes.length > 0

              const renderSizeButtons = (sizes: string[]) => (
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  {sizes.map(size => {
                    const isSelected = selectedSize === size
                    // Blank garments: the real price for this size (in the
                    // selected colour group) lives on the button itself.
                    const sizePrice = blankPricing ? blankUnitPriceDollars(blankPricing, size, selectedColor) : null
                    // Printed tees and hoodies: the whole amount this size
                    // adds or takes off ("+$2.50", "-$3.00"), the same rails
                    // the server charges.
                    const deltaLabel = formatPriceDelta(sizePriceDelta(product, size))
                    return (
                      <button
                        key={size}
                        onClick={() => setSelectedSize(size)}
                        className={`${chip(isSelected)} min-w-[3rem] min-h-[2.75rem] px-2.5 py-1.5 flex flex-col items-center justify-center leading-tight`}
                        title={sizePrice !== null ? `$${sizePrice.toFixed(2)} each` : deltaLabel ? `${deltaLabel} for this size` : undefined}
                      >
                        {size}
                        {sizePrice !== null ? (
                          <span className={`text-[10px] font-medium ${isSelected ? 'text-white/85' : 'text-muted'}`}>
                            ${sizePrice.toFixed(2)}
                          </span>
                        ) : deltaLabel ? (
                          <span className={`text-[10px] font-medium ${isSelected ? 'text-white/85' : 'text-muted'}`}>
                            {deltaLabel}
                          </span>
                        ) : productKind === 'metal' && (
                          <span className={`text-[10px] font-medium ${isSelected ? 'text-white/85' : 'text-primary'}`}>
                            ${metalSizePrice(size as '4x6' | '8x10').toFixed(2)}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )

              return (
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-sm font-semibold text-text">{sizeLabel}</span>
                    {adultChart && guideAdultRows.length > 0 && (
                      <button type="button" onClick={() => setShowSizeGuide(true)} className="text-sm font-semibold text-primary hover:underline underline-offset-4">
                        Size guide
                      </button>
                    )}
                  </div>
                  {splitBands ? (
                    <div className="space-y-3">
                      {renderSizeButtons(adultSizes)}
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">
                          Youth <span className="normal-case font-normal">(${YOUTH_SIZE_DISCOUNT_DOLLARS.toFixed(2)} less)</span>
                        </div>
                        {renderSizeButtons(youthSizes)}
                      </div>
                    </div>
                  ) : (
                    renderSizeButtons(displaySizes)
                  )}
                </div>
              )
            })()}

            {productKind === 'metal' && product.metadata?.finish && (
              <div>
                <span className={optionLabel}>Finish</span>
                <span className="inline-block px-4 py-2 rounded-xl border-2 border-primary text-text font-semibold capitalize">
                  {String(product.metadata.finish)}
                </span>
              </div>
            )}

            {colorChoices.length > 0 && (
              <div>
                <span className={optionLabel}>
                  Color
                  {selectedColor && (
                    <span className="ml-2 text-muted font-normal">— {isBlank ? selectedColor : getColorName(selectedColor)}</span>
                  )}
                </span>
                <div className="flex flex-wrap gap-2">
                  {colorChoices.map(color => {
                    // Blanks store Jiffy colour NAMES (so inventory + reorders
                    // line up); their swatch hex comes off metadata.garment.colors.
                    const label = isBlank ? color : getColorName(color)
                    const swatch = isBlank ? (blankSwatches[color] || '#9CA3AF') : color
                    const light = isBlank ? isLightHex(swatch) : isLightSwatch(color)
                    const isSelected = selectedColor === color
                    return (
                      <button
                        key={color}
                        onClick={() => {
                          setSelectedColor(color)
                          // A blank with a render for this colour puts it in
                          // the hero slot — make sure the hero is what's showing.
                          if (isBlank && blankColorImages[color]) { setSelectedImage(0); setVideoActive(false) }
                        }}
                        title={label}
                        aria-label={`Select ${label}`}
                        className={`flex items-center gap-2 pl-2 pr-3 py-1.5 min-h-[2.75rem] rounded-xl border-2 transition-colors ${
                          isSelected ? 'border-primary text-text' : 'border-border hover:border-primary text-text'
                        }`}
                      >
                        <span
                          className="w-6 h-6 rounded-full border border-black/15 flex items-center justify-center shrink-0"
                          style={{ backgroundColor: swatch }}
                        >
                          {isSelected && (
                            <Check className={`w-3.5 h-3.5 ${light ? 'text-slate-800' : 'text-white'}`} />
                          )}
                        </span>
                        <span className="text-sm">{label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Garment quality — printed tees offer the tee blanks (base price =
                the standard blank, premium blanks upcharge per unit); a hoodie
                shows its own hoodie blank, never the tee line. */}
            {showGarmentTiers && (
              <div>
                <span className={optionLabel}>{options.blankPicker === 'hoodie' ? 'Hoodie Quality' : 'Shirt Quality'}</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {blankTiers.map(tier => {
                    const isSelected = selectedTier === tier.id
                    return (
                      <button
                        key={tier.id}
                        onClick={() => setSelectedTier(tier.id)}
                        className={`text-left p-3 rounded-xl border-2 transition-colors ${isSelected ? 'border-primary bg-bg-warm' : 'border-border bg-card hover:border-primary'}`}
                        aria-pressed={isSelected}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${isSelected ? 'border-primary' : 'border-border'}`}>
                            {isSelected && <span className="w-2 h-2 rounded-full bg-primary" />}
                          </span>
                          <span className="font-semibold text-sm text-text flex-1">{tier.label}</span>
                          <span className="text-xs font-semibold text-muted">
                            {tier.upcharge > 0 ? `+$${tier.upcharge.toFixed(2)}` : 'included'}
                          </span>
                        </div>
                        <p className="text-xs text-muted mt-1 line-clamp-2">{tier.blurb}</p>
                        <p className="text-[11px] text-muted mt-1">{tier.weightOz} oz · {tier.compareTo}</p>
                      </button>
                    )
                  })}
                </div>
                {tierUpcharge > 0 && (
                  <p className="text-xs text-muted mt-1.5">
                    Unit price with this blank: <span className="text-text font-semibold">${(product.price + tierUpcharge).toFixed(2)}</span>
                  </p>
                )}
              </div>
            )}

            {requiresPrintLocation && (
              <div>
                <span className={optionLabel}>Print Placement</span>
                <div className="flex flex-wrap gap-2">
                  {placementChoices.map(loc => {
                    const isSelected = selectedPrintLocation === loc
                    return (
                      <button
                        key={loc}
                        onClick={() => {
                          setSelectedPrintLocation(loc)
                          // Show the shot that matches what they just picked.
                          // Only pocket has its own render today; front/back
                          // keep whatever the shopper was already looking at.
                          const shot = placementShots[loc === 'pocket' ? 'pocket' : '']
                          if (shot) {
                            const at = galleryImages.indexOf(shot)
                            if (at >= 0) { setSelectedImage(at); setVideoActive(false) }
                          }
                        }}
                        className={`${chip(isSelected)} px-4 min-h-[2.75rem]`}
                      >
                        {printLocationLabel(loc)}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {availableAddons.length > 0 && (
              <div>
                <span className={optionLabel}>Add-ons</span>
                <div className="space-y-2">
                  {availableAddons.map(addon => {
                    const checked = selectedAddons.some(a => a.id === addon.id)
                    return (
                      <button
                        key={addon.id}
                        type="button"
                        onClick={() => toggleAddon(addon)}
                        className={`w-full flex items-start gap-3 text-left px-4 py-3 rounded-xl border-2 transition-colors ${
                          checked ? 'border-primary bg-bg-warm' : 'border-border bg-card hover:border-primary'
                        }`}
                      >
                        <span className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${checked ? 'bg-primary border-primary' : 'border-border'}`}>
                          {checked && <Check className="w-3.5 h-3.5 text-white" />}
                        </span>
                        <span className="flex-1">
                          <span className="flex items-center justify-between">
                            <span className="font-semibold text-text">{addon.name}</span>
                            <span className="font-semibold text-primary">+${addon.price.toFixed(2)}</span>
                          </span>
                          <span className="block text-xs text-muted mt-0.5">{addon.blurb}{addon.printed ? ' · Made in-house' : ''}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
                {addonsTotal > 0 && (
                  <p className="text-sm text-muted mt-2">
                    Item total: <span className="font-bold text-text">${(unitPrice + addonsTotal).toFixed(2)}</span>
                    <span className="text-xs"> (base ${unitPrice.toFixed(2)} + add-ons ${addonsTotal.toFixed(2)})</span>
                  </p>
                )}
              </div>
            )}

            {teamTemplate && (
              <TeamPersonalizePanel
                productId={product.id}
                template={teamTemplate}
                values={personalization}
                onChange={setPersonalization}
                onUnsupported={() => setPersonalizeUnsupported(true)}
              />
            )}

            {/* Quantity + the ONE main button. */}
            <div>
              <span className={optionLabel}>Quantity</span>
              <div className="flex items-stretch gap-3">
                <div className="flex items-center border-2 border-border rounded-xl bg-card">
                  <button
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="w-11 h-12 flex items-center justify-center text-lg text-text"
                    aria-label="One fewer"
                  >
                    −
                  </button>
                  <span className="w-8 text-center font-semibold text-text" aria-live="polite">{quantity}</span>
                  <button
                    onClick={() => setQuantity(quantity + 1)}
                    className="w-11 h-12 flex items-center justify-center text-lg text-text"
                    aria-label="One more"
                  >
                    +
                  </button>
                </div>
                <button
                  onClick={() => handleAddToCart()}
                  disabled={!product.inStock || (teamTemplate ? !personalizationComplete : false)}
                  className="flex-1 btn-primary !py-3 !px-4 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ShoppingCart className="w-5 h-5" />
                  {product.inStock ? 'Add to cart' : 'Out of stock'}
                </button>
              </div>
              <div className="flex flex-col items-center gap-2 mt-3">
                <button
                  onClick={handleBuyNow}
                  disabled={!product.inStock}
                  className="text-sm font-semibold text-primary hover:underline underline-offset-4 disabled:opacity-50 py-1"
                >
                  Or buy it now
                </button>
                {/* Gang sheet: put this design on an Imagination Sheet with other
                    designs. Needs artwork, so never on a blank, metal or 3D. It
                    is a small link now; Add to cart is the main button (63520e95). */}
                {options.gangSheet && (
                  <button
                    onClick={() => {
                      // Imagination Station gets the SOURCE image from product_assets
                      // (kind='source' or 'nobg'), else the first product image.
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
                    className="text-sm text-muted hover:text-primary inline-flex items-center gap-1.5 py-1"
                  >
                    <Sparkles className="w-4 h-4" />
                    {isTransfer ? 'Ordering several designs? Put them on one Imagination Sheet' : 'Add this design to your Imagination Sheet'}
                  </button>
                )}
              </div>
            </div>

            {/* Upload-your-own: only where the shopper brings the art (a
                blank, a personalizable template). A finished design already
                IS the art, so it never shows here (David 2026-10-07). */}
            {options.upload && (
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
                  className="w-full border-2 border-primary text-primary font-semibold py-3 px-6 rounded-full transition-colors hover:bg-bg-warm flex items-center justify-center gap-2"
                >
                  {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                  {uploading ? 'Uploading...' : 'Upload your own design'}
                </button>
              </>
            )}

            {/* Three true facts (pickup + free threshold live in shipping-calculator). */}
            <ul className="grid grid-cols-3 gap-2 border-y border-border py-4">
              <li className="flex flex-col sm:flex-row items-center sm:items-start gap-1.5 sm:gap-2 text-center sm:text-left text-xs sm:text-sm text-text-secondary">
                <Store className="w-5 h-5 text-primary shrink-0" strokeWidth={1.75} />
                <span>Free pickup in {SHOP_PLACE.town}</span>
              </li>
              <li className="flex flex-col sm:flex-row items-center sm:items-start gap-1.5 sm:gap-2 text-center sm:text-left text-xs sm:text-sm text-text-secondary">
                <Truck className="w-5 h-5 text-primary shrink-0" strokeWidth={1.75} />
                <span>Free shipping on ${FREE_SHIPPING_THRESHOLD}+</span>
              </li>
              <li className="flex flex-col sm:flex-row items-center sm:items-start gap-1.5 sm:gap-2 text-center sm:text-left text-xs sm:text-sm text-text-secondary">
                <ShieldCheck className="w-5 h-5 text-primary shrink-0" strokeWidth={1.75} />
                <span>Secure checkout</span>
              </li>
            </ul>

            {/* Virtual try-on. Apparel only — it dresses a person, which means
                nothing for metal wall art or a 3D print. The card renders
                itself to null until the feature is switched on server-side. */}
            {options.tryOn && (
              <VirtualTryOn
                productId={product.id}
                productName={product.name}
                garmentImageIndex={videoActive ? 0 : selectedImage}
                onAddToCart={(attribution) => handleAddToCart(attribution)}
                disabled={!product.inStock}
              />
            )}

            {hasDigitalDeliverables(product) && (
              <div className="bg-card border border-border p-4 rounded-2xl">
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
                        className="flex items-center justify-between px-3 py-2 rounded-xl border border-border bg-bg-warm hover:border-primary transition-colors text-sm text-text"
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
                      className="w-full btn-primary !py-3 disabled:opacity-60"
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

            {/* The story, short: three lines and Read more (no italic quote). */}
            {description && (
              <div>
                <p className={`text-text-secondary leading-relaxed whitespace-pre-line ${descOpen ? '' : 'line-clamp-3'}`}>{description}</p>
                {description.length > 160 && (
                  <button onClick={() => setDescOpen(o => !o)} className="mt-1 text-sm font-semibold text-primary inline-flex items-center gap-1">
                    {descOpen ? 'Show less' : 'Read more'}
                    <ChevronDown className={`w-4 h-4 transition-transform ${descOpen ? 'rotate-180' : ''}`} />
                  </button>
                )}
              </div>
            )}

            <div className="space-y-2">
              {!isBlank && (
                <details className="group rounded-xl border border-border bg-card">
                  <summary className="flex items-center justify-between cursor-pointer list-none px-4 py-3 font-semibold text-text">
                    Details
                    <ChevronDown className="w-4 h-4 text-muted transition-transform group-open:rotate-180" />
                  </summary>
                  <ul className="px-4 pb-4 space-y-1.5 text-sm text-text-secondary">
                    <li>{productKind === '3d' ? '3D printed in our Georgia shop after you order' : isTransfer ? 'DTF transfer, printed after you order. This is the transfer only; no shirt is included' : 'Made to order, printed after you order'}</li>
                    <li>Ships from Georgia, USA</li>
                    <li>Questions? <a href={`mailto:${BUSINESS_EMAIL}`} className="text-primary hover:underline">{BUSINESS_EMAIL}</a></li>
                  </ul>
                </details>
              )}
              <details className="group rounded-xl border border-border bg-card">
                <summary className="flex items-center justify-between cursor-pointer list-none px-4 py-3 font-semibold text-text">
                  Shipping and pickup
                  <ChevronDown className="w-4 h-4 text-muted transition-transform group-open:rotate-180" />
                </summary>
                <ul className="px-4 pb-4 space-y-1.5 text-sm text-text-secondary">
                  <li>Free standard shipping on orders of ${FREE_SHIPPING_THRESHOLD} or more</li>
                  <li>Ships within {STANDARD_FULFILLMENT_DAYS} business days of payment, then ground delivery up to 5 business days</li>
                  <li>Faster options and free {SHOP_PLACE.town}, {SHOP_PLACE.stateCode} pickup at checkout</li>
                  <li><Link to="/shipping" className="text-primary hover:underline">Shipping policy</Link></li>
                </ul>
              </details>
              <details className="group rounded-xl border border-border bg-card">
                <summary className="flex items-center justify-between cursor-pointer list-none px-4 py-3 font-semibold text-text">
                  Returns
                  <ChevronDown className="w-4 h-4 text-muted transition-transform group-open:rotate-180" />
                </summary>
                <p className="px-4 pb-4 text-sm text-text-secondary">
                  Everything is made for you after you order, so a change of mind or a wrong size can't come back. If it arrives
                  damaged, defective or wrong, email us within 14 days with a photo and we replace or refund it. Full terms:{' '}
                  <Link to="/returns" className="text-primary hover:underline">Returns policy</Link>.
                </p>
              </details>
            </div>
          </div>
        </div>
      </div>

      <YouMayAlsoLike product={product} />

      <SizeGuide
        open={showSizeGuide}
        onClose={() => setShowSizeGuide(false)}
        title={guideTier?.label ?? product.name}
        compareTo={guideTier?.compareTo}
        adult={guideAdultRows}
        youth={guideYouthRows}
      />
    </div>
  )
}

export default ProductPage



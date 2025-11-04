import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/SupabaseAuthContext'
import { useCart } from '../context/CartContext'
import ProductRecommendations from '../components/ProductRecommendations'
import type { WholesaleVendor, WholesaleProduct, Product } from '../types'

interface VendorStorefrontTheme {
  primaryColor: string
  secondaryColor: string
  backgroundColor: string
  headerStyle: 'minimal' | 'bold' | 'classic'
  layout: 'grid' | 'list' | 'masonry'
  showPricing: boolean
  showReviews: boolean
  customCSS?: string
}

interface VendorStorefrontConfig {
  id: string
  vendorId: string
  isPublic: boolean
  customDomain?: string
  customUrl: string
  seoTitle: string
  seoDescription: string
  theme: VendorStorefrontTheme
  featuredProducts: string[]
  categories: string[]
  socialLinks: {
    website?: string
    facebook?: string
    instagram?: string
    twitter?: string
    linkedin?: string
  }
  contactInfo: {
    showPhone: boolean
    showEmail: boolean
    showAddress: boolean
    customMessage?: string
  }
  analytics: {
    googleAnalyticsId?: string
    facebookPixelId?: string
  }
  lastUpdated: string
}

const VendorStorefront: React.FC = () => {
  const { vendorId, customUrl } = useParams<{ vendorId?: string; customUrl?: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { addToCart } = useCart()
  
  const [vendor, setVendor] = useState<WholesaleVendor | null>(null)
  const [storefrontConfig, setStorefrontConfig] = useState<VendorStorefrontConfig | null>(null)
  const [products, setProducts] = useState<WholesaleProduct[]>([])
  const [filteredProducts, setFilteredProducts] = useState<WholesaleProduct[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [sortBy, setSortBy] = useState<string>('featured')
  const [isContactModalOpen, setIsContactModalOpen] = useState(false)

  useEffect(() => {
    loadVendorStorefront()
  }, [vendorId, customUrl])

  useEffect(() => {
    filterProducts()
  }, [products, selectedCategory, sortBy])

  const loadVendorStorefront = async () => {
    setIsLoading(true)
    try {
      // Mock vendor and storefront data
      const mockVendor: WholesaleVendor = {
        id: vendorId || 'vendor_1',
        userId: 'user_vendor_1',
        companyName: 'Premium Apparel Co.',
        businessDescription: 'Leading manufacturer of high-quality custom apparel and promotional products. We specialize in sustainable, ethically-sourced materials and cutting-edge printing techniques.',
        logo: 'https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=200&h=200&fit=crop',
        coverImage: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&h=400&fit=crop',
        address: {
          company: 'Premium Apparel Co.',
          address1: '123 Manufacturing St',
          city: 'Los Angeles',
          state: 'CA',
          zip: '90210',
          country: 'US',
          phone: '(555) 123-4567',
          email: 'sales@premiumapparel.com'
        },
        contactInfo: {
          firstName: 'Sarah',
          lastName: 'Johnson',
          title: 'Sales Director',
          email: 'sarah@premiumapparel.com',
          phone: '(555) 123-4567'
        },
        categories: ['shirts', 'hoodies', 'dtf-transfers'],
        productCount: 150,
        minimumOrderValue: 500,
        leadTime: 7,
        shippingMethods: [
          { name: 'Standard', description: 'Standard shipping', estimatedDays: 5, cost: 15.00 },
          { name: 'Express', description: 'Express shipping', estimatedDays: 2, cost: 35.00, freeShippingThreshold: 1000 }
        ],
        paymentMethods: ['Credit Card', 'Net 30', 'Wire Transfer'],
        certifications: ['ISO 9001', 'OEKO-TEX', 'WRAP'],
        rating: 4.8,
        reviewCount: 127,
        isVerified: true,
        isFeatured: true,
        status: 'active',
        joinedDate: '2023-01-15T00:00:00Z',
        lastActive: '2025-01-12T10:30:00Z'
      }

      const mockStorefrontConfig: VendorStorefrontConfig = {
        id: 'storefront_1',
        vendorId: mockVendor.id,
        isPublic: true,
        customUrl: customUrl || 'premium-apparel',
        seoTitle: 'Premium Apparel Co. - High-Quality Custom Apparel',
        seoDescription: 'Discover our premium collection of custom apparel and promotional products. Sustainable materials, fast turnaround, and exceptional quality.',
        theme: {
          primaryColor: '#8B5CF6',
          secondaryColor: '#06B6D4',
          backgroundColor: '#F8FAFC',
          headerStyle: 'bold',
          layout: 'grid',
          showPricing: true,
          showReviews: true
        },
        featuredProducts: ['wp_1', 'wp_2', 'wp_3'],
        categories: ['shirts', 'hoodies', 'dtf-transfers'],
        socialLinks: {
          website: 'https://premiumapparel.com',
          instagram: 'https://instagram.com/premiumapparel',
          linkedin: 'https://linkedin.com/company/premiumapparel'
        },
        contactInfo: {
          showPhone: true,
          showEmail: true,
          showAddress: false,
          customMessage: 'Ready to start your custom apparel project? Get in touch with our team for personalized service and competitive pricing.'
        },
        analytics: {
          googleAnalyticsId: 'GA-XXXXX-X'
        },
        lastUpdated: '2025-01-10T00:00:00Z'
      }

      const mockProducts: WholesaleProduct[] = [
        {
          id: 'wp_1',
          name: 'Premium Cotton T-Shirt',
          description: 'Ultra-soft 100% organic cotton t-shirt, perfect for custom printing and embroidery.',
          retailPrice: 24.99,
          wholesalePricing: [
            { tier: 'bronze', price: 18.74, minimumQuantity: 12 },
            { tier: 'silver', price: 17.49, minimumQuantity: 24 },
            { tier: 'gold', price: 16.24, minimumQuantity: 48 },
            { tier: 'platinum', price: 14.99, minimumQuantity: 96 }
          ],
          images: [
            'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&h=600&fit=crop',
            'https://images.unsplash.com/photo-1503341338985-95ad5e163e51?w=600&h=600&fit=crop'
          ],
          category: 'shirts',
          inStock: true,
          minimumOrderQuantity: 12,
          leadTime: 3,
          specifications: [
            { name: 'Material', value: '100% Organic Cotton', type: 'material' },
            { name: 'Weight', value: '180 GSM', type: 'measurement' },
            { name: 'Sizes', value: 'XS-5XL', type: 'text' },
            { name: 'Colors', value: '15 colors available', type: 'color' }
          ],
          bulkDiscounts: [
            { minimumQuantity: 100, discountPercentage: 5, description: '5% off orders of 100+' },
            { minimumQuantity: 250, discountPercentage: 10, description: '10% off orders of 250+' }
          ],
          customizationOptions: [
            {
              id: 'size',
              name: 'Size',
              type: 'size',
              options: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
              required: true
            },
            {
              id: 'color',
              name: 'Color',
              type: 'color',
              options: ['White', 'Black', 'Navy', 'Red', 'Royal Blue', 'Forest Green'],
              required: true
            }
          ]
        },
        {
          id: 'wp_2',
          name: 'Premium Hoodie',
          description: 'Heavyweight cotton blend hoodie with double-lined hood and kangaroo pocket.',
          retailPrice: 54.99,
          wholesalePricing: [
            { tier: 'bronze', price: 41.24, minimumQuantity: 6 },
            { tier: 'silver', price: 38.49, minimumQuantity: 12 },
            { tier: 'gold', price: 35.74, minimumQuantity: 24 },
            { tier: 'platinum', price: 32.99, minimumQuantity: 48 }
          ],
          images: [
            'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=600&h=600&fit=crop'
          ],
          category: 'hoodies',
          inStock: true,
          minimumOrderQuantity: 6,
          leadTime: 5,
          specifications: [
            { name: 'Material', value: '80% Cotton, 20% Polyester', type: 'material' },
            { name: 'Weight', value: '320 GSM', type: 'measurement' },
            { name: 'Sizes', value: 'S-3XL', type: 'text' }
          ],
          bulkDiscounts: [
            { minimumQuantity: 50, discountPercentage: 8, description: '8% off orders of 50+' }
          ],
          customizationOptions: [
            {
              id: 'size',
              name: 'Size',
              type: 'size',
              options: ['S', 'M', 'L', 'XL', '2XL', '3XL'],
              required: true
            },
            {
              id: 'color',
              name: 'Color',
              type: 'color',
              options: ['Black', 'Gray', 'Navy', 'Maroon'],
              required: true
            }
          ]
        },
        {
          id: 'wp_3',
          name: 'Custom DTF Transfer',
          description: 'High-quality direct-to-film transfers with vibrant colors and excellent washability.',
          retailPrice: 8.99,
          wholesalePricing: [
            { tier: 'bronze', price: 6.74, minimumQuantity: 25 },
            { tier: 'silver', price: 6.29, minimumQuantity: 50 },
            { tier: 'gold', price: 5.84, minimumQuantity: 100 },
            { tier: 'platinum', price: 5.39, minimumQuantity: 250 }
          ],
          images: [
            'https://images.unsplash.com/photo-1503341338985-95ad5e163e51?w=600&h=600&fit=crop'
          ],
          category: 'dtf-transfers',
          inStock: true,
          minimumOrderQuantity: 25,
          leadTime: 2,
          specifications: [
            { name: 'Size', value: 'Up to 11"x15"', type: 'measurement' },
            { name: 'Application', value: 'Heat Press 300°F, 15 seconds', type: 'text' },
            { name: 'Durability', value: '50+ washes', type: 'text' }
          ],
          bulkDiscounts: [
            { minimumQuantity: 100, discountPercentage: 10, description: '10% off orders of 100+' },
            { minimumQuantity: 500, discountPercentage: 15, description: '15% off orders of 500+' }
          ],
          customizationOptions: [
            {
              id: 'size',
              name: 'Transfer Size',
              type: 'size',
              options: ['4"x4"', '8"x8"', '11"x11"', '11"x15"'],
              required: true
            }
          ]
        }
      ]

      setVendor(mockVendor)
      setStorefrontConfig(mockStorefrontConfig)
      setProducts(mockProducts)
    } catch (error) {
      console.error('Error loading vendor storefront:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const filterProducts = () => {
    let filtered = products

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(product => product.category === selectedCategory)
    }

    // Sort products
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'featured':
          return storefrontConfig?.featuredProducts.includes(a.id) ? -1 : 1
        case 'price_low':
          return a.retailPrice - b.retailPrice
        case 'price_high':
          return b.retailPrice - a.retailPrice
        case 'name':
          return a.name.localeCompare(b.name)
        case 'newest':
          return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime()
        default:
          return 0
      }
    })

    setFilteredProducts(filtered)
  }

  const getDisplayPrice = (product: WholesaleProduct): { price: number; label: string } => {
    if (!storefrontConfig?.theme.showPricing) {
      return { price: 0, label: 'Contact for pricing' }
    }

    // Show wholesale price if user is logged in and has wholesale access
    if (user?.role === 'wholesale') {
      const userTier = (user as any).wholesaleTier || 'bronze'
      const tierPricing = product.wholesalePricing.find(p => p.tier === userTier)
      return {
        price: tierPricing?.price || product.retailPrice,
        label: `${userTier} price`
      }
    }

    return { price: product.retailPrice, label: 'Retail price' }
  }

  const handleAddToCart = (product: WholesaleProduct) => {
    // Convert wholesale product to regular product format for cart
    const cartProduct: Product = {
      id: product.id,
      name: product.name,
      description: product.description,
      price: getDisplayPrice(product).price,
      images: product.images,
      category: product.category as any,
      inStock: product.inStock,
      vendorId: vendor?.id
    }
    
    addToCart(cartProduct, product.minimumOrderQuantity)
    alert('Product added to cart!')
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    )
  }

  if (!vendor || !storefrontConfig) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-text mb-4">Vendor Not Found</h1>
          <p className="text-muted mb-6">The vendor storefront you're looking for doesn't exist.</p>
          <button 
            onClick={() => navigate('/vendors')}
            className="btn-primary"
          >
            Browse All Vendors
          </button>
        </div>
      </div>
    )
  }

  const theme = storefrontConfig.theme

  return (
    <div 
      className="min-h-screen"
      style={{ 
        backgroundColor: theme.backgroundColor,
        '--primary-color': theme.primaryColor,
        '--secondary-color': theme.secondaryColor
      } as any}
    >
      {/* SEO Meta Tags */}
      <head>
        <title>{storefrontConfig.seoTitle}</title>
        <meta name="description" content={storefrontConfig.seoDescription} />
        <meta property="og:title" content={storefrontConfig.seoTitle} />
        <meta property="og:description" content={storefrontConfig.seoDescription} />
        <meta property="og:image" content={vendor.coverImage} />
        {storefrontConfig.analytics.googleAnalyticsId && (
          <script async src={`https://www.googletagmanager.com/gtag/js?id=${storefrontConfig.analytics.googleAnalyticsId}`}></script>
        )}
      </head>

      {/* Header */}
      <header 
        className={`${
          theme.headerStyle === 'bold' ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white' :
          theme.headerStyle === 'minimal' ? 'bg-card border-b' :
          'bg-gray-900 text-white'
        } shadow-sm`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              {vendor.logo && (
                <img
                  src={vendor.logo}
                  alt={vendor.companyName}
                  className="w-10 h-10 rounded-full mr-3"
                />
              )}
              <div>
                <h1 className="text-xl font-bold">{vendor.companyName}</h1>
                {vendor.isVerified && (
                  <div className="flex items-center text-sm opacity-75">
                    <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                    </svg>
                    Verified Vendor
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-4">
              {storefrontConfig.contactInfo.showPhone && (
                <a 
                  href={`tel:${vendor.contactInfo.phone}`}
                  className="text-sm hover:underline"
                >
                  {vendor.contactInfo.phone}
                </a>
              )}
              <button
                onClick={() => setIsContactModalOpen(true)}
                className={`px-4 py-2 rounded-md text-sm font-medium ${
                  theme.headerStyle === 'minimal' 
                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                    : 'bg-card text-text hover:bg-card'
                }`}
              >
                Contact Us
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      {vendor.coverImage && (
        <section className="relative h-64 md:h-80">
          <img
            src={vendor.coverImage}
            alt={vendor.companyName}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black bg-opacity-40 flex items-center justify-center">
            <div className="text-center text-white max-w-4xl px-4">
              <h2 className="text-3xl md:text-5xl font-bold mb-4">{vendor.companyName}</h2>
              <p className="text-lg md:text-xl opacity-90">{vendor.businessDescription}</p>
            </div>
          </div>
        </section>
      )}

      {/* Vendor Info */}
      <section className="py-8 border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="flex items-center justify-center text-2xl font-bold mb-2">
                <svg className="w-6 h-6 mr-2 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                {vendor.productCount}
              </div>
              <p className="text-muted">Products</p>
            </div>
            
            <div className="text-center">
              <div className="flex items-center justify-center text-2xl font-bold mb-2">
                <svg className="w-6 h-6 mr-2 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {vendor.leadTime}
              </div>
              <p className="text-muted">Days Lead Time</p>
            </div>
            
            <div className="text-center">
              <div className="flex items-center justify-center text-2xl font-bold mb-2">
                <svg className="w-6 h-6 mr-2 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                </svg>
                ${vendor.minimumOrderValue}
              </div>
              <p className="text-muted">Minimum Order</p>
            </div>
            
            <div className="text-center">
              <div className="flex items-center justify-center text-2xl font-bold mb-2">
                <div className="flex items-center">
                  {[...Array(5)].map((_, i) => (
                    <svg
                      key={i}
                      className={`w-5 h-5 ${i < Math.floor(vendor.rating) ? 'text-yellow-400' : 'text-gray-300'}`}
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                    </svg>
                  ))}
                </div>
                <span className="ml-2">{vendor.rating}</span>
              </div>
              <p className="text-muted">{vendor.reviewCount} Reviews</p>
            </div>
          </div>
        </div>
      </section>

      {/* Product Catalog */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-2xl font-bold text-text">Our Products</h3>
            
            <div className="flex items-center space-x-4">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="form-select"
              >
                <option value="all">All Categories</option>
                {storefrontConfig.categories.map(category => (
                  <option key={category} value={category}>
                    {category.charAt(0).toUpperCase() + category.slice(1)}
                  </option>
                ))}
              </select>
              
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="form-select"
              >
                <option value="featured">Featured</option>
                <option value="name">Name A-Z</option>
                <option value="price_low">Price Low to High</option>
                <option value="price_high">Price High to Low</option>
                <option value="newest">Newest</option>
              </select>
            </div>
          </div>

          {/* Products Grid */}
          <div className={`grid gap-6 ${
            theme.layout === 'grid' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' :
            theme.layout === 'list' ? 'grid-cols-1' :
            'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
          }`}>
            {filteredProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                vendor={vendor}
                theme={theme}
                displayPrice={getDisplayPrice(product)}
                onAddToCart={() => handleAddToCart(product)}
                layout={theme.layout}
              />
            ))}
          </div>

          {filteredProducts.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted">No products found in this category.</p>
            </div>
          )}
        </div>
      </section>

      {/* Recommendations */}
      <section className="py-12 bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <ProductRecommendations
            context={{
              page: 'category',
              limit: 6
            }}
            title="You Might Also Like"
          />
        </div>
      </section>

      {/* Contact Modal */}
      {isContactModalOpen && (
        <ContactModal
          vendor={vendor}
          config={storefrontConfig}
          onClose={() => setIsContactModalOpen(false)}
        />
      )}
    </div>
  )
}

// Product Card Component
const ProductCard: React.FC<{
  product: WholesaleProduct
  vendor: WholesaleVendor
  theme: VendorStorefrontTheme
  displayPrice: { price: number; label: string }
  onAddToCart: () => void
  layout: string
}> = ({ product, theme, displayPrice, onAddToCart, layout }) => {
  return (
    <div className={`bg-card rounded-lg shadow overflow-hidden hover:shadow-lg transition-shadow ${
      layout === 'list' ? 'flex' : ''
    }`}>
      <div className={layout === 'list' ? 'w-1/3' : ''}>
        <img
          src={product.images[0]}
          alt={product.name}
          className={`object-cover ${layout === 'list' ? 'w-full h-full' : 'w-full h-48'}`}
        />
      </div>
      
      <div className={`p-6 ${layout === 'list' ? 'flex-1' : ''}`}>
        <h4 className="text-lg font-medium text-text mb-2">{product.name}</h4>
        <p className="text-muted text-sm mb-4 line-clamp-2">{product.description}</p>
        
        {theme.showPricing && displayPrice.price > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold" style={{ color: theme.primaryColor }}>
                  ${displayPrice.price.toFixed(2)}
                </p>
                <p className="text-xs text-muted">{displayPrice.label}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted">MOQ</p>
                <p className="font-medium">{product.minimumOrderQuantity}</p>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between text-sm text-muted mb-4">
          <span>Lead time: {product.leadTime} days</span>
          <span className="text-green-600">{product.inStock ? 'In Stock' : 'Out of Stock'}</span>
        </div>

        <div className="space-y-2">
          <button
            onClick={onAddToCart}
            disabled={!product.inStock}
            className="w-full py-2 px-4 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ 
              backgroundColor: theme.primaryColor,
              color: 'white'
            }}
          >
            Add to Cart
          </button>
          <button className="w-full py-2 px-4 border card-border rounded-md text-sm font-medium text-text hover:bg-card">
            Request Quote
          </button>
        </div>
      </div>
    </div>
  )
}

// Contact Modal Component
const ContactModal: React.FC<{
  vendor: WholesaleVendor
  config: VendorStorefrontConfig
  onClose: () => void
}> = ({ vendor, config, onClose }) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-card rounded-lg p-6 max-w-lg w-full mx-4">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-medium text-text">Contact {vendor.companyName}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-muted"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {config.contactInfo.customMessage && (
          <p className="text-muted mb-6">{config.contactInfo.customMessage}</p>
        )}

        <div className="space-y-4">
          {config.contactInfo.showEmail && (
            <div className="flex items-center">
              <svg className="w-5 h-5 text-gray-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <a 
                href={`mailto:${vendor.contactInfo.email}`}
                className="text-purple-600 hover:text-purple-700"
              >
                {vendor.contactInfo.email}
              </a>
            </div>
          )}
          
          {config.contactInfo.showPhone && (
            <div className="flex items-center">
              <svg className="w-5 h-5 text-gray-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              <a 
                href={`tel:${vendor.contactInfo.phone}`}
                className="text-purple-600 hover:text-purple-700"
              >
                {vendor.contactInfo.phone}
              </a>
            </div>
          )}

          {config.contactInfo.showAddress && (
            <div className="flex items-start">
              <svg className="w-5 h-5 text-gray-400 mr-3 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <div>
                <p>{vendor.address.address1}</p>
                <p>{vendor.address.city}, {vendor.address.state} {vendor.address.zip}</p>
              </div>
            </div>
          )}
        </div>

        {/* Social Links */}
        {Object.values(config.socialLinks).some(link => link) && (
          <div className="mt-6 pt-6 border-t">
            <p className="text-sm font-medium text-text mb-3">Follow Us</p>
            <div className="flex space-x-3">
              {config.socialLinks.website && (
                <a 
                  href={config.socialLinks.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-muted"
                >
                  🌐
                </a>
              )}
              {config.socialLinks.instagram && (
                <a 
                  href={config.socialLinks.instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-muted"
                >
                  📷
                </a>
              )}
              {config.socialLinks.linkedin && (
                <a 
                  href={config.socialLinks.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-muted"
                >
                  💼
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default VendorStorefront
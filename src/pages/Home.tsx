import React, { useState, useEffect, Suspense, lazy, memo } from 'react'
import { Link } from 'react-router-dom'
import { Palette, Sparkles, Zap, Shield, Heart, ArrowRight, Star } from 'lucide-react'
import { Hero } from '../components/Hero'
import ProductCard from '../components/ProductCard'
import type { Product } from '../types'

import { supabase } from '../lib/supabase'

// Lazy load heavy components - they load AFTER initial render
const ProductRecommendations = lazy(() => import('../components/ProductRecommendations'))
const FeaturedSocialContent = lazy(() => import('../components/FeaturedSocialContent'))
const DesignStudioModal = lazy(() => import('../components/DesignStudioModal'))

// Loading skeleton for lazy-loaded sections
const SectionSkeleton = memo(() => (
  <div className="animate-pulse">
    <div className="h-8 bg-gray-200 rounded w-48 mb-6" />
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="bg-gray-100 rounded-lg h-48" />
      ))}
    </div>
  </div>
))

// Product cache to prevent refetching on navigation
let featuredProductsCache: { data: Product[]; timestamp: number } | null = null
const CACHE_TTL = 60000 // 1 minute

const Home: React.FC = () => {
  const [showDesignModal, setShowDesignModal] = useState(false)
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>(() =>
    featuredProductsCache?.data || []
  )
  const [isLoading, setIsLoading] = useState(!featuredProductsCache)

  const scrollRef = React.useRef<HTMLDivElement>(null)
  const autoScrollRef = React.useRef<NodeJS.Timeout | null>(null)

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const { current } = scrollRef
      const scrollAmount = direction === 'left' ? -current.offsetWidth : current.offsetWidth
      current.scrollBy({ left: scrollAmount, behavior: 'smooth' })
    }
  }

  const startAutoScroll = () => {
    if (autoScrollRef.current) clearInterval(autoScrollRef.current)
    autoScrollRef.current = setInterval(() => {
      if (scrollRef.current) {
        const { current } = scrollRef
        // Check if we reached the end
        if (current.scrollLeft + current.offsetWidth >= current.scrollWidth - 10) {
          current.scrollTo({ left: 0, behavior: 'smooth' })
        } else {
          scroll('right')
        }
      }
    }, 4000) // Scroll every 4 seconds
  }

  React.useEffect(() => {
    startAutoScroll()
    return () => {
      if (autoScrollRef.current) clearInterval(autoScrollRef.current)
    }
  }, [])

  // Optimized featured products fetch with caching
  useEffect(() => {
    // Use cache if fresh
    if (featuredProductsCache && Date.now() - featuredProductsCache.timestamp < CACHE_TTL) {
      if (featuredProducts.length === 0) {
        setFeaturedProducts(featuredProductsCache.data)
      }
      setIsLoading(false)
      return
    }

    const fetchFeaturedProducts = async () => {
      try {
        // Optimized query - only fetch needed columns
        const { data, error } = await supabase
          .from('products')
          .select('id, name, description, price, images, category, is_active, is_featured')
          .eq('is_featured', true)
          .eq('is_active', true)
          .limit(12)

        if (error) throw error

        if (data) {
          const products = data.map((p: any) => ({
            id: p.id,
            name: p.name,
            description: p.description || '',
            price: p.price || 0,
            images: p.images || [],
            category: p.category || 'shirts',
            inStock: p.is_active !== false,
            is_featured: p.is_featured
          }))

          // Cache the result
          featuredProductsCache = { data: products, timestamp: Date.now() }
          setFeaturedProducts(products)
        }
      } catch (error) {
        console.error('Error fetching featured products:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchFeaturedProducts()
  }, [])

  /* Scroll-triggered video logic */
  const videoRef = React.useRef<HTMLVideoElement>(null)

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!videoRef.current) return

          if (entry.isIntersecting) {
            // Provide a better experience by not restarting if it's already ended
            if (!videoRef.current.ended) {
              videoRef.current.muted = false
              videoRef.current.play().catch((e) => console.log('Autoplay blocked:', e))
            }
          } else {
            // Pause when out of view
            videoRef.current.pause()
          }
        })
      },
      { threshold: 0.5 } // Play/Pause when 50% visible
    )

    if (videoRef.current) {
      observer.observe(videoRef.current)
    }

    return () => observer.disconnect()
  }, [])

  return (
    <div className="bg-bg">
      {/* Hero Section - Full Screen Video */}
      <Hero />

      {/* How It Works Section */}
      <section className="py-24 bg-gradient-to-b from-bg to-purple-50/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-100 text-purple-700 text-sm font-medium mb-4">
              <Sparkles className="w-4 h-4" />
              Simple Process
            </span>
            <h2 className="font-display text-4xl md:text-5xl text-text mb-4">
              How It <span className="text-gradient">Works</span>
            </h2>
            <p className="text-muted text-lg max-w-2xl mx-auto">
              From idea to printed product in just three simple steps
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-12">
            {/* Step 1 */}
            <div className="relative group">
              <div className="card-editorial p-8 h-full text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-purple-200 group-hover:scale-110 transition-transform duration-300">
                  <Sparkles className="w-8 h-8 text-white" />
                </div>
                <div className="absolute -top-3 -left-3 w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center font-display text-purple-600 text-lg font-bold">
                  1
                </div>
                <h3 className="font-display text-xl text-text mb-3">Imagine Your Design</h3>
                <p className="text-muted">
                  Describe your vision to our AI or use our design tools to create your perfect design
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="relative group">
              <div className="card-editorial p-8 h-full text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-200 group-hover:scale-110 transition-transform duration-300">
                  <Palette className="w-8 h-8 text-white" />
                </div>
                <div className="absolute -top-3 -left-3 w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center font-display text-blue-600 text-lg font-bold">
                  2
                </div>
                <h3 className="font-display text-xl text-text mb-3">Choose Your Product</h3>
                <p className="text-muted">
                  Select from our wide range of premium products — t-shirts, hoodies, mugs, and more
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="relative group">
              <div className="card-editorial p-8 h-full text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-pink-500 to-pink-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-pink-200 group-hover:scale-110 transition-transform duration-300">
                  <Heart className="w-8 h-8 text-white" />
                </div>
                <div className="absolute -top-3 -left-3 w-10 h-10 bg-pink-100 rounded-full flex items-center justify-center font-display text-pink-600 text-lg font-bold">
                  3
                </div>
                <h3 className="font-display text-xl text-text mb-3">We Print & Ship</h3>
                <p className="text-muted">
                  Our professional team prints your design with care and ships it directly to you
                </p>
              </div>
            </div>
          </div>

          {/* CTA */}
          <div className="text-center mt-12">
            <button
              onClick={() => setShowDesignModal(true)}
              className="btn-primary group"
            >
              <Sparkles className="w-5 h-5" />
              Start Creating Now
              <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
            </button>
          </div>
        </div>
      </section>

      {/* Featured Products Section */}
      <section className="py-24 bg-bg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-12">
            <div>
              <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-100 text-purple-700 text-sm font-medium mb-4">
                <Star className="w-4 h-4" />
                Featured
              </span>
              <h2 className="font-display text-4xl md:text-5xl text-text">
                Popular <span className="text-gradient">Products</span>
              </h2>
            </div>

            <div className="flex items-center gap-4 mt-4 md:mt-0">
              {/* Navigation Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => scroll('left')}
                  className="p-2 rounded-full border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
                  aria-label="Scroll left"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={() => scroll('right')}
                  className="p-2 rounded-full border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
                  aria-label="Scroll right"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

              <Link
                to="/catalog"
                className="hidden md:inline-flex items-center gap-2 text-primary font-medium hover:gap-3 transition-all ml-4"
              >
                View All Products
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </div>

          <div className="relative group"
            onMouseEnter={() => {
              if (autoScrollRef.current) clearInterval(autoScrollRef.current)
            }}
            onMouseLeave={() => {
              startAutoScroll()
            }}
          >
            {isLoading ? (
              <div className="flex gap-6 overflow-hidden">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="min-w-[280px] md:min-w-[320px] card-editorial overflow-hidden animate-pulse">
                    <div className="aspect-square bg-gradient-to-br from-purple-100 to-blue-100" />
                    <div className="p-6">
                      <div className="h-6 bg-gray-200 rounded w-3/4 mb-3" />
                      <div className="h-4 bg-gray-200 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : featuredProducts.length > 0 ? (
              <div
                ref={scrollRef}
                className="flex overflow-x-auto gap-6 pb-8 snap-x snap-mandatory scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                {featuredProducts.map((product) => (
                  <div key={product.id} className="min-w-[280px] md:min-w-[320px] snap-start">
                    <ProductCard
                      product={product}
                      showSocialBadges={true}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted">
                No featured products available
              </div>
            )}
          </div>

          <div className="mt-8 text-center md:hidden">
            <Link
              to="/catalog"
              className="inline-flex items-center gap-2 text-primary font-medium hover:gap-3 transition-all"
            >
              View All Products
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Mr. Imagine Feature Section */}
      <section className="py-24 bg-gradient-to-br from-purple-50 via-bg to-blue-50 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left: Mr. Imagine Video */}
            <div className="relative flex justify-center">
              <div className="relative w-full max-w-sm">
                {/* Glow effect */}
                <div className="absolute inset-0 bg-gradient-radial from-purple-400/30 via-purple-300/10 to-transparent rounded-full blur-3xl scale-150" />

                <div className="relative rounded-3xl overflow-hidden shadow-2xl shadow-purple-500/20 border-4 border-white/50 backdrop-blur-sm">
                  <video
                    ref={videoRef}
                    src="/mr-imagine/welcome-video.mp4"
                    className="w-full h-auto object-cover"
                    playsInline
                  />
                </div>

                {/* Floating elements */}
                <div className="absolute top-10 -left-8 w-16 h-16 bg-gradient-to-br from-purple-400 to-purple-500 rounded-2xl shadow-lg shadow-purple-200 flex items-center justify-center animate-float z-10" style={{ animationDelay: '0.5s' }}>
                  <Sparkles className="w-8 h-8 text-white" />
                </div>
                <div className="absolute bottom-20 -right-8 w-14 h-14 bg-gradient-to-br from-blue-400 to-blue-500 rounded-xl shadow-lg shadow-blue-200 flex items-center justify-center animate-float z-10" style={{ animationDelay: '1s' }}>
                  <Palette className="w-6 h-6 text-white" />
                </div>
              </div>
            </div>

            {/* Right: Content */}
            <div>
              <h2 className="font-display text-4xl md:text-5xl text-text mb-6">
                Say Hello to
                <br />
                <span className="text-gradient">Mr. Imagine</span>
              </h2>
              <p className="text-muted text-lg mb-8 leading-relaxed">
                Your personal AI design assistant is here to help bring your creative visions to life.
                Just describe what you want, and Mr. Imagine will generate stunning designs in seconds.
              </p>

              <ul className="space-y-4 mb-8">
                <li className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <span className="text-text-secondary">Generate unique designs with simple text prompts</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <span className="text-text-secondary">Choose from multiple AI-generated options</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <span className="text-text-secondary">Automatic mockup generation for visualization</span>
                </li>
              </ul>

              <button
                onClick={() => setShowDesignModal(true)}
                className="btn-primary group"
              >
                <Sparkles className="w-5 h-5" />
                Try Mr. Imagine
                <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Social Showcase */}
      <section className="py-24 bg-bg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-pink-100 text-pink-700 text-sm font-medium mb-4">
              <Heart className="w-4 h-4" />
              Community
            </span>
            <h2 className="font-display text-4xl md:text-5xl text-text mb-4">
              Customer <span className="text-gradient-pink">Showcase</span>
            </h2>
            <p className="text-muted text-lg max-w-2xl mx-auto">
              See how our customers are using our products and sharing their amazing creations
            </p>
          </div>

          <Suspense fallback={<SectionSkeleton />}>
            <FeaturedSocialContent limit={5} />
          </Suspense>
        </div>
      </section>

      {/* Personalized Recommendations */}
      <section className="py-24 bg-gradient-to-b from-bg to-purple-50/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Suspense fallback={<SectionSkeleton />}>
            <ProductRecommendations
              context={{
                page: 'home',
                limit: 6
              }}
              title="Recommended for You"
              showReason={true}
            />
          </Suspense>
        </div>
      </section>

      {/* Why Choose Us */}
      <section className="py-24 bg-bg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-100 text-blue-700 text-sm font-medium mb-4">
              <Shield className="w-4 h-4" />
              Why Us
            </span>
            <h2 className="font-display text-4xl md:text-5xl text-text mb-4">
              Why Choose <span className="text-gradient">Imagine This Printed</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="card-editorial p-8 text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-purple-200">
                <Zap className="w-8 h-8 text-white" />
              </div>
              <h3 className="font-display text-xl text-text mb-3">Fast Turnaround</h3>
              <p className="text-muted">
                Quick processing and shipping to get your orders to you fast. Most orders ship within 2-3 business days.
              </p>
            </div>

            <div className="card-editorial p-8 text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-200">
                <Shield className="w-8 h-8 text-white" />
              </div>
              <h3 className="font-display text-xl text-text mb-3">Quality Guaranteed</h3>
              <p className="text-muted">
                Premium materials and professional DTF printing processes for lasting, vibrant results.
              </p>
            </div>

            <div className="card-editorial p-8 text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-pink-500 to-pink-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-pink-200">
                <Heart className="w-8 h-8 text-white" />
              </div>
              <h3 className="font-display text-xl text-text mb-3">Made with Love</h3>
              <p className="text-muted">
                Every design is crafted with care. Our AI + human team ensures your vision comes to life perfectly.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 bg-gradient-to-br from-purple-600 via-purple-700 to-blue-700 relative overflow-hidden">
        {/* Background elements */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-400/20 rounded-full blur-[150px]" />
          <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-blue-400/20 rounded-full blur-[120px]" />
        </div>

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h2 className="font-display text-4xl md:text-5xl lg:text-6xl text-white mb-6">
            Ready to Create Something
            <br />
            <span className="text-purple-200">Amazing?</span>
          </h2>
          <p className="text-purple-100 text-lg mb-10 max-w-2xl mx-auto">
            Join thousands of customers who have brought their creative visions to life with Imagine This Printed.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => setShowDesignModal(true)}
              className="group flex items-center gap-3 px-8 py-4 bg-white text-purple-700 font-semibold rounded-full hover:bg-purple-50 transition-all duration-300 shadow-xl hover:shadow-2xl hover:-translate-y-1"
            >
              <Sparkles className="w-5 h-5" />
              Start Creating Free
              <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
            </button>
            <Link
              to="/catalog"
              className="group flex items-center gap-3 px-8 py-4 bg-transparent border-2 border-white/40 text-white font-semibold rounded-full hover:bg-white/10 hover:border-white/60 transition-all duration-300"
            >
              Browse Products
              <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      </section>

      {showDesignModal && (
        <Suspense fallback={null}>
          <DesignStudioModal
            isOpen={showDesignModal}
            onClose={() => setShowDesignModal(false)}
          />
        </Suspense>
      )}
    </div>
  )
}

export default Home

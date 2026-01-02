import React, { useState, useEffect, Suspense, lazy, memo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Palette, Sparkles, Zap, Shield, Heart, ArrowRight, Star, Play } from 'lucide-react'
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
  const navigate = useNavigate()
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
  const [hasUserInteracted, setHasUserInteracted] = React.useState(false)
  const [isVideoPlaying, setIsVideoPlaying] = React.useState(false)

  // Track user interaction for unmuting
  React.useEffect(() => {
    const handleInteraction = () => setHasUserInteracted(true)
    window.addEventListener('click', handleInteraction, { once: true })
    window.addEventListener('touchstart', handleInteraction, { once: true })
    return () => {
      window.removeEventListener('click', handleInteraction)
      window.removeEventListener('touchstart', handleInteraction)
    }
  }, [])

  // Manual play handler for when autoplay fails
  const handleVideoPlay = React.useCallback(() => {
    if (!videoRef.current) return
    videoRef.current.muted = true // Always start muted for mobile
    videoRef.current.play()
      .then(() => setIsVideoPlaying(true))
      .catch((e) => console.log('Play blocked:', e))
  }, [])

  // Track video play/pause state
  React.useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onPlay = () => setIsVideoPlaying(true)
    const onPause = () => setIsVideoPlaying(false)

    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)

    // Try to play immediately when component mounts (for mobile)
    video.play()
      .then(() => setIsVideoPlaying(true))
      .catch(() => setIsVideoPlaying(false))

    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
    }
  }, [])

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!videoRef.current) return

          if (entry.isIntersecting) {
            // Play video when visible - keep muted on mobile for autoplay to work
            // Only unmute if user has already interacted with the page
            if (!videoRef.current.ended) {
              if (hasUserInteracted) {
                videoRef.current.muted = false
              }
              videoRef.current.play()
                .then(() => setIsVideoPlaying(true))
                .catch((e) => {
                  console.log('Autoplay blocked:', e)
                  setIsVideoPlaying(false)
                })
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
  }, [hasUserInteracted])

  return (
    <div className="bg-bg">
      {/* Hero Section - Full Screen Video */}
      <Hero />

      {/* How It Works Section */}
      <section className="py-12 sm:py-24 bg-gradient-to-b from-bg to-purple-50/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8 sm:mb-16">
            <span className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1 sm:py-1.5 rounded-full bg-purple-100 text-purple-700 text-xs sm:text-sm font-medium mb-3 sm:mb-4">
              <Sparkles className="w-3 h-3 sm:w-4 sm:h-4" />
              Simple Process
            </span>
            <h2 className="font-display text-2xl sm:text-4xl md:text-5xl text-text mb-3 sm:mb-4">
              How It <span className="text-gradient">Works</span>
            </h2>
            <p className="text-muted text-sm sm:text-lg max-w-2xl mx-auto px-4 sm:px-0">
              From idea to printed product in just three simple steps
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-8 lg:gap-12">
            {/* Step 1 */}
            <div className="relative group">
              <div className="card-editorial p-5 sm:p-8 h-full text-center">
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl sm:rounded-2xl flex items-center justify-center mx-auto mb-4 sm:mb-6 shadow-lg shadow-purple-200 group-hover:scale-110 transition-transform duration-300">
                  <Sparkles className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                </div>
                <div className="absolute -top-2 -left-2 sm:-top-3 sm:-left-3 w-8 h-8 sm:w-10 sm:h-10 bg-purple-100 rounded-full flex items-center justify-center font-display text-purple-600 text-base sm:text-lg font-bold">
                  1
                </div>
                <h3 className="font-display text-lg sm:text-xl text-text mb-2 sm:mb-3">Imagine Your Design</h3>
                <p className="text-muted text-sm sm:text-base">
                  Describe your vision to our AI or use our design tools to create your perfect design
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="relative group">
              <div className="card-editorial p-5 sm:p-8 h-full text-center">
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl sm:rounded-2xl flex items-center justify-center mx-auto mb-4 sm:mb-6 shadow-lg shadow-blue-200 group-hover:scale-110 transition-transform duration-300">
                  <Palette className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                </div>
                <div className="absolute -top-2 -left-2 sm:-top-3 sm:-left-3 w-8 h-8 sm:w-10 sm:h-10 bg-blue-100 rounded-full flex items-center justify-center font-display text-blue-600 text-base sm:text-lg font-bold">
                  2
                </div>
                <h3 className="font-display text-lg sm:text-xl text-text mb-2 sm:mb-3">Choose Your Product</h3>
                <p className="text-muted text-sm sm:text-base">
                  Select from our wide range of premium products — t-shirts, hoodies, mugs, and more
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="relative group">
              <div className="card-editorial p-5 sm:p-8 h-full text-center">
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-pink-500 to-pink-600 rounded-xl sm:rounded-2xl flex items-center justify-center mx-auto mb-4 sm:mb-6 shadow-lg shadow-pink-200 group-hover:scale-110 transition-transform duration-300">
                  <Heart className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                </div>
                <div className="absolute -top-2 -left-2 sm:-top-3 sm:-left-3 w-8 h-8 sm:w-10 sm:h-10 bg-pink-100 rounded-full flex items-center justify-center font-display text-pink-600 text-base sm:text-lg font-bold">
                  3
                </div>
                <h3 className="font-display text-lg sm:text-xl text-text mb-2 sm:mb-3">We Print & Ship</h3>
                <p className="text-muted text-sm sm:text-base">
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
      <section className="py-12 sm:py-24 bg-bg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between mb-6 sm:mb-12">
            <div>
              <span className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1 sm:py-1.5 rounded-full bg-purple-100 text-purple-700 text-xs sm:text-sm font-medium mb-3 sm:mb-4">
                <Star className="w-3 h-3 sm:w-4 sm:h-4" />
                Featured
              </span>
              <h2 className="font-display text-2xl sm:text-4xl md:text-5xl text-text">
                Popular <span className="text-gradient">Products</span>
              </h2>
            </div>

            <div className="flex items-center gap-3 sm:gap-4 mt-4 md:mt-0">
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
      <section className="py-12 sm:py-24 bg-gradient-to-br from-purple-50 via-bg to-blue-50 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 sm:gap-12 items-center">
            {/* Left: Mr. Imagine Video */}
            <div className="relative flex justify-center order-2 lg:order-1">
              <div className="relative w-full max-w-[280px] sm:max-w-sm">
                {/* Glow effect */}
                <div className="absolute inset-0 bg-gradient-radial from-purple-400/30 via-purple-300/10 to-transparent rounded-full blur-3xl scale-150" />

                <div
                  className="relative rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl shadow-purple-500/20 border-2 sm:border-4 border-white/50 backdrop-blur-sm cursor-pointer"
                  onClick={handleVideoPlay}
                >
                  <video
                    ref={videoRef}
                    src="/mr-imagine/welcome-video.mp4"
                    poster="/mr-imagine/mr-imagine-standing-happy.png"
                    className="w-full h-auto object-cover"
                    playsInline
                    autoPlay
                    muted
                    loop
                  />
                  {/* Play button overlay - shows when video isn't playing */}
                  {!isVideoPlaying && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/90 flex items-center justify-center shadow-lg hover:scale-110 transition-transform">
                        <Play className="w-8 h-8 sm:w-10 sm:h-10 text-purple-600 ml-1" fill="currentColor" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Floating elements - Hidden on mobile */}
                <div className="hidden sm:flex absolute top-10 -left-8 w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-purple-400 to-purple-500 rounded-xl sm:rounded-2xl shadow-lg shadow-purple-200 items-center justify-center animate-float z-10" style={{ animationDelay: '0.5s' }}>
                  <Sparkles className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                </div>
                <div className="hidden sm:flex absolute bottom-20 -right-8 w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-blue-400 to-blue-500 rounded-lg sm:rounded-xl shadow-lg shadow-blue-200 items-center justify-center animate-float z-10" style={{ animationDelay: '1s' }}>
                  <Palette className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                </div>
              </div>
            </div>

            {/* Right: Content */}
            <div className="order-1 lg:order-2 text-center lg:text-left">
              <h2 className="font-display text-2xl sm:text-4xl md:text-5xl text-text mb-4 sm:mb-6">
                Say Hello to
                <br />
                <span className="text-gradient">Mr. Imagine</span>
              </h2>
              <p className="text-muted text-sm sm:text-lg mb-6 sm:mb-8 leading-relaxed">
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
                onClick={() => navigate('/account/designs')}
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
      <section className="py-12 sm:py-24 bg-bg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8 sm:mb-12">
            <span className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1 sm:py-1.5 rounded-full bg-pink-100 text-pink-700 text-xs sm:text-sm font-medium mb-3 sm:mb-4">
              <Heart className="w-3 h-3 sm:w-4 sm:h-4" />
              Community
            </span>
            <h2 className="font-display text-2xl sm:text-4xl md:text-5xl text-text mb-3 sm:mb-4">
              Customer <span className="text-gradient-pink">Showcase</span>
            </h2>
            <p className="text-muted text-sm sm:text-lg max-w-2xl mx-auto px-4 sm:px-0">
              See how our customers are using our products and sharing their amazing creations
            </p>
          </div>

          <Suspense fallback={<SectionSkeleton />}>
            <FeaturedSocialContent limit={5} />
          </Suspense>
        </div>
      </section>

      {/* Personalized Recommendations */}
      <section className="py-12 sm:py-24 bg-gradient-to-b from-bg to-purple-50/30">
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
      <section className="py-12 sm:py-24 bg-bg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8 sm:mb-16">
            <span className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1 sm:py-1.5 rounded-full bg-blue-100 text-blue-700 text-xs sm:text-sm font-medium mb-3 sm:mb-4">
              <Shield className="w-3 h-3 sm:w-4 sm:h-4" />
              Why Us
            </span>
            <h2 className="font-display text-2xl sm:text-4xl md:text-5xl text-text mb-3 sm:mb-4 px-4 sm:px-0">
              Why Choose <span className="text-gradient">Imagine This Printed</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-8">
            <div className="card-editorial p-5 sm:p-8 text-center">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl sm:rounded-2xl flex items-center justify-center mx-auto mb-4 sm:mb-6 shadow-lg shadow-purple-200">
                <Zap className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
              </div>
              <h3 className="font-display text-lg sm:text-xl text-text mb-2 sm:mb-3">Fast Turnaround</h3>
              <p className="text-muted text-sm sm:text-base">
                Quick processing and shipping to get your orders to you fast. Most orders ship within 2-3 business days.
              </p>
            </div>

            <div className="card-editorial p-5 sm:p-8 text-center">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl sm:rounded-2xl flex items-center justify-center mx-auto mb-4 sm:mb-6 shadow-lg shadow-blue-200">
                <Shield className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
              </div>
              <h3 className="font-display text-lg sm:text-xl text-text mb-2 sm:mb-3">Quality Guaranteed</h3>
              <p className="text-muted text-sm sm:text-base">
                Premium materials and professional DTF printing processes for lasting, vibrant results.
              </p>
            </div>

            <div className="card-editorial p-5 sm:p-8 text-center">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-pink-500 to-pink-600 rounded-xl sm:rounded-2xl flex items-center justify-center mx-auto mb-4 sm:mb-6 shadow-lg shadow-pink-200">
                <Heart className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
              </div>
              <h3 className="font-display text-lg sm:text-xl text-text mb-2 sm:mb-3">Made with Love</h3>
              <p className="text-muted text-sm sm:text-base">
                Every design is crafted with care. Our AI + human team ensures your vision comes to life perfectly.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-12 sm:py-24 bg-gradient-to-br from-purple-600 via-purple-700 to-blue-700 relative overflow-hidden">
        {/* Background elements - hidden on mobile */}
        <div className="absolute inset-0 pointer-events-none hidden sm:block">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-400/20 rounded-full blur-[150px]" />
          <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-blue-400/20 rounded-full blur-[120px]" />
        </div>

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h2 className="font-display text-2xl sm:text-4xl md:text-5xl lg:text-6xl text-white mb-4 sm:mb-6">
            Ready to Create Something
            <br />
            <span className="text-purple-200">Amazing?</span>
          </h2>
          <p className="text-purple-100 text-sm sm:text-lg mb-6 sm:mb-10 max-w-2xl mx-auto px-4 sm:px-0">
            Join thousands of customers who have brought their creative visions to life with Imagine This Printed.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <button
              onClick={() => navigate('/account/designs')}
              className="group w-full sm:w-auto flex items-center justify-center gap-2 sm:gap-3 px-6 sm:px-8 py-3 sm:py-4 bg-white text-purple-700 font-semibold rounded-full hover:bg-purple-50 transition-all duration-300 shadow-xl hover:shadow-2xl hover:-translate-y-1 text-sm sm:text-base"
            >
              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
              Start Creating Free
              <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 transition-transform group-hover:translate-x-1" />
            </button>
            <Link
              to="/catalog"
              className="group w-full sm:w-auto flex items-center justify-center gap-2 sm:gap-3 px-6 sm:px-8 py-3 sm:py-4 bg-transparent border-2 border-white/40 text-white font-semibold rounded-full hover:bg-white/10 hover:border-white/60 transition-all duration-300 text-sm sm:text-base"
            >
              Browse Products
              <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 transition-transform group-hover:translate-x-1" />
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

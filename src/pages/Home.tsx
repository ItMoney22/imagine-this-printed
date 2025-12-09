import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { Palette, Sparkles, Zap, Shield, Heart, ArrowRight, Star } from 'lucide-react'
import { Hero } from '../components/Hero'
import ProductRecommendations from '../components/ProductRecommendations'
import FeaturedSocialContent from '../components/FeaturedSocialContent'
import ProductCard from '../components/ProductCard'
import DesignStudioModal from '../components/DesignStudioModal'
import type { Product } from '../types'

import { supabase } from '../lib/supabase'

const Home: React.FC = () => {
  const [showDesignModal, setShowDesignModal] = useState(false)
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([])

  React.useEffect(() => {
    const fetchFeaturedProducts = async () => {
      try {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('is_featured', true)
          .eq('is_active', true)
          .limit(3)

        if (error) throw error

        if (data) {
          setFeaturedProducts(data.map((p: any) => ({
            id: p.id,
            name: p.name,
            description: p.description || '',
            price: p.price || 0,
            images: p.images || [],
            category: p.category || 'shirts',
            inStock: p.is_active !== false,
            is_featured: p.is_featured
          })))
        }
      } catch (error) {
        console.error('Error fetching featured products:', error)
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
          if (entry.isIntersecting) {
            videoRef.current?.play().catch((e) => console.log('Autoplay blocked:', e))
          } else {
            videoRef.current?.pause()
          }
        })
      },
      { threshold: 0.5 } // Play when 50% visible
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
            <Link
              to="/catalog"
              className="mt-4 md:mt-0 inline-flex items-center gap-2 text-primary font-medium hover:gap-3 transition-all"
            >
              View All Products
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>

          {featuredProducts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {featuredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  showSocialBadges={true}
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Placeholder cards when no products */}
              {[1, 2, 3].map((i) => (
                <div key={i} className="card-editorial overflow-hidden">
                  <div className="aspect-square bg-gradient-to-br from-purple-100 to-blue-100 animate-pulse" />
                  <div className="p-6">
                    <div className="h-6 bg-gray-100 rounded w-3/4 mb-3" />
                    <div className="h-4 bg-gray-100 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}
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
                    loop
                  // muted={false} // Intentionally unmuted as requested, but might be blocked
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

          <FeaturedSocialContent limit={5} />
        </div>
      </section>

      {/* Personalized Recommendations */}
      <section className="py-24 bg-gradient-to-b from-bg to-purple-50/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <ProductRecommendations
            context={{
              page: 'home',
              limit: 6
            }}
            title="Recommended for You"
            showReason={true}
          />
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

      <DesignStudioModal
        isOpen={showDesignModal}
        onClose={() => setShowDesignModal(false)}
      />
    </div>
  )
}

export default Home

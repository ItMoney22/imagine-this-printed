import React from 'react'
import { Link } from 'react-router-dom'
import ProductRecommendations from '../components/ProductRecommendations'
import FeaturedSocialContent from '../components/FeaturedSocialContent'
import ProductCard from '../components/ProductCard'
import type { Product } from '../types'

const Home: React.FC = () => {
  const featuredProducts: Product[] = [
    {
      id: '1',
      name: 'Custom DTF Transfer',
      description: 'High-quality direct-to-film transfer for vibrant prints',
      price: 15.99,
      images: ['https://images.unsplash.com/photo-1503341338985-95ad5e163e51?w=400&h=400&fit=crop'],
      category: 'dtf-transfers',
      inStock: true
    },
    {
      id: '2',
      name: 'Premium T-Shirt',
      description: 'Soft, comfortable 100% cotton tee in multiple colors',
      price: 24.99,
      images: ['https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&h=400&fit=crop'],
      category: 'shirts',
      inStock: true
    },
    {
      id: '3',
      name: 'Insulated Tumbler',
      description: '20oz stainless steel tumbler with custom printing',
      price: 29.99,
      images: ['https://images.unsplash.com/photo-1544441892-794166f1e3be?w=400&h=400&fit=crop'],
      category: 'tumblers',
      inStock: true
    }
  ]

  return (
    <div className="bg-white">
      <section className="relative bg-gradient-to-r from-purple-600 to-blue-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="text-center">
            <h1 className="text-4xl md:text-6xl font-bold mb-6">
              Imagine This Printed
            </h1>
            <p className="text-xl md:text-2xl mb-8 max-w-3xl mx-auto">
              Custom printing solutions for your creative vision. From DTF transfers to personalized apparel.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/catalog" className="btn-primary text-lg px-8 py-3">
                Shop Products
              </Link>
              <Link to="/designer" className="btn-secondary text-lg px-8 py-3">
                Create Design
              </Link>
              <button 
                onClick={() => window.open('#', '_blank')}
                className="bg-white text-purple-600 hover:bg-gray-100 font-semibold text-lg px-8 py-3 rounded-lg transition-colors"
              >
                Gang Sheet Builder
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Featured Products</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Discover our most popular items and start creating something amazing today.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {featuredProducts.map((product) => (
              <ProductCard 
                key={product.id} 
                product={product} 
                showSocialBadges={true}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Featured Social Content */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Customer Showcase</h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              See how our customers are using our products and sharing their amazing creations on social media.
            </p>
          </div>
          
          <FeaturedSocialContent limit={5} />
        </div>
      </section>

      {/* Personalized Recommendations */}
      <section className="py-16">
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

      <section className="bg-gray-100 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-8">Why Choose Us?</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-6">
              <div className="w-16 h-16 bg-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-2">Fast Turnaround</h3>
              <p className="text-gray-600">Quick processing and shipping to get your orders to you fast.</p>
            </div>
            <div className="p-6">
              <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-2">Quality Guaranteed</h3>
              <p className="text-gray-600">Premium materials and printing processes for lasting results.</p>
            </div>
            <div className="p-6">
              <div className="w-16 h-16 bg-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-2">Custom Designs</h3>
              <p className="text-gray-600">Bring your vision to life with our design tools and services.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default Home
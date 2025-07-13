import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import ProductRecommendations from '../components/ProductRecommendations'

const RecommendationsDashboard: React.FC = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'shirts' | 'dtf-transfers' | 'tumblers' | 'hoodies' | '3d-models'>('all')

  if (!user) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
          <p className="text-yellow-800">Please sign in to view personalized recommendations.</p>
        </div>
      </div>
    )
  }

  const categories = [
    { id: 'all', name: 'All Categories', icon: '🎯' },
    { id: 'shirts', name: 'T-Shirts', icon: '👕' },
    { id: 'dtf-transfers', name: 'DTF Transfers', icon: '🎨' },
    { id: 'tumblers', name: 'Tumblers', icon: '🥤' },
    { id: 'hoodies', name: 'Hoodies', icon: '🧥' },
    { id: '3d-models', name: '3D Models', icon: '🔳' }
  ]

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Recommended for You</h1>
        <p className="text-gray-600">Personalized product suggestions based on your preferences and activity</p>
      </div>

      {/* Category Filter */}
      <div className="mb-8">
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id as any)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors flex items-center ${
                selectedCategory === category.id
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span className="mr-2">{category.icon}</span>
              {category.name}
            </button>
          ))}
        </div>
      </div>

      {/* Recommendation Sections */}
      <div className="space-y-12">
        {/* Trending Recommendations */}
        <ProductRecommendations
          context={{
            page: 'home',
            limit: 8
          }}
          title="🔥 Trending This Week"
          showReason={true}
          onProductClick={(product, _position) => {
            navigate(`/product/${product.id}`)
          }}
        />

        {/* Personalized Recommendations */}
        <ProductRecommendations
          context={{
            page: 'home',
            limit: 8
          }}
          title="⭐ Just for You"
          className="border-t pt-8"
          showReason={true}
          onProductClick={(product, _position) => {
            navigate(`/product/${product.id}`)
          }}
        />

        {/* Category-based Recommendations */}
        {selectedCategory !== 'all' && (
          <ProductRecommendations
            context={{
              page: 'category',
              limit: 8
            }}
            title={`📂 More ${categories.find(c => c.id === selectedCategory)?.name}`}
            className="border-t pt-8"
            onProductClick={(product, _position) => {
              navigate(`/product/${product.id}`)
            }}
          />
        )}

        {/* Recently Viewed */}
        <div className="border-t pt-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900">👁️ Recently Viewed</h3>
              <button
                onClick={() => navigate('/catalog')}
                className="text-purple-600 hover:text-purple-700 font-medium text-sm"
              >
                Browse All Products →
              </button>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {[
                {
                  id: '1',
                  name: 'Custom T-Shirt',
                  price: 25.99,
                  image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&h=400&fit=crop'
                },
                {
                  id: '2',
                  name: 'DTF Transfer',
                  price: 8.99,
                  image: 'https://images.unsplash.com/photo-1503341338985-95ad5e163e51?w=400&h=400&fit=crop'
                },
                {
                  id: '3',
                  name: 'Custom Hoodie',
                  price: 45.99,
                  image: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400&h=400&fit=crop'
                }
              ].map((product) => (
                <div
                  key={product.id}
                  className="group cursor-pointer"
                  onClick={() => navigate(`/product/${product.id}`)}
                >
                  <div className="bg-gray-100 rounded-lg overflow-hidden mb-2 group-hover:shadow-md transition-shadow">
                    <img
                      src={product.image}
                      alt={product.name}
                      className="w-full h-32 object-cover group-hover:scale-105 transition-transform duration-200"
                    />
                  </div>
                  <h4 className="font-medium text-gray-900 text-sm group-hover:text-purple-600 transition-colors line-clamp-1">
                    {product.name}
                  </h4>
                  <p className="text-purple-600 font-semibold text-sm">
                    ${product.price.toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recommendation Insights */}
        <div className="border-t pt-8">
          <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">🧠 Your Recommendation Profile</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-lg p-4">
                <div className="flex items-center mb-2">
                  <span className="text-2xl mr-2">🎨</span>
                  <h4 className="font-medium">Top Interest</h4>
                </div>
                <p className="text-purple-600 font-semibold">Custom Designs</p>
                <p className="text-sm text-gray-600">Based on your activity</p>
              </div>
              
              <div className="bg-white rounded-lg p-4">
                <div className="flex items-center mb-2">
                  <span className="text-2xl mr-2">📊</span>
                  <h4 className="font-medium">Recommendation Accuracy</h4>
                </div>
                <p className="text-green-600 font-semibold">92%</p>
                <p className="text-sm text-gray-600">You liked 11 of 12 suggestions</p>
              </div>
              
              <div className="bg-white rounded-lg p-4">
                <div className="flex items-center mb-2">
                  <span className="text-2xl mr-2">⚡</span>
                  <h4 className="font-medium">New Recommendations</h4>
                </div>
                <p className="text-blue-600 font-semibold">Daily</p>
                <p className="text-sm text-gray-600">Updated based on trends</p>
              </div>
            </div>
            
            <div className="mt-4 p-4 bg-blue-100 rounded-lg">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-blue-600 mr-2 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-blue-900 font-medium">Improve Your Recommendations</p>
                  <p className="text-blue-800 text-sm">Like products, make purchases, and browse different categories to get better personalized suggestions.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default RecommendationsDashboard
import React, { useState, useEffect } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import ProductCard from '../components/ProductCard'
import type { Product } from '../types'

const ProductCatalog: React.FC = () => {
  const { category } = useParams<{ category?: string }>()
  const location = useLocation()
  const [selectedCategory, setSelectedCategory] = useState<string>(category || 'all')
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [sortBy, setSortBy] = useState<'newest' | 'price-low' | 'price-high' | 'popular'>('newest')

  // Load products from Supabase - reload when navigating to this page
  useEffect(() => {
    loadProducts()
  }, [location.pathname])

  const loadProducts = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('status', 'active')
        .eq('is_active', true)
        .order('created_at', { ascending: false })

      if (error) throw error

      const mappedProducts: Product[] = (data || []).map((p: any) => {
        // For user submitted designs, they must be approved
        if (p.metadata?.is_user_submitted && !p.metadata?.approved_by_admin) {
          return null
        }

        return {
          id: p.id,
          name: p.name,
          description: p.description || '',
          price: p.price || 0,
          images: p.images || [],
          category: p.category || 'shirts',
          inStock: p.is_active !== false,
          createdAt: p.created_at,
          updatedAt: p.updated_at,
          metadata: p.metadata || {},
          isThreeForTwentyFive: p.metadata?.isThreeForTwentyFive || false,
          sizes: p.metadata?.sizes || [],
          colors: p.metadata?.colors || [],
          isUserSubmitted: p.metadata?.is_user_submitted || false
        }
      }).filter(Boolean) as Product[]

      setProducts(mappedProducts)
    } catch (error) {
      console.error('Error loading products:', error)
    } finally {
      setLoading(false)
    }
  }

  const categories = [
    {
      id: 'all', name: 'All Products', icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      )
    },
    {
      id: 'dtf-transfers', name: 'DTF Transfers', icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      )
    },
    {
      id: 'shirts', name: 'T-Shirts', icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 2L2 6v3h4v13h12V9h4V6l-4-4h-4l-2 2-2-2H6z" />
        </svg>
      )
    },
    {
      id: 'tumblers', name: 'Tumblers', icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3h6l1 2h2a1 1 0 011 1v1H5V6a1 1 0 011-1h2l1-2zM5 7l1 14a2 2 0 002 2h8a2 2 0 002-2l1-14H5z" />
        </svg>
      )
    },
    {
      id: 'hoodies', name: 'Hoodies', icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2C8 2 6 4 6 4L2 8v4h4v10h12V12h4V8l-4-4s-2-2-6-2zm0 0v6" />
        </svg>
      )
    },
    {
      id: '3d-prints', name: '3D Prints', icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
        </svg>
      )
    }
  ]

  const filteredProducts = selectedCategory === 'all'
    ? products
    : products.filter(product => product.category === selectedCategory)

  // Sort products
  const sortedProducts = [...filteredProducts].sort((a, b) => {
    switch (sortBy) {
      case 'price-low':
        return a.price - b.price
      case 'price-high':
        return b.price - a.price
      case 'popular':
        return (b.metadata?.viewCount || 0) - (a.metadata?.viewCount || 0)
      case 'newest':
      default:
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return dateB - dateA
    }
  })

  useEffect(() => {
    if (category) {
      setSelectedCategory(category)
    }
  }, [category])

  const getCategoryCount = (catId: string) => {
    if (catId === 'all') return products.length
    return products.filter(p => p.category === catId).length
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header Section */}
      <div className="bg-gradient-to-br from-purple-600 via-purple-700 to-pink-600 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }} />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 relative">
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-white mb-2">Product Catalog</h1>
          <p className="text-purple-100">Browse our collection of custom printing products</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar */}
          <div className="lg:w-72 flex-shrink-0">
            <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden sticky top-24">
              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="text-lg font-display font-bold text-slate-900">Categories</h3>
              </div>
              <div className="p-3">
                {categories.map((cat) => {
                  const count = getCategoryCount(cat.id)
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all mb-1 ${selectedCategory === cat.id
                          ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/25'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                    >
                      <span className={selectedCategory === cat.id ? 'text-purple-200' : 'text-slate-400'}>
                        {cat.icon}
                      </span>
                      <span className="flex-1 text-left font-medium">{cat.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${selectedCategory === cat.id
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-100 text-slate-500'
                        }`}>
                        {count}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Quick Stats */}
              <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/50">
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center">
                    <p className="text-2xl font-display font-bold text-slate-900">{products.length}</p>
                    <p className="text-xs text-slate-500">Total Products</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-display font-bold text-purple-600">{categories.length - 1}</p>
                    <p className="text-xs text-slate-500">Categories</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 min-w-0">
            {/* Toolbar */}
            <div className="bg-white rounded-xl shadow-soft border border-slate-100 p-4 mb-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <p className="text-slate-600">
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-pulse">Loading...</span>
                      </span>
                    ) : (
                      <>
                        <span className="font-semibold text-slate-900">{sortedProducts.length}</span>
                        <span className="text-slate-500"> products</span>
                        {selectedCategory !== 'all' && (
                          <span className="text-slate-400"> in {categories.find(c => c.id === selectedCategory)?.name}</span>
                        )}
                      </>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {/* Sort Dropdown */}
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                  >
                    <option value="newest">Newest First</option>
                    <option value="price-low">Price: Low to High</option>
                    <option value="price-high">Price: High to Low</option>
                    <option value="popular">Most Popular</option>
                  </select>

                  {/* View Toggle */}
                  <div className="flex items-center bg-slate-100 rounded-lg p-1">
                    <button
                      onClick={() => setViewMode('grid')}
                      className={`p-2 rounded-md transition-colors ${viewMode === 'grid'
                          ? 'bg-white text-purple-600 shadow-sm'
                          : 'text-slate-400 hover:text-slate-600'
                        }`}
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`p-2 rounded-md transition-colors ${viewMode === 'list'
                          ? 'bg-white text-purple-600 shadow-sm'
                          : 'text-slate-400 hover:text-slate-600'
                        }`}
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Products Grid/List */}
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mb-4"></div>
                <p className="text-slate-500">Loading products...</p>
              </div>
            ) : sortedProducts.length > 0 ? (
              <div className={
                viewMode === 'grid'
                  ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6'
                  : 'space-y-4'
              }>
                {sortedProducts.map((product, index) => (
                  <div
                    key={product.id}
                    className="animate-fade-in"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <ProductCard
                      product={product}
                      showSocialBadges={true}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-12 text-center">
                <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-slate-100 flex items-center justify-center">
                  <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <h3 className="text-xl font-display font-bold text-slate-900 mb-2">No products found</h3>
                <p className="text-slate-500 mb-6">
                  {selectedCategory === 'all'
                    ? "We're working on adding new products. Check back soon!"
                    : `No products in the "${categories.find(c => c.id === selectedCategory)?.name}" category yet.`
                  }
                </p>
                {selectedCategory !== 'all' && (
                  <button
                    onClick={() => setSelectedCategory('all')}
                    className="px-6 py-2.5 bg-purple-600 text-white rounded-xl hover:bg-purple-700 font-medium transition-colors"
                  >
                    View All Products
                  </button>
                )}
              </div>
            )}

            {/* Load More / Pagination placeholder */}
            {sortedProducts.length > 0 && sortedProducts.length >= 12 && (
              <div className="mt-8 text-center">
                <button className="px-8 py-3 bg-white text-purple-600 border-2 border-purple-200 rounded-xl hover:border-purple-400 hover:bg-purple-50 font-medium transition-all">
                  Load More Products
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ProductCatalog

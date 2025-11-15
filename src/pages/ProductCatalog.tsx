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
        .order('created_at', { ascending: false })

      if (error) throw error

      const mappedProducts: Product[] = (data || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description || '',
        price: p.price || 0,
        images: p.images || [],
        category: p.category || 'shirts',
        inStock: p.is_active !== false,
        createdAt: p.created_at,
        updatedAt: p.updated_at
      }))

      setProducts(mappedProducts)
    } catch (error) {
      console.error('Error loading products:', error)
    } finally {
      setLoading(false)
    }
  }

  const categories = [
    { id: 'all', name: 'All Products' },
    { id: 'dtf-transfers', name: 'DTF Transfers' },
    { id: 'shirts', name: 'T-Shirts' },
    { id: 'tumblers', name: 'Tumblers' },
    { id: 'hoodies', name: 'Hoodies' }
  ]

  const filteredProducts = selectedCategory === 'all' 
    ? products 
    : products.filter(product => product.category === selectedCategory)

  useEffect(() => {
    if (category) {
      setSelectedCategory(category)
    }
  }, [category])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text mb-4">Product Catalog</h1>
        <p className="text-muted">Browse our collection of custom printing products</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        <div className="lg:w-1/4">
          <div className="bg-card rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Categories</h3>
            <div className="space-y-2">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                    selectedCategory === cat.id
                      ? 'bg-primary text-white shadow-glow'
                      : 'text-text hover:bg-card'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:w-3/4">
          <div className="mb-4 flex justify-between items-center">
            <p className="text-muted">
              {loading ? 'Loading...' : `Showing ${filteredProducts.length} products`}
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center items-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    showSocialBadges={true}
                  />
                ))}
              </div>

              {filteredProducts.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-muted text-lg">No products found in this category.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default ProductCatalog

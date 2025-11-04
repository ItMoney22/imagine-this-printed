import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import ProductCard from '../components/ProductCard'
import type { Product } from '../types'

const ProductCatalog: React.FC = () => {
  const { category } = useParams<{ category?: string }>()
  const [selectedCategory, setSelectedCategory] = useState<string>(category || 'all')
  const [products] = useState<Product[]>([
    {
      id: '1',
      name: 'Premium DTF Transfer',
      description: 'High-quality direct-to-film transfer for vibrant prints',
      price: 15.99,
      images: ['https://images.unsplash.com/photo-1503341338985-95ad5e163e51?w=400&h=400&fit=crop'],
      category: 'dtf-transfers',
      inStock: true
    },
    {
      id: '2',
      name: 'Custom Logo Transfer',
      description: 'Professional logo transfers for business apparel',
      price: 12.99,
      images: ['https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400&h=400&fit=crop'],
      category: 'dtf-transfers',
      inStock: true
    },
    {
      id: '3',
      name: 'Premium Cotton T-Shirt',
      description: 'Soft, comfortable 100% cotton tee in multiple colors',
      price: 24.99,
      images: ['https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&h=400&fit=crop'],
      category: 'shirts',
      inStock: true
    },
    {
      id: '4',
      name: 'Performance Athletic Shirt',
      description: 'Moisture-wicking fabric perfect for active wear',
      price: 29.99,
      images: ['https://images.unsplash.com/photo-1583743814966-8936f37f4a9a?w=400&h=400&fit=crop'],
      category: 'shirts',
      inStock: true
    },
    {
      id: '5',
      name: 'Insulated Steel Tumbler',
      description: '20oz stainless steel tumbler with custom printing',
      price: 29.99,
      images: ['https://images.unsplash.com/photo-1544441892-794166f1e3be?w=400&h=400&fit=crop'],
      category: 'tumblers',
      inStock: true
    },
    {
      id: '6',
      name: 'Travel Coffee Mug',
      description: '16oz travel mug with leak-proof lid',
      price: 24.99,
      images: ['https://images.unsplash.com/photo-1545529468-42764ef8c85f?w=400&h=400&fit=crop'],
      category: 'tumblers',
      inStock: true
    },
    {
      id: '7',
      name: 'Classic Pullover Hoodie',
      description: 'Comfortable fleece hoodie with custom printing options',
      price: 45.99,
      images: ['https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400&h=400&fit=crop'],
      category: 'hoodies',
      inStock: true
    },
    {
      id: '8',
      name: 'Zip-Up Hoodie',
      description: 'Premium zip-up hoodie with front pocket',
      price: 52.99,
      images: ['https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=400&h=400&fit=crop'],
      category: 'hoodies',
      inStock: true
    }
  ])

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
                      ? 'bg-purple-600 text-white'
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
              Showing {filteredProducts.length} products
            </p>
          </div>

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
        </div>
      </div>
    </div>
  )
}

export default ProductCatalog
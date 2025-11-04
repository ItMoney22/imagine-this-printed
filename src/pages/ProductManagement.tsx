import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import type { Product } from '../types'

interface ProductVariation {
  id: string
  name: string
  type: 'color' | 'size' | 'material' | 'style'
  options: VariationOption[]
  required: boolean
}

interface VariationOption {
  id: string
  value: string
  priceAdjustment: number
  stockQuantity: number
  sku?: string
}

interface ProductFormData {
  name: string
  description: string
  basePrice: number
  category: 'dtf-transfers' | 'shirts' | 'tumblers' | 'hoodies' | '3d-models'
  inStock: boolean
  variations: ProductVariation[]
  images: string[]
  tags: string[]
  seoTitle: string
  seoDescription: string
  weight: number
  dimensions: {
    length: number
    width: number
    height: number
  }
  isDigital: boolean
  downloadFiles?: string[]
}

const ProductManagement: React.FC = () => {
  const { user } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [selectedTab, setSelectedTab] = useState<'list' | 'add' | 'edit'>('list')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  
  const [formData, setFormData] = useState<ProductFormData>({
    name: '',
    description: '',
    basePrice: 0,
    category: 'shirts',
    inStock: true,
    variations: [],
    images: [],
    tags: [],
    seoTitle: '',
    seoDescription: '',
    weight: 0,
    dimensions: { length: 0, width: 0, height: 0 },
    isDigital: false,
    downloadFiles: []
  })

  useEffect(() => {
    if (user && (user.role === 'manager' || user.role === 'admin' || user.role === 'founder')) {
      loadProducts()
    }
  }, [user])

  const loadProducts = async () => {
    try {
      setIsLoading(true)
      // Mock products data - in real app, this would fetch from database
      const mockProducts: Product[] = [
        {
          id: '1',
          name: 'Custom DTF Transfer',
          description: 'High-quality direct-to-film transfer',
          price: 15.99,
          images: ['https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&h=600&fit=crop'],
          category: 'dtf-transfers',
          inStock: true,
          createdAt: '2025-01-01T00:00:00Z'
        },
        {
          id: '2',
          name: 'Premium Cotton T-Shirt',
          description: 'Soft cotton t-shirt perfect for custom printing',
          price: 24.99,
          images: ['https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&h=600&fit=crop'],
          category: 'shirts',
          inStock: true,
          createdAt: '2025-01-02T00:00:00Z'
        }
      ]
      setProducts(mockProducts)
    } catch (error) {
      console.error('Error loading products:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const addVariation = () => {
    const newVariation: ProductVariation = {
      id: `var_${Date.now()}`,
      name: '',
      type: 'color',
      options: [],
      required: false
    }
    setFormData(prev => ({
      ...prev,
      variations: [...prev.variations, newVariation]
    }))
  }

  const updateVariation = (variationId: string, field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      variations: prev.variations.map(variation =>
        variation.id === variationId
          ? { ...variation, [field]: value }
          : variation
      )
    }))
  }

  const removeVariation = (variationId: string) => {
    setFormData(prev => ({
      ...prev,
      variations: prev.variations.filter(variation => variation.id !== variationId)
    }))
  }

  const addVariationOption = (variationId: string) => {
    const newOption: VariationOption = {
      id: `opt_${Date.now()}`,
      value: '',
      priceAdjustment: 0,
      stockQuantity: 0
    }
    
    setFormData(prev => ({
      ...prev,
      variations: prev.variations.map(variation =>
        variation.id === variationId
          ? { ...variation, options: [...variation.options, newOption] }
          : variation
      )
    }))
  }

  const updateVariationOption = (variationId: string, optionId: string, field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      variations: prev.variations.map(variation =>
        variation.id === variationId
          ? {
              ...variation,
              options: variation.options.map(option =>
                option.id === optionId
                  ? { ...option, [field]: value }
                  : option
              )
            }
          : variation
      )
    }))
  }

  const removeVariationOption = (variationId: string, optionId: string) => {
    setFormData(prev => ({
      ...prev,
      variations: prev.variations.map(variation =>
        variation.id === variationId
          ? { ...variation, options: variation.options.filter(option => option.id !== optionId) }
          : variation
      )
    }))
  }

  const saveProduct = async () => {
    try {
      setIsSaving(true)
      
      // Validate required fields
      if (!formData.name || !formData.description || formData.basePrice <= 0) {
        alert('Please fill in all required fields')
        return
      }

      const newProduct: Product = {
        id: selectedProduct ? selectedProduct.id : `product_${Date.now()}`,
        name: formData.name,
        description: formData.description,
        price: formData.basePrice,
        images: formData.images.length > 0 ? formData.images : ['https://via.placeholder.com/600x600?text=Product'],
        category: formData.category,
        inStock: formData.inStock,
        createdAt: selectedProduct ? selectedProduct.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }

      // In real app, this would save to database including variations
      console.log('Saving product:', newProduct, 'with variations:', formData.variations)
      
      if (selectedProduct) {
        // Update existing product
        setProducts(prev => prev.map(p => p.id === selectedProduct.id ? newProduct : p))
      } else {
        // Add new product
        setProducts(prev => [...prev, newProduct])
      }

      // Reset form
      resetForm()
      setSelectedTab('list')
      alert('Product saved successfully!')
    } catch (error) {
      console.error('Error saving product:', error)
      alert('Failed to save product. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const editProduct = (product: Product) => {
    setSelectedProduct(product)
    setFormData({
      name: product.name,
      description: product.description,
      basePrice: product.price,
      category: product.category,
      inStock: product.inStock,
      variations: [], // In real app, load existing variations
      images: product.images,
      tags: [],
      seoTitle: product.name,
      seoDescription: product.description,
      weight: 0,
      dimensions: { length: 0, width: 0, height: 0 },
      isDigital: product.category === 'dtf-transfers',
      downloadFiles: []
    })
    setSelectedTab('edit')
  }

  const deleteProduct = async (productId: string) => {
    if (window.confirm('Are you sure you want to delete this product?')) {
      try {
        // In real app, this would delete from database
        setProducts(prev => prev.filter(p => p.id !== productId))
        alert('Product deleted successfully!')
      } catch (error) {
        console.error('Error deleting product:', error)
        alert('Failed to delete product. Please try again.')
      }
    }
  }

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      basePrice: 0,
      category: 'shirts',
      inStock: true,
      variations: [],
      images: [],
      tags: [],
      seoTitle: '',
      seoDescription: '',
      weight: 0,
      dimensions: { length: 0, width: 0, height: 0 },
      isDigital: false,
      downloadFiles: []
    })
    setSelectedProduct(null)
  }

  const filteredProducts = products.filter(product => {
    const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         product.description.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCategory = categoryFilter === 'all' || product.category === categoryFilter
    return matchesSearch && matchesCategory
  })

  if (!user || (user.role !== 'manager' && user.role !== 'admin' && user.role !== 'founder')) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Access denied. Manager access required.</p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-text">Product Management</h1>
        <p className="text-muted">Manage store products and variations</p>
      </div>

      {/* Tabs */}
      <div className="border-b card-border mb-6">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'list', label: 'Products', icon: '📦' },
            { id: 'add', label: 'Add Product', icon: '➕' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setSelectedTab(tab.id as any)
                if (tab.id === 'add') resetForm()
              }}
              className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center ${
                selectedTab === tab.id
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-muted hover:text-text hover:card-border'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Product List */}
      {selectedTab === 'list' && (
        <div className="space-y-6">
          {/* Search and Filters */}
          <div className="bg-card rounded-lg shadow p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <input
                type="text"
                placeholder="Search products..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="form-input"
              />
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="form-select"
              >
                <option value="all">All Categories</option>
                <option value="shirts">T-Shirts</option>
                <option value="hoodies">Hoodies</option>
                <option value="dtf-transfers">DTF Transfers</option>
                <option value="tumblers">Tumblers</option>
                <option value="3d-models">3D Models</option>
              </select>
              <button
                onClick={() => setSelectedTab('add')}
                className="btn-primary"
              >
                Add New Product
              </button>
            </div>
          </div>

          {/* Products Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProducts.map((product) => (
              <div key={product.id} className="bg-card rounded-lg shadow overflow-hidden">
                <img
                  src={product.images[0]}
                  alt={product.name}
                  className="w-full h-48 object-cover"
                />
                <div className="p-4">
                  <h3 className="font-medium text-text mb-1">{product.name}</h3>
                  <p className="text-sm text-muted mb-2 line-clamp-2">{product.description}</p>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-lg font-bold text-purple-600">${product.price}</p>
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      product.inStock ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {product.inStock ? 'In Stock' : 'Out of Stock'}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => editProduct(product)}
                      className="btn-secondary text-sm flex-1"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteProduct(product.id)}
                      className="btn-danger text-sm flex-1"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {filteredProducts.length === 0 && (
            <div className="text-center py-12">
              <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <h3 className="text-lg font-medium text-text mb-2">No products found</h3>
              <p className="text-muted">Try adjusting your search or add a new product</p>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Product Form */}
      {(selectedTab === 'add' || selectedTab === 'edit') && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg shadow">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">
                {selectedTab === 'edit' ? 'Edit Product' : 'Add New Product'}
              </h3>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Basic Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    Product Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    className="form-input w-full"
                    placeholder="Enter product name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    Category *
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => handleInputChange('category', e.target.value)}
                    className="form-select w-full"
                  >
                    <option value="shirts">T-Shirts</option>
                    <option value="hoodies">Hoodies</option>
                    <option value="dtf-transfers">DTF Transfers</option>
                    <option value="tumblers">Tumblers</option>
                    <option value="3d-models">3D Models</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    Base Price *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.basePrice}
                    onChange={(e) => handleInputChange('basePrice', parseFloat(e.target.value))}
                    className="form-input w-full"
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.inStock}
                      onChange={(e) => handleInputChange('inStock', e.target.checked)}
                      className="form-checkbox"
                    />
                    <span className="ml-2 text-sm text-text">In Stock</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Description *
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  rows={4}
                  className="form-input w-full"
                  placeholder="Enter product description"
                />
              </div>

              {/* Product Variations */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-lg font-medium text-text">Product Variations</h4>
                  <button
                    onClick={addVariation}
                    className="btn-secondary text-sm"
                  >
                    Add Variation
                  </button>
                </div>

                {formData.variations.map((variation, variationIndex) => (
                  <div key={variation.id} className="border card-border rounded-lg p-4 mb-4">
                    <div className="flex items-center justify-between mb-4">
                      <h5 className="font-medium text-text">Variation {variationIndex + 1}</h5>
                      <button
                        onClick={() => removeVariation(variation.id)}
                        className="text-red-600 hover:text-red-800"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      <div>
                        <label className="block text-sm font-medium text-text mb-2">
                          Variation Name
                        </label>
                        <input
                          type="text"
                          value={variation.name}
                          onChange={(e) => updateVariation(variation.id, 'name', e.target.value)}
                          className="form-input w-full"
                          placeholder="e.g., Color, Size"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-text mb-2">
                          Type
                        </label>
                        <select
                          value={variation.type}
                          onChange={(e) => updateVariation(variation.id, 'type', e.target.value)}
                          className="form-select w-full"
                        >
                          <option value="color">Color</option>
                          <option value="size">Size</option>
                          <option value="material">Material</option>
                          <option value="style">Style</option>
                        </select>
                      </div>

                      <div>
                        <label className="flex items-center mt-6">
                          <input
                            type="checkbox"
                            checked={variation.required}
                            onChange={(e) => updateVariation(variation.id, 'required', e.target.checked)}
                            className="form-checkbox"
                          />
                          <span className="ml-2 text-sm text-text">Required</span>
                        </label>
                      </div>
                    </div>

                    {/* Variation Options */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <label className="text-sm font-medium text-text">Options</label>
                        <button
                          onClick={() => addVariationOption(variation.id)}
                          className="text-purple-600 hover:text-purple-800 text-sm"
                        >
                          Add Option
                        </button>
                      </div>

                      {variation.options.map((option, _optionIndex) => (
                        <div key={option.id} className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3 p-3 bg-card rounded">
                          <input
                            type="text"
                            value={option.value}
                            onChange={(e) => updateVariationOption(variation.id, option.id, 'value', e.target.value)}
                            className="form-input"
                            placeholder="Option value"
                          />
                          <input
                            type="number"
                            step="0.01"
                            value={option.priceAdjustment}
                            onChange={(e) => updateVariationOption(variation.id, option.id, 'priceAdjustment', parseFloat(e.target.value))}
                            className="form-input"
                            placeholder="Price adjustment"
                          />
                          <input
                            type="number"
                            value={option.stockQuantity}
                            onChange={(e) => updateVariationOption(variation.id, option.id, 'stockQuantity', parseInt(e.target.value))}
                            className="form-input"
                            placeholder="Stock quantity"
                          />
                          <button
                            onClick={() => removeVariationOption(variation.id, option.id)}
                            className="text-red-600 hover:text-red-800 text-sm"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Images */}
              <div>
                <label className="block text-sm font-medium text-text mb-2">
                  Product Images
                </label>
                <div className="border-2 border-dashed card-border rounded-lg p-6 text-center">
                  <svg className="w-12 h-12 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-muted mb-2">Click to upload or drag and drop</p>
                  <p className="text-xs text-gray-400">PNG, JPG up to 10MB</p>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t card-border flex items-center justify-between">
              <button
                onClick={() => {
                  resetForm()
                  setSelectedTab('list')
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={saveProduct}
                disabled={isSaving || !formData.name || !formData.description || formData.basePrice <= 0}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? 'Saving...' : (selectedTab === 'edit' ? 'Update Product' : 'Create Product')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ProductManagement
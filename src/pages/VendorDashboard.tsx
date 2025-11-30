import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { supabase } from '../lib/supabase'
import type { VendorProduct, Product } from '../types'

const VendorDashboard: React.FC = () => {
  const { user } = useAuth()
  const [products, setProducts] = useState<VendorProduct[]>([])
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([])
  const [selectedTab, setSelectedTab] = useState<'products' | 'submit' | 'analytics' | 'payouts' | 'catalog'>('products')
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false)

  // Enhanced state for 3D Marketplace
  const [newProduct, setNewProduct] = useState({
    title: '',
    description: '',
    price: 0, // Physical Price
    digitalPrice: 0, // STL Price
    category: '',
    productType: 'physical' as 'physical' | 'digital' | 'both',
    shippingCost: 0,
    images: [] as string[],
    file: null as File | null
  })

  const [analytics] = useState({
    totalSales: 542.30,
    thisMonth: 123.45,
    pendingPayout: 89.67,
    commissionRate: 10 // Updated to 10% for 3D Marketplace
  })

  // Mock data - replace with real PostgreSQL queries
  useEffect(() => {
    const mockProducts: VendorProduct[] = [
      {
        id: '1',
        vendorId: user?.id || '',
        title: 'Custom Gaming Mouse Pad',
        description: 'High-quality gaming mouse pad with custom designs',
        price: 19.99,
        images: ['https://images.unsplash.com/photo-1527814050087-3793815479db?w=300&h=300&fit=crop'],
        category: 'gaming',
        approved: true,
        commissionRate: 10,
        createdAt: '2025-01-08T10:00:00Z',
        productType: 'physical'
      },
      {
        id: '2',
        vendorId: user?.id || '',
        title: 'Dragon Figurine STL',
        description: 'High detail dragon model for 3D printing',
        price: 0,
        digitalPrice: 5.99,
        images: ['https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=300&h=300&fit=crop'],
        category: '3d-models',
        approved: true,
        commissionRate: 10,
        createdAt: '2025-01-09T14:30:00Z',
        productType: 'digital',
        fileUrl: '/models/dragon.stl'
      }
    ]
    setProducts(mockProducts)
  }, [user?.id])

  useEffect(() => {
    if (selectedTab === 'catalog') {
      loadCatalogProducts()
    }
  }, [selectedTab])

  const loadCatalogProducts = async () => {
    try {
      setIsLoadingCatalog(true)
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
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
        updatedAt: p.updated_at,
        metadata: p.metadata || {},
        isThreeForTwentyFive: p.metadata?.isThreeForTwentyFive || false
      }))

      setCatalogProducts(mappedProducts)
    } catch (error) {
      console.error('Error loading catalog:', error)
    } finally {
      setIsLoadingCatalog(false)
    }
  }

  const handleAddToStore = (product: Product) => {
    const vendorProduct: VendorProduct = {
      id: `vp_${Date.now()}`,
      vendorId: user?.id || '',
      title: product.name,
      description: product.description,
      price: product.price,
      images: product.images,
      category: product.category,
      approved: true,
      commissionRate: 10,
      createdAt: new Date().toISOString(),
      productType: 'physical'
    }

    setProducts([...products, vendorProduct])
    alert(`${product.name} added to your store!`)
    setSelectedTab('products')
  }

  const handleSubmitProduct = async (e: React.FormEvent) => {
    e.preventDefault()

    const product: VendorProduct = {
      id: Date.now().toString(),
      vendorId: user?.id || '',
      title: newProduct.title,
      description: newProduct.description,
      price: newProduct.price,
      digitalPrice: newProduct.digitalPrice,
      images: newProduct.images,
      category: newProduct.category,
      approved: false,
      commissionRate: 10,
      createdAt: new Date().toISOString(),
      productType: newProduct.productType,
      shippingCost: newProduct.shippingCost,
      fileUrl: newProduct.file ? `/models/${newProduct.file.name}` : undefined
    }

    setProducts([...products, product])

    // Reset form
    setNewProduct({
      title: '',
      description: '',
      price: 0,
      digitalPrice: 0,
      category: '',
      productType: 'physical',
      shippingCost: 0,
      images: [],
      file: null
    })

    alert('Product submitted for approval!')
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files) {
      const imageUrls = Array.from(files).map(file => URL.createObjectURL(file))
      setNewProduct(prev => ({ ...prev, images: [...prev.images, ...imageUrls] }))
    }
  }

  if (user?.role !== 'vendor' && user?.role !== 'admin') {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Access denied. This page is for vendors only.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text mb-2">Vendor Dashboard</h1>
        <p className="text-muted">Manage your products and track sales performance</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Total Earnings</p>
              <p className="text-2xl font-semibold text-text">${analytics.totalSales.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">This Month</p>
              <p className="text-2xl font-semibold text-text">${analytics.thisMonth.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v2a2 2 0 002 2h2m8-2V9a2 2 0 00-2-2H9a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V9z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Pending Payout</p>
              <p className="text-2xl font-semibold text-text">${analytics.pendingPayout.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Commission Rate</p>
              <p className="text-2xl font-semibold text-text">{analytics.commissionRate}%</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b card-border mb-6">
        <nav className="-mb-px flex space-x-8">
          {['products', 'catalog', 'submit', 'analytics', 'payouts'].map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${selectedTab === tab
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-muted hover:text-text hover:card-border'
                }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {/* Products Tab */}
      {selectedTab === 'products' && (
        <div className="bg-card rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b card-border flex justify-between items-center">
            <h3 className="text-lg font-medium text-text">Your Products</h3>
            <button
              onClick={() => setSelectedTab('catalog')}
              className="bg-purple-600 hover:bg-purple-700 text-white text-sm py-2 px-4 rounded-lg transition-colors"
            >
              + Add from Catalog
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
            {products.length === 0 ? (
              <div className="col-span-full text-center py-12">
                <p className="text-muted mb-4">You haven't added any products yet.</p>
                <button
                  onClick={() => setSelectedTab('catalog')}
                  className="text-purple-600 font-medium hover:underline"
                >
                  Browse Catalog to add products
                </button>
              </div>
            ) : (
              products.map((product) => (
                <div key={product.id} className="border rounded-lg overflow-hidden">
                  <img
                    src={product.images[0]}
                    alt={product.title}
                    className="w-full h-48 object-cover"
                  />
                  <div className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-semibold text-text">{product.title}</h4>
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${product.approved
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                        }`}>
                        {product.approved ? 'Approved' : 'Pending'}
                      </span>
                    </div>
                    <p className="text-muted text-sm mb-3 line-clamp-2">{product.description}</p>

                    <div className="space-y-1 mb-3">
                      {(product.productType === 'physical' || product.productType === 'both') && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted">Physical Price:</span>
                          <span className="font-semibold text-text">${product.price}</span>
                        </div>
                      )}
                      {(product.productType === 'digital' || product.productType === 'both') && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted">Digital Price:</span>
                          <span className="font-semibold text-text">${product.digitalPrice}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted mb-3">
                      <span>Type: {product.productType || 'physical'}</span>
                      <span>Comm: {product.commissionRate}%</span>
                    </div>

                    <div className="flex space-x-2">
                      <button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm py-2 px-3 rounded">
                        Edit
                      </button>
                      <button className="flex-1 bg-gray-600 hover:bg-gray-700 text-white text-sm py-2 px-3 rounded">
                        Analytics
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Catalog Tab */}
      {selectedTab === 'catalog' && (
        <div className="bg-card rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b card-border">
            <h3 className="text-lg font-medium text-text">Available Catalog Products</h3>
            <p className="text-sm text-muted">Select products to add to your store</p>
          </div>

          {isLoadingCatalog ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
              {catalogProducts.map((product) => (
                <div key={product.id} className="border rounded-lg overflow-hidden hover:shadow-md transition-shadow">
                  <img
                    src={product.images[0]}
                    alt={product.name}
                    className="w-full h-48 object-cover"
                  />
                  <div className="p-4">
                    <h4 className="font-semibold text-text mb-2">{product.name}</h4>
                    <p className="text-muted text-sm mb-3 line-clamp-2">{product.description}</p>
                    <div className="flex justify-between items-center mb-4">
                      <span className="text-lg font-bold text-text">${product.price}</span>
                      <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs">
                        {product.category}
                      </span>
                    </div>
                    <button
                      onClick={() => handleAddToStore(product)}
                      className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center"
                    >
                      <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      Add to My Store
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Submit Product Tab */}
      {selectedTab === 'submit' && (
        <div className="bg-card rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-text mb-6">Submit New Product</h3>

          <form onSubmit={handleSubmitProduct} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-text mb-2">Product Title</label>
                <input
                  type="text"
                  value={newProduct.title}
                  onChange={(e) => setNewProduct(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text mb-2">Category</label>
                <select
                  value={newProduct.category}
                  onChange={(e) => setNewProduct(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                >
                  <option value="">Select Category</option>
                  <option value="gaming">Gaming</option>
                  <option value="eco">Eco-Friendly</option>
                  <option value="office">Office</option>
                  <option value="lifestyle">Lifestyle</option>
                  <option value="3d-models">3D Models</option>
                  <option value="tech">Technology</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text mb-2">Description</label>
              <textarea
                value={newProduct.description}
                onChange={(e) => setNewProduct(prev => ({ ...prev, description: e.target.value }))}
                rows={4}
                className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                required
              />
            </div>

            {/* Product Type Selection */}
            <div>
              <label className="block text-sm font-medium text-text mb-2">Product Type</label>
              <div className="flex space-x-4">
                {['physical', 'digital', 'both'].map((type) => (
                  <label key={type} className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="radio"
                      name="productType"
                      value={type}
                      checked={newProduct.productType === type}
                      onChange={(e) => setNewProduct(prev => ({ ...prev, productType: e.target.value as any }))}
                      className="text-purple-600 focus:ring-purple-500"
                    />
                    <span className="capitalize">{type}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {(newProduct.productType === 'physical' || newProduct.productType === 'both') && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-text mb-2">Physical Price ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={newProduct.price}
                      onChange={(e) => setNewProduct(prev => ({ ...prev, price: parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text mb-2">Shipping Cost ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={newProduct.shippingCost}
                      onChange={(e) => setNewProduct(prev => ({ ...prev, shippingCost: parseFloat(e.target.value) }))}
                      className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                      required
                    />
                  </div>
                </>
              )}

              {(newProduct.productType === 'digital' || newProduct.productType === 'both') && (
                <div>
                  <label className="block text-sm font-medium text-text mb-2">Digital (STL) Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={newProduct.digitalPrice}
                    onChange={(e) => setNewProduct(prev => ({ ...prev, digitalPrice: parseFloat(e.target.value) }))}
                    className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                    required
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-text mb-2">Product Images</label>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleImageUpload}
                className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              {newProduct.images.length > 0 && (
                <div className="mt-3 grid grid-cols-4 gap-3">
                  {newProduct.images.map((img, index) => (
                    <img key={index} src={img} alt={`Preview ${index + 1}`} className="w-full h-20 object-cover rounded" />
                  ))}
                </div>
              )}
            </div>

            {(newProduct.productType === 'digital' || newProduct.productType === 'both') && (
              <div>
                <label className="block text-sm font-medium text-text mb-2">Upload STL File</label>
                <div className="border-2 border-dashed card-border rounded-lg p-6 text-center hover:border-purple-500 transition-colors bg-gray-50">
                  <input
                    type="file"
                    accept=".stl,.obj,.3mf"
                    onChange={(e) => setNewProduct(prev => ({ ...prev, file: e.target.files?.[0] || null }))}
                    className="hidden"
                    id="stl-upload"
                  />
                  <label htmlFor="stl-upload" className="cursor-pointer">
                    <svg className="mx-auto h-8 w-8 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="block text-sm font-medium text-purple-600">Choose STL file</span>
                  </label>
                  {newProduct.file && (
                    <div className="mt-2 text-sm text-green-600 font-medium">
                      Selected: {newProduct.file.name}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
              <div className="flex">
                <svg className="w-5 h-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <h4 className="text-sm font-medium text-blue-900">Submission Guidelines</h4>
                  <ul className="text-sm text-blue-700 mt-1">
                    <li>• Products must be original and not infringe on copyrights</li>
                    <li>• High-quality images are required (minimum 1000x1000px)</li>
                    <li>• Accurate descriptions and competitive pricing</li>
                    <li>• <strong>Commission rate is {analytics.commissionRate}% of sales</strong> (You keep 90%)</li>
                  </ul>
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              Submit for Approval
            </button>
          </form>
        </div>
      )}

      {/* Analytics Tab */}
      {selectedTab === 'analytics' && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-text mb-6">Sales Performance</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="bg-gradient-to-r from-green-400 to-blue-500 rounded-lg p-6 text-white">
                <h4 className="text-lg font-semibold mb-2">Revenue This Month</h4>
                <p className="text-3xl font-bold">${analytics.thisMonth.toFixed(2)}</p>
                <p className="text-sm opacity-90">+23% from last month</p>
              </div>

              <div className="bg-gradient-to-r from-purple-400 to-pink-500 rounded-lg p-6 text-white">
                <h4 className="text-lg font-semibold mb-2">Products Sold</h4>
                <p className="text-3xl font-bold">47</p>
                <p className="text-sm opacity-90">Across {products.filter(p => p.approved).length} products</p>
              </div>
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-semibold text-text mb-4">Top Performing Products</h4>
              <div className="space-y-3">
                {products.filter(p => p.approved).map((product) => (
                  <div key={product.id} className="flex items-center justify-between p-3 bg-card rounded">
                    <div className="flex items-center">
                      <img src={product.images[0]} alt={product.title} className="w-12 h-12 object-cover rounded mr-3" />
                      <div>
                        <p className="font-medium text-text">{product.title}</p>
                        <p className="text-sm text-muted">${product.price}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-green-600">$67.89</p>
                      <p className="text-sm text-muted">23 sold</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payouts Tab */}
      {selectedTab === 'payouts' && (
        <div className="bg-card rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-text mb-6">Payout Management</h3>

          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
            <div className="flex">
              <svg className="w-5 h-5 text-yellow-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 15.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div>
                <h4 className="text-sm font-medium text-yellow-900">Stripe Account Required</h4>
                <p className="text-sm text-yellow-700">Connect your Stripe account to receive automatic payouts.</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="border rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <h4 className="font-semibold text-text">Pending Payout</h4>
                <span className="text-2xl font-bold text-green-600">${analytics.pendingPayout.toFixed(2)}</span>
              </div>
              <p className="text-sm text-muted mb-4">Available for payout on next billing cycle</p>
              <button className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded">
                Request Payout
              </button>
            </div>

            <div className="border rounded-lg p-4">
              <h4 className="font-semibold text-text mb-4">Payout History</h4>
              <div className="space-y-3">
                {[
                  { date: '2025-01-01', amount: 145.67, status: 'Completed' },
                  { date: '2024-12-01', amount: 234.12, status: 'Completed' },
                  { date: '2024-11-01', amount: 178.93, status: 'Completed' }
                ].map((payout, index) => (
                  <div key={index} className="flex justify-between items-center p-3 bg-card rounded">
                    <div>
                      <p className="font-medium text-text">${payout.amount.toFixed(2)}</p>
                      <p className="text-sm text-muted">{payout.date}</p>
                    </div>
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                      {payout.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default VendorDashboard

import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { supabase } from '../lib/supabase'
import { API_BASE } from '../lib/api'
import type { VendorProduct, Product } from '../types'
import { CreatorAnalytics } from '../components/CreatorAnalytics'
import { useToast } from '../hooks/useToast'

const VendorDashboard: React.FC = () => {
  const { user } = useAuth()
  const toast = useToast()
  
  const [products, setProducts] = useState<VendorProduct[]>([])
  const [uploadingImages, setUploadingImages] = useState(false)
  const [uploadedImages, setUploadedImages] = useState<{ url: string; file?: File }[]>([])
  const [uploadingDigitalFile, setUploadingDigitalFile] = useState(false)
  const [uploadedDigitalFile, setUploadedDigitalFile] = useState<{ url: string; name: string; size: number } | null>(null)
  
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([])
  const [selectedTab, setSelectedTab] = useState<'products' | 'catalog' | 'submit' | 'creator' | 'analytics' | 'payouts'>('products')
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
    images: [] as string[]
  })

  const [analytics, setAnalytics] = useState({
    totalSales: 0,
    thisMonth: 0,
    pendingPayout: 0,
    commissionRate: 25 // 25% vendor commission on sales
  })

  // Real numbers from paid orders containing this vendor's products —
  // replaces the hardcoded $542.30 mock that shipped with the first cut.
  useEffect(() => {
    const loadAnalytics = async () => {
      if (!user) return
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return
        const apiBase = import.meta.env.VITE_API_BASE || ''
        const res = await fetch(`${apiBase}/api/vendor/analytics`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) return
        const data = await res.json()
        setAnalytics({
          totalSales: data.totalSales ?? 0,
          thisMonth: data.thisMonth ?? 0,
          pendingPayout: data.pendingPayout ?? 0,
          commissionRate: data.commissionRate ?? 25,
        })
      } catch (error) {
        console.error('Error loading vendor analytics:', error)
      }
    }
    loadAnalytics()
  }, [user?.id])

  const loadVendorProducts = async () => {
    if (!user) return
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('vendor_id', user.id)
        .order('created_at', { ascending: false })

      if (error) throw error

      const mappedProducts: VendorProduct[] = (data || []).map((p: any) => ({
        id: p.id,
        vendorId: p.vendor_id,
        title: p.name,
        description: p.description || '',
        price: p.price || 0,
        digitalPrice: p.digital_price || 0,
        images: p.images || [],
        category: p.category || 'shirts',
        approved: p.status === 'active',
        commissionRate: 25,
        createdAt: p.created_at,
        productType: p.product_type || 'physical',
        fileUrl: p.file_url
      }))
      setProducts(mappedProducts)
    } catch (error) {
      console.error('Error loading vendor products:', error)
    }
  }

  useEffect(() => {
    loadVendorProducts()
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

  const handleAddToStore = async (product: Product) => {
    if (!user) return
    try {
      // Persist a real draft row — this used to mutate local state only, so
      // "added" products vanished on refresh and never reached approval.
      const { error } = await supabase.from('products').insert({
        vendor_id: user.id,
        name: product.name,
        description: product.description,
        price: product.price,
        category: product.category,
        product_type: 'physical',
        images: product.images,
        status: 'draft',
        is_active: false,
        metadata: {
          ...(product.metadata || {}),
          source_product_id: product.id,
          added_from_catalog: true,
        },
      })
      if (error) throw error

      toast.success('Added to your store', `${product.name} saved as a draft in My Products.`)
      setSelectedTab('products')
      loadVendorProducts()
    } catch (error: any) {
      console.error('Error adding product to store:', error)
      toast.error('Failed to add product', error.message)
    }
  }

  const handleSubmitProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    if (uploadedImages.length === 0) {
      toast.error('Missing images', 'Please upload at least one image.')
      return
    }
    
    // If it's a digital product, ensure a file was uploaded
    if ((newProduct.productType === 'digital' || newProduct.productType === 'both') && !uploadedDigitalFile) {
      toast.error('Missing file', 'Please upload an STL file for your digital product.')
      return
    }

    try {
      const { error } = await supabase.from('products').insert({
        vendor_id: user?.id,
        name: newProduct.title,
        description: newProduct.description,
        price: newProduct.price,
        digital_price: newProduct.digitalPrice,
        category: newProduct.category,
        product_type: newProduct.productType,
        images: uploadedImages.map(img => img.url),
        file_url: uploadedDigitalFile?.url || null,
        status: 'draft',
        is_active: false
      })
      if (error) throw error
      
      toast.success('Success', 'Product submitted for approval!')
      setNewProduct({
        title: '',
        description: '',
        price: 0,
        digitalPrice: 0,
        category: '',
        productType: 'physical',
        shippingCost: 0,
        images: []
      })
      setUploadedImages([])
      setUploadedDigitalFile(null)
      setSelectedTab('products')
      loadVendorProducts()
    } catch (error: any) {
      console.error('Error submitting product:', error)
      toast.error('Submission failed', error.message)
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploadingImages(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        toast.error('Not authenticated', 'Please sign in to upload images.')
        return
      }
      
      const newImages: { url: string; file?: File }[] = []
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue
        
        const formData = new FormData()
        formData.append('image', file)
        formData.append('folder', 'products')
        
        const response = await fetch(`${API_BASE}/api/admin/upload-product-image`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`
          },
          body: formData
        })
        
        if (response.ok) {
          const data = await response.json()
          newImages.push({ url: data.url, file })
        }
      }
      
      if (newImages.length > 0) {
        setUploadedImages(prev => [...prev, ...newImages])
        toast.success('Images uploaded', `${newImages.length} images uploaded successfully.`)
      }
    } catch (error) {
      console.error('Error uploading images:', error)
      toast.error('Upload failed', 'Failed to upload images.')
    } finally {
      setUploadingImages(false)
    }
  }

  const handleDigitalFileUpload = async (file: File | null) => {
    if (!file) return
    setUploadingDigitalFile(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        toast.error('Not authenticated', 'Please sign in to upload files.')
        return
      }
      
      const formData = new FormData()
      formData.append('file', file)
      formData.append('folder', 'digital-products')
      
      const response = await fetch(`${API_BASE}/api/admin/upload-digital-file`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        },
        body: formData
      })
      
      if (response.ok) {
        const data = await response.json()
        setUploadedDigitalFile({ url: data.url, name: file.name, size: file.size })
        toast.success('File uploaded', 'Digital file uploaded successfully.')
      } else {
        const err = await response.json()
        throw new Error(err.error || 'Upload failed')
      }
    } catch (error: any) {
      console.error('Error uploading digital file:', error)
      toast.error('Upload failed', error.message || 'Failed to upload digital file.')
    } finally {
      setUploadingDigitalFile(false)
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
          {['products', 'catalog', 'submit', 'creator', 'analytics', 'payouts'].map((tab) => (
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
                <div key={product.id} className="border rounded-lg overflow-hidden bg-card">
                  <img
                    src={product.images[0] || 'https://via.placeholder.com/400x300?text=No+Image'}
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
                      <button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm py-2 px-3 rounded transition-colors">
                        Edit
                      </button>
                      <button className="flex-1 bg-gray-600 hover:bg-gray-700 text-white text-sm py-2 px-3 rounded transition-colors">
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
                <div key={product.id} className="border rounded-lg overflow-hidden hover:shadow-md transition-shadow bg-card">
                  <img
                    src={product.images[0] || 'https://via.placeholder.com/400x300?text=No+Image'}
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
                  className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 bg-bg text-text"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text mb-2">Category</label>
                <select
                  value={newProduct.category}
                  onChange={(e) => setNewProduct(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 bg-bg text-text"
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
                className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 bg-bg text-text"
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
                    <span className="capitalize text-text">{type}</span>
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
                      className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 bg-bg text-text"
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
                      className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 bg-bg text-text"
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
                    className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 bg-bg text-text"
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
                className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 bg-bg text-text"
              />
              {uploadingImages && <p className="mt-2 text-sm text-purple-600 animate-pulse">Uploading images...</p>}
              {uploadedImages.length > 0 && (
                <div className="mt-3 grid grid-cols-4 gap-3">
                  {uploadedImages.map((img, index) => (
                    <div key={index} className="relative group">
                      <img src={img.url} alt={`Preview ${index + 1}`} className="w-full h-20 object-cover rounded border card-border" />
                      <button 
                        type="button"
                        onClick={() => setUploadedImages(prev => prev.filter((_, i) => i !== index))}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {(newProduct.productType === 'digital' || newProduct.productType === 'both') && (
              <div>
                <label className="block text-sm font-medium text-text mb-2">Upload STL File</label>
                <div className="border-2 border-dashed card-border rounded-lg p-6 text-center hover:border-purple-500 transition-colors bg-bg/50">
                  <input
                    type="file"
                    accept=".stl,.obj,.3mf"
                    onChange={(e) => handleDigitalFileUpload(e.target.files?.[0] || null)}
                    className="hidden"
                    id="stl-upload"
                  />
                  <label htmlFor="stl-upload" className="cursor-pointer">
                    <svg className="mx-auto h-8 w-8 text-muted mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="block text-sm font-medium text-purple-600">
                      {uploadingDigitalFile ? 'Uploading...' : 'Choose STL file'}
                    </span>
                  </label>
                  {uploadedDigitalFile && (
                    <div className="mt-2 text-sm text-green-600 font-medium">
                      Uploaded: {uploadedDigitalFile.name} ({(uploadedDigitalFile.size / 1024 / 1024).toFixed(2)} MB)
                    </div>
                  )}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={uploadingImages || uploadingDigitalFile}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors shadow-glow disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Submit for Approval
            </button>
          </form>
        </div>
      )}

      {/* Creator Analytics Tab */}
      {selectedTab === 'creator' && (
        <div className="bg-card rounded-lg shadow p-6">
          <CreatorAnalytics />
        </div>
      )}

      {/* Analytics Tab */}
      {selectedTab === 'analytics' && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-text mb-6">Sales Performance</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="bg-gradient-to-r from-green-400 to-blue-500 rounded-lg p-6 text-white shadow-lg">
                <h4 className="text-lg font-semibold mb-2">Revenue This Month</h4>
                <p className="text-3xl font-bold">${analytics.thisMonth.toFixed(2)}</p>
                <p className="text-sm opacity-90">+23% from last month</p>
              </div>

              <div className="bg-gradient-to-r from-purple-400 to-pink-500 rounded-lg p-6 text-white shadow-lg">
                <h4 className="text-lg font-semibold mb-2">Products Sold</h4>
                <p className="text-3xl font-bold">47</p>
                <p className="text-sm opacity-90">Across {products.filter(p => p.approved).length} products</p>
              </div>
            </div>

            <div className="border card-border rounded-lg p-4">
              <h4 className="font-semibold text-text mb-4">Top Performing Products</h4>
              <div className="space-y-3">
                {products.filter(p => p.approved).length > 0 ? (
                  products.filter(p => p.approved).map((product) => (
                    <div key={product.id} className="flex items-center justify-between p-3 bg-bg/30 rounded border card-border">
                      <div className="flex items-center">
                        <img src={product.images[0] || 'https://via.placeholder.com/50'} alt={product.title} className="w-12 h-12 object-cover rounded mr-3" />
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
                  ))
                ) : (
                  <p className="text-center text-muted py-4">No sales data available yet.</p>
                )}
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
            <div className="border card-border rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <h4 className="font-semibold text-text">Pending Payout</h4>
                <span className="text-2xl font-bold text-green-600">${analytics.pendingPayout.toFixed(2)}</span>
              </div>
              <p className="text-sm text-muted mb-4">Available for payout on next billing cycle</p>
              <button className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded shadow-md transition-colors">
                Request Payout
              </button>
            </div>

            <div className="border card-border rounded-lg p-4">
              <h4 className="font-semibold text-text mb-4">Payout History</h4>
              <div className="space-y-3">
                {[
                  { date: '2025-01-01', amount: 145.67, status: 'Completed' },
                  { date: '2024-12-01', amount: 234.12, status: 'Completed' },
                  { date: '2024-11-01', amount: 178.93, status: 'Completed' }
                ].map((payout, index) => (
                  <div key={index} className="flex justify-between items-center p-3 bg-bg/30 rounded border card-border">
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


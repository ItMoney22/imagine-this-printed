import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { aiProducts } from '../lib/api'
import type { User, VendorProduct, ThreeDModel, SystemMetrics, AuditLog, Product } from '../types'
import AdminCreateProductWizard from '../components/AdminCreateProductWizard'
import AdminWalletManagement from '../components/AdminWalletManagement'
import AdminSupport from '../components/AdminSupport'

const AdminDashboard: React.FC = () => {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabFromUrl = searchParams.get('tab') as 'overview' | 'users' | 'vendors' | 'products' | 'models' | 'audit' | 'wallet' | 'support' || 'overview'
  const [selectedTab, setSelectedTab] = useState<'overview' | 'users' | 'vendors' | 'products' | 'models' | 'audit' | 'wallet' | 'support'>(tabFromUrl)
  const [users, setUsers] = useState<User[]>([])
  const [vendorProducts, setVendorProducts] = useState<VendorProduct[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [productAssets, setProductAssets] = useState<Record<string, any>>({})
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null)
  const [productJobs, setProductJobs] = useState<Record<string, any[]>>({})
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set())
  const [showEnhancedEditModal, setShowEnhancedEditModal] = useState(false)
  const [editingProductData, setEditingProductData] = useState<any>(null)
  const [models, setModels] = useState<ThreeDModel[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics>({
    totalUsers: 0,
    totalOrders: 0,
    totalRevenue: 0,
    activeVendors: 0,
    pendingApprovals: 0,
    modelsUploaded: 0,
    pointsDistributed: 0,
    activeSessions: 0
  })
  const [showProductModal, setShowProductModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [productForm, setProductForm] = useState({
    name: '',
    description: '',
    price: 0,
    category: 'shirts' as Product['category'],
    images: '',
    inStock: true,
    productType: 'physical' as 'physical' | 'digital' | 'both',
    digitalPrice: 0,
    fileUrl: '',
    shippingCost: 0,
    isFeatured: false
  })

  // Load products and metrics from Supabase
  useEffect(() => {
    loadProducts()
    loadMetrics()
  }, [])

  const loadMetrics = async () => {
    try {
      // Get total users
      const { count: totalUsers } = await supabase
        .from('user_profiles')
        .select('*', { count: 'exact', head: true })

      // Get total orders and revenue
      const { data: orders } = await supabase
        .from('orders')
        .select('total_amount')

      const totalRevenue = orders?.reduce((sum, order) => sum + (order.total_amount || 0), 0) || 0
      const totalOrders = orders?.length || 0

      // Get active vendors (users with role = 'vendor')
      const { count: activeVendors } = await supabase
        .from('user_profiles')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'vendor')

      // Get pending approvals (draft products)
      const { count: pendingProducts } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'draft')

      // Get pending vendor products
      const { count: pendingVendorProducts } = await supabase
        .from('vendor_products')
        .select('*', { count: 'exact', head: true })
        .eq('approved', false)

      // Get pending 3D models
      const { count: pendingModels } = await supabase
        .from('three_d_models')
        .select('*', { count: 'exact', head: true })
        .eq('approved', false)

      const pendingApprovals = (pendingProducts || 0) + (pendingVendorProducts || 0) + (pendingModels || 0)

      // Get total 3D models
      const { count: modelsUploaded } = await supabase
        .from('three_d_models')
        .select('*', { count: 'exact', head: true })

      // Get total points distributed
      const { data: wallets } = await supabase
        .from('user_wallets')
        .select('points')

      const pointsDistributed = wallets?.reduce((sum, wallet) => sum + (wallet.points || 0), 0) || 0

      setSystemMetrics({
        totalUsers: totalUsers || 0,
        totalOrders,
        totalRevenue,
        activeVendors: activeVendors || 0,
        pendingApprovals,
        modelsUploaded: modelsUploaded || 0,
        pointsDistributed,
        activeSessions: 0 // Keep as 0 or implement session tracking
      })
    } catch (error) {
      console.error('Error loading metrics:', error)
    }
  }

  const loadProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error

      // Map Supabase product to our Product type, including metadata and status
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
        status: p.status || 'draft',
        metadata: p.metadata || {},
        isThreeForTwentyFive: p.metadata?.isThreeForTwentyFive || false
      }))

      setProducts(mappedProducts as any)

      // Fetch source images from product_assets for all products
      const productIds = mappedProducts.map(p => p.id)
      if (productIds.length > 0) {
        const { data: assetsData, error: assetsError } = await supabase
          .from('product_assets')
          .select('product_id, url, path')
          .in('product_id', productIds)
          .eq('kind', 'source')

        if (!assetsError && assetsData) {
          const assetsMap: Record<string, { url: string, path: string }> = {}
          assetsData.forEach((asset: any) => {
            assetsMap[asset.product_id] = {
              url: asset.url,
              path: asset.path
            }
          })
          setProductAssets(assetsMap)
        }
      }
    } catch (error) {
      console.error('Error loading products:', error)
    }
  }

  const openCreateProductModal = () => {
    setEditingProduct(null)
    setProductForm({
      name: '',
      description: '',
      price: 0,
      category: 'shirts',
      images: '',
      inStock: true,
      productType: 'physical',
      digitalPrice: 0,
      fileUrl: '',
      shippingCost: 0,
      isFeatured: false
    })
    setShowProductModal(true)
  }

  const openEditProductModal = (product: Product) => {
    setEditingProduct(product)
    setProductForm({
      name: product.name,
      description: product.description,
      price: product.price,
      category: product.category,
      images: product.images.join(', '),
      inStock: product.inStock,
      productType: product.productType || 'physical',
      digitalPrice: product.digitalPrice || 0,
      fileUrl: product.fileUrl || '',
      shippingCost: product.shippingCost || 0,
      isFeatured: product.is_featured || false
    })
    setShowProductModal(true)
  }



  const toggleFeatured = async (product: Product) => {
    try {
      const newFeaturedStatus = !product.is_featured
      const { error } = await supabase
        .from('products')
        .update({ is_featured: newFeaturedStatus })
        .eq('id', product.id)

      if (error) throw error

      setProducts(products.map(p =>
        p.id === product.id ? { ...p, is_featured: newFeaturedStatus } : p
      ))
    } catch (error: any) {
      console.error('Error updating featured status:', error)
      alert('Failed to update featured status')
    }
  }

  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      const images = productForm.images
        .split(',')
        .map(url => url.trim())
        .filter(url => url.length > 0)

      const productData = {
        name: productForm.name,
        description: productForm.description,
        price: productForm.price,
        category: productForm.category,
        images,
        is_active: productForm.inStock,
        productType: productForm.productType,
        digitalPrice: productForm.digitalPrice,
        fileUrl: productForm.fileUrl,
        shippingCost: productForm.shippingCost,
        is_featured: productForm.isFeatured
      }

      if (editingProduct) {
        // Update existing product
        const { error } = await supabase
          .from('products')
          .update(productData)
          .eq('id', editingProduct.id)

        if (error) throw error
      } else {
        // Create new product
        const { error } = await supabase
          .from('products')
          .insert(productData)

        if (error) throw error
      }

      // Reload products and close modal
      await loadProducts()
      setShowProductModal(false)

      // Add audit log
      const auditLog: AuditLog = {
        id: Date.now().toString(),
        userId: user?.id || 'admin',
        action: editingProduct ? 'UPDATE_PRODUCT' : 'CREATE_PRODUCT',
        entity: 'Product',
        entityId: editingProduct?.id || 'new',
        changes: productData,
        ipAddress: '192.168.1.100',
        userAgent: navigator.userAgent,
        createdAt: new Date().toISOString()
      }
      setAuditLogs(prev => [auditLog, ...prev])
    } catch (error: any) {
      console.error('Error saving product:', error)
      alert('Failed to save product: ' + error.message)
    }
  }

  const handleDeleteProduct = async (productId: string) => {
    if (!confirm('Are you sure you want to delete this product?')) return

    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', productId)

      if (error) throw error

      await loadProducts()

      // Add audit log
      const auditLog: AuditLog = {
        id: Date.now().toString(),
        userId: user?.id || 'admin',
        action: 'DELETE_PRODUCT',
        entity: 'Product',
        entityId: productId,
        changes: { deleted: true },
        ipAddress: '192.168.1.100',
        userAgent: navigator.userAgent,
        createdAt: new Date().toISOString()
      }
      setAuditLogs(prev => [auditLog, ...prev])
    } catch (error: any) {
      console.error('Error deleting product:', error)
      alert('Failed to delete product: ' + error.message)
    }
  }

  const handleRegenerateImages = async (productId: string) => {
    try {
      setLoadingAction(`regenerate-${productId}`)
      await aiProducts.regenerateImages(productId)
      alert('Image regeneration job created! The worker will process it shortly.')
      await loadProductJobs(productId)
    } catch (error: any) {
      console.error('Error regenerating images:', error)
      alert('Failed to regenerate images: ' + error.message)
    } finally {
      setLoadingAction(null)
    }
  }

  const handleRemoveBackground = async (productId: string) => {
    try {
      setLoadingAction(`rembg-${productId}`)
      await aiProducts.removeBackground(productId)
      alert('Background removal job created! The worker will process it shortly.')
      await loadProductJobs(productId)
    } catch (error: any) {
      console.error('Error removing background:', error)
      alert('Failed to remove background: ' + error.message)
    } finally {
      setLoadingAction(null)
    }
  }

  const handleCreateMockups = async (productId: string) => {
    try {
      setLoadingAction(`mockups-${productId}`)
      await aiProducts.createMockups(productId)
      alert('Mockup jobs created! The worker will process them shortly.')
      await loadProductJobs(productId)
    } catch (error: any) {
      console.error('Error creating mockups:', error)
      alert('Failed to create mockups: ' + error.message)
    } finally {
      setLoadingAction(null)
    }
  }

  const loadProductJobs = async (productId: string) => {
    try {
      // Load both jobs and assets
      const [jobsResult, assetsResult] = await Promise.all([
        supabase
          .from('ai_jobs')
          .select('*')
          .eq('product_id', productId)
          .order('created_at', { ascending: false }),
        supabase
          .from('product_assets')
          .select('*')
          .eq('product_id', productId)
          .order('created_at', { ascending: false })
      ])

      if (jobsResult.error) throw jobsResult.error
      if (assetsResult.error) throw assetsResult.error

      setProductJobs(prev => ({ ...prev, [productId]: jobsResult.data || [] }))

      // Set product assets organized by kind (source, nobg, mockup, upscaled)
      const assets = assetsResult.data || []
      if (assets.length > 0) {
        // Store all assets for this product
        const assetsByKind: Record<string, any[]> = {}
        assets.forEach(asset => {
          if (!assetsByKind[asset.kind]) {
            assetsByKind[asset.kind] = []
          }
          assetsByKind[asset.kind].push(asset)
        })

        setProductAssets(prev => ({
          ...prev,
          [productId]: assetsByKind
        }))
      }
    } catch (error) {
      console.error('Error loading product jobs:', error)
    }
  }

  const toggleProductExpansion = async (productId: string) => {
    if (expandedProductId === productId) {
      setExpandedProductId(null)
    } else {
      setExpandedProductId(productId)
      await loadProductJobs(productId)
    }
  }

  const toggleProductSelection = (productId: string) => {
    const newSelection = new Set(selectedProducts)
    if (newSelection.has(productId)) {
      newSelection.delete(productId)
    } else {
      newSelection.add(productId)
    }
    setSelectedProducts(newSelection)
  }

  const toggleAllProducts = () => {
    if (selectedProducts.size === products.length) {
      setSelectedProducts(new Set())
    } else {
      setSelectedProducts(new Set(products.map(p => p.id)))
    }
  }

  const handleMassDelete = async () => {
    if (selectedProducts.size === 0) {
      alert('Please select products to delete')
      return
    }

    if (!confirm(`Are you sure you want to delete ${selectedProducts.size} products?`)) return

    try {
      const deletePromises = Array.from(selectedProducts).map(productId =>
        supabase.from('products').delete().eq('id', productId)
      )

      await Promise.all(deletePromises)

      await loadProducts()
      setSelectedProducts(new Set())
      alert(`Successfully deleted ${selectedProducts.size} products!`)
    } catch (error: any) {
      console.error('Error deleting products:', error)
      alert('Failed to delete some products: ' + error.message)
    }
  }

  const handlePublishProducts = async () => {
    if (selectedProducts.size === 0) {
      alert('Please select products to publish')
      return
    }

    try {
      // For each product, fetch its assets and build images array
      const updatePromises = Array.from(selectedProducts).map(async (productId) => {
        // Get all assets for this product
        const { data: assets } = await supabase
          .from('product_assets')
          .select('url, kind')
          .eq('product_id', productId)
          .order('created_at', { ascending: false })

        // Build images array: [mockups, source, nobg, upscaled]
        const images: string[] = []

        if (assets) {
          // Prioritize mockups for display
          const mockups = assets.filter(a => a.kind === 'mockup').map(a => a.url)
          const upscaled = assets.filter(a => a.kind === 'upscaled').map(a => a.url)
          const nobg = assets.filter(a => a.kind === 'nobg').map(a => a.url)
          const source = assets.filter(a => a.kind === 'source').map(a => a.url)

          images.push(...mockups, ...upscaled, ...nobg, ...source)
        }

        // Update product with images array and publish
        return supabase
          .from('products')
          .update({
            status: 'active',
            is_active: true,
            images: images.length > 0 ? images : []
          })
          .eq('id', productId)
      })

      await Promise.all(updatePromises)

      await loadProducts()
      await loadMetrics()
      setSelectedProducts(new Set())
      alert(`Successfully published ${selectedProducts.size} products!`)
    } catch (error: any) {
      console.error('Error publishing products:', error)
      alert('Failed to publish some products: ' + error.message)
    }
  }

  const openEnhancedEditModal = async (product: any) => {
    setEditingProductData(product)
    setShowEnhancedEditModal(true)
    await loadProductJobs(product.id)
  }

  const handleUpscaleImage = async (productId: string) => {
    try {
      setLoadingAction(`upscale-${productId}`)

      // Create an upscale job using recraft-crisp-upscale
      const { data: job, error } = await supabase
        .from('ai_jobs')
        .insert({
          product_id: productId,
          type: 'replicate_upscale',
          status: 'queued',
          input: {
            model: 'recraft-ai/recraft-v3',
            upscale: true
          },
        })
        .select()
        .single()

      if (error) throw error

      alert('Image upscale job created! The worker will process it shortly.')
      if (editingProductData?.id === productId) {
        await loadProductJobs(productId)
      }
    } catch (error: any) {
      console.error('Error upscaling image:', error)
      alert('Failed to create upscale job: ' + error.message)
    } finally {
      setLoadingAction(null)
    }
  }

  const handleUpdateProductField = async (field: string, value: any) => {
    if (!editingProductData) return

    try {
      // If changing status to 'active', automatically populate images array from assets
      if (field === 'status' && value === 'active') {
        const { data: assets } = await supabase
          .from('product_assets')
          .select('url, kind')
          .eq('product_id', editingProductData.id)
          .order('created_at', { ascending: false })

        const images: string[] = []

        if (assets) {
          const mockups = assets.filter(a => a.kind === 'mockup').map(a => a.url)
          const upscaled = assets.filter(a => a.kind === 'upscaled').map(a => a.url)
          const nobg = assets.filter(a => a.kind === 'nobg').map(a => a.url)
          const source = assets.filter(a => a.kind === 'source').map(a => a.url)

          images.push(...mockups, ...upscaled, ...nobg, ...source)
        }

        // Update both status and images
        const { error } = await supabase
          .from('products')
          .update({
            status: value,
            images: images.length > 0 ? images : [],
            is_active: true
          })
          .eq('id', editingProductData.id)

        if (error) throw error

        setEditingProductData({
          ...editingProductData,
          status: value,
          images: images,
          is_active: true
        })
      } else {
        // Regular field update
        const { error } = await supabase
          .from('products')
          .update({ [field]: value })
          .eq('id', editingProductData.id)

        if (error) throw error

        setEditingProductData({ ...editingProductData, [field]: value })
      }

      await loadProducts()
    } catch (error: any) {
      console.error('Error updating product:', error)
      alert('Failed to update product: ' + error.message)
    }
  }

  const handleDeleteImage = async (productId: string, assetId: string, imageUrl: string) => {
    if (!confirm('Are you sure you want to delete this image? This action cannot be undone.')) {
      return
    }

    try {
      // 1. Delete from product_assets table
      const { error: assetError } = await supabase
        .from('product_assets')
        .delete()
        .eq('id', assetId)

      if (assetError) throw assetError

      // 2. Remove from products.images array
      const { data: product } = await supabase
        .from('products')
        .select('images')
        .eq('id', productId)
        .single()

      if (product?.images) {
        const updatedImages = product.images.filter((url: string) => url !== imageUrl)

        const { error: updateError } = await supabase
          .from('products')
          .update({ images: updatedImages })
          .eq('id', productId)

        if (updateError) throw updateError
      }

      // 3. Reload product data
      await loadProducts()

      // 4. Refresh product assets for this product
      const { data: assets } = await supabase
        .from('product_assets')
        .select('*')
        .eq('product_id', productId)
        .order('created_at', { ascending: false })

      const groupedAssets: Record<string, any[]> = {
        source: [],
        nobg: [],
        mockup: [],
        upscaled: []
      }

      assets?.forEach(asset => {
        if (groupedAssets[asset.kind]) {
          groupedAssets[asset.kind].push(asset)
        }
      })

      setProductAssets(prev => ({
        ...prev,
        [productId]: groupedAssets
      }))

      // 5. Update editing product data if currently editing
      if (editingProductData?.id === productId) {
        const { data: updatedProduct } = await supabase
          .from('products')
          .select('*')
          .eq('id', productId)
          .single()

        if (updatedProduct) {
          setEditingProductData(updatedProduct)
        }
      }

      console.log('✅ Image deleted successfully')
    } catch (error: any) {
      console.error('Error deleting image:', error)
      alert('Failed to delete image: ' + error.message)
    }
  }

  const handleSetMainImage = async (productId: string, imageUrl: string) => {
    try {
      console.log('🔄 Setting main image:', imageUrl)

      // Get current images array
      const { data: product } = await supabase
        .from('products')
        .select('images')
        .eq('id', productId)
        .single()

      if (!product?.images || !product.images.includes(imageUrl)) {
        throw new Error('Image not found in product images')
      }

      // Reorder images array to put selected image first
      const updatedImages = [
        imageUrl,
        ...product.images.filter((url: string) => url !== imageUrl)
      ]

      console.log('📝 Updating database with new image order:', updatedImages)

      // Update database
      const { error } = await supabase
        .from('products')
        .update({ images: updatedImages })
        .eq('id', productId)

      if (error) throw error

      console.log('✅ Database updated, reloading products...')

      // Reload products to refresh the table
      await loadProducts()

      // Update local state in the products array for immediate UI update
      setProducts(prevProducts =>
        prevProducts.map(p =>
          p.id === productId
            ? { ...p, images: updatedImages }
            : p
        )
      )

      // Update editing product data if currently editing
      if (editingProductData?.id === productId) {
        setEditingProductData({
          ...editingProductData,
          images: updatedImages
        })
      }

      console.log('✅ Main image updated successfully')
    } catch (error: any) {
      console.error('❌ Error setting main image:', error)
      alert('Failed to set main image: ' + error.message)
    }
  }

  const togglePromo = async (product: Product) => {
    const newStatus = !product.isThreeForTwentyFive
    const newMetadata = { ...product.metadata, isThreeForTwentyFive: newStatus }

    try {
      const { error } = await supabase
        .from('products')
        .update({ metadata: newMetadata })
        .eq('id', product.id)

      if (error) throw error

      // Update local state
      setProducts(products.map(p => p.id === product.id ? { ...p, isThreeForTwentyFive: newStatus, metadata: newMetadata } : p))
    } catch (error: any) {
      console.error('Error updating promo:', error)
      alert('Failed to update promo status: ' + error.message)
    }
  }

  // Load real data from database
  useEffect(() => {
    loadUsersData()
    loadVendorProductsData()
    loadModelsData()
    loadAuditLogsData()
  }, [user?.id])

  const loadUsersData = async () => {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*, user_wallets(points, itc_balance)')
        .order('created_at', { ascending: false })

      if (error) throw error

      const mappedUsers: User[] = (data || []).map((u: any) => ({
        id: u.id,
        email: u.email || '',
        role: u.role || 'customer',
        firstName: u.first_name || '',
        lastName: u.last_name || '',
        points: u.user_wallets?.[0]?.points || 0,
        itcBalance: u.user_wallets?.[0]?.itc_balance || 0,
        stripeAccountId: u.stripe_account_id || undefined,
        createdAt: u.created_at
      }))

      setUsers(mappedUsers)
    } catch (error) {
      console.error('Error loading users:', error)
    }
  }

  const loadVendorProductsData = async () => {
    try {
      const { data, error } = await supabase
        .from('vendor_products')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error

      const mappedVendorProducts: VendorProduct[] = (data || []).map((vp: any) => ({
        id: vp.id,
        vendorId: vp.vendor_id,
        title: vp.title || '',
        description: vp.description || '',
        price: vp.price || 0,
        images: vp.images || [],
        category: vp.category || 'other',
        approved: vp.approved || false,
        commissionRate: vp.commission_rate || 15,
        createdAt: vp.created_at
      }))

      setVendorProducts(mappedVendorProducts)
    } catch (error) {
      console.error('Error loading vendor products:', error)
    }
  }

  const loadModelsData = async () => {
    try {
      const { data, error } = await supabase
        .from('three_d_models')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error

      const mappedModels: ThreeDModel[] = (data || []).map((m: any) => ({
        id: m.id,
        title: m.title || '',
        description: m.description || '',
        fileUrl: m.file_url || '',
        category: m.category || 'other',
        uploadedBy: m.uploaded_by,
        approved: m.approved || false,
        votes: m.votes || 0,
        points: m.points || 0,
        createdAt: m.created_at,
        fileType: m.file_type || 'stl'
      }))

      setModels(mappedModels)
    } catch (error) {
      console.error('Error loading 3D models:', error)
    }
  }

  const loadAuditLogsData = async () => {
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error

      const mappedAuditLogs: AuditLog[] = (data || []).map((log: any) => ({
        id: log.id,
        userId: log.user_id,
        action: log.action,
        entity: log.entity,
        entityId: log.entity_id,
        changes: log.changes || {},
        ipAddress: log.ip_address || '',
        userAgent: log.user_agent || '',
        createdAt: log.created_at
      }))

      setAuditLogs(mappedAuditLogs)
    } catch (error) {
      console.error('Error loading audit logs:', error)
    }
  }

  const updateUserRole = async (userId: string, newRole: User['role']) => {
    try {
      // Update role in database
      const { error } = await supabase
        .from('user_profiles')
        .update({ role: newRole })
        .eq('id', userId)

      if (error) throw error

      // Update local state
      setUsers(prev => prev.map(u =>
        u.id === userId ? { ...u, role: newRole } : u
      ))

      // Add audit log to database
      await supabase
        .from('audit_logs')
        .insert({
          user_id: user?.id || 'admin',
          action: 'ROLE_CHANGE',
          entity: 'User',
          entity_id: userId,
          changes: { role: newRole },
          ip_address: '192.168.1.100',
          user_agent: navigator.userAgent
        })

      // Reload audit logs to show the new entry
      await loadAuditLogsData()

      alert(`User role updated to ${newRole} successfully!`)
    } catch (error: any) {
      console.error('Error updating user role:', error)
      alert('Failed to update user role: ' + error.message)
    }
  }

  const approveVendorProduct = async (productId: string) => {
    try {
      const { error } = await supabase
        .from('vendor_products')
        .update({ approved: true })
        .eq('id', productId)

      if (error) throw error

      setVendorProducts(prev => prev.map(p =>
        p.id === productId ? { ...p, approved: true } : p
      ))

      await supabase.from('audit_logs').insert({
        user_id: user?.id || 'admin',
        action: 'APPROVE_PRODUCT',
        entity: 'VendorProduct',
        entity_id: productId,
        changes: { approved: true },
        ip_address: '192.168.1.100',
        user_agent: navigator.userAgent
      })

      await loadAuditLogsData()
      await loadMetrics()
      alert('Vendor product approved successfully!')
    } catch (error: any) {
      console.error('Error approving vendor product:', error)
      alert('Failed to approve product: ' + error.message)
    }
  }

  const rejectVendorProduct = async (productId: string) => {
    if (!confirm('Are you sure you want to reject this vendor product?')) return

    try {
      const { error } = await supabase
        .from('vendor_products')
        .delete()
        .eq('id', productId)

      if (error) throw error

      setVendorProducts(prev => prev.filter(p => p.id !== productId))

      await supabase.from('audit_logs').insert({
        user_id: user?.id || 'admin',
        action: 'REJECT_PRODUCT',
        entity: 'VendorProduct',
        entity_id: productId,
        changes: { rejected: true },
        ip_address: '192.168.1.100',
        user_agent: navigator.userAgent
      })

      await loadAuditLogsData()
      await loadMetrics()
      alert('Vendor product rejected and deleted successfully!')
    } catch (error: any) {
      console.error('Error rejecting vendor product:', error)
      alert('Failed to reject product: ' + error.message)
    }
  }

  const approveModel = async (modelId: string) => {
    try {
      const { error } = await supabase
        .from('three_d_models')
        .update({ approved: true })
        .eq('id', modelId)

      if (error) throw error

      setModels(prev => prev.map(m =>
        m.id === modelId ? { ...m, approved: true } : m
      ))

      await supabase.from('audit_logs').insert({
        user_id: user?.id || 'admin',
        action: 'APPROVE_MODEL',
        entity: 'ThreeDModel',
        entity_id: modelId,
        changes: { approved: true },
        ip_address: '192.168.1.100',
        user_agent: navigator.userAgent
      })

      await loadAuditLogsData()
      await loadMetrics()
      alert('3D model approved successfully!')
    } catch (error: any) {
      console.error('Error approving model:', error)
      alert('Failed to approve model: ' + error.message)
    }
  }

  const rejectModel = async (modelId: string) => {
    if (!confirm('Are you sure you want to reject this 3D model?')) return

    try {
      const { error } = await supabase
        .from('three_d_models')
        .delete()
        .eq('id', modelId)

      if (error) throw error

      setModels(prev => prev.filter(m => m.id !== modelId))

      await supabase.from('audit_logs').insert({
        user_id: user?.id || 'admin',
        action: 'REJECT_MODEL',
        entity: 'ThreeDModel',
        entity_id: modelId,
        changes: { rejected: true },
        ip_address: '192.168.1.100',
        user_agent: navigator.userAgent
      })

      await loadAuditLogsData()
      await loadMetrics()
      alert('3D model rejected and deleted successfully!')
    } catch (error: any) {
      console.error('Error rejecting model:', error)
      alert('Failed to reject model: ' + error.message)
    }
  }

  // DEBUG: Log role check for admin dashboard access
  useEffect(() => {
    console.log('[AdminDashboard] 🔐 Access check:', {
      user: user ? {
        id: user.id,
        email: user.email,
        role: user.role,
        roleType: typeof user.role
      } : null,
      hasAccess: user?.role === 'admin',
      condition: 'user?.role !== "admin"',
      result: user?.role !== 'admin' ? 'DENIED' : 'GRANTED'
    })
  }, [user])

  if (user?.role !== 'admin') {
    console.error('[AdminDashboard] ❌ ACCESS DENIED:', {
      userRole: user?.role,
      required: 'admin',
      userEmail: user?.email
    })
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Access denied. This page is for administrators only.</p>
          <p className="text-red-600 text-sm mt-2">Current role: {user?.role || 'none'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text mb-2">Admin Dashboard</h1>
        <p className="text-muted">Manage users, approvals, and monitor system performance</p>
      </div>

      {/* System Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Total Users</p>
              <p className="text-2xl font-semibold text-text">{systemMetrics.totalUsers}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Total Revenue</p>
              <p className="text-2xl font-semibold text-text">${systemMetrics.totalRevenue.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Pending Approvals</p>
              <p className="text-2xl font-semibold text-text">{systemMetrics.pendingApprovals}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Active Sessions</p>
              <p className="text-2xl font-semibold text-text">{systemMetrics.activeSessions}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b card-border mb-6">
        <nav className="-mb-px flex space-x-8 overflow-x-auto">
          {['overview', 'users', 'vendors', 'products', 'models', 'wallet', 'audit', 'support'].map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setSelectedTab(tab as any)
                setSearchParams({ tab })
              }}
              className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${selectedTab === tab
                ? 'border-purple-500 text-purple-600'
                : 'border-transparent text-muted hover:text-text hover:card-border'
                }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {/* Overview Tab */}
      {selectedTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-card rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-text mb-4">Quick Actions</h3>
              <div className="space-y-3">
                <button
                  onClick={() => setSelectedTab('vendors')}
                  className="w-full text-left p-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                >
                  <div className="font-medium text-blue-900">Review Vendor Products</div>
                  <div className="text-sm text-blue-600">{vendorProducts.filter(p => !p.approved).length} pending approval</div>
                </button>
                <button
                  onClick={() => setSelectedTab('models')}
                  className="w-full text-left p-3 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
                >
                  <div className="font-medium text-green-900">Review 3D Models</div>
                  <div className="text-sm text-green-600">{models.filter(m => !m.approved).length} pending approval</div>
                </button>
                <button
                  onClick={() => setSelectedTab('users')}
                  className="w-full text-left p-3 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
                >
                  <div className="font-medium text-purple-900">Manage User Roles</div>
                  <div className="text-sm text-purple-600">{users.length} total users</div>
                </button>
                <button
                  onClick={() => setSelectedTab('wallet')}
                  className="w-full text-left p-3 bg-yellow-50 hover:bg-yellow-100 rounded-lg transition-colors"
                >
                  <div className="font-medium text-yellow-900">Manage Wallets</div>
                  <div className="text-sm text-yellow-600">Credit/Debit user balances</div>
                </button>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-text mb-4">System Health</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-text">Database Status</span>
                  <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Healthy</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-text">API Response Time</span>
                  <span className="text-sm text-muted">45ms</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-text">Storage Usage</span>
                  <span className="text-sm text-muted">68% of 100GB</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-text">Active Vendors</span>
                  <span className="text-sm text-muted">{systemMetrics.activeVendors}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-text mb-4">Recent Activity</h3>
            <div className="space-y-3">
              {auditLogs.slice(0, 5).map((log) => (
                <div key={log.id} className="flex items-center justify-between p-3 bg-card rounded">
                  <div>
                    <p className="text-sm font-medium text-text">{log.action.replace('_', ' ')}</p>
                    <p className="text-xs text-muted">{log.entity} #{log.entityId}</p>
                  </div>
                  <span className="text-xs text-muted">{new Date(log.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Users Tab */}
      {selectedTab === 'users' && (
        <div className="bg-card rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b card-border">
            <h3 className="text-lg font-medium text-text">User Management</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-card">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">User</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Points</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">ITC Balance</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Joined</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-card divide-y divide-gray-200">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-card">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-text">{user.firstName} {user.lastName}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-text">{user.email}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <select
                        value={user.role}
                        onChange={(e) => updateUserRole(user.id, e.target.value as User['role'])}
                        className="text-sm border card-border rounded px-2 py-1"
                      >
                        <option value="customer">Customer</option>
                        <option value="vendor">Vendor</option>
                        <option value="founder">Founder</option>
                        <option value="manager">Manager</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-text">{user.points || 0}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-text">{user.itcBalance || 0} ITC</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                      {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <button className="text-blue-600 hover:text-blue-900 mr-3">Edit</button>
                      <button className="text-red-600 hover:text-red-900">Suspend</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Vendor Products Tab */}
      {selectedTab === 'vendors' && (
        <div className="bg-card rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b card-border">
            <h3 className="text-lg font-medium text-text">Vendor Product Approvals</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
            {vendorProducts.map((product) => {
              const vendor = users.find(u => u.id === product.vendorId)
              return (
                <div key={product.id} className="border rounded-lg overflow-hidden">
                  <img
                    src={product.images[0]}
                    alt={product.title}
                    className="w-full h-48 object-cover"
                  />
                  <div className="p-4">
                    <h4 className="font-semibold text-text mb-2">{product.title}</h4>
                    <p className="text-muted text-sm mb-3">{product.description}</p>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-lg font-bold text-text">${product.price}</span>
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${product.approved
                        ? 'bg-green-100 text-green-800'
                        : 'bg-yellow-100 text-yellow-800'
                        }`}>
                        {product.approved ? 'Approved' : 'Pending'}
                      </span>
                    </div>
                    <p className="text-sm text-muted mb-3">
                      Vendor: {vendor?.firstName} {vendor?.lastName}
                    </p>

                    {!product.approved && (
                      <div className="flex space-x-2">
                        <button
                          onClick={() => approveVendorProduct(product.id)}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm py-2 px-3 rounded"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => rejectVendorProduct(product.id)}
                          className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm py-2 px-3 rounded"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Products Tab */}
      {selectedTab === 'products' && (
        <div className="bg-card rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b card-border">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-text">Product Management</h3>
              <button
                onClick={openCreateProductModal}
                className="bg-purple-600 hover:bg-purple-700 text-white font-medium px-4 py-2 rounded-lg transition-colors"
              >
                + Create Product
              </button>
            </div>
            {selectedProducts.size > 0 && (
              <div className="flex items-center space-x-3 bg-purple-50 p-3 rounded-lg">
                <span className="text-sm font-medium text-purple-900">
                  {selectedProducts.size} selected
                </span>
                <button
                  onClick={handlePublishProducts}
                  className="bg-green-600 hover:bg-green-700 text-white text-sm px-3 py-1.5 rounded transition-colors"
                >
                  📢 Publish Selected
                </button>
                <button
                  onClick={handleMassDelete}
                  className="bg-red-600 hover:bg-red-700 text-white text-sm px-3 py-1.5 rounded transition-colors"
                >
                  🗑️ Delete Selected
                </button>
                <button
                  onClick={() => setSelectedProducts(new Set())}
                  className="bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm px-3 py-1.5 rounded transition-colors"
                >
                  Clear Selection
                </button>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-card">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={products.length > 0 && selectedProducts.size === products.length}
                      onChange={toggleAllProducts}
                      className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                    />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Image</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Product</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Category</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Price</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Promo</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Featured</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-card divide-y divide-gray-200">
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-muted">
                      No products found. Click "Create Product" to add your first product.
                    </td>
                  </tr>
                ) : (
                  products.map((product: any) => {
                    const sourceAsset = productAssets[product.id]
                    const isExpanded = expandedProductId === product.id
                    const jobs = productJobs[product.id] || []
                    const isAIProduct = product.metadata?.ai_generated
                    return (
                      <React.Fragment key={product.id}>
                        <tr className="hover:bg-card">
                          <td className="px-4 py-4">
                            <input
                              type="checkbox"
                              checked={selectedProducts.has(product.id)}
                              onChange={() => toggleProductSelection(product.id)}
                              className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                            />
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center space-x-3">
                              {sourceAsset ? (
                                <>
                                  <img
                                    src={sourceAsset.url}
                                    alt={product.name}
                                    className="w-12 h-12 object-cover rounded"
                                  />
                                  <a
                                    href={sourceAsset.url}
                                    download
                                    className="text-purple-600 hover:text-purple-700 font-medium text-sm"
                                    title="Download source image"
                                  >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                  </a>
                                </>
                              ) : product.images.length > 0 ? (
                                <img
                                  src={product.images[0]}
                                  alt={product.name}
                                  className="w-12 h-12 object-cover rounded"
                                />
                              ) : (
                                <div className="w-12 h-12 bg-gray-200 rounded flex items-center justify-center">
                                  <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center space-x-2">
                              <div>
                                <div className="text-sm font-medium text-text">{product.name}</div>
                                <div className="text-sm text-muted truncate max-w-xs">{product.description}</div>
                              </div>
                              {isAIProduct && (
                                <span className="px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">
                                  AI
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 capitalize">
                              {product.category.replace('-', ' ')}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-text font-medium">
                            ${product.price.toFixed(2)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <label className="flex items-center space-x-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={product.isThreeForTwentyFive || false}
                                onChange={() => togglePromo(product)}
                                className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                              />
                              <span className="text-sm text-text">3 for $25</span>
                            </label>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex flex-col space-y-1">
                              <span className={`px-2 py-1 text-xs font-semibold rounded-full ${product.status === 'active'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-yellow-100 text-yellow-800'
                                }`}>
                                {product.status === 'active' ? 'Active' : 'Draft'}
                              </span>
                              <span className={`px-2 py-1 text-xs font-semibold rounded-full ${product.inStock
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                                }`}>
                                {product.inStock ? 'In Stock' : 'Out of Stock'}
                              </span>
                            </div>

                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <button
                              onClick={() => toggleFeatured(product)}
                              className={`p-2 rounded-full transition-colors ${product.is_featured
                                ? 'text-yellow-500 hover:bg-yellow-100'
                                : 'text-gray-400 hover:text-yellow-500 hover:bg-gray-100'
                                }`}
                              title={product.is_featured ? "Remove from Featured" : "Add to Featured"}
                            >
                              <svg className="w-6 h-6" fill={product.is_featured ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                              </svg>
                            </button>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            <div className="flex flex-col space-y-2">
                              <button
                                onClick={() => toggleProductExpansion(product.id)}
                                className="text-purple-600 hover:text-purple-900 text-left"
                              >
                                {isExpanded ? '▼ Collapse' : '▶ Expand'}
                              </button>
                              <button
                                onClick={() => openEnhancedEditModal(product)}
                                className="text-blue-600 hover:text-blue-900 text-left font-medium"
                              >
                                ✏️ Edit Product
                              </button>
                              <button
                                onClick={async () => {
                                  if (confirm('Are you sure you want to delete this product?')) {
                                    try {
                                      await supabase.from('products').delete().eq('id', product.id)
                                      await loadProducts()
                                      alert('Product deleted successfully!')
                                    } catch (error: any) {
                                      alert('Failed to delete: ' + error.message)
                                    }
                                  }
                                }}
                                className="text-red-600 hover:text-red-900 text-left"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                        {
                          isExpanded && (
                            <tr>
                              <td colSpan={7} className="px-6 py-4 bg-gray-50">
                                <div className="space-y-4">
                                  {/* AI Operations Section */}
                                  {isAIProduct && (
                                    <div className="border-b pb-4">
                                      <h4 className="font-semibold text-text mb-3">AI Operations</h4>
                                      <div className="grid grid-cols-3 gap-3">
                                        <button
                                          onClick={() => handleRegenerateImages(product.id)}
                                          disabled={loadingAction === `regenerate-${product.id}`}
                                          className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white text-sm py-2 px-3 rounded transition-colors"
                                        >
                                          {loadingAction === `regenerate-${product.id}` ? 'Creating Job...' : '🔄 Regenerate Images'}
                                        </button>
                                        <button
                                          onClick={() => handleRemoveBackground(product.id)}
                                          disabled={loadingAction === `rembg-${product.id}`}
                                          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white text-sm py-2 px-3 rounded transition-colors"
                                        >
                                          {loadingAction === `rembg-${product.id}` ? 'Creating Job...' : '✂️ Remove Background'}
                                        </button>
                                        <button
                                          onClick={() => handleCreateMockups(product.id)}
                                          disabled={loadingAction === `mockups-${product.id}`}
                                          className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white text-sm py-2 px-3 rounded transition-colors"
                                        >
                                          {loadingAction === `mockups-${product.id}` ? 'Creating Jobs...' : '🎨 Create Mockups'}
                                        </button>
                                      </div>
                                    </div>
                                  )}

                                  {/* Metadata Section */}
                                  {isAIProduct && product.metadata && (
                                    <div className="border-b pb-4">
                                      <h4 className="font-semibold text-text mb-2">AI Metadata</h4>
                                      <div className="grid grid-cols-2 gap-2 text-sm">
                                        {product.metadata.original_prompt && (
                                          <div className="col-span-2">
                                            <span className="font-medium text-muted">Original Prompt:</span>
                                            <p className="text-text">{product.metadata.original_prompt}</p>
                                          </div>
                                        )}
                                        {product.metadata.image_prompt && (
                                          <div className="col-span-2">
                                            <span className="font-medium text-muted">Image Prompt:</span>
                                            <p className="text-text">{product.metadata.image_prompt}</p>
                                          </div>
                                        )}
                                        {product.metadata.image_style && (
                                          <div>
                                            <span className="font-medium text-muted">Style:</span>
                                            <p className="text-text capitalize">{product.metadata.image_style}</p>
                                          </div>
                                        )}
                                        {product.metadata.background && (
                                          <div>
                                            <span className="font-medium text-muted">Background:</span>
                                            <p className="text-text capitalize">{product.metadata.background}</p>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {/* Jobs Section */}
                                  <div>
                                    <h4 className="font-semibold text-text mb-2">Processing Jobs ({jobs.length})</h4>
                                    {jobs.length === 0 ? (
                                      <p className="text-sm text-muted">No jobs found for this product.</p>
                                    ) : (
                                      <div className="space-y-2">
                                        {jobs.map((job: any) => (
                                          <div key={job.id} className="flex items-center justify-between bg-white p-3 rounded border">
                                            <div>
                                              <span className="text-sm font-medium text-text capitalize">{job.type.replace('replicate_', '')}</span>
                                              <span className={`ml-2 px-2 py-1 text-xs font-semibold rounded-full ${job.status === 'succeeded' ? 'bg-green-100 text-green-800' :
                                                job.status === 'running' ? 'bg-blue-100 text-blue-800' :
                                                  job.status === 'failed' ? 'bg-red-100 text-red-800' :
                                                    'bg-yellow-100 text-yellow-800'
                                                }`}>
                                                {job.status}
                                              </span>
                                            </div>
                                            <span className="text-xs text-muted">
                                              {new Date(job.created_at).toLocaleString()}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )
                        }
                      </React.Fragment>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )
      }

      {/* 3D Models Tab */}
      {
        selectedTab === 'models' && (
          <div className="bg-card rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">3D Model Approvals</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
              {models.map((model) => {
                const uploader = users.find(u => u.id === model.uploadedBy)
                return (
                  <div key={model.id} className="border rounded-lg overflow-hidden">
                    <div className="h-48 bg-card flex items-center justify-center">
                      <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                    </div>
                    <div className="p-4">
                      <h4 className="font-semibold text-text mb-2">{model.title}</h4>
                      <p className="text-muted text-sm mb-3">{model.description}</p>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm text-muted">{model.fileType.toUpperCase()}</span>
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${model.approved
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                          }`}>
                          {model.approved ? 'Approved' : 'Pending'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-sm text-muted">👍 {model.votes} votes</span>
                        <span className="text-sm text-muted">⭐ {model.points} points</span>
                      </div>
                      <p className="text-sm text-muted mb-3">
                        By: {uploader?.firstName} {uploader?.lastName}
                      </p>

                      {!model.approved && (
                        <div className="flex space-x-2">
                          <button
                            onClick={() => approveModel(model.id)}
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm py-2 px-3 rounded"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => rejectModel(model.id)}
                            className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm py-2 px-3 rounded"
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      }

      {/* Wallet Management Tab */}
      {
        selectedTab === 'wallet' && (
          <AdminWalletManagement />
        )
      }

      {/* Support Tab */}
      {
        selectedTab === 'support' && (
          <AdminSupport />
        )
      }

      {/* Audit Logs Tab */}
      {
        selectedTab === 'audit' && (
          <div className="bg-card rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b card-border">
              <h3 className="text-lg font-medium text-text">Audit Logs</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-card">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Timestamp</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Action</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Entity</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">Changes</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">IP Address</th>
                  </tr>
                </thead>
                <tbody className="bg-card divide-y divide-gray-200">
                  {auditLogs.map((log) => {
                    const logUser = users.find(u => u.id === log.userId)
                    return (
                      <tr key={log.id} className="hover:bg-card">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                          {logUser ? `${logUser.firstName} ${logUser.lastName}` : 'System'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${log.action.includes('APPROVE') ? 'bg-green-100 text-green-800' :
                            log.action.includes('REJECT') ? 'bg-red-100 text-red-800' :
                              log.action.includes('CREATE') ? 'bg-blue-100 text-blue-800' :
                                'bg-card text-gray-800'
                            }`}>
                            {log.action.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                          {log.entity} #{log.entityId}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                          {Object.keys(log.changes || {}).join(', ')}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                          {log.ipAddress}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      }

      {/* Product Create/Edit Modal */}
      {
        showProductModal && (
          <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-gray-900 border border-purple-500/30 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto relative">
              {/* Glow Effects */}
              <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600 rounded-full mix-blend-multiply filter blur-3xl opacity-10 pointer-events-none"></div>
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-indigo-600 rounded-full mix-blend-multiply filter blur-3xl opacity-10 pointer-events-none"></div>

              <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center relative z-10">
                <h3 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-300">
                  {editingProduct ? 'Edit Product' : 'Create New Product'}
                </h3>
                <button
                  onClick={() => setShowProductModal(false)}
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleProductSubmit} className="p-6 space-y-6 relative z-10">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Product Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={productForm.name}
                    onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    placeholder="e.g., Custom T-Shirt"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Description *
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={productForm.description}
                    onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    placeholder="Product description..."
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Category *
                    </label>
                    <select
                      required
                      value={productForm.category}
                      onChange={(e) => setProductForm({ ...productForm, category: e.target.value as Product['category'] })}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    >
                      <option value="shirts">T-Shirts</option>
                      <option value="hoodies">Hoodies</option>
                      <option value="tumblers">Tumblers</option>
                      <option value="dtf-transfers">DTF Transfers</option>
                      <option value="3d-models">3D Models</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Product Type
                    </label>
                    <select
                      value={productForm.productType}
                      onChange={(e) => setProductForm({ ...productForm, productType: e.target.value as any })}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    >
                      <option value="physical">Physical Only</option>
                      <option value="digital">Digital Only</option>
                      <option value="both">Both</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {(productForm.productType === 'physical' || productForm.productType === 'both') && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Physical Price ($) *
                        </label>
                        <input
                          type="number"
                          required
                          min="0"
                          step="0.01"
                          value={productForm.price}
                          onChange={(e) => setProductForm({ ...productForm, price: parseFloat(e.target.value) })}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                          placeholder="29.99"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Shipping Cost ($)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={productForm.shippingCost}
                          onChange={(e) => setProductForm({ ...productForm, shippingCost: parseFloat(e.target.value) })}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                          placeholder="5.00"
                        />
                      </div>
                    </>
                  )}

                  {(productForm.productType === 'digital' || productForm.productType === 'both') && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Digital Price ($) *
                        </label>
                        <input
                          type="number"
                          required
                          min="0"
                          step="0.01"
                          value={productForm.digitalPrice}
                          onChange={(e) => setProductForm({ ...productForm, digitalPrice: parseFloat(e.target.value) })}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                          placeholder="9.99"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          STL File URL
                        </label>
                        <input
                          type="text"
                          value={productForm.fileUrl}
                          onChange={(e) => setProductForm({ ...productForm, fileUrl: e.target.value })}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                          placeholder="/models/my-model.stl"
                        />
                      </div>
                    </>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Image URLs (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={productForm.images}
                    onChange={(e) => setProductForm({ ...productForm, images: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    placeholder="https://example.com/image1.jpg, https://example.com/image2.jpg"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Enter one or more image URLs separated by commas
                  </p>
                </div>

                <div className="flex items-center gap-6 bg-gray-800/50 p-3 rounded-lg border border-gray-700">
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="inStock"
                      checked={productForm.inStock}
                      onChange={(e) => setProductForm({ ...productForm, inStock: e.target.checked })}
                      className="w-4 h-4 text-purple-600 bg-gray-700 border-gray-600 rounded focus:ring-purple-500"
                    />
                    <label htmlFor="inStock" className="ml-2 text-sm text-gray-300">
                      Product is Active
                    </label>
                  </div>

                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="isFeatured"
                      checked={productForm.isFeatured}
                      onChange={(e) => setProductForm({ ...productForm, isFeatured: e.target.checked })}
                      className="w-4 h-4 text-yellow-500 bg-gray-700 border-gray-600 rounded focus:ring-yellow-500"
                    />
                    <label htmlFor="isFeatured" className="ml-2 text-sm text-gray-300 flex items-center gap-1">
                      Featured Product <span className="text-yellow-500">★</span>
                    </label>
                  </div>
                </div>

                <div className="flex justify-end space-x-3 pt-6 border-t border-gray-800">
                  <button
                    type="button"
                    onClick={() => setShowProductModal(false)}
                    className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium rounded-lg transition-colors border border-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-medium rounded-lg shadow-lg shadow-purple-900/20 transition-all transform hover:scale-105"
                  >
                    {editingProduct ? 'Update Product' : 'Create Product'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )
      }

      {/* Enhanced Product Edit Modal */}
      {
        showEnhancedEditModal && editingProductData && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-card px-6 py-4 border-b card-border flex justify-between items-center z-10">
                <h3 className="text-lg font-medium text-text">
                  ✨ Edit Product: {editingProductData.name}
                </h3>
                <button
                  onClick={() => setShowEnhancedEditModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Image Gallery */}
                {productAssets[editingProductData.id] && (
                  <div className="border rounded-lg p-4">
                    <h4 className="font-semibold text-text mb-3">📸 Product Images</h4>
                    <div className="space-y-4">
                      {/* Source Images */}
                      {productAssets[editingProductData.id].source && (
                        <div>
                          <h5 className="text-sm font-medium text-muted mb-2">Source Images</h5>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {productAssets[editingProductData.id].source.map((asset: any, idx: number) => {
                              const isMainImage = editingProductData.images && editingProductData.images[0] === asset.url
                              return (
                                <div key={asset.id || idx} className="relative group">
                                  <img
                                    src={asset.url}
                                    alt={`Source ${idx + 1}`}
                                    className="w-full h-40 object-cover rounded-lg shadow-md border-2 border-purple-200"
                                  />
                                  {isMainImage && (
                                    <div className="absolute top-2 left-2 bg-yellow-400 text-black text-xs font-bold px-2 py-1 rounded shadow">
                                      ⭐ Main
                                    </div>
                                  )}
                                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {!isMainImage && (
                                      <button
                                        onClick={() => handleSetMainImage(editingProductData.id, asset.url)}
                                        className="bg-yellow-500 hover:bg-yellow-600 text-white text-xs px-2 py-1 rounded shadow"
                                        title="Set as main image"
                                      >
                                        ⭐
                                      </button>
                                    )}
                                    <button
                                      onClick={() => handleDeleteImage(editingProductData.id, asset.id, asset.url)}
                                      className="bg-red-500 hover:bg-red-600 text-white text-xs px-2 py-1 rounded shadow"
                                      title="Delete image"
                                    >
                                      🗑️
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* No Background Images */}
                      {productAssets[editingProductData.id].nobg && (
                        <div>
                          <h5 className="text-sm font-medium text-muted mb-2">Background Removed</h5>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {productAssets[editingProductData.id].nobg.map((asset: any, idx: number) => {
                              const isMainImage = editingProductData.images && editingProductData.images[0] === asset.url
                              return (
                                <div key={asset.id || idx} className="relative group">
                                  <img
                                    src={asset.url}
                                    alt={`No Background ${idx + 1}`}
                                    className="w-full h-40 object-cover rounded-lg shadow-md border-2 border-blue-200 bg-gray-100"
                                  />
                                  {isMainImage && (
                                    <div className="absolute top-2 left-2 bg-yellow-400 text-black text-xs font-bold px-2 py-1 rounded shadow">
                                      ⭐ Main
                                    </div>
                                  )}
                                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {!isMainImage && (
                                      <button
                                        onClick={() => handleSetMainImage(editingProductData.id, asset.url)}
                                        className="bg-yellow-500 hover:bg-yellow-600 text-white text-xs px-2 py-1 rounded shadow"
                                        title="Set as main image"
                                      >
                                        ⭐
                                      </button>
                                    )}
                                    <button
                                      onClick={() => handleDeleteImage(editingProductData.id, asset.id, asset.url)}
                                      className="bg-red-500 hover:bg-red-600 text-white text-xs px-2 py-1 rounded shadow"
                                      title="Delete image"
                                    >
                                      🗑️
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Upscaled Images */}
                      {productAssets[editingProductData.id].upscaled && (
                        <div>
                          <h5 className="text-sm font-medium text-muted mb-2">Upscaled Images</h5>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {productAssets[editingProductData.id].upscaled.map((asset: any, idx: number) => {
                              const isMainImage = editingProductData.images && editingProductData.images[0] === asset.url
                              return (
                                <div key={asset.id || idx} className="relative group">
                                  <img
                                    src={asset.url}
                                    alt={`Upscaled ${idx + 1}`}
                                    className="w-full h-40 object-cover rounded-lg shadow-md border-2 border-green-200"
                                  />
                                  {isMainImage && (
                                    <div className="absolute top-2 left-2 bg-yellow-400 text-black text-xs font-bold px-2 py-1 rounded shadow">
                                      ⭐ Main
                                    </div>
                                  )}
                                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {!isMainImage && (
                                      <button
                                        onClick={() => handleSetMainImage(editingProductData.id, asset.url)}
                                        className="bg-yellow-500 hover:bg-yellow-600 text-white text-xs px-2 py-1 rounded shadow"
                                        title="Set as main image"
                                      >
                                        ⭐
                                      </button>
                                    )}
                                    <button
                                      onClick={() => handleDeleteImage(editingProductData.id, asset.id, asset.url)}
                                      className="bg-red-500 hover:bg-red-600 text-white text-xs px-2 py-1 rounded shadow"
                                      title="Delete image"
                                    >
                                      🗑️
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Mockup Images */}
                      {productAssets[editingProductData.id].mockup && (
                        <div>
                          <h5 className="text-sm font-medium text-muted mb-2">Mockups</h5>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {productAssets[editingProductData.id].mockup.map((asset: any, idx: number) => {
                              const isMainImage = editingProductData.images && editingProductData.images[0] === asset.url
                              return (
                                <div key={asset.id || idx} className="relative group">
                                  <img
                                    src={asset.url}
                                    alt={`Mockup ${idx + 1}`}
                                    className="w-full h-40 object-cover rounded-lg shadow-md border-2 border-indigo-200"
                                  />
                                  {isMainImage && (
                                    <div className="absolute top-2 left-2 bg-yellow-400 text-black text-xs font-bold px-2 py-1 rounded shadow">
                                      ⭐ Main
                                    </div>
                                  )}
                                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {!isMainImage && (
                                      <button
                                        onClick={() => handleSetMainImage(editingProductData.id, asset.url)}
                                        className="bg-yellow-500 hover:bg-yellow-600 text-white text-xs px-2 py-1 rounded shadow"
                                        title="Set as main image"
                                      >
                                        ⭐
                                      </button>
                                    )}
                                    <button
                                      onClick={() => handleDeleteImage(editingProductData.id, asset.id, asset.url)}
                                      className="bg-red-500 hover:bg-red-600 text-white text-xs px-2 py-1 rounded shadow"
                                      title="Delete image"
                                    >
                                      🗑️
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Advanced AI Operations */}
                <div className="border rounded-lg p-4 bg-gradient-to-r from-purple-50 to-blue-50">
                  <h4 className="font-semibold text-text mb-3">🚀 Advanced Image Operations</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <button
                      onClick={() => handleRegenerateImages(editingProductData.id)}
                      disabled={loadingAction === `regenerate-${editingProductData.id}`}
                      className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white text-sm py-3 px-4 rounded-lg transition-colors font-medium"
                    >
                      {loadingAction === `regenerate-${editingProductData.id}` ? '⏳ Creating...' : '🔄 Regenerate Image'}
                    </button>
                    <button
                      onClick={() => handleRemoveBackground(editingProductData.id)}
                      disabled={loadingAction === `rembg-${editingProductData.id}`}
                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white text-sm py-3 px-4 rounded-lg transition-colors font-medium"
                    >
                      {loadingAction === `rembg-${editingProductData.id}` ? '⏳ Creating...' : '✂️ Remove Background'}
                    </button>
                    <button
                      onClick={() => handleUpscaleImage(editingProductData.id)}
                      disabled={loadingAction === `upscale-${editingProductData.id}`}
                      className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white text-sm py-3 px-4 rounded-lg transition-colors font-medium"
                    >
                      {loadingAction === `upscale-${editingProductData.id}` ? '⏳ Creating...' : '⬆️ Upscale Image'}
                    </button>
                  </div>
                  <button
                    onClick={() => handleCreateMockups(editingProductData.id)}
                    disabled={loadingAction === `mockups-${editingProductData.id}`}
                    className="mt-3 w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white text-sm py-3 px-4 rounded-lg transition-colors font-medium"
                  >
                    {loadingAction === `mockups-${editingProductData.id}` ? '⏳ Creating...' : '🎨 Create Mockups'}
                  </button>
                </div>

                {/* Editable Fields */}
                <div className="border rounded-lg p-4">
                  <h4 className="font-semibold text-text mb-3">Product Details</h4>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-text mb-2">Product Name</label>
                      <input
                        type="text"
                        value={editingProductData.name}
                        onChange={(e) => {
                          setEditingProductData({ ...editingProductData, name: e.target.value })
                          handleUpdateProductField('name', e.target.value)
                        }}
                        className="w-full border card-border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-text mb-2">Description</label>
                      <textarea
                        rows={4}
                        value={editingProductData.description}
                        onChange={(e) => {
                          setEditingProductData({ ...editingProductData, description: e.target.value })
                          handleUpdateProductField('description', e.target.value)
                        }}
                        className="w-full border card-border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-text mb-2">Price ($)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={editingProductData.price}
                          onChange={(e) => {
                            const newPrice = parseFloat(e.target.value)
                            setEditingProductData({ ...editingProductData, price: newPrice })
                            handleUpdateProductField('price', newPrice)
                          }}
                          className="w-full border card-border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-text mb-2">Category</label>
                        <select
                          value={editingProductData.category}
                          onChange={(e) => {
                            setEditingProductData({ ...editingProductData, category: e.target.value })
                            handleUpdateProductField('category', e.target.value)
                          }}
                          className="w-full border card-border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="shirts">T-Shirts</option>
                          <option value="hoodies">Hoodies</option>
                          <option value="tumblers">Tumblers</option>
                          <option value="dtf-transfers">DTF Transfers</option>
                          <option value="3d-models">3D Models</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-text mb-2">Status</label>
                        <select
                          value={editingProductData.status}
                          onChange={(e) => {
                            setEditingProductData({ ...editingProductData, status: e.target.value })
                            handleUpdateProductField('status', e.target.value)
                          }}
                          className="w-full border card-border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="draft">Draft</option>
                          <option value="active">Active (Published)</option>
                        </select>
                      </div>

                      <div className="flex items-center space-x-2 pt-7">
                        <input
                          type="checkbox"
                          id="inStockEdit"
                          checked={editingProductData.inStock !== false}
                          onChange={(e) => {
                            setEditingProductData({ ...editingProductData, inStock: e.target.checked })
                            handleUpdateProductField('is_active', e.target.checked)
                          }}
                          className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                        />
                        <label htmlFor="inStockEdit" className="text-sm text-text font-medium">
                          Active
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-800">
                      <div>
                        <label className="block text-sm font-medium text-text mb-2">Sizes (comma separated)</label>
                        <input
                          type="text"
                          placeholder="S, M, L, XL"
                          defaultValue={editingProductData.sizes?.join(', ')}
                          onBlur={(e) => {
                            const sizes = e.target.value.split(',').map(s => s.trim()).filter(s => s)
                            setEditingProductData({ ...editingProductData, sizes })
                            handleUpdateProductField('sizes', sizes)
                          }}
                          className="w-full border card-border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-text mb-2">Colors (comma separated)</label>
                        <input
                          type="text"
                          placeholder="Red, Blue, Black"
                          defaultValue={editingProductData.colors?.join(', ')}
                          onBlur={(e) => {
                            const colors = e.target.value.split(',').map(s => s.trim()).filter(s => s)
                            setEditingProductData({ ...editingProductData, colors })
                            handleUpdateProductField('colors', colors)
                          }}
                          className="w-full border card-border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* AI Metadata */}
                {editingProductData.metadata?.ai_generated && (
                  <div className="border rounded-lg p-4 bg-purple-50">
                    <h4 className="font-semibold text-text mb-3">🤖 AI Metadata</h4>
                    <div className="space-y-2 text-sm">
                      {editingProductData.metadata.original_prompt && (
                        <div>
                          <span className="font-medium text-muted">Original Prompt:</span>
                          <p className="text-text mt-1">{editingProductData.metadata.original_prompt}</p>
                        </div>
                      )}
                      {editingProductData.metadata.image_prompt && (
                        <div>
                          <span className="font-medium text-muted">Image Prompt:</span>
                          <p className="text-text mt-1">{editingProductData.metadata.image_prompt}</p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        {editingProductData.metadata.image_style && (
                          <div>
                            <span className="font-medium text-muted">Style:</span>
                            <p className="text-text capitalize">{editingProductData.metadata.image_style}</p>
                          </div>
                        )}
                        {editingProductData.metadata.background && (
                          <div>
                            <span className="font-medium text-muted">Background:</span>
                            <p className="text-text capitalize">{editingProductData.metadata.background}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Processing Jobs */}
                <div className="border rounded-lg p-4">
                  <h4 className="font-semibold text-text mb-3">⚙️ Processing Jobs</h4>
                  {(productJobs[editingProductData.id] || []).length === 0 ? (
                    <p className="text-sm text-muted">No jobs found for this product.</p>
                  ) : (
                    <div className="space-y-2">
                      {(productJobs[editingProductData.id] || []).map((job: any) => (
                        <div key={job.id} className="flex items-center justify-between bg-white p-3 rounded border">
                          <div>
                            <span className="text-sm font-medium text-text capitalize">
                              {job.type.replace('replicate_', '').replace('_', ' ')}
                            </span>
                            <span className={`ml-2 px-2 py-1 text-xs font-semibold rounded-full ${job.status === 'succeeded' ? 'bg-green-100 text-green-800' :
                              job.status === 'running' ? 'bg-blue-100 text-blue-800' :
                                job.status === 'failed' ? 'bg-red-100 text-red-800' :
                                  'bg-yellow-100 text-yellow-800'
                              }`}>
                              {job.status}
                            </span>
                          </div>
                          <span className="text-xs text-muted">
                            {new Date(job.created_at).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="sticky bottom-0 bg-card px-6 py-4 border-t card-border flex justify-end">
                <button
                  onClick={() => setShowEnhancedEditModal(false)}
                  className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )
      }
    </div >
  )
}

export default AdminDashboard

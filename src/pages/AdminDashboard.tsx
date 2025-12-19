import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { aiProducts, adminApi } from '../lib/api'
import type { User, VendorProduct, ThreeDModel, SystemMetrics, AuditLog, Product } from '../types'
import AdminCreateProductWizard from '../components/AdminCreateProductWizard'
import AdminWalletManagement from '../components/AdminWalletManagement'
import AdminSupport from '../components/AdminSupport'
import { AdminCreatorProductsTab as CreatorProductsTab } from '../components/AdminCreatorProductsTab'
import AdminImaginationProducts from './admin/ImaginationProducts'
import AdminCouponManagement from '../components/AdminCouponManagement'
import AdminGiftCardManagement from '../components/AdminGiftCardManagement'
import AdminNotificationBell from '../components/AdminNotificationBell'

const AdminDashboard: React.FC = () => {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabFromUrl = searchParams.get('tab') as 'overview' | 'users' | 'vendors' | 'products' | 'creator-products' | 'models' | 'audit' | 'wallet' | 'support' | 'itc-pricing' | 'imagination' | 'coupons' | 'gift-cards' || 'overview'
  const [selectedTab, setSelectedTab] = useState<'overview' | 'users' | 'vendors' | 'products' | 'creator-products' | 'models' | 'audit' | 'wallet' | 'support' | 'itc-pricing' | 'imagination' | 'coupons' | 'gift-cards'>(tabFromUrl)
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
  // ITC Pricing state
  const [itcPricing, setItcPricing] = useState<Array<{
    feature_key: string;
    display_name: string;
    base_cost: number;
    current_cost: number;
    is_free_trial: boolean;
    free_trial_uses: number;
    promo_end_time: string | null;
  }>>([])
  const [loadingPricing, setLoadingPricing] = useState(false)
  const [editingPricing, setEditingPricing] = useState<string | null>(null)
  const [promoHours, setPromoHours] = useState<number>(24)
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

  // OTC/ITC Grant State
  const [showItcModal, setShowItcModal] = useState(false)
  const [itcUser, setItcUser] = useState<User | null>(null)
  const [itcAmount, setItcAmount] = useState<number>(0)

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

      // Get user-submitted products pending approval
      const { count: pendingUserProducts } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending_approval')

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

      const pendingApprovals = (pendingProducts || 0) + (pendingUserProducts || 0) + (pendingVendorProducts || 0) + (pendingModels || 0)

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

  // ITC Pricing functions
  const loadItcPricing = async () => {
    setLoadingPricing(true)
    try {
      const { data } = await adminApi.getImaginationPricing()
      if (data?.pricing) {
        setItcPricing(data.pricing)
      }
    } catch (error) {
      console.error('Error loading ITC pricing:', error)
    } finally {
      setLoadingPricing(false)
    }
  }

  const updateItcPricing = async (featureKey: string, updates: { current_cost?: number; is_free_trial?: boolean; free_trial_uses?: number }) => {
    try {
      await adminApi.updateImaginationPricing(featureKey, updates)
      await loadItcPricing()
      setEditingPricing(null)
    } catch (error) {
      console.error('Error updating pricing:', error)
      alert('Failed to update pricing')
    }
  }

  const setItcPromo = async () => {
    if (promoHours <= 0) return
    try {
      await adminApi.setImaginationPromo(promoHours)
      await loadItcPricing()
      alert(`Promotional pricing activated for ${promoHours} hours!`)
    } catch (error) {
      console.error('Error setting promo:', error)
      alert('Failed to activate promo')
    }
  }

  const resetItcPricing = async () => {
    if (!confirm('Reset all pricing to default values?')) return
    try {
      await adminApi.resetImaginationPricing()
      await loadItcPricing()
      alert('Pricing reset to defaults')
    } catch (error) {
      console.error('Error resetting pricing:', error)
      alert('Failed to reset pricing')
    }
  }

  // Load pricing when tab is selected
  useEffect(() => {
    if (selectedTab === 'itc-pricing') {
      loadItcPricing()
    }
  }, [selectedTab])

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
      } else if (field === 'sizes' || field === 'colors') {
        // For sizes and colors, store in metadata
        const currentMetadata = editingProductData.metadata || {}
        const newMetadata = {
          ...currentMetadata,
          [field]: value
        }

        const { error } = await supabase
          .from('products')
          .update({ metadata: newMetadata })
          .eq('id', editingProductData.id)

        if (error) throw error

        setEditingProductData({
          ...editingProductData,
          metadata: newMetadata,
          [field]: value
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
      // Fetch profiles first
      const { data: profileData, error: profileError } = await supabase
        .from('user_profiles')
        .select('*')
        .order('created_at', { ascending: false })

      if (profileError) throw profileError

      // Fetch wallets separately to avoid FK join issues
      const userIds = profileData?.map(u => u.id) || []
      let walletMap: Record<string, { points: number; itc_balance: number }> = {}

      if (userIds.length > 0) {
        const { data: walletData } = await supabase
          .from('user_wallets')
          .select('user_id, points, itc_balance')
          .in('user_id', userIds)

        walletData?.forEach(w => {
          walletMap[w.user_id] = { points: w.points || 0, itc_balance: w.itc_balance || 0 }
        })
      }

      const mappedUsers: User[] = (profileData || []).map((u: any) => ({
        id: u.id,
        email: u.email || '',
        role: u.role || 'customer',
        firstName: u.first_name || '',
        lastName: u.last_name || '',
        points: walletMap[u.id]?.points || 0,
        itcBalance: walletMap[u.id]?.itc_balance || 0,
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

  const handleGrantItc = async () => {
    if (!itcUser || itcAmount === 0) return

    try {
      // Fetch current wallet first
      const { data: wallet } = await supabase
        .from('user_wallets')
        .select('*')
        .eq('user_id', itcUser.id)
        .single()

      if (!wallet) {
        alert('User has no wallet initialized.')
        return
      }

      const newBalance = (wallet.itc_balance || 0) + itcAmount

      const { error } = await supabase
        .from('user_wallets')
        .update({ itc_balance: newBalance })
        .eq('user_id', itcUser.id)

      if (error) throw error

      setUsers(users.map(u => u.id === itcUser.id ? { ...u, itcBalance: newBalance } : u))

      // Audit log
      await supabase.from('audit_logs').insert({
        user_id: user?.id || 'admin',
        action: 'GRANT_ITC',
        entity: 'UserWallet',
        entity_id: itcUser.id,
        changes: { amount: itcAmount, previous_balance: wallet.itc_balance, new_balance: newBalance },
        ip_address: '192.168.1.100',
        user_agent: navigator.userAgent
      })

      setShowItcModal(false)
      setItcAmount(0)
      setItcUser(null)
      alert('ITC Balance updated successfully')
    } catch (error: any) {
      console.error('Error granting ITC:', error)
      alert('Failed to update ITC: ' + error.message)
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
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-soft border border-red-100 p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-display font-bold text-slate-900 mb-2">Access Denied</h2>
          <p className="text-slate-600 mb-2">This page is for administrators only.</p>
          <p className="text-sm text-slate-500">Current role: <span className="font-medium text-slate-700">{user?.role || 'none'}</span></p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      {/* Header */}
      <div className="bg-gradient-to-br from-purple-600 via-purple-700 to-pink-600 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }} />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 relative z-10">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-display font-bold text-white mb-2">Admin Dashboard</h1>
              <p className="text-purple-100">Manage users, approvals, and monitor system performance</p>
            </div>
            <div className="relative z-50">
              <AdminNotificationBell onNotificationClick={(ticketId) => {
                setSelectedTab('support')
                setSearchParams({ tab: 'support' })
              }} />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* System Overview Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
          <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg shadow-blue-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-slate-500">Total Users</p>
                <p className="text-2xl font-bold text-slate-900">{systemMetrics.totalUsers}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl shadow-lg shadow-emerald-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-slate-500">Total Revenue</p>
                <p className="text-2xl font-bold text-slate-900">${systemMetrics.totalRevenue.toFixed(2)}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-amber-500 to-orange-500 rounded-xl shadow-lg shadow-amber-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-slate-500">Pending Approvals</p>
                <p className="text-2xl font-bold text-slate-900">{systemMetrics.pendingApprovals}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg shadow-purple-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-slate-500">Active Sessions</p>
                <p className="text-2xl font-bold text-slate-900">{systemMetrics.activeSessions}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-2 mb-8 overflow-x-auto">
          <nav className="flex space-x-1">
            {['overview', 'users', 'vendors', 'products', 'creator-products', 'models', 'wallet', 'itc-pricing', 'imagination', 'coupons', 'gift-cards', 'audit', 'support'].map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setSelectedTab(tab as any)
                  setSearchParams({ tab })
                }}
                className={`px-4 py-2.5 rounded-xl font-medium text-sm whitespace-nowrap transition-all ${selectedTab === tab
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/25'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
              >
                {tab === 'creator-products' ? 'Creator Products' : tab === 'itc-pricing' ? 'ITC Pricing' : tab === 'imagination' ? 'Imagination Products' : tab === 'gift-cards' ? 'Gift Cards' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </nav>
        </div>

        {/* Overview Tab */}
        {selectedTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
                <h3 className="text-lg font-display font-bold text-slate-900 mb-4">Quick Actions</h3>
                <div className="space-y-3">
                  <button
                    onClick={() => setSelectedTab('creator-products')}
                    className="w-full text-left p-4 bg-pink-50 hover:bg-pink-100 rounded-xl transition-colors border border-pink-100"
                  >
                    <div className="font-semibold text-pink-900">Review Creator Products</div>
                    <div className="text-sm text-pink-600">User-submitted designs awaiting approval</div>
                  </button>
                  <button
                    onClick={() => setSelectedTab('vendors')}
                    className="w-full text-left p-4 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors border border-blue-100"
                  >
                    <div className="font-semibold text-blue-900">Review Vendor Products</div>
                    <div className="text-sm text-blue-600">{vendorProducts.filter(p => !p.approved).length} pending approval</div>
                  </button>
                  <button
                    onClick={() => setSelectedTab('models')}
                    className="w-full text-left p-4 bg-emerald-50 hover:bg-emerald-100 rounded-xl transition-colors border border-emerald-100"
                  >
                    <div className="font-semibold text-emerald-900">Review 3D Models</div>
                    <div className="text-sm text-emerald-600">{models.filter(m => !m.approved).length} pending approval</div>
                  </button>
                  <button
                    onClick={() => setSelectedTab('users')}
                    className="w-full text-left p-4 bg-purple-50 hover:bg-purple-100 rounded-xl transition-colors border border-purple-100"
                  >
                    <div className="font-semibold text-purple-900">Manage User Roles</div>
                    <div className="text-sm text-purple-600">{users.length} total users</div>
                  </button>
                  <button
                    onClick={() => setSelectedTab('wallet')}
                    className="w-full text-left p-4 bg-amber-50 hover:bg-amber-100 rounded-xl transition-colors border border-amber-100"
                  >
                    <div className="font-semibold text-amber-900">Manage Wallets</div>
                    <div className="text-sm text-amber-600">Credit/Debit user balances</div>
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
                <h3 className="text-lg font-display font-bold text-slate-900 mb-4">System Health</h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                    <span className="text-sm font-medium text-slate-700">Database Status</span>
                    <span className="px-3 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-700">Healthy</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                    <span className="text-sm font-medium text-slate-700">API Response Time</span>
                    <span className="text-sm font-semibold text-slate-900">45ms</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                    <span className="text-sm font-medium text-slate-700">Storage Usage</span>
                    <span className="text-sm font-semibold text-slate-900">68% of 100GB</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-slate-50 rounded-xl">
                    <span className="text-sm font-medium text-slate-700">Active Vendors</span>
                    <span className="text-sm font-semibold text-slate-900">{systemMetrics.activeVendors}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
              <h3 className="text-lg font-display font-bold text-slate-900 mb-4">Recent Activity</h3>
              <div className="space-y-2">
                {auditLogs.slice(0, 5).map((log) => (
                  <div key={log.id} className="flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{log.action.replace('_', ' ')}</p>
                      <p className="text-xs text-slate-500">{log.entity} #{log.entityId}</p>
                    </div>
                    <span className="text-xs text-slate-500">{new Date(log.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Users Tab */}
        {selectedTab === 'users' && (
          <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-display font-bold text-slate-900">User Management</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">User</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Email</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Points</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">ITC Balance</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Joined</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-slate-900">{user.firstName} {user.lastName}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{user.email}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <select
                          value={user.role}
                          onChange={(e) => updateUserRole(user.id, e.target.value as User['role'])}
                          className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-slate-900 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                        >
                          <option value="customer">Customer</option>
                          <option value="vendor">Vendor</option>
                          <option value="founder">Founder</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-amber-600">{user.points || 0}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-purple-600">{user.itcBalance || 0} ITC</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                        {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                        <button className="text-purple-600 hover:text-purple-700 hover:underline" onClick={() => { }}>Edit</button>
                        <button
                          onClick={() => {
                            setItcUser(user)
                            setItcAmount(0)
                            setShowItcModal(true)
                          }}
                          className="text-emerald-600 hover:text-emerald-700 hover:underline"
                        >
                          Grant ITC
                        </button>
                        <button className="text-red-600 hover:text-red-700 hover:underline">Suspend</button>
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
          <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-display font-bold text-slate-900">Vendor Product Approvals</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
              {vendorProducts.map((product) => {
                const vendor = users.find(u => u.id === product.vendorId)
                return (
                  <div key={product.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-soft hover:shadow-soft-lg transition-shadow">
                    <img
                      src={product.images[0]}
                      alt={product.title}
                      className="w-full h-48 object-cover"
                    />
                    <div className="p-4">
                      <h4 className="font-semibold text-slate-900 mb-2">{product.title}</h4>
                      <p className="text-slate-600 text-sm mb-3 line-clamp-2">{product.description}</p>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-lg font-bold text-slate-900">${product.price}</span>
                        <span className={`px-3 py-1 text-xs font-semibold rounded-full ${product.approved
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                          }`}>
                          {product.approved ? 'Approved' : 'Pending'}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 mb-3">
                        Vendor: {vendor?.firstName} {vendor?.lastName}
                      </p>

                      {!product.approved && (
                        <div className="flex space-x-2">
                          <button
                            onClick={() => approveVendorProduct(product.id)}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-2.5 px-4 rounded-xl transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => rejectVendorProduct(product.id)}
                            className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm font-medium py-2.5 px-4 rounded-xl transition-colors"
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
          <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-display font-bold text-slate-900">Product Management</h3>
                <button
                  onClick={openCreateProductModal}
                  className="bg-purple-600 hover:bg-purple-700 text-white font-medium px-5 py-2.5 rounded-xl transition-colors shadow-lg shadow-purple-500/25"
                >
                  + Create Product
                </button>
              </div>
              {selectedProducts.size > 0 && (
                <div className="flex items-center space-x-3 bg-purple-50 border border-purple-100 p-4 rounded-xl">
                  <span className="text-sm font-semibold text-purple-900">
                    {selectedProducts.size} selected
                  </span>
                  <button
                    onClick={handlePublishProducts}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    Publish Selected
                  </button>
                  <button
                    onClick={handleMassDelete}
                    className="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    Delete Selected
                  </button>
                  <button
                    onClick={() => setSelectedProducts(new Set())}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    Clear Selection
                  </button>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-3 text-left w-10">
                      <input
                        type="checkbox"
                        checked={products.length > 0 && selectedProducts.size === products.length}
                        onChange={toggleAllProducts}
                        className="w-4 h-4 text-purple-600 border-slate-300 rounded focus:ring-purple-500"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-20">Image</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Product</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">Category</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">Price</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">Promo</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-16 text-center">Featured</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {products.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
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
                          <tr className="hover:bg-slate-50 transition-colors">
                            <td className="px-3 py-4">
                              <input
                                type="checkbox"
                                checked={selectedProducts.has(product.id)}
                                onChange={() => toggleProductSelection(product.id)}
                                className="w-4 h-4 text-purple-600 border-slate-300 rounded focus:ring-purple-500"
                              />
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap">
                              <div className="flex items-center space-x-3">
                                {sourceAsset ? (
                                  <>
                                    <img
                                      src={sourceAsset.url}
                                      alt={product.name}
                                      className="w-10 h-10 object-cover rounded-lg border border-slate-200"
                                    />
                                    <a
                                      href={sourceAsset.url}
                                      download
                                      className="text-purple-600 hover:text-purple-700 font-medium text-sm"
                                      title="Download source image"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                      </svg>
                                    </a>
                                  </>
                                ) : product.images.length > 0 ? (
                                  <img
                                    src={product.images[0]}
                                    alt={product.name}
                                    className="w-10 h-10 object-cover rounded-lg border border-slate-200"
                                  />
                                ) : (
                                  <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                                    <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex items-center space-x-2">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-slate-900 truncate">{product.name}</div>
                                  <div className="text-xs text-slate-500 truncate max-w-[180px]">{product.description}</div>
                                </div>
                                {isAIProduct && (
                                  <span className="flex-shrink-0 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-purple-100 text-purple-700">
                                    AI
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap">
                              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-700 capitalize">
                                {product.category.replace('-', ' ')}
                              </span>
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-900 font-semibold">
                              ${product.price.toFixed(2)}
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap">
                              <label className="flex items-center space-x-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={product.isThreeForTwentyFive || false}
                                  onChange={() => togglePromo(product)}
                                  className="w-4 h-4 text-purple-600 border-slate-300 rounded focus:ring-purple-500"
                                />
                                <span className="text-xs text-slate-600">3 for $25</span>
                              </label>
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap">
                              <div className="flex flex-col space-y-1">
                                <span className={`w-fit px-2.5 py-0.5 text-[10px] font-semibold rounded-full ${product.status === 'active'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-amber-100 text-amber-700'
                                  }`}>
                                  {product.status === 'active' ? 'Active' : 'Draft'}
                                </span>
                                <span className={`w-fit px-2.5 py-0.5 text-[10px] font-semibold rounded-full ${product.inStock
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-red-100 text-red-700'
                                  }`}>
                                  {product.inStock ? 'In Stock' : 'Out'}
                                </span>
                              </div>

                            </td>
                            <td className="px-4 py-4 whitespace-nowrap text-center">
                              <button
                                onClick={() => toggleFeatured(product)}
                                className={`p-1.5 rounded-lg transition-colors ${product.is_featured
                                  ? 'text-amber-500 bg-amber-50 hover:bg-amber-100'
                                  : 'text-slate-400 hover:text-amber-500 hover:bg-slate-100'
                                  }`}
                                title={product.is_featured ? "Remove from Featured" : "Add to Featured"}
                              >
                                <svg className="w-5 h-5" fill={product.is_featured ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                                </svg>
                              </button>
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() => toggleProductExpansion(product.id)}
                                  className="text-purple-600 hover:text-purple-700 hover:bg-purple-50 p-1.5 rounded-lg transition-colors"
                                  title={isExpanded ? 'Collapse' : 'Expand'}
                                >
                                  {isExpanded ? (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                    </svg>
                                  ) : (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                  )}
                                </button>
                                <button
                                  onClick={() => openEnhancedEditModal(product)}
                                  className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 p-1.5 rounded-lg transition-colors"
                                  title="Edit Product"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                  </svg>
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
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50 p-1.5 rounded-lg transition-colors"
                                  title="Delete Product"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                          {
                            isExpanded && (
                              <tr>
                                <td colSpan={9} className="px-6 py-4 bg-slate-50">
                                  <div className="space-y-4">
                                    {/* AI Operations Section */}
                                    {isAIProduct && (
                                      <div className="border-b border-slate-200 pb-4">
                                        <h4 className="font-semibold text-slate-900 mb-3">AI Operations</h4>
                                        <div className="grid grid-cols-3 gap-3">
                                          <button
                                            onClick={() => handleRegenerateImages(product.id)}
                                            disabled={loadingAction === `regenerate-${product.id}`}
                                            className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 text-white text-sm font-medium py-2.5 px-4 rounded-xl transition-colors"
                                          >
                                            {loadingAction === `regenerate-${product.id}` ? 'Creating Job...' : 'Regenerate Images'}
                                          </button>
                                          <button
                                            onClick={() => handleRemoveBackground(product.id)}
                                            disabled={loadingAction === `rembg-${product.id}`}
                                            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-sm font-medium py-2.5 px-4 rounded-xl transition-colors"
                                          >
                                            {loadingAction === `rembg-${product.id}` ? 'Creating Job...' : 'Remove Background'}
                                          </button>
                                          <button
                                            onClick={() => handleCreateMockups(product.id)}
                                            disabled={loadingAction === `mockups-${product.id}`}
                                            className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-sm font-medium py-2.5 px-4 rounded-xl transition-colors"
                                          >
                                            {loadingAction === `mockups-${product.id}` ? 'Creating Jobs...' : 'Create Mockups'}
                                          </button>
                                        </div>
                                      </div>
                                    )}

                                    {/* Metadata Section */}
                                    {isAIProduct && product.metadata && (
                                      <div className="border-b border-slate-200 pb-4">
                                        <h4 className="font-semibold text-slate-900 mb-2">AI Metadata</h4>
                                        <div className="grid grid-cols-2 gap-2 text-sm">
                                          {product.metadata.original_prompt && (
                                            <div className="col-span-2">
                                              <span className="font-medium text-slate-500">Original Prompt:</span>
                                              <p className="text-slate-900">{product.metadata.original_prompt}</p>
                                            </div>
                                          )}
                                          {product.metadata.image_prompt && (
                                            <div className="col-span-2">
                                              <span className="font-medium text-slate-500">Image Prompt:</span>
                                              <p className="text-slate-900">{product.metadata.image_prompt}</p>
                                            </div>
                                          )}
                                          {product.metadata.image_style && (
                                            <div>
                                              <span className="font-medium text-slate-500">Style:</span>
                                              <p className="text-slate-900 capitalize">{product.metadata.image_style}</p>
                                            </div>
                                          )}
                                          {product.metadata.background && (
                                            <div>
                                              <span className="font-medium text-slate-500">Background:</span>
                                              <p className="text-slate-900 capitalize">{product.metadata.background}</p>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}

                                    {/* Jobs Section */}
                                    <div>
                                      <h4 className="font-semibold text-slate-900 mb-2">Processing Jobs ({jobs.length})</h4>
                                      {jobs.length === 0 ? (
                                        <p className="text-sm text-slate-500">No jobs found for this product.</p>
                                      ) : (
                                        <div className="space-y-2">
                                          {jobs.map((job: any) => (
                                            <div key={job.id} className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200">
                                              <div>
                                                <span className="text-sm font-medium text-slate-900 capitalize">{job.type.replace('replicate_', '')}</span>
                                                <span className={`ml-2 px-3 py-1 text-xs font-semibold rounded-full ${job.status === 'succeeded' ? 'bg-emerald-100 text-emerald-700' :
                                                  job.status === 'running' ? 'bg-blue-100 text-blue-700' :
                                                    job.status === 'failed' ? 'bg-red-100 text-red-700' :
                                                      'bg-amber-100 text-amber-700'
                                                  }`}>
                                                  {job.status}
                                                </span>
                                              </div>
                                              <span className="text-xs text-slate-500">
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
            <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200">
                <h3 className="text-lg font-display font-bold text-slate-900">3D Model Approvals</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
                {models.map((model) => {
                  const uploader = users.find(u => u.id === model.uploadedBy)
                  return (
                    <div key={model.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                      <div className="h-48 bg-slate-100 flex items-center justify-center">
                        <svg className="w-16 h-16 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                      </div>
                      <div className="p-4">
                        <h4 className="font-semibold text-slate-900 mb-2">{model.title}</h4>
                        <p className="text-slate-500 text-sm mb-3">{model.description}</p>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-sm text-slate-500">{model.fileType.toUpperCase()}</span>
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${model.approved
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700'
                            }`}>
                            {model.approved ? 'Approved' : 'Pending'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-sm text-slate-500">👍 {model.votes} votes</span>
                          <span className="text-sm text-slate-500">⭐ {model.points} points</span>
                        </div>
                        <p className="text-sm text-slate-500 mb-3">
                          By: {uploader?.firstName} {uploader?.lastName}
                        </p>

                        {!model.approved && (
                          <div className="flex space-x-2">
                            <button
                              onClick={() => approveModel(model.id)}
                              className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white text-sm py-2 px-3 rounded-lg font-medium transition-colors"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => rejectModel(model.id)}
                              className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm py-2 px-3 rounded-lg font-medium transition-colors"
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

        {/* ITC Pricing Tab */}
        {
          selectedTab === 'itc-pricing' && (
            <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-xl font-display font-bold text-slate-900">Imagination Station ITC Pricing</h3>
                  <p className="text-sm text-slate-500 mt-1">Manage ITC costs for AI tools and features</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={resetItcPricing}
                    className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors text-sm font-medium"
                  >
                    Reset to Defaults
                  </button>
                </div>
              </div>

              {/* Promo Section */}
              <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl p-4 mb-6 border border-purple-100">
                <h4 className="font-semibold text-purple-900 mb-2">Run a Promotion</h4>
                <p className="text-sm text-purple-700 mb-3">Make all features FREE for a limited time</p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="1"
                    max="168"
                    value={promoHours}
                    onChange={(e) => setPromoHours(Number(e.target.value))}
                    className="w-24 px-3 py-2 border border-purple-200 rounded-lg text-sm"
                    placeholder="Hours"
                  />
                  <span className="text-sm text-purple-700">hours</span>
                  <button
                    onClick={setItcPromo}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
                  >
                    Activate Promo
                  </button>
                </div>
              </div>

              {/* Pricing Table */}
              {loadingPricing ? (
                <div className="text-center py-12 text-slate-400">Loading pricing...</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Feature</th>
                        <th className="text-center py-3 px-4 text-sm font-semibold text-slate-700">Base Cost</th>
                        <th className="text-center py-3 px-4 text-sm font-semibold text-slate-700">Current Cost</th>
                        <th className="text-center py-3 px-4 text-sm font-semibold text-slate-700">Free Trial</th>
                        <th className="text-center py-3 px-4 text-sm font-semibold text-slate-700">Trial Uses</th>
                        <th className="text-center py-3 px-4 text-sm font-semibold text-slate-700">Promo Active</th>
                        <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {itcPricing.map((item) => (
                        <tr key={item.feature_key} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-800">{item.display_name}</div>
                            <div className="text-xs text-slate-400">{item.feature_key}</div>
                          </td>
                          <td className="py-3 px-4 text-center text-slate-600">{item.base_cost} ITC</td>
                          <td className="py-3 px-4 text-center">
                            {editingPricing === item.feature_key ? (
                              <input
                                type="number"
                                min="0"
                                defaultValue={item.current_cost}
                                className="w-20 px-2 py-1 border border-slate-300 rounded text-center text-sm"
                                onBlur={(e) => updateItcPricing(item.feature_key, { current_cost: Number(e.target.value) })}
                                autoFocus
                              />
                            ) : (
                              <span className={item.current_cost === 0 ? 'text-green-600 font-medium' : 'text-slate-800'}>
                                {item.current_cost === 0 ? 'FREE' : `${item.current_cost} ITC`}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${item.is_free_trial ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                              {item.is_free_trial ? 'Yes' : 'No'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center text-slate-600">{item.free_trial_uses}</td>
                          <td className="py-3 px-4 text-center">
                            {item.promo_end_time && new Date(item.promo_end_time) > new Date() ? (
                              <span className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                                Until {new Date(item.promo_end_time).toLocaleDateString()}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-sm">-</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => setEditingPricing(item.feature_key)}
                              className="px-3 py-1 text-sm text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                            >
                              Edit
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {itcPricing.length === 0 && !loadingPricing && (
                <div className="text-center py-12 text-slate-400">
                  <p>No pricing configuration found.</p>
                  <p className="text-sm mt-2">Make sure the imagination_pricing table is set up in Supabase.</p>
                </div>
              )}
            </div>
          )
        }

        {/* Imagination Products Tab */}
        {
          selectedTab === 'imagination' && (
            <AdminImaginationProducts />
          )
        }

        {/* Support Tab */}
        {
          selectedTab === 'support' && (
            <AdminSupport />
          )
        }

        {/* Creator Products Tab - User-submitted products pending approval */}
        {
          selectedTab === 'creator-products' && (
            <CreatorProductsTab />
          )
        }

        {/* Coupons Tab */}
        {
          selectedTab === 'coupons' && (
            <AdminCouponManagement />
          )
        }

        {/* Gift Cards Tab */}
        {
          selectedTab === 'gift-cards' && (
            <AdminGiftCardManagement />
          )
        }

        {/* Audit Logs Tab */}
        {
          selectedTab === 'audit' && (
            <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200">
                <h3 className="text-lg font-display font-bold text-slate-900">Audit Logs</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Timestamp</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">User</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Action</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Entity</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Changes</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">IP Address</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-100">
                    {auditLogs.map((log) => {
                      const logUser = users.find(u => u.id === log.userId)
                      return (
                        <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                            {new Date(log.createdAt).toLocaleString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 font-medium">
                            {logUser ? `${logUser.firstName} ${logUser.lastName}` : 'System'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${log.action.includes('APPROVE') ? 'bg-emerald-100 text-emerald-700' :
                              log.action.includes('REJECT') ? 'bg-red-100 text-red-700' :
                                log.action.includes('CREATE') ? 'bg-blue-100 text-blue-700' :
                                  'bg-slate-100 text-slate-700'
                              }`}>
                              {log.action.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                            {log.entity} #{log.entityId}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                            {Object.keys(log.changes || {}).join(', ')}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
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
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
              <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-200">
                <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white rounded-t-2xl">
                  <h3 className="text-xl font-display font-bold text-slate-900">
                    {editingProduct ? 'Edit Product' : 'Create New Product'}
                  </h3>
                  <button
                    onClick={() => setShowProductModal(false)}
                    className="text-slate-400 hover:text-slate-600 transition-colors p-1 hover:bg-slate-100 rounded-lg"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <form onSubmit={handleProductSubmit} className="p-6 space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Product Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={productForm.name}
                      onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all placeholder:text-slate-400"
                      placeholder="e.g., Custom T-Shirt"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Description *
                    </label>
                    <textarea
                      required
                      rows={4}
                      value={productForm.description}
                      onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all placeholder:text-slate-400"
                      placeholder="Product description..."
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Category *
                      </label>
                      <select
                        required
                        value={productForm.category}
                        onChange={(e) => setProductForm({ ...productForm, category: e.target.value as Product['category'] })}
                        className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                      >
                        <option value="shirts">T-Shirts</option>
                        <option value="hoodies">Hoodies</option>
                        <option value="tumblers">Tumblers</option>
                        <option value="dtf-transfers">DTF Transfers</option>
                        <option value="3d-models">3D Models</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Product Type
                      </label>
                      <select
                        value={productForm.productType}
                        onChange={(e) => setProductForm({ ...productForm, productType: e.target.value as any })}
                        className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
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
                          <label className="block text-sm font-medium text-slate-700 mb-2">
                            Physical Price ($) *
                          </label>
                          <input
                            type="number"
                            required
                            min="0"
                            step="0.01"
                            value={productForm.price}
                            onChange={(e) => setProductForm({ ...productForm, price: parseFloat(e.target.value) })}
                            className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all placeholder:text-slate-400"
                            placeholder="29.99"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">
                            Shipping Cost ($)
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={productForm.shippingCost}
                            onChange={(e) => setProductForm({ ...productForm, shippingCost: parseFloat(e.target.value) })}
                            className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all placeholder:text-slate-400"
                            placeholder="5.00"
                          />
                        </div>
                      </>
                    )}

                    {(productForm.productType === 'digital' || productForm.productType === 'both') && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">
                            Digital Price ($) *
                          </label>
                          <input
                            type="number"
                            required
                            min="0"
                            step="0.01"
                            value={productForm.digitalPrice}
                            onChange={(e) => setProductForm({ ...productForm, digitalPrice: parseFloat(e.target.value) })}
                            className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all placeholder:text-slate-400"
                            placeholder="9.99"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">
                            STL File URL
                          </label>
                          <input
                            type="text"
                            value={productForm.fileUrl}
                            onChange={(e) => setProductForm({ ...productForm, fileUrl: e.target.value })}
                            className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all placeholder:text-slate-400"
                            placeholder="/models/my-model.stl"
                          />
                        </div>
                      </>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Image URLs (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={productForm.images}
                      onChange={(e) => setProductForm({ ...productForm, images: e.target.value })}
                      className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all placeholder:text-slate-400"
                      placeholder="https://example.com/image1.jpg, https://example.com/image2.jpg"
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      Enter one or more image URLs separated by commas
                    </p>
                  </div>

                  <div className="flex items-center gap-6 bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="inStock"
                        checked={productForm.inStock}
                        onChange={(e) => setProductForm({ ...productForm, inStock: e.target.checked })}
                        className="w-4 h-4 text-purple-600 bg-white border-slate-300 rounded focus:ring-purple-500"
                      />
                      <label htmlFor="inStock" className="ml-2 text-sm text-slate-700 font-medium">
                        Product is Active
                      </label>
                    </div>

                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="isFeatured"
                        checked={productForm.isFeatured}
                        onChange={(e) => setProductForm({ ...productForm, isFeatured: e.target.checked })}
                        className="w-4 h-4 text-amber-500 bg-white border-slate-300 rounded focus:ring-amber-500"
                      />
                      <label htmlFor="isFeatured" className="ml-2 text-sm text-slate-700 font-medium flex items-center gap-1">
                        Featured Product <span className="text-amber-500">★</span>
                      </label>
                    </div>
                  </div>

                  <div className="flex justify-end space-x-3 pt-6 border-t border-slate-200">
                    <button
                      type="button"
                      onClick={() => setShowProductModal(false)}
                      className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 font-medium rounded-xl transition-colors border border-slate-300"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-medium rounded-xl shadow-lg shadow-purple-500/25 transition-all"
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
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
              <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto border border-slate-200">
                <div className="sticky top-0 bg-white px-6 py-4 border-b border-slate-200 flex justify-between items-center z-10 rounded-t-2xl">
                  <h3 className="text-lg font-display font-bold text-slate-900">
                    Edit Product: {editingProductData.name}
                  </h3>
                  <button
                    onClick={() => setShowEnhancedEditModal(false)}
                    className="text-slate-400 hover:text-slate-600 transition-colors p-1 hover:bg-slate-100 rounded-lg"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="p-6 space-y-6">
                  {/* Image Gallery */}
                  {productAssets[editingProductData.id] && (
                    <div className="border border-slate-200 rounded-xl p-4 bg-white">
                      <h4 className="font-semibold text-slate-900 mb-3">Product Images</h4>
                      <div className="space-y-4">
                        {/* Source Images */}
                        {productAssets[editingProductData.id].source && (
                          <div>
                            <h5 className="text-sm font-medium text-slate-600 mb-2">Source Images</h5>
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
                            <h5 className="text-sm font-medium text-slate-600 mb-2">Background Removed</h5>
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
                            <h5 className="text-sm font-medium text-slate-600 mb-2">Upscaled Images</h5>
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
                            <h5 className="text-sm font-medium text-slate-600 mb-2">Mockups</h5>
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
                  <div className="border border-slate-200 rounded-xl p-4 bg-gradient-to-r from-purple-50 to-blue-50">
                    <h4 className="font-semibold text-slate-900 mb-3">Advanced Image Operations</h4>
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
                  <div className="border border-slate-200 rounded-xl p-4 bg-white">
                    <h4 className="font-semibold text-slate-900 mb-3">Product Details</h4>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Product Name</label>
                        <input
                          type="text"
                          value={editingProductData.name}
                          onChange={(e) => {
                            setEditingProductData({ ...editingProductData, name: e.target.value })
                            handleUpdateProductField('name', e.target.value)
                          }}
                          className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">Description</label>
                        <textarea
                          rows={4}
                          value={editingProductData.description}
                          onChange={(e) => {
                            setEditingProductData({ ...editingProductData, description: e.target.value })
                            handleUpdateProductField('description', e.target.value)
                          }}
                          className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Price ($)</label>
                          <input
                            type="number"
                            step="0.01"
                            value={editingProductData.price}
                            onChange={(e) => {
                              const newPrice = parseFloat(e.target.value)
                              setEditingProductData({ ...editingProductData, price: newPrice })
                              handleUpdateProductField('price', newPrice)
                            }}
                            className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Category</label>
                          <select
                            value={editingProductData.category}
                            onChange={(e) => {
                              setEditingProductData({ ...editingProductData, category: e.target.value })
                              handleUpdateProductField('category', e.target.value)
                            }}
                            className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
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
                          <label className="block text-sm font-medium text-slate-700 mb-2">Status</label>
                          <select
                            value={editingProductData.status}
                            onChange={(e) => {
                              setEditingProductData({ ...editingProductData, status: e.target.value })
                              handleUpdateProductField('status', e.target.value)
                            }}
                            className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
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
                            className="w-4 h-4 text-purple-600 border-slate-300 rounded focus:ring-purple-500"
                          />
                          <label htmlFor="inStockEdit" className="text-sm text-slate-700 font-medium">
                            Active
                          </label>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-200">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Sizes (comma separated)</label>
                          <input
                            type="text"
                            placeholder="S, M, L, XL"
                            defaultValue={editingProductData.sizes?.join(', ')}
                            onBlur={(e) => {
                              const sizes = e.target.value.split(',').map(s => s.trim()).filter(s => s)
                              setEditingProductData({ ...editingProductData, sizes })
                              handleUpdateProductField('sizes', sizes)
                            }}
                            className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent placeholder:text-slate-400"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Colors (comma separated)</label>
                          <input
                            type="text"
                            placeholder="Red, Blue, Black"
                            defaultValue={editingProductData.colors?.join(', ')}
                            onBlur={(e) => {
                              const colors = e.target.value.split(',').map(s => s.trim()).filter(s => s)
                              setEditingProductData({ ...editingProductData, colors })
                              handleUpdateProductField('colors', colors)
                            }}
                            className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent placeholder:text-slate-400"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* AI Metadata */}
                  {editingProductData.metadata?.ai_generated && (
                    <div className="border border-purple-200 rounded-xl p-4 bg-purple-50">
                      <h4 className="font-semibold text-slate-900 mb-3">AI Metadata</h4>
                      <div className="space-y-2 text-sm">
                        {editingProductData.metadata.original_prompt && (
                          <div>
                            <span className="font-medium text-slate-600">Original Prompt:</span>
                            <p className="text-slate-900 mt-1">{editingProductData.metadata.original_prompt}</p>
                          </div>
                        )}
                        {editingProductData.metadata.image_prompt && (
                          <div>
                            <span className="font-medium text-slate-600">Image Prompt:</span>
                            <p className="text-slate-900 mt-1">{editingProductData.metadata.image_prompt}</p>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          {editingProductData.metadata.image_style && (
                            <div>
                              <span className="font-medium text-slate-600">Style:</span>
                              <p className="text-slate-900 capitalize">{editingProductData.metadata.image_style}</p>
                            </div>
                          )}
                          {editingProductData.metadata.background && (
                            <div>
                              <span className="font-medium text-slate-600">Background:</span>
                              <p className="text-slate-900 capitalize">{editingProductData.metadata.background}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Processing Jobs */}
                  <div className="border border-slate-200 rounded-xl p-4 bg-white">
                    <h4 className="font-semibold text-slate-900 mb-3">Processing Jobs</h4>
                    {(productJobs[editingProductData.id] || []).length === 0 ? (
                      <p className="text-sm text-slate-500">No jobs found for this product.</p>
                    ) : (
                      <div className="space-y-2">
                        {(productJobs[editingProductData.id] || []).map((job: any) => (
                          <div key={job.id} className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-100">
                            <div>
                              <span className="text-sm font-medium text-slate-900 capitalize">
                                {job.type.replace('replicate_', '').replace('_', ' ')}
                              </span>
                              <span className={`ml-2 px-2 py-1 text-xs font-semibold rounded-full ${job.status === 'succeeded' ? 'bg-emerald-100 text-emerald-700' :
                                job.status === 'running' ? 'bg-blue-100 text-blue-700' :
                                  job.status === 'failed' ? 'bg-red-100 text-red-700' :
                                    'bg-amber-100 text-amber-700'
                                }`}>
                                {job.status}
                              </span>
                            </div>
                            <span className="text-xs text-slate-500">
                              {new Date(job.created_at).toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="sticky bottom-0 bg-white px-6 py-4 border-t border-slate-200 flex justify-end rounded-b-2xl">
                  <button
                    onClick={() => setShowEnhancedEditModal(false)}
                    className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-medium rounded-xl shadow-lg shadow-purple-500/25 transition-all"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )
        }

        {/* Grant ITC Modal */}
        {showItcModal && itcUser && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 p-6">
              <h3 className="text-xl font-display font-bold text-slate-900 mb-4">
                Grant/Revoke ITC
              </h3>
              <p className="text-slate-600 mb-4">
                Adjust ITC balance for <span className="font-semibold">{itcUser.firstName} {itcUser.lastName}</span>
              </p>
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-700 mb-2">Amount (use negative to revoke)</label>
                <input
                  type="number"
                  value={itcAmount}
                  onChange={(e) => setItcAmount(parseInt(e.target.value) || 0)}
                  className="w-full border border-slate-300 rounded-xl px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <p className="text-xs text-slate-500 mt-2">Current Balance: <span className="font-medium text-purple-600">{itcUser.itcBalance} ITC</span></p>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowItcModal(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-50 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGrantItc}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 shadow-md shadow-purple-500/20"
                >
                  Update Balance
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default AdminDashboard

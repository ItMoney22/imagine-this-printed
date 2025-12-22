import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { useToast } from '../hooks/useToast'
import type { ThreeDModel, VendorProduct } from '../types'
import ThreeDPrintRequestModal from '../components/ThreeDPrintRequestModal'

const ModelGallery: React.FC = () => {
  const { user } = useAuth()
  const toast = useToast()
  const [models, setModels] = useState<(ThreeDModel | VendorProduct)[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showPrintRequestModal, setShowPrintRequestModal] = useState(false)
  const [selectedModelForPrint, setSelectedModelForPrint] = useState<{ title: string; fileUrl: string } | undefined>(undefined)
  const [newModel, setNewModel] = useState({
    title: '',
    description: '',
    category: 'figurines' as const,
    file: null as File | null
  })

  const categories = [
    { id: 'all', name: 'All Items' },
    { id: 'figurines', name: 'Figurines' },
    { id: 'tools', name: 'Tools' },
    { id: 'decorative', name: 'Decorative' },
    { id: 'functional', name: 'Functional' },
    { id: 'toys', name: 'Toys' },
    { id: '3d-models', name: 'Marketplace' }
  ]

  // Mock data - replace with real PostgreSQL queries
  useEffect(() => {
    // Community Models
    const communityModels: ThreeDModel[] = [
      {
        id: '1',
        title: 'Dragon Figurine',
        description: 'Detailed fantasy dragon figure perfect for tabletop gaming',
        fileUrl: '/models/dragon.stl',
        previewUrl: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=300&h=300&fit=crop',
        category: 'figurines',
        uploadedBy: 'user123',
        approved: true,
        votes: 45,
        points: 150,
        createdAt: '2025-01-08T10:00:00Z',
        fileType: 'stl'
      }
    ]

    // Vendor Marketplace Products
    const vendorProducts: VendorProduct[] = [
      {
        id: 'vp_1',
        vendorId: 'vendor_123',
        title: 'Pro Gaming Headset Stand',
        description: 'Heavy duty headphone stand, shipped directly from our farm.',
        price: 24.99,
        digitalPrice: 0,
        images: ['https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=300&h=300&fit=crop'],
        category: 'functional',
        approved: true,
        commissionRate: 10,
        createdAt: '2025-01-09T10:00:00Z',
        productType: 'physical',
        shippingCost: 5.00
      },
      {
        id: 'vp_2',
        vendorId: 'vendor_456',
        title: 'Articulated Slug STL',
        description: 'Print-in-place articulated slug. Instant download.',
        price: 0,
        digitalPrice: 3.99,
        images: ['https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=300&h=300&fit=crop'],
        category: 'toys',
        approved: true,
        commissionRate: 10,
        createdAt: '2025-01-09T12:00:00Z',
        productType: 'digital',
        fileUrl: '/models/slug.stl'
      }
    ]

    setModels([...communityModels, ...vendorProducts])
  }, [user?.id])

  const filteredModels = selectedCategory === 'all'
    ? models.filter(m => m.approved)
    : models.filter(m => m.approved && m.category === selectedCategory || (selectedCategory === '3d-models' && (m as VendorProduct).vendorId))

  const handleVote = (modelId: string) => {
    if (!user) {
      toast.warning('Sign in required', 'Please sign in to vote')
      return
    }
    // Mock vote logic
    toast.success('Vote cast!', 'Thank you for voting')
  }

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    toast.success('Upload submitted', 'Community upload submitted!')
    setShowUploadModal(false)
  }

  const handleBuyPhysical = (product: VendorProduct) => {
    toast.success('Added to cart', `${product.title} (Physical Print) - $${product.price}`)
  }

  const handleBuyDigital = (product: VendorProduct) => {
    toast.success('Added to cart', `${product.title} (STL Download) - $${product.digitalPrice}`)
  }

  const handleContactVendor = (vendorId: string) => {
    toast.info('Opening chat', `Connecting with vendor...`)
    // In real app, navigate to /messages/new?recipient={vendorId}
  }

  const handleOrderPrint = (model: ThreeDModel) => {
    setSelectedModelForPrint({ title: model.title, fileUrl: model.fileUrl })
    setShowPrintRequestModal(true)
  }

  const handleCustomPrint = () => {
    setSelectedModelForPrint(undefined)
    setShowPrintRequestModal(true)
  }

  const isVendorProduct = (item: any): item is VendorProduct => {
    return 'vendorId' in item
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8 bg-gradient-to-r from-gray-900 to-gray-800 rounded-2xl p-8 text-white shadow-xl overflow-hidden relative">
        <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
        <div className="absolute -bottom-8 -left-8 w-64 h-64 bg-indigo-600 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>

        <div className="relative z-10 flex flex-col md:flex-row justify-between items-center">
          <div className="mb-6 md:mb-0">
            <h1 className="text-4xl font-bold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-300">
              3D Marketplace & Gallery
            </h1>
            <p className="text-gray-300 text-lg max-w-xl">
              Buy prints from verified vendors, download premium STLs, or browse community models.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            <button
              onClick={handleCustomPrint}
              className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold py-3 px-6 rounded-xl shadow-lg transform transition-all hover:scale-105 flex items-center"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
              Request Custom Print
            </button>
            <button
              onClick={() => setShowUploadModal(true)}
              className="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 px-6 rounded-xl transition-colors border border-gray-600"
            >
              Upload Community Model
            </button>
          </div>
        </div>
      </div>

      {/* Categories */}
      <div className="mb-8">
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${selectedCategory === category.id
                  ? 'bg-purple-600 text-white shadow-lg scale-105'
                  : 'bg-card text-text hover:bg-gray-200 hover:scale-105'
                }`}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>

      {/* Models Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredModels.map((item) => {
          const isVendor = isVendorProduct(item)
          const previewUrl = isVendor ? item.images[0] : (item as ThreeDModel).previewUrl

          return (
            <div key={item.id} className="bg-card rounded-xl shadow-lg overflow-hidden hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 group">
              <div className="relative overflow-hidden">
                <img
                  src={previewUrl || 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=300&h=300&fit=crop'}
                  alt={item.title}
                  className="w-full h-56 object-cover transform group-hover:scale-110 transition-transform duration-500"
                />
                {isVendor && (
                  <div className="absolute top-2 right-2">
                    <span className="bg-purple-600 text-white px-2 py-1 rounded text-xs font-bold shadow-sm">
                      Vendor
                    </span>
                  </div>
                )}
                {!isVendor && (
                  <div className="absolute top-2 right-2">
                    <span className="bg-black bg-opacity-75 text-white px-2 py-1 rounded text-xs font-medium backdrop-blur-sm">
                      .{(item as ThreeDModel).fileType}
                    </span>
                  </div>
                )}
              </div>

              <div className="p-5">
                <h3 className="text-lg font-bold text-text mb-2 group-hover:text-purple-600 transition-colors">{item.title}</h3>
                <p className="text-muted text-sm mb-4 line-clamp-2">{item.description}</p>

                {/* Vendor Product Actions */}
                {isVendor ? (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted">Sold by Vendor</span>
                      <button
                        onClick={() => handleContactVendor((item as VendorProduct).vendorId)}
                        className="text-purple-600 hover:underline text-xs font-medium"
                      >
                        Contact
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                      {((item as VendorProduct).productType === 'physical' || (item as VendorProduct).productType === 'both') && (
                        <button
                          onClick={() => handleBuyPhysical(item as VendorProduct)}
                          className="w-full bg-green-600 hover:bg-green-700 text-white text-sm font-bold py-2 px-3 rounded-lg transition-colors shadow-md flex justify-between items-center"
                        >
                          <span>Buy Print</span>
                          <span>${(item as VendorProduct).price}</span>
                        </button>
                      )}

                      {((item as VendorProduct).productType === 'digital' || (item as VendorProduct).productType === 'both') && (
                        <button
                          onClick={() => handleBuyDigital(item as VendorProduct)}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-2 px-3 rounded-lg transition-colors shadow-md flex justify-between items-center"
                        >
                          <span>Download STL</span>
                          <span>${(item as VendorProduct).digitalPrice}</span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Community Model Actions */
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <button onClick={() => handleVote(item.id)} className="flex items-center space-x-1 text-muted hover:text-purple-600">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                          </svg>
                          <span className="text-sm font-medium">{(item as ThreeDModel).votes}</span>
                        </button>
                      </div>
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-bold rounded-full uppercase">
                        {item.category}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleOrderPrint(item as ThreeDModel)}
                        className="bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold py-2 px-3 rounded-lg transition-colors shadow-md"
                      >
                        Order Print
                      </button>
                      <button
                        className="bg-gray-100 hover:bg-gray-200 text-text text-sm font-bold py-2 px-3 rounded-lg transition-colors border border-gray-200"
                      >
                        Download
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {filteredModels.length === 0 && (
        <div className="text-center py-16 bg-card rounded-2xl shadow-inner">
          <h3 className="text-xl font-bold text-text mb-2">No items found</h3>
          <p className="text-muted">No models or products available in this category yet.</p>
        </div>
      )}

      {/* Upload Modal (Community) */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-card rounded-xl shadow-2xl max-w-md w-full p-6 border card-border">
            <h3 className="text-xl font-bold text-text mb-4">Upload Community Model</h3>
            <p className="text-muted mb-6">Share your creations with the community for free.</p>
            <form onSubmit={handleUpload} className="space-y-4">
              {/* Simplified for demo */}
              <button type="submit" className="w-full bg-purple-600 text-white py-2 rounded-lg">Upload</button>
              <button type="button" onClick={() => setShowUploadModal(false)} className="w-full bg-gray-200 text-text py-2 rounded-lg">Cancel</button>
            </form>
          </div>
        </div>
      )}

      {/* Print Request Modal */}
      <ThreeDPrintRequestModal
        isOpen={showPrintRequestModal}
        onClose={() => setShowPrintRequestModal(false)}
        initialModel={selectedModelForPrint}
      />
    </div>
  )
}

export default ModelGallery

import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import type { MarketingCampaign, Product } from '../types'

const MarketingTools: React.FC = () => {
  const { user } = useAuth()
  const [selectedTab, setSelectedTab] = useState<'campaigns' | 'create' | 'content' | 'analytics' | 'feeds'>('campaigns')
  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [newCampaign, setNewCampaign] = useState({
    name: '',
    type: 'google_ads' as MarketingCampaign['type'],
    targetProducts: [] as string[],
    budget: 0
  })
  const [contentGeneration, setContentGeneration] = useState({
    productId: '',
    platform: 'google_ads',
    tone: 'professional',
    targetAudience: 'general',
    isGenerating: false,
    generatedContent: null as any
  })
  const [pixelTracking, setPixelTracking] = useState({
    googlePixelId: '',
    facebookPixelId: '',
    isEnabled: false
  })

  // Mock data - replace with real API calls
  useEffect(() => {
    const mockProducts: Product[] = [
      {
        id: '1',
        name: 'Premium T-Shirt',
        description: 'High-quality cotton t-shirt perfect for custom designs',
        price: 24.99,
        images: ['https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=300&h=300&fit=crop'],
        category: 'shirts',
        inStock: true,
        approved: true
      },
      {
        id: '2',
        name: 'Custom Tumbler',
        description: 'Insulated tumbler with personalization options',
        price: 29.99,
        images: ['https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=300&h=300&fit=crop'],
        category: 'tumblers',
        inStock: true,
        approved: true
      },
      {
        id: '3',
        name: 'Cozy Hoodie',
        description: 'Warm and comfortable hoodie for all seasons',
        price: 45.99,
        images: ['https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=300&h=300&fit=crop'],
        category: 'hoodies',
        inStock: true,
        approved: true
      }
    ]

    const mockCampaigns: MarketingCampaign[] = [
      {
        id: '1',
        name: 'Summer T-Shirt Campaign',
        type: 'google_ads',
        status: 'active',
        targetProducts: ['1'],
        generatedContent: {
          headline: 'Custom T-Shirts That Make a Statement',
          description: 'Design your perfect tee with our easy-to-use customization tools. Premium quality, fast shipping, satisfaction guaranteed!'
        },
        budget: 500,
        startDate: '2025-01-10T00:00:00Z',
        endDate: '2025-02-10T00:00:00Z',
        metrics: {
          impressions: 15420,
          clicks: 892,
          conversions: 34,
          spend: 287.50
        },
        createdBy: user?.id || 'admin',
        createdAt: '2025-01-10T09:00:00Z'
      },
      {
        id: '2',
        name: 'Holiday Tumbler Promo',
        type: 'facebook_ads',
        status: 'completed',
        targetProducts: ['2'],
        generatedContent: {
          headline: 'Personalized Tumblers for Every Occasion',
          description: 'Keep your drinks at the perfect temperature while showcasing your unique style. Custom tumblers made easy!'
        },
        budget: 300,
        startDate: '2024-12-01T00:00:00Z',
        endDate: '2024-12-31T00:00:00Z',
        metrics: {
          impressions: 8950,
          clicks: 456,
          conversions: 28,
          spend: 245.80
        },
        createdBy: user?.id || 'admin',
        createdAt: '2024-12-01T10:00:00Z'
      }
    ]

    setProducts(mockProducts)
    setCampaigns(mockCampaigns)
  }, [user?.id])

  const generateContent = async () => {
    setContentGeneration(prev => ({ ...prev, isGenerating: true }))
    
    const selectedProduct = products.find(p => p.id === contentGeneration.productId)
    if (!selectedProduct) return

    // Simulate AI content generation delay
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Mock GPT-generated content based on product and settings
    const mockGeneratedContent = {
      headline: `${selectedProduct.name} - ${contentGeneration.tone === 'professional' ? 'Premium Quality' : 'Trendy Style'} Customization`,
      description: `Create your perfect ${selectedProduct.name.toLowerCase()} with our advanced design tools. ${
        contentGeneration.targetAudience === 'business' 
          ? 'Perfect for corporate branding and team uniforms.' 
          : contentGeneration.targetAudience === 'creative'
          ? 'Express your creativity with unlimited design possibilities.'
          : 'Quality products for everyone.'
      } Fast shipping, satisfaction guaranteed!`,
      keywords: [`custom ${selectedProduct.category}`, 'personalized apparel', 'design tools', 'quality printing'],
      callToAction: contentGeneration.platform === 'google_ads' ? 'Start Designing Now' : 'Shop Custom Products',
      adCopy: {
        short: `Custom ${selectedProduct.name} from $${selectedProduct.price}`,
        medium: `Design your perfect ${selectedProduct.name} with our easy tools. Starting at $${selectedProduct.price}`,
        long: `Transform your ideas into reality with our custom ${selectedProduct.name}. Professional-grade materials, unlimited design options, and fast shipping. Starting at just $${selectedProduct.price}. Create yours today!`
      }
    }

    setContentGeneration(prev => ({
      ...prev,
      isGenerating: false,
      generatedContent: mockGeneratedContent
    }))
  }

  const createCampaign = () => {
    const campaign: MarketingCampaign = {
      id: Date.now().toString(),
      name: newCampaign.name,
      type: newCampaign.type,
      status: 'draft',
      targetProducts: newCampaign.targetProducts,
      generatedContent: {
        headline: '',
        description: ''
      },
      budget: newCampaign.budget,
      metrics: {
        impressions: 0,
        clicks: 0,
        conversions: 0,
        spend: 0
      },
      createdBy: user?.id || 'admin',
      createdAt: new Date().toISOString()
    }

    setCampaigns(prev => [campaign, ...prev])
    setNewCampaign({
      name: '',
      type: 'google_ads',
      targetProducts: [],
      budget: 0
    })
    alert('Campaign created successfully!')
  }

  const exportProductFeed = (format: 'google' | 'facebook') => {
    const feedData = products.map(product => ({
      id: product.id,
      title: product.name,
      description: product.description,
      price: `${product.price} USD`,
      image_link: product.images[0],
      availability: product.inStock ? 'in stock' : 'out of stock',
      category: product.category,
      brand: 'ImagineThisPrinted',
      condition: 'new'
    }))

    const csvContent = format === 'google' 
      ? "id,title,description,price,image_link,availability,google_product_category,brand,condition\n" +
        feedData.map(item => Object.values(item).join(',')).join('\n')
      : "id,title,description,price,image_link,availability,product_category,brand,condition\n" +
        feedData.map(item => Object.values(item).join(',')).join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `product-feed-${format}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  }

  if (user?.role !== 'admin' && user?.role !== 'manager') {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">Access denied. This page is for administrators and managers only.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text mb-2">Marketing Tools</h1>
        <p className="text-muted">AI-powered marketing content generation and campaign management</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Active Campaigns</p>
              <p className="text-2xl font-semibold text-text">{campaigns.filter(c => c.status === 'active').length}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Total Impressions</p>
              <p className="text-2xl font-semibold text-text">{campaigns.reduce((sum, c) => sum + c.metrics.impressions, 0).toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Total Clicks</p>
              <p className="text-2xl font-semibold text-text">{campaigns.reduce((sum, c) => sum + c.metrics.clicks, 0).toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-muted">Total Spend</p>
              <p className="text-2xl font-semibold text-text">${campaigns.reduce((sum, c) => sum + c.metrics.spend, 0).toFixed(2)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b card-border mb-6">
        <nav className="-mb-px flex space-x-8">
          {['campaigns', 'create', 'content', 'analytics', 'feeds'].map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                selectedTab === tab
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-muted hover:text-text hover:card-border'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      {/* Campaigns Tab */}
      {selectedTab === 'campaigns' && (
        <div className="space-y-6">
          {campaigns.map((campaign) => (
            <div key={campaign.id} className="bg-card rounded-lg shadow p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-text">{campaign.name}</h3>
                  <div className="flex items-center mt-1">
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      campaign.status === 'active' ? 'bg-green-100 text-green-800' :
                      campaign.status === 'paused' ? 'bg-yellow-100 text-yellow-800' :
                      campaign.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                      'bg-card text-gray-800'
                    }`}>
                      {campaign.status}
                    </span>
                    <span className="ml-2 text-sm text-muted">{campaign.type.replace('_', ' ')}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted">Budget</p>
                  <p className="text-lg font-semibold">${campaign.budget}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-blue-600">{campaign.metrics.impressions.toLocaleString()}</p>
                  <p className="text-sm text-muted">Impressions</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-green-600">{campaign.metrics.clicks.toLocaleString()}</p>
                  <p className="text-sm text-muted">Clicks</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-purple-600">{campaign.metrics.conversions}</p>
                  <p className="text-sm text-muted">Conversions</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-red-600">${campaign.metrics.spend.toFixed(2)}</p>
                  <p className="text-sm text-muted">Spend</p>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium text-text mb-2">Generated Content:</h4>
                <p className="text-sm font-medium text-gray-800">{campaign.generatedContent.headline}</p>
                <p className="text-sm text-muted mt-1">{campaign.generatedContent.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Campaign Tab */}
      {selectedTab === 'create' && (
        <div className="bg-card rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-text mb-6">Create New Campaign</h3>
          
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-text mb-2">Campaign Name</label>
              <input
                type="text"
                value={newCampaign.name}
                onChange={(e) => setNewCampaign(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="Enter campaign name"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-text mb-2">Campaign Type</label>
                <select
                  value={newCampaign.type}
                  onChange={(e) => setNewCampaign(prev => ({ ...prev, type: e.target.value as MarketingCampaign['type'] }))}
                  className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="google_ads">Google Ads</option>
                  <option value="facebook_ads">Facebook Ads</option>
                  <option value="email">Email Campaign</option>
                  <option value="social">Social Media</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">Budget ($)</label>
                <input
                  type="number"
                  value={newCampaign.budget}
                  onChange={(e) => setNewCampaign(prev => ({ ...prev, budget: parseFloat(e.target.value) }))}
                  className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text mb-2">Target Products</label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {products.map((product) => (
                  <label key={product.id} className="flex items-center p-3 border card-border rounded-lg hover:bg-card">
                    <input
                      type="checkbox"
                      checked={newCampaign.targetProducts.includes(product.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setNewCampaign(prev => ({
                            ...prev,
                            targetProducts: [...prev.targetProducts, product.id]
                          }))
                        } else {
                          setNewCampaign(prev => ({
                            ...prev,
                            targetProducts: prev.targetProducts.filter(id => id !== product.id)
                          }))
                        }
                      }}
                      className="mr-3"
                    />
                    <div className="flex items-center">
                      <img src={product.images[0]} alt={product.name} className="w-10 h-10 object-cover rounded mr-3" />
                      <div>
                        <p className="text-sm font-medium text-text">{product.name}</p>
                        <p className="text-xs text-muted">${product.price}</p>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={createCampaign}
              disabled={!newCampaign.name || newCampaign.targetProducts.length === 0}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
            >
              Create Campaign
            </button>
          </div>
        </div>
      )}

      {/* Content Generation Tab */}
      {selectedTab === 'content' && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-text mb-6">AI Content Generator</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-sm font-medium text-text mb-2">Select Product</label>
                <select
                  value={contentGeneration.productId}
                  onChange={(e) => setContentGeneration(prev => ({ ...prev, productId: e.target.value }))}
                  className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">Choose a product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>{product.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">Platform</label>
                <select
                  value={contentGeneration.platform}
                  onChange={(e) => setContentGeneration(prev => ({ ...prev, platform: e.target.value }))}
                  className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="google_ads">Google Ads</option>
                  <option value="facebook_ads">Facebook Ads</option>
                  <option value="instagram">Instagram</option>
                  <option value="email">Email</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">Tone</label>
                <select
                  value={contentGeneration.tone}
                  onChange={(e) => setContentGeneration(prev => ({ ...prev, tone: e.target.value }))}
                  className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="professional">Professional</option>
                  <option value="casual">Casual</option>
                  <option value="enthusiastic">Enthusiastic</option>
                  <option value="luxury">Luxury</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">Target Audience</label>
                <select
                  value={contentGeneration.targetAudience}
                  onChange={(e) => setContentGeneration(prev => ({ ...prev, targetAudience: e.target.value }))}
                  className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="general">General</option>
                  <option value="business">Business</option>
                  <option value="creative">Creative Professionals</option>
                  <option value="youth">Young Adults</option>
                </select>
              </div>
            </div>

            <button
              onClick={generateContent}
              disabled={!contentGeneration.productId || contentGeneration.isGenerating}
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors flex items-center justify-center"
            >
              {contentGeneration.isGenerating ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Generating Content...
                </>
              ) : (
                '✨ Generate AI Content'
              )}
            </button>
          </div>

          {contentGeneration.generatedContent && (
            <div className="bg-card rounded-lg shadow p-6">
              <h4 className="text-lg font-medium text-text mb-4">Generated Content</h4>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text mb-1">Headline</label>
                  <p className="p-3 bg-card rounded border text-text">{contentGeneration.generatedContent.headline}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text mb-1">Description</label>
                  <p className="p-3 bg-card rounded border text-text">{contentGeneration.generatedContent.description}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text mb-1">Ad Copy Variations</label>
                  <div className="space-y-2">
                    <div>
                      <span className="text-xs font-medium text-muted">Short:</span>
                      <p className="p-2 bg-card rounded border text-sm text-text">{contentGeneration.generatedContent.adCopy.short}</p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-muted">Medium:</span>
                      <p className="p-2 bg-card rounded border text-sm text-text">{contentGeneration.generatedContent.adCopy.medium}</p>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-muted">Long:</span>
                      <p className="p-2 bg-card rounded border text-sm text-text">{contentGeneration.generatedContent.adCopy.long}</p>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text mb-1">Keywords</label>
                  <div className="flex flex-wrap gap-2">
                    {contentGeneration.generatedContent.keywords.map((keyword: string, index: number) => (
                      <span key={index} className="px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded-full">
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex space-x-3 pt-4">
                  <button className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded">
                    Copy Content
                  </button>
                  <button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded">
                    Create Campaign
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Product Feeds Tab */}
      {selectedTab === 'feeds' && (
        <div className="space-y-6">
          <div className="bg-card rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-text mb-6">Product Feed Export</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="border card-border rounded-lg p-4">
                <div className="flex items-center mb-3">
                  <svg className="w-8 h-8 text-blue-600 mr-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  <div>
                    <h4 className="font-semibold text-text">Google Merchant Center</h4>
                    <p className="text-sm text-muted">Export for Google Shopping ads</p>
                  </div>
                </div>
                <button
                  onClick={() => exportProductFeed('google')}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded"
                >
                  Export Google Feed
                </button>
              </div>

              <div className="border card-border rounded-lg p-4">
                <div className="flex items-center mb-3">
                  <svg className="w-8 h-8 text-blue-600 mr-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                  <div>
                    <h4 className="font-semibold text-text">Facebook Catalog</h4>
                    <p className="text-sm text-muted">Export for Facebook & Instagram ads</p>
                  </div>
                </div>
                <button
                  onClick={() => exportProductFeed('facebook')}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded"
                >
                  Export Facebook Feed
                </button>
              </div>
            </div>

            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex">
                <svg className="w-5 h-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <h4 className="text-sm font-medium text-blue-900">Product Feed Guidelines</h4>
                  <ul className="text-sm text-blue-700 mt-1">
                    <li>• Feeds are automatically updated with current product information</li>
                    <li>• Only approved products are included in exports</li>
                    <li>• Images must be accessible via direct URLs</li>
                    <li>• Prices include currency formatting for platform requirements</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Pixel Tracking Setup */}
          <div className="bg-card rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-text mb-6">Pixel Tracking Setup</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text mb-2">Google Analytics Tracking ID</label>
                <input
                  type="text"
                  value={pixelTracking.googlePixelId}
                  onChange={(e) => setPixelTracking(prev => ({ ...prev, googlePixelId: e.target.value }))}
                  placeholder="G-XXXXXXXXXX"
                  className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">Facebook Pixel ID</label>
                <input
                  type="text"
                  value={pixelTracking.facebookPixelId}
                  onChange={(e) => setPixelTracking(prev => ({ ...prev, facebookPixelId: e.target.value }))}
                  placeholder="123456789012345"
                  className="w-full px-3 py-2 border card-border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={pixelTracking.isEnabled}
                  onChange={(e) => setPixelTracking(prev => ({ ...prev, isEnabled: e.target.checked }))}
                  className="mr-2"
                />
                <label className="text-sm text-text">Enable pixel tracking</label>
              </div>

              <button className="bg-purple-600 hover:bg-purple-700 text-white py-2 px-4 rounded">
                Save Tracking Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default MarketingTools

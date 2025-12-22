import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/SupabaseAuthContext'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/api'
import type { MarketingCampaign, Product } from '../types'

const MarketingTools: React.FC = () => {
  const { user } = useAuth()
  const [selectedTab, setSelectedTab] = useState<'campaigns' | 'create' | 'content' | 'analytics' | 'feeds'>('campaigns')
  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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

  // Fetch real data from Supabase
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      setError(null)

      try {
        // Fetch real products
        const { data: productsData, error: productsError } = await supabase
          .from('products')
          .select('*')
          .eq('approved', true)
          .order('created_at', { ascending: false })

        if (productsError) throw productsError

        // Fetch marketing campaigns
        const { data: campaignsData, error: campaignsError } = await supabase
          .from('marketing_campaigns')
          .select('*')
          .order('created_at', { ascending: false })

        // If marketing_campaigns table doesn't exist, use empty array
        if (campaignsError && campaignsError.code !== 'PGRST116') {
          console.warn('Marketing campaigns table may not exist:', campaignsError)
        }

        setProducts(productsData || [])
        setCampaigns(campaignsData || [])
      } catch (err: any) {
        console.error('Error fetching data:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  const generateContent = async () => {
    setContentGeneration(prev => ({ ...prev, isGenerating: true }))

    const selectedProduct = products.find(p => p.id === contentGeneration.productId)
    if (!selectedProduct) return

    try {
      // Call backend API for real GPT content generation
      const response = await apiFetch('/api/marketing/generate-content', {
        method: 'POST',
        body: JSON.stringify({
          productName: selectedProduct.name,
          productDescription: selectedProduct.description,
          productPrice: selectedProduct.price,
          platform: contentGeneration.platform,
          tone: contentGeneration.tone,
          targetAudience: contentGeneration.targetAudience
        })
      })

      if (!response.ok) {
        throw new Error('Failed to generate content')
      }

      const { content } = await response.json()
      setContentGeneration(prev => ({
        ...prev,
        isGenerating: false,
        generatedContent: content
      }))
    } catch (err) {
      console.error('Content generation error:', err)
      // Fallback to mock content if API fails
      const mockGeneratedContent = {
        headline: `${selectedProduct.name} - ${contentGeneration.tone === 'professional' ? 'Premium Quality' : 'Trendy Style'} Customization`,
        description: `Create your perfect ${selectedProduct.name.toLowerCase()} with our advanced design tools. Fast shipping, satisfaction guaranteed!`,
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
  }

  const createCampaign = async () => {
    try {
      const { data, error } = await supabase
        .from('marketing_campaigns')
        .insert({
          name: newCampaign.name,
          type: newCampaign.type,
          target_products: newCampaign.targetProducts,
          budget: newCampaign.budget,
          status: 'draft',
          generated_content: { headline: '', description: '' },
          metrics: { impressions: 0, clicks: 0, conversions: 0, spend: 0 },
          created_by: user?.id
        })
        .select()
        .single()

      if (error) throw error

      setCampaigns(prev => [data, ...prev])
      setNewCampaign({
        name: '',
        type: 'google_ads',
        targetProducts: [],
        budget: 0
      })
      setSelectedTab('campaigns')
    } catch (err: any) {
      console.error('Error creating campaign:', err)
      alert('Failed to create campaign: ' + err.message)
    }
  }

  const toggleCampaignStatus = async (campaignId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'paused' : 'active'

    try {
      const { error } = await supabase
        .from('marketing_campaigns')
        .update({ status: newStatus })
        .eq('id', campaignId)

      if (error) throw error

      setCampaigns(prev => prev.map(c =>
        c.id === campaignId ? { ...c, status: newStatus } : c
      ))
    } catch (err: any) {
      console.error('Error updating campaign:', err)
    }
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

  // Tab configuration with icons
  const tabs = [
    { id: 'campaigns', label: 'Campaigns', icon: 'M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z' },
    { id: 'create', label: 'Create', icon: 'M12 4v16m8-8H4' },
    { id: 'content', label: 'AI Content', icon: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z' },
    { id: 'analytics', label: 'Analytics', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
    { id: 'feeds', label: 'Feeds', icon: 'M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7m-6 0a1 1 0 11-2 0 1 1 0 012 0z' }
  ]

  if (user?.role !== 'admin' && user?.role !== 'manager') {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6 max-w-md">
          <div className="flex items-center">
            <svg className="w-6 h-6 text-red-600 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-red-800 dark:text-red-200 font-medium">Access denied. This page is for administrators and managers only.</p>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="flex items-center space-x-3">
          <svg className="animate-spin h-8 w-8 text-purple-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-lg text-muted">Loading marketing tools...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6 max-w-md text-center">
          <p className="text-red-800 dark:text-red-200 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Gradient Header */}
      <div className="bg-gradient-to-br from-purple-600 via-purple-700 to-pink-600 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 relative">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Marketing Tools</h1>
              <p className="text-purple-100">AI-powered marketing content generation and campaign management</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 border border-white/20">
                <span className="text-purple-100 text-xs uppercase tracking-wider">Campaigns</span>
                <p className="text-white text-xl font-bold">{campaigns.length}</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 border border-white/20">
                <span className="text-purple-100 text-xs uppercase tracking-wider">Active</span>
                <p className="text-white text-xl font-bold">{campaigns.filter(c => c.status === 'active').length}</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-3 border border-white/20">
                <span className="text-purple-100 text-xs uppercase tracking-wider">Products</span>
                <p className="text-white text-xl font-bold">{products.length}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg shadow-blue-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted">Active Campaigns</p>
                <p className="text-2xl font-bold text-text">{campaigns.filter(c => c.status === 'active').length}</p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl shadow-lg shadow-green-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted">Total Impressions</p>
                <p className="text-2xl font-bold text-text">{campaigns.reduce((sum, c) => sum + (c.metrics?.impressions || 0), 0).toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl shadow-lg shadow-amber-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted">Total Clicks</p>
                <p className="text-2xl font-bold text-text">{campaigns.reduce((sum, c) => sum + (c.metrics?.clicks || 0), 0).toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
            <div className="flex items-center">
              <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl shadow-lg shadow-purple-500/25">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-muted">Total Spend</p>
                <p className="text-2xl font-bold text-text">${campaigns.reduce((sum, c) => sum + (c.metrics?.spend || 0), 0).toFixed(2)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-2 mb-6">
          <nav className="flex space-x-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedTab(tab.id as any)}
                className={`flex items-center px-4 py-2.5 rounded-lg font-medium text-sm transition-all ${
                  selectedTab === tab.id
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/25'
                    : 'text-muted hover:text-text hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
                </svg>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Campaigns Tab */}
        {selectedTab === 'campaigns' && (
          <div className="space-y-6">
            {campaigns.length === 0 ? (
              <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-12 text-center">
                <svg className="w-16 h-16 text-muted mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <h3 className="text-lg font-medium text-text mb-2">No campaigns yet</h3>
                <p className="text-muted mb-4">Create your first marketing campaign to get started</p>
                <button
                  onClick={() => setSelectedTab('create')}
                  className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white px-5 py-2.5 rounded-xl shadow-lg shadow-purple-500/25 transition-all"
                >
                  Create Campaign
                </button>
              </div>
            ) : (
              campaigns.map((campaign) => (
                <div key={campaign.id} className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6 hover:shadow-purple-500/5 transition-shadow">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-text">{campaign.name}</h3>
                      <div className="flex items-center mt-2 gap-2">
                        <span className={`px-2.5 py-1 text-xs font-semibold rounded-lg ${
                          campaign.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                          campaign.status === 'paused' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
                          campaign.status === 'completed' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                          'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                        }`}>
                          {campaign.status}
                        </span>
                        <span className="text-sm text-muted">{campaign.type.replace('_', ' ')}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-sm text-muted">Budget</p>
                        <p className="text-lg font-bold text-text">${campaign.budget}</p>
                      </div>
                      {(campaign.status === 'active' || campaign.status === 'paused') && (
                        <button
                          onClick={() => toggleCampaignStatus(campaign.id, campaign.status)}
                          className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                            campaign.status === 'active'
                              ? 'bg-amber-100 hover:bg-amber-200 text-amber-700 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 dark:text-amber-300'
                              : 'bg-green-100 hover:bg-green-200 text-green-700 dark:bg-green-900/30 dark:hover:bg-green-900/50 dark:text-green-300'
                          }`}
                        >
                          {campaign.status === 'active' ? 'Pause' : 'Resume'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-blue-600">{(campaign.metrics?.impressions || 0).toLocaleString()}</p>
                      <p className="text-sm text-muted">Impressions</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-green-600">{(campaign.metrics?.clicks || 0).toLocaleString()}</p>
                      <p className="text-sm text-muted">Clicks</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-purple-600">{campaign.metrics?.conversions || 0}</p>
                      <p className="text-sm text-muted">Conversions</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-pink-600">${(campaign.metrics?.spend || 0).toFixed(2)}</p>
                      <p className="text-sm text-muted">Spend</p>
                    </div>
                  </div>

                  {campaign.generatedContent?.headline && (
                    <div className="border-t border-purple-100 dark:border-purple-900/30 pt-4">
                      <h4 className="font-medium text-text mb-2">Generated Content:</h4>
                      <p className="text-sm font-medium text-text">{campaign.generatedContent.headline}</p>
                      <p className="text-sm text-muted mt-1">{campaign.generatedContent.description}</p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Create Campaign Tab */}
        {selectedTab === 'create' && (
          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6">
            <h3 className="text-lg font-medium text-text mb-6">Create New Campaign</h3>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-text mb-2">Campaign Name</label>
                <input
                  type="text"
                  value={newCampaign.name}
                  onChange={(e) => setNewCampaign(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-card border border-purple-500/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-text"
                  placeholder="Enter campaign name"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-text mb-2">Campaign Type</label>
                  <select
                    value={newCampaign.type}
                    onChange={(e) => setNewCampaign(prev => ({ ...prev, type: e.target.value as MarketingCampaign['type'] }))}
                    className="w-full px-4 py-2.5 bg-card border border-purple-500/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-text"
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
                    onChange={(e) => setNewCampaign(prev => ({ ...prev, budget: parseFloat(e.target.value) || 0 }))}
                    className="w-full px-4 py-2.5 bg-card border border-purple-500/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-text"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text mb-2">Target Products</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {products.map((product) => (
                    <label key={product.id} className="flex items-center p-3 border border-purple-500/20 rounded-xl hover:bg-purple-50 dark:hover:bg-purple-900/10 cursor-pointer transition-colors">
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
                        className="mr-3 w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                      />
                      <div className="flex items-center">
                        <img src={product.images?.[0] || '/placeholder.png'} alt={product.name} className="w-10 h-10 object-cover rounded-lg mr-3" />
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
                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-400 disabled:to-gray-400 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-purple-500/25 transition-all"
              >
                Create Campaign
              </button>
            </div>
          </div>
        )}

        {/* Content Generation Tab */}
        {selectedTab === 'content' && (
          <div className="space-y-6">
            <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6">
              <h3 className="text-lg font-medium text-text mb-6">AI Content Generator</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                  <label className="block text-sm font-medium text-text mb-2">Select Product</label>
                  <select
                    value={contentGeneration.productId}
                    onChange={(e) => setContentGeneration(prev => ({ ...prev, productId: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-card border border-purple-500/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-text"
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
                    className="w-full px-4 py-2.5 bg-card border border-purple-500/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-text"
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
                    className="w-full px-4 py-2.5 bg-card border border-purple-500/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-text"
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
                    className="w-full px-4 py-2.5 bg-card border border-purple-500/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-text"
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
                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:from-gray-400 disabled:to-gray-400 text-white font-semibold py-3 px-4 rounded-xl shadow-lg shadow-purple-500/25 transition-all flex items-center justify-center"
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
                  'Generate AI Content'
                )}
              </button>
            </div>

            {contentGeneration.generatedContent && (
              <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6">
                <h4 className="text-lg font-medium text-text mb-4">Generated Content</h4>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text mb-1">Headline</label>
                    <p className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-purple-500/10 text-text">{contentGeneration.generatedContent.headline}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text mb-1">Description</label>
                    <p className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-purple-500/10 text-text">{contentGeneration.generatedContent.description}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text mb-1">Ad Copy Variations</label>
                    <div className="space-y-2">
                      <div>
                        <span className="text-xs font-medium text-muted">Short:</span>
                        <p className="p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-purple-500/10 text-sm text-text">{contentGeneration.generatedContent.adCopy?.short}</p>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-muted">Medium:</span>
                        <p className="p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-purple-500/10 text-sm text-text">{contentGeneration.generatedContent.adCopy?.medium}</p>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-muted">Long:</span>
                        <p className="p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-purple-500/10 text-sm text-text">{contentGeneration.generatedContent.adCopy?.long}</p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text mb-1">Keywords</label>
                    <div className="flex flex-wrap gap-2">
                      {contentGeneration.generatedContent.keywords?.map((keyword: string, index: number) => (
                        <span key={index} className="px-3 py-1 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 text-sm rounded-lg">
                          {keyword}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(contentGeneration.generatedContent, null, 2))
                        alert('Content copied to clipboard!')
                      }}
                      className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white py-2.5 px-4 rounded-xl shadow-lg shadow-green-500/25 transition-all"
                    >
                      Copy Content
                    </button>
                    <button
                      onClick={() => setSelectedTab('create')}
                      className="flex-1 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white py-2.5 px-4 rounded-xl shadow-lg shadow-blue-500/25 transition-all"
                    >
                      Create Campaign
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Analytics Tab */}
        {selectedTab === 'analytics' && (
          <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-12 text-center">
            <svg className="w-16 h-16 text-muted mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <h3 className="text-lg font-medium text-text mb-2">Analytics Dashboard</h3>
            <p className="text-muted">Advanced analytics and reporting coming soon</p>
          </div>
        )}

        {/* Product Feeds Tab */}
        {selectedTab === 'feeds' && (
          <div className="space-y-6">
            <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6">
              <h3 className="text-lg font-medium text-text mb-6">Product Feed Export</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border border-purple-500/20 rounded-xl p-4 hover:border-purple-500/40 transition-colors">
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
                    className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white py-2.5 px-4 rounded-xl shadow-lg shadow-blue-500/25 transition-all"
                  >
                    Export Google Feed
                  </button>
                </div>

                <div className="border border-purple-500/20 rounded-xl p-4 hover:border-purple-500/40 transition-colors">
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
                    className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white py-2.5 px-4 rounded-xl shadow-lg shadow-blue-500/25 transition-all"
                  >
                    Export Facebook Feed
                  </button>
                </div>
              </div>

              <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
                <div className="flex">
                  <svg className="w-5 h-5 text-blue-600 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <h4 className="text-sm font-medium text-blue-900 dark:text-blue-200">Product Feed Guidelines</h4>
                    <ul className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                      <li>Feeds are automatically updated with current product information</li>
                      <li>Only approved products are included in exports</li>
                      <li>Images must be accessible via direct URLs</li>
                      <li>Prices include currency formatting for platform requirements</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Pixel Tracking Setup */}
            <div className="bg-card rounded-xl shadow-lg border border-purple-500/10 p-6">
              <h3 className="text-lg font-medium text-text mb-6">Pixel Tracking Setup</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text mb-2">Google Analytics Tracking ID</label>
                  <input
                    type="text"
                    value={pixelTracking.googlePixelId}
                    onChange={(e) => setPixelTracking(prev => ({ ...prev, googlePixelId: e.target.value }))}
                    placeholder="G-XXXXXXXXXX"
                    className="w-full px-4 py-2.5 bg-card border border-purple-500/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-text"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text mb-2">Facebook Pixel ID</label>
                  <input
                    type="text"
                    value={pixelTracking.facebookPixelId}
                    onChange={(e) => setPixelTracking(prev => ({ ...prev, facebookPixelId: e.target.value }))}
                    placeholder="123456789012345"
                    className="w-full px-4 py-2.5 bg-card border border-purple-500/20 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-text"
                  />
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    checked={pixelTracking.isEnabled}
                    onChange={(e) => setPixelTracking(prev => ({ ...prev, isEnabled: e.target.checked }))}
                    className="mr-2 w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                  />
                  <label className="text-sm text-text">Enable pixel tracking</label>
                </div>

                <button className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white py-2.5 px-4 rounded-xl shadow-lg shadow-purple-500/25 transition-all">
                  Save Tracking Settings
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default MarketingTools
